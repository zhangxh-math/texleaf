/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import * as vscode from "vscode";
import {
  findFractionNumerator,
  planAutoEnlargeAncestors,
  planLeftRightEnter,
  planTabout,
  replacementPartsToText,
  scanLatexRegions,
  type CompiledSnippet,
  type LeftRightEnterPlan,
  type LatexContext,
  type ReplacementPart,
  type SnippetMatch,
} from "./core";
import { isSupportedDocument, readConfig, type TeXLeafConfig } from "./config";
import { type SnippetRecord, SnippetRepository } from "./snippetRepository";
import {
  replacementPartsToSnippetString,
  SnippetRuntime,
  type RuntimeMatch,
} from "./snippetRuntime";
import { TemplateManager, type TemplateMatch } from "./templateManager";

interface TypeCommandArguments {
  readonly text: string;
  readonly replacePreviousCharCnt?: number;
}

const INPUT_DOCUMENT_CHANGE_TIMEOUT_MS = 250;

interface QuickPickSnippet extends vscode.QuickPickItem {
  readonly snippet: CompiledSnippet;
}

interface InputCommandTicket {
  readonly sequence: number;
  readonly segment: number;
}

export interface EditorControllerHooks {
  readonly onEditorStateChanged?: (editor: vscode.TextEditor | undefined) => void;
}

export class EditorController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly applying = new Set<string>();
  private readonly delegatedInputDocuments = new Set<string>();
  private readonly autoTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private inputCommandQueue: Promise<void> = Promise.resolve();
  private postInputCommandQueue: Promise<void> = Promise.resolve();
  private activeInputCommandCount = 0;
  private inputCommandSequence = 0;
  private inputCommandSegment = 0;
  private readonly latestReplacementBySegment = new Map<number, number>();
  private nextCompositionSessionId = 0;
  private queuedCompositionSessionId: number | undefined;
  private activeCompositionSessionId: number | undefined;
  private compositionDocument: vscode.TextDocument | undefined;
  private compositionStartVersion: number | undefined;
  private compositionHadInput = false;
  private contextTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    _extensionContext: vscode.ExtensionContext,
    private readonly repository: SnippetRepository,
    private readonly runtime: SnippetRuntime,
    private readonly templates: TemplateManager,
    private readonly hooks: EditorControllerHooks = {},
  ) {}

  public register(): void {
    this.disposables.push(
      vscode.commands.registerCommand("type", (args: unknown) =>
        this.enqueueInputCommand("type", (ticket) =>
          this.handleType(args, ticket),
        ),
      ),
      vscode.commands.registerCommand("replacePreviousChar", (args: unknown) =>
        this.enqueueInputCommand("replacement", (ticket) =>
          this.handlePostCommitInput(
            "default:replacePreviousChar",
            args,
            ticket,
          ),
        ),
      ),
      vscode.commands.registerCommand("compositionType", (args: unknown) =>
        this.enqueueInputCommand("replacement", (ticket) =>
          this.handlePostCommitInput("default:compositionType", args, ticket),
        ),
      ),
      vscode.commands.registerCommand("compositionStart", (args: unknown) => {
        const sessionId = ++this.nextCompositionSessionId;
        const inputSegment = ++this.inputCommandSegment;
        this.queuedCompositionSessionId = sessionId;
        return this.enqueueInputCommand("passive", () =>
          this.handleCompositionStart(args, sessionId, inputSegment),
          inputSegment,
        );
      }),
      vscode.commands.registerCommand("compositionEnd", (args: unknown) => {
        const sessionId =
          this.queuedCompositionSessionId ?? this.activeCompositionSessionId;
        return this.enqueueInputCommand(
          "passive",
          (ticket) =>
            this.handleCompositionEnd(args, ticket, sessionId),
        );
      }),
      vscode.commands.registerCommand("texleaf.handleTab", () => this.handleTab()),
      vscode.commands.registerCommand("texleaf.handleSuggestTabout", () =>
        this.handleSuggestTabout(),
      ),
      vscode.commands.registerCommand("texleaf.handleSuggestSnippetTab", () =>
        this.handleSuggestSnippetTab(),
      ),
      vscode.commands.registerCommand("texleaf.handleSnippetTab", () =>
        this.handleSnippetTab(),
      ),
      vscode.commands.registerCommand("texleaf.handleSpace", () => this.handleSpace()),
      vscode.commands.registerCommand("texleaf.matrixEnter", () => this.matrixEnter()),
      vscode.commands.registerCommand("texleaf.matrixExit", () => this.matrixExit()),
      vscode.commands.registerCommand("texleaf.deleteEmptyMathDelimiters", () =>
        this.deleteEmptyMathDelimiters(),
      ),
      vscode.commands.registerCommand("texleaf.openSnippetFile", () =>
        this.repository.openGlobalSnippetFile(),
      ),
      vscode.commands.registerCommand("texleaf.openTemplateFile", () =>
        this.templates.openTemplateFile(),
      ),
      vscode.commands.registerCommand("texleaf.reloadSnippets", async () => {
        await this.repository.reload();
        void vscode.window.showInformationMessage(
          `TeXLeaf 已加载 ${this.repository.snapshot.snippets.length} 条片段。`,
        );
      }),
      vscode.commands.registerCommand("texleaf.importSnippets", () =>
        this.repository.importSnippets(),
      ),
      vscode.commands.registerCommand("texleaf.exportSnippets", () =>
        this.repository.exportSnippets(),
      ),
      vscode.commands.registerCommand("texleaf.pickSnippet", () => this.pickSnippet()),
      vscode.commands.registerCommand("texleaf.wrapSelection", () =>
        this.wrapSelection(),
      ),
      vscode.commands.registerCommand(
        "texleaf.insertSnippet",
        (record: SnippetRecord | undefined) => this.insertRecord(record),
      ),
      vscode.commands.registerCommand("texleaf.toggle", () => this.toggle()),
      vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.runtime.forgetDocument(document);
        if (document === this.compositionDocument) {
          this.clearCompositionSession(this.activeCompositionSessionId);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.scheduleContextUpdate();
        this.hooks.onEditorStateChanged?.(editor);
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        this.scheduleContextUpdate();
        this.hooks.onEditorStateChanged?.(event.textEditor);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(async () => {
        this.repository.rebuildWatchers();
        await this.repository.reload();
        this.scheduleContextUpdate();
      }),
      vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!event.affectsConfiguration("texleaf")) {
          return;
        }
        this.repository.rebuildWatchers();
        await this.repository.reload();
        const editor = vscode.window.activeTextEditor;
        this.runtime.configure(readConfig(editor?.document.uri));
        this.scheduleContextUpdate();
        this.hooks.onEditorStateChanged?.(editor);
      }),
      this.templates.onDidChange(() => this.scheduleContextUpdate()),
    );

    this.scheduleContextUpdate();
  }

  public dispose(): void {
    if (this.contextTimer !== undefined) {
      clearTimeout(this.contextTimer);
    }
    for (const timer of this.autoTimers.values()) {
      clearTimeout(timer);
    }
    this.compositionDocument = undefined;
    this.compositionStartVersion = undefined;
    this.compositionHadInput = false;
    this.queuedCompositionSessionId = undefined;
    this.activeCompositionSessionId = undefined;
    this.autoTimers.clear();
    this.delegatedInputDocuments.clear();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private async handleType(
    rawArguments: unknown,
    inputTicket: InputCommandTicket,
  ): Promise<void> {
    const args = coerceTypeArguments(rawArguments);
    const editor = vscode.window.activeTextEditor;
    if (args === undefined || editor === undefined) {
      await vscode.commands.executeCommand("default:type", rawArguments);
      return;
    }

    const config = readConfig(editor.document.uri);
    this.runtime.configure(config);
    if (!isSupportedDocument(editor.document, config) || editor.selections.length !== 1) {
      await vscode.commands.executeCommand("default:type", rawArguments);
      return;
    }
    await this.withDelegatedInput(editor.document, () =>
      this.handleSupportedType(rawArguments, args, inputTicket, editor, config),
    );
  }

  private async handleSupportedType(
    rawArguments: unknown,
    args: TypeCommandArguments,
    inputTicket: InputCommandTicket,
    editor: vscode.TextEditor,
    config: TeXLeafConfig,
  ): Promise<void> {
    if (
      editor.document === this.compositionDocument ||
      this.hasNewerReplacement(inputTicket)
    ) {
      if (editor.document === this.compositionDocument && args.text.length > 0) {
        this.compositionHadInput = true;
      }
      const previousVersion = editor.document.version;
      await vscode.commands.executeCommand("default:type", rawArguments);
      if (args.text.length > 0) {
        await this.waitForDocumentVersionAdvance(
          editor.document,
          previousVersion,
        );
      }
      return;
    }
    if ((args.replacePreviousCharCnt ?? 0) > 0) {
      const previousVersion = editor.document.version;
      const eligible = editor.selections.length === 1 && editor.selection.isEmpty;
      await vscode.commands.executeCommand("default:type", rawArguments);
      if (eligible) {
        await this.expandPostCommitAutoMatch(
          editor,
          inputTicket,
          previousVersion,
        );
      }
      return;
    }

    const selection = editor.selection;
    const typedText = args.text;
    const typedNewline = typedText === "\n" || typedText === "\r\n";
    const leftRightEnter =
      typedNewline && selection.isEmpty && config.matrixShortcuts
        ? leftRightEnterPlan(editor.document, selection.active)
        : undefined;
    if (
      typedNewline &&
      selection.isEmpty &&
      config.matrixShortcuts &&
      (isConfiguredMatrix(
        this.runtime.contextAt(editor.document, selection.active),
        config,
      ) ||
        leftRightEnter !== undefined)
    ) {
      // LaTeX Workshop owns Enter by default and eventually delegates its
      // ordinary newline path to the public `type` command. Route that call
      // back through TeXLeaf while the cursor is in a configured matrix-like
      // environment, so Align row insertion does not depend on extension
      // keybinding order.
      await this.matrixEnter(leftRightEnter);
      return;
    }
    if (typedText.length === 1 && !selection.isEmpty && config.visualSnippets) {
      const visualText = editor.document.getText(selection);
      const context = this.runtime.contextAt(editor.document, selection.active);
      const visualMatch = this.runtime.matchText(
        editor.document,
        typedText,
        "",
        context,
        "visual",
        config,
        visualText,
      );
      if (
        visualMatch !== undefined &&
        !isExcludedContext(context, config) &&
        (await this.insertParts(
          editor,
          visualMatch.replacement,
          selection,
          config,
        ))
      ) {
        return;
      }
    }

    const hasProspectiveAutomaticMatch =
      typedText.length === 1 &&
      selection.isEmpty &&
      config.autoSnippets &&
      (this.templates.matchAfterType(
        editor.document,
        selection.active,
        typedText,
      ) !== undefined ||
        this.syntheticAutomaticMatch(editor, typedText, config) !== undefined);

    if (hasProspectiveAutomaticMatch) {
      const prospectiveVersion = editor.document.version;
      const prospectiveOffset = editor.document.offsetAt(selection.active);

      // A one-character IME/dead-key update can arrive as `type` followed by
      // a replacement on the next event-loop turn. Keep the established
      // pre-insert snippet path (it is required for VS Code to retain `$0` and
      // placeholder selections), but first give that replacement a chance to
      // enqueue and then revalidate the untouched source position.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const editorIsStable =
        vscode.window.activeTextEditor === editor &&
        editor.document.version === prospectiveVersion &&
        editor.selections.length === 1 &&
        editor.selection.isEmpty &&
        editor.document.offsetAt(editor.selection.active) === prospectiveOffset;
      if (!editorIsStable || this.hasNewerReplacement(inputTicket)) {
        const fallbackEditor = vscode.window.activeTextEditor;
        const previousVersion = fallbackEditor?.document.version;
        await vscode.commands.executeCommand("default:type", rawArguments);
        if (fallbackEditor !== undefined && previousVersion !== undefined) {
          await this.waitForDocumentVersionAdvance(
            fallbackEditor.document,
            previousVersion,
          );
        }
        return;
      }

      const template = this.templates.matchAfterType(
        editor.document,
        editor.selection.active,
        typedText,
      );
      if (template !== undefined && (await this.expandTemplate(editor, template))) {
        return;
      }

      const automatic = this.syntheticAutomaticMatch(editor, typedText, config);
      const deferAutoEnlargedSnippet =
        automatic !== undefined &&
        automatic.match.replacement.some((part) => part.kind === "tabstop") &&
        config.autoEnlargeBrackets &&
        planInlineAutoEnlarge(
          editor.document,
          automatic.range,
          automatic.match.replacement,
          config.autoEnlargeTriggers,
        ) !== undefined;
      if (deferAutoEnlargedSnippet) {
        // A native snippet merged from inside the contributed `type` command is
        // discarded when VS Code finishes that command, even if the merge is
        // delayed by a timer. Commit the real trigger character first, let this
        // command return across the extension-host boundary, and only then run
        // the normal committed-text matcher through the post-input barrier.
        // This preserves both the inner snippet's tabstops and any surrounding
        // Snippet Session while keeping later characters/Tab serialized behind
        // the deferred expansion.
        const versionBeforeInput = editor.document.version;
        const expectedOffset = prospectiveOffset + typedText.length;
        await vscode.commands.executeCommand("default:type", rawArguments);
        const changed = await this.waitForDocumentVersionAdvance(
          editor.document,
          versionBeforeInput,
        );
        if (changed) {
          await this.waitForEditorOffset(editor, expectedOffset);
          this.schedulePostInputCommand(() =>
            this.expandPostCommitAutoMatch(
              editor,
              inputTicket,
              versionBeforeInput,
              expectedOffset,
            ),
          );
        }
        return;
      }
      if (
        automatic !== undefined &&
        (await this.insertParts(
          editor,
          automatic.match.replacement,
          automatic.range,
          config,
        ))
      ) {
        return;
      }
    }

    if (
      typedText === "/" &&
      config.autoFraction &&
      !hasProspectiveAutomaticMatch &&
      !selection.isEmpty &&
      (await this.wrapSelectionAsFraction(editor, config))
    ) {
      return;
    }

    if (
      typedText.length === 1 &&
      !hasProspectiveAutomaticMatch &&
      config.skipPairedClosingCharacters &&
      ")]}".includes(typedText) &&
      selection.isEmpty &&
      characterAt(editor.document, selection.active) === typedText
    ) {
      const next = editor.document.positionAt(
        editor.document.offsetAt(selection.active) + typedText.length,
      );
      editor.selection = new vscode.Selection(next, next);
      return;
    }

    const autoFractionSeed =
      config.autoFraction &&
      !hasProspectiveAutomaticMatch &&
      selection.isEmpty &&
      this.canStartAutoFractionAfterType(editor, typedText, config)
        ? typedText
        : undefined;

    const previousVersion = editor.document.version;
    const expectedOffset = selection.isEmpty && !/[\r\n]/u.test(typedText)
      ? editor.document.offsetAt(selection.active) + typedText.length
      : undefined;
    const postCommitEligible =
      typedText.length > 0 && expectedOffset !== undefined;
    await vscode.commands.executeCommand("default:type", rawArguments);
    if (postCommitEligible) {
      await this.expandPostCommitAutoMatch(
        editor,
        inputTicket,
        previousVersion,
        expectedOffset,
        true,
        autoFractionSeed,
      );
    } else if (typedText.length > 0) {
      const changed = await this.waitForDocumentVersionAdvance(
        editor.document,
        previousVersion,
      );
      if (changed) {
        if (expectedOffset === undefined) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        } else {
          await this.waitForEditorOffset(editor, expectedOffset);
        }
      }
    }
  }

  private async handlePostCommitInput(
    defaultCommand: "default:replacePreviousChar" | "default:compositionType",
    rawArguments: unknown,
    inputTicket: InputCommandTicket,
  ): Promise<unknown> {
    const editor = vscode.window.activeTextEditor;
    const eligible =
      editor !== undefined &&
      editor.selections.length === 1 &&
      isSupportedDocument(editor.document, readConfig(editor.document.uri));
    const previousVersion = editor?.document.version;
    return this.withDelegatedInput(editor?.document, async () => {
      if (editor?.document === this.compositionDocument) {
        this.compositionHadInput = true;
      }
      const result = await vscode.commands.executeCommand(
        defaultCommand,
        rawArguments,
      );
      if (editor?.document === this.compositionDocument) {
        return result;
      }
      if (
        eligible &&
        editor !== undefined &&
        previousVersion !== undefined
      ) {
        await this.expandPostCommitAutoMatch(
          editor,
          inputTicket,
          previousVersion,
        );
      }
      return result;
    });
  }

  private async handleCompositionStart(
    rawArguments: unknown,
    sessionId: number,
    inputSegment: number,
  ): Promise<unknown> {
    for (const segment of this.latestReplacementBySegment.keys()) {
      if (segment < inputSegment) {
        this.latestReplacementBySegment.delete(segment);
      }
    }
    const editor = vscode.window.activeTextEditor;
    this.activeCompositionSessionId = sessionId;
    this.compositionDocument = editor?.document;
    this.compositionStartVersion = editor?.document.version;
    this.compositionHadInput = false;
    if (editor !== undefined) {
      this.cancelDocumentAutoTimer(editor.document);
    }
    try {
      return await vscode.commands.executeCommand(
        "default:compositionStart",
        rawArguments,
      );
    } catch (error) {
      this.compositionDocument = undefined;
      this.compositionStartVersion = undefined;
      this.compositionHadInput = false;
      if (this.activeCompositionSessionId === sessionId) {
        this.activeCompositionSessionId = undefined;
      }
      if (this.queuedCompositionSessionId === sessionId) {
        this.queuedCompositionSessionId = undefined;
      }
      throw error;
    }
  }

  private async handleCompositionEnd(
    rawArguments: unknown,
    inputTicket: InputCommandTicket,
    sessionId: number | undefined,
  ): Promise<unknown> {
    const trackedComposition =
      sessionId !== undefined && this.activeCompositionSessionId === sessionId;
    const compositionDocument = trackedComposition
      ? this.compositionDocument
      : undefined;
    const compositionStartVersion = trackedComposition
      ? this.compositionStartVersion
      : undefined;
    const compositionHadInput = trackedComposition && this.compositionHadInput;
    let result: unknown;
    try {
      result = await vscode.commands.executeCommand(
        "default:compositionEnd",
        rawArguments,
      );
    } catch (error) {
      if (trackedComposition) {
        this.clearCompositionSession(sessionId);
      }
      throw error;
    }

    const editor = vscode.window.activeTextEditor;
    const shouldMatch =
      trackedComposition &&
      compositionHadInput &&
      compositionDocument !== undefined &&
      editor?.document === compositionDocument &&
      compositionStartVersion !== undefined;
    if (trackedComposition) {
      this.clearCompositionSession(sessionId);
    }
    if (shouldMatch && editor !== undefined) {
      await this.expandPostCommitAutoMatch(
        editor,
        inputTicket,
        compositionStartVersion,
        undefined,
        false,
      );
    }
    return result;
  }

  private async handleTab(): Promise<void> {
    const originatingEditor = vscode.window.activeTextEditor;
    await this.inputCommandQueue;
    await this.postInputCommandQueue;
    const editor = vscode.window.activeTextEditor;
    if (editor !== originatingEditor) {
      return;
    }
    if (editor === undefined) {
      return;
    }
    const config = readConfig(editor.document.uri);
    if (!isSupportedDocument(editor.document, config)) {
      await vscode.commands.executeCommand("tab");
      return;
    }

    if (editor.selections.length === 1 && editor.selection.isEmpty) {
      const template = this.templates.match(
        editor.document,
        editor.selection.active,
      );
      if (template !== undefined) {
        await vscode.commands.executeCommand("hideSuggestWidget");
        if (await this.expandTemplate(editor, template)) {
          return;
        }
      }
    }

    if (
      config.manualTrigger === "tab" &&
      editor.selections.length === 1 &&
      editor.selection.isEmpty &&
      (await this.expandManualSnippet(editor, config, true))
    ) {
      return;
    }

    const context = this.runtime.contextAt(editor.document, editor.selection.active);
    if (await this.tryTabout(editor, config, context)) {
      return;
    }

    if (
      config.matrixShortcuts &&
      editor.selections.length === 1 &&
      editor.selection.isEmpty &&
      isConfiguredMatrix(context, config)
    ) {
      const lineStart = new vscode.Position(editor.selection.active.line, 0);
      const linePrefix = editor.document.getText(
        new vscode.Range(lineStart, editor.selection.active),
      );
      // At a freshly indented row start, a leading separator space becomes
      // part of the line indentation and is copied by every following Enter.
      // Insert `& ` there; retain ` & ` between ordinary matrix cells.
      const insertion = /^\s*$/u.test(linePrefix) ? "& " : " & ";
      await this.withMutation(editor.document.uri, () =>
        editor.edit(
          (builder) => builder.insert(editor.selection.active, insertion),
          { undoStopBefore: true, undoStopAfter: true },
        ),
      );
      return;
    }

    await vscode.commands.executeCommand("tab");
  }

  /**
   * Resolve Tab while native Suggest is visible. The keybinding reaches this
   * command only outside active snippet/inline-completion sessions. A real
   * Tabout target wins; otherwise preserve VS Code's normal selected-suggestion
   * acceptance instead of swallowing Tab or inserting indentation.
   */
  private async handleSuggestTabout(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor !== undefined) {
      const config = readConfig(editor.document.uri);
      if (isSupportedDocument(editor.document, config)) {
        const context = this.runtime.contextAt(editor.document, editor.selection.active);
        if (await this.tryTabout(editor, config, context)) {
          return;
        }
      }
    }
    await vscode.commands.executeCommand("acceptSelectedSuggestion");
  }

  private async handleSuggestSnippetTab(): Promise<void> {
    await this.handleSnippetTab(true);
  }

  private async handleSnippetTab(dismissSuggestions = false): Promise<void> {
    // Keyboard input commands are dispatched across the extension-host bridge
    // without the renderer awaiting each one. Serialize snippet navigation
    // behind the last TeXLeaf input so a rapid final character + Tab cannot
    // advance the outer session before an inner automatic snippet is installed.
    // Capture the originating editor so a focus change while the queue drains
    // cannot apply the delayed Tab to a different document.
    const originatingEditor = vscode.window.activeTextEditor;
    await this.inputCommandQueue;
    await this.postInputCommandQueue;

    if (
      originatingEditor === undefined ||
      vscode.window.activeTextEditor !== originatingEditor
    ) {
      return;
    }

    if (dismissSuggestions) {
      await vscode.commands.executeCommand("hideSuggestWidget");
      if (vscode.window.activeTextEditor !== originatingEditor) {
        return;
      }
    }

    const config = readConfig(originatingEditor.document.uri);
    if (
      isSupportedDocument(originatingEditor.document, config) &&
      originatingEditor.selections.length === 1 &&
      originatingEditor.selection.isEmpty
    ) {
      const template = this.templates.match(
        originatingEditor.document,
        originatingEditor.selection.active,
      );
      if (
        template !== undefined &&
        (await this.expandTemplate(originatingEditor, template))
      ) {
        return;
      }

      if (
        config.manualTrigger === "tab" &&
        (await this.expandManualSnippet(
          originatingEditor,
          config,
          false,
          true,
        ))
      ) {
        return;
      }
    }

    if (vscode.window.activeTextEditor !== originatingEditor) {
      return;
    }
    if (
      isSupportedDocument(originatingEditor.document, config) &&
      originatingEditor.selections.length === 1 &&
      originatingEditor.selection.isEmpty
    ) {
      const context = this.runtime.contextAt(
        originatingEditor.document,
        originatingEditor.selection.active,
      );
      // Textual environment snippets (for example a theorem body containing
      // `(1|)`) should leave the local closer before jumping out of the
      // environment. Mathematical snippets must keep their established
      // numerator/denominator/etc. tabstop order instead of Tabout claiming a
      // structural brace first.
      if (
        context.mathMode === "text"
        && (await this.tryTabout(originatingEditor, config, context, true))
      ) {
        return;
      }
    }
    await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
  }

  private async tryTabout(
    editor: vscode.TextEditor,
    config: TeXLeafConfig,
    context: LatexContext,
    allowTextLine = false,
  ): Promise<boolean> {
    if (
      !config.tabout ||
      editor.selections.length !== 1 ||
      !editor.selection.isEmpty ||
      (context.mathMode === "text" && !allowTextLine)
    ) {
      return false;
    }
    const document = editor.document;
    const version = document.version;
    const from = editor.selection.active;
    const offset = document.offsetAt(from);
    const line = document.lineAt(from.line);
    const plan = context.mathMode === "text"
      ? planTabout(document.getText(), offset, {
          innerStart: document.offsetAt(line.range.start),
          innerEnd: document.offsetAt(line.range.end),
          outerEnd: document.offsetAt(line.range.end),
          arrayMode: true,
        })
      : planTabout(document.getText(), offset, {
          arrayMode: isConfiguredMatrix(context, config),
        });
    if (plan === undefined) {
      return false;
    }

    await vscode.commands.executeCommand("hideSuggestWidget");
    if (
      vscode.window.activeTextEditor !== editor ||
      document.version !== version ||
      !editor.selection.isEmpty ||
      !editor.selection.active.isEqual(from)
    ) {
      return true;
    }
    const target = document.positionAt(plan.to);
    editor.selection = new vscode.Selection(target, target);
    editor.revealRange(new vscode.Range(target, target));
    return true;
  }

  private async handleSpace(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      return;
    }
    const config = readConfig(editor.document.uri);
    if (
      isSupportedDocument(editor.document, config) &&
      config.manualTrigger === "space" &&
      editor.selection.isEmpty &&
      (await this.expandManualSnippet(editor, config))
    ) {
      return;
    }
    await vscode.commands.executeCommand("default:type", { text: " " });
  }

  private async matrixEnter(precomputedLeftRight?: LeftRightEnterPlan): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      return;
    }
    const config = readConfig(editor.document.uri);
    const context = this.runtime.contextAt(editor.document, editor.selection.active);
    if (
      !isSupportedDocument(editor.document, config) ||
      !config.matrixShortcuts ||
      !editor.selection.isEmpty
    ) {
      await vscode.commands.executeCommand("default:type", { text: "\n" });
      return;
    }

    const leftRight =
      precomputedLeftRight ??
      leftRightEnterPlan(editor.document, editor.selection.active);
    if (leftRight !== undefined) {
      const inserted = await this.withMutation(editor.document.uri, () =>
        editor.edit(
          (builder) =>
            builder.insert(
              editor.document.positionAt(leftRight.insertionOffset),
              leftRight.insertionText,
            ),
          { undoStopBefore: true, undoStopAfter: true },
        ),
      );
      if (inserted) {
        const target = editor.document.positionAt(leftRight.cursorOffset);
        editor.selection = new vscode.Selection(target, target);
      }
      return;
    }

    if (!isConfiguredMatrix(context, config)) {
      await vscode.commands.executeCommand("default:type", { text: "\n" });
      return;
    }

    const indentation = /^\s*/.exec(
      editor.document.lineAt(editor.selection.active.line).text,
    )?.[0] ?? "";
    const endOfLine =
      editor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const insertion =
      context.mathMode === "block"
        ? ` \\\\${endOfLine}${indentation}`
        : " \\\\ ";
    const offset = editor.document.offsetAt(editor.selection.active);
    const inserted = await this.withMutation(editor.document.uri, () =>
      editor.edit(
        (builder) => builder.insert(editor.selection.active, insertion),
        { undoStopBefore: true, undoStopAfter: true },
      ),
    );
    if (inserted) {
      const target = editor.document.positionAt(offset + insertion.length);
      editor.selection = new vscode.Selection(target, target);
    }
  }

  private async matrixExit(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      return;
    }
    const config = readConfig(editor.document.uri);
    const context = this.runtime.contextAt(editor.document, editor.selection.active);
    if (
      !isSupportedDocument(editor.document, config) ||
      !config.matrixShortcuts ||
      !isConfiguredMatrix(context, config)
    ) {
      await vscode.commands.executeCommand("default:type", { text: "\n" });
      return;
    }

    const text = editor.document.getText();
    const offset = editor.document.offsetAt(editor.selection.active);
    const region = innermostMathRegion(text, offset);
    if (region !== undefined) {
      const target = editor.document.positionAt(region.outerEnd);
      editor.selection = new vscode.Selection(target, target);
      editor.revealRange(new vscode.Range(target, target));
    }
  }

  private async deleteEmptyMathDelimiters(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      return;
    }
    const config = readConfig(editor.document.uri);
    const range = emptyMathDelimiterRange(editor.document, editor.selection);
    if (
      !isSupportedDocument(editor.document, config) ||
      !config.autoDeleteMathDelimiters ||
      range === undefined
    ) {
      await vscode.commands.executeCommand("deleteLeft");
      return;
    }
    await this.withMutation(editor.document.uri, () =>
      editor.edit((builder) => builder.delete(range), {
        undoStopBefore: true,
        undoStopAfter: true,
      }),
    );
  }

  private async pickSnippet(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showWarningMessage("请先打开一个 LaTeX 编辑器。");
      return;
    }
    const config = readConfig(editor.document.uri);
    if (!isSupportedDocument(editor.document, config)) {
      void vscode.window.showWarningMessage("当前文档未启用 TeXLeaf。");
      return;
    }
    const context = this.runtime.contextAt(editor.document, editor.selection.active);
    const candidates: QuickPickSnippet[] = this.runtime
      .compiledSnippetsFor(editor.document, config)
      .filter(
        (snippet) =>
          !snippet.disabled &&
          snippet.triggerKind === "literal" &&
          !snippet.options.visual &&
          snippetAppliesToContext(snippet, context),
      )
      .map((snippet) => ({
        label: snippet.triggerSource,
        ...(snippet.description === undefined
          ? {}
          : { description: snippet.description }),
        detail: replacementPartsToText(this.runtime.partsForSnippet(snippet)),
        snippet,
      }));
    const selected = await vscode.window.showQuickPick(candidates, {
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: "搜索触发器、说明或 replacement",
      title: "TeXLeaf 片段",
    });
    if (selected !== undefined) {
      await this.insertParts(
        editor,
        this.runtime.partsForSnippet(selected.snippet),
        editor.selection,
        config,
      );
    }
  }

  private async wrapSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || editor.selection.isEmpty) {
      void vscode.window.showWarningMessage("请先选择要包裹的 LaTeX 内容。");
      return;
    }
    const config = readConfig(editor.document.uri);
    if (!isSupportedDocument(editor.document, config)) {
      void vscode.window.showWarningMessage(
        "TeXLeaf 片段只能在已保存的 .tex 或 .bib 文件中使用。",
      );
      return;
    }
    const context = this.runtime.contextAt(editor.document, editor.selection.active);
    const candidates: QuickPickSnippet[] = this.runtime
      .compiledSnippetsFor(editor.document, config)
      .filter(
        (snippet) =>
          !snippet.disabled &&
          snippet.options.visual &&
          snippetAppliesToContext(snippet, context),
      )
      .map((snippet) => ({
        label: snippet.triggerSource,
        ...(snippet.description === undefined
          ? {}
          : { description: snippet.description }),
        detail: snippet.replacement,
        snippet,
      }));
    const selected = await vscode.window.showQuickPick(candidates, {
      placeHolder: "选择包裹方式",
      title: "TeXLeaf Visual Snippets",
    });
    if (selected === undefined) {
      return;
    }
    const visualText = editor.document.getText(editor.selection);
    await this.insertParts(
      editor,
      this.runtime.partsForSnippet(selected.snippet, visualText),
      editor.selection,
      config,
    );
  }

  private async insertRecord(record: SnippetRecord | undefined): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (record === undefined || editor === undefined) {
      return;
    }
    if (!record.enabled) {
      void vscode.window.showInformationMessage("该片段已停用。");
      return;
    }
    const config = readConfig(editor.document.uri);
    if (!isSupportedDocument(editor.document, config)) {
      void vscode.window.showWarningMessage(
        "TeXLeaf 片段只能在已保存的 .tex 或 .bib 文件中使用。",
      );
      return;
    }
    if (record.options.includes("r")) {
      void vscode.window.showInformationMessage(
        "正则片段需要在编辑器中键入匹配文本后触发，不能从片段树直接插入。",
      );
      return;
    }
    const visualText = record.options.includes("v")
      ? editor.document.getText(editor.selection)
      : undefined;
    if (record.options.includes("v") && visualText?.length === 0) {
      void vscode.window.showWarningMessage("该片段需要先选择内容。");
      return;
    }
    const parts = this.runtime.partsForRecord(
      record,
      editor.document,
      config,
      visualText,
    );
    if (parts === undefined) {
      void vscode.window.showWarningMessage(
        "该工作区附加片段不属于当前文档所在的工作区，未执行插入。",
      );
      return;
    }
    await this.insertParts(
      editor,
      parts,
      editor.selection,
      config,
    );
  }

  private async toggle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const config = vscode.workspace.getConfiguration("texleaf", editor?.document.uri);
    const current = config.get<boolean>("enabled", true);
    const target =
      vscode.workspace.workspaceFolders === undefined
        ? vscode.ConfigurationTarget.Global
        : vscode.ConfigurationTarget.Workspace;
    await config.update("enabled", !current, target);
    void vscode.window.showInformationMessage(`TeXLeaf 已${current ? "停用" : "启用"}。`);
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    this.runtime.handleDocumentChange(event);
    this.scheduleContextUpdate();
    if (
      event.document === this.compositionDocument &&
      event.contentChanges.length > 0
    ) {
      this.compositionHadInput = true;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor?.document === event.document) {
      this.hooks.onEditorStateChanged?.(editor);
    }

    const key = event.document.uri.toString();
    if (
      this.applying.has(key) ||
      this.delegatedInputDocuments.has(key) ||
      event.reason === vscode.TextDocumentChangeReason.Undo ||
      event.reason === vscode.TextDocumentChangeReason.Redo
    ) {
      return;
    }
    if (event.document === this.compositionDocument) {
      // Composition text is provisional until `compositionEnd`. Expanding an
      // intermediate suffix would make the IME's next replacement target stale.
      return;
    }
    const config = readConfig(event.document.uri);
    if (
      (!config.autoSnippets && !config.autoFraction) ||
      !isSupportedDocument(event.document, config)
    ) {
      return;
    }
    const change = event.contentChanges[0];
    if (
      event.contentChanges.length !== 1 ||
      change === undefined ||
      change.rangeLength !== 0 ||
      change.text.length !== 1 ||
      /[\r\n]/.test(change.text)
    ) {
      return;
    }

    const previous = this.autoTimers.get(key);
    if (previous !== undefined) {
      clearTimeout(previous);
    }
    const expectedVersion = event.document.version;
    const expectedOffset = change.rangeOffset + change.text.length;
    this.autoTimers.set(
      key,
      setTimeout(() => {
        this.autoTimers.delete(key);
        void this.expandAfterChange(
          event.document,
          expectedVersion,
          expectedOffset,
          change.text,
          config,
        );
      }, 0),
    );
  }

  private async expandAfterChange(
    document: vscode.TextDocument,
    expectedVersion: number,
    expectedOffset: number,
    insertedText: string,
    config: TeXLeafConfig,
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (
      editor === undefined ||
      editor.document !== document ||
      document === this.compositionDocument ||
      document.version !== expectedVersion ||
      editor.selections.length !== 1 ||
      !editor.selection.isEmpty ||
      document.offsetAt(editor.selection.active) !== expectedOffset
    ) {
      return;
    }
    if (config.autoSnippets) {
      const template = this.templates.match(document, editor.selection.active);
      if (template !== undefined && (await this.expandTemplate(editor, template))) {
        return;
      }

      const runtimeMatch = this.runtime.matchAt(
        document,
        editor.selection.active,
        "auto",
        config,
      );
      if (
        runtimeMatch !== undefined &&
        (await this.insertParts(
          editor,
          runtimeMatch.match.replacement,
          runtimeMatch.range,
          config,
        ))
      ) {
        // Explicit automatic snippets such as `//` take precedence over the
        // generic fraction transform.
        return;
      }
    }

    if (config.autoFraction) {
      await this.expandAutoFractionAfterChange(
        editor,
        expectedOffset,
        insertedText,
        config,
      );
    }
  }

  private async expandAutoFractionAfterChange(
    editor: vscode.TextEditor,
    cursorOffset: number,
    insertedText: string,
    config: TeXLeafConfig,
  ): Promise<boolean> {
    const text = editor.document.getText();
    let denominatorEnd = cursorOffset;

    // Ordinarily the first denominator character triggers the transform. If
    // several keys arrived before the deferred change handler ran, scan the
    // complete denominator suffix so fast typing (`1/23`) is not lost.
    if (!isFractionDenominatorSeed(insertedText, config.autoFractionBreakingCharacters)) {
      return false;
    }
    let denominatorStart = denominatorEnd;
    while (denominatorStart > 0) {
      const character = text[denominatorStart - 1];
      if (
        character === undefined ||
        !isFractionDenominatorSeed(character, config.autoFractionBreakingCharacters)
      ) {
        break;
      }
      denominatorStart -= 1;
    }

    const slashOffset = denominatorStart - 1;
    if (
      slashOffset < 0 ||
      denominatorStart === denominatorEnd ||
      text[slashOffset] !== "/" ||
      text[slashOffset - 1] === "/" ||
      isEscapedAt(text, slashOffset)
    ) {
      return false;
    }

    const position = editor.document.positionAt(cursorOffset);
    const context = this.runtime.contextAt(editor.document, position);
    if (context.mathMode === "text" || isExcludedContext(context, config)) {
      return false;
    }

    const region = innermostMathRegion(text, slashOffset);
    const plan = findFractionNumerator(text, slashOffset, {
      lowerBound: region?.innerStart ?? 0,
      breakingCharacters: config.autoFractionBreakingCharacters,
    });
    if (plan === undefined || plan.numerator.length === 0) {
      return false;
    }

    const denominator = text.slice(denominatorStart, denominatorEnd);
    const fractionPrefix =
      `${config.autoFractionCommand}{${plan.numerator}}{${denominator}`;
    const parts: ReplacementPart[] = [
      {
        kind: "text",
        value: fractionPrefix,
      },
      { kind: "tabstop", index: 0 },
      { kind: "text", value: "}" },
      { kind: "tabstop", index: 1 },
    ];
    const range = new vscode.Range(
      editor.document.positionAt(plan.replacementRange.start),
      editor.document.positionAt(denominatorEnd),
    );
    const inserted = await this.insertParts(editor, parts, range, config);
    if (!inserted) {
      return false;
    }

    // When this fallback follows a programmatic TextEditor.edit, VS Code can
    // preserve the pre-replacement selection even though insertSnippet applied
    // the snippet text. Pin the cursor to the first neutral tabstop so editor
    // API input behaves like physical typing. The normal `type` path already
    // lands here and is unaffected.
    // insertSnippet can resolve just before its document/selection updates are
    // observable to an onDidChangeTextDocument caller. Yield once so the
    // replacement and the corrective cursor move are ordered deterministically.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (vscode.window.activeTextEditor !== editor) {
      return true;
    }
    const updatedText = editor.document.getText();
    const fractionStart = updatedText.indexOf(
      fractionPrefix,
      plan.replacementRange.start,
    );
    if (
      fractionStart >= plan.replacementRange.start &&
      fractionStart <= plan.replacementRange.start + 512
    ) {
      const target = editor.document.positionAt(
        fractionStart + fractionPrefix.length,
      );
      if (!editor.selection.active.isEqual(target)) {
        editor.selection = new vscode.Selection(target, target);
      }
    }
    return true;
  }

  private syntheticAutomaticMatch(
    editor: vscode.TextEditor,
    typedText: string,
    config: TeXLeafConfig,
  ): RuntimeMatch | undefined {
    const document = editor.document;
    const position = editor.selection.active;
    const cursorOffset = document.offsetAt(position);
    const prefixStart = Math.max(0, cursorOffset - config.maxRegexScanLength);
    const prefix = document.getText(
      new vscode.Range(document.positionAt(prefixStart), position),
    );
    const context = this.runtime.contextAt(document, position);
    if (isExcludedContext(context, config)) {
      return undefined;
    }
    const match = this.runtime.matchText(
      document,
      `${prefix}${typedText}`,
      characterAt(document, position),
      context,
      "auto",
      config,
    );
    if (match === undefined) {
      return undefined;
    }
    const absoluteStart = prefixStart + match.startOffset;
    // The synthetic final character has not been inserted, so the replacement
    // range ends at the current cursor rather than match.endOffset.
    return {
      match,
      range: new vscode.Range(document.positionAt(absoluteStart), position),
      context,
    };
  }

  private async expandManualSnippet(
    editor: vscode.TextEditor,
    config: TeXLeafConfig,
    dismissSuggestions = false,
    manualOnly = false,
  ): Promise<boolean> {
    const runtimeMatch = this.runtime.matchAt(
      editor.document,
      editor.selection.active,
      manualOnly ? "manual-only" : "manual",
      config,
    );
    if (runtimeMatch === undefined) {
      return false;
    }
    // While VS Code is already navigating a live Snippet Session, generated
    // delimiters immediately before an empty placeholder can themselves be
    // valid automatic triggers (`{`, `[`, ...). `manual-only` filters those
    // candidates before priority/length/source ordering chooses the winner, so
    // a lower-priority explicit manual rule at the same cursor remains usable.
    if (dismissSuggestions) {
      await vscode.commands.executeCommand("hideSuggestWidget");
    }
    return this.insertParts(
      editor,
      runtimeMatch.match.replacement,
      runtimeMatch.range,
      config,
    );
  }

  private async expandTemplate(
    editor: vscode.TextEditor,
    match: TemplateMatch,
  ): Promise<boolean> {
    const snippet = replacementPartsToSnippetString(match.parts);
    return this.withMutation(editor.document.uri, () =>
      editor.insertSnippet(snippet, match.range, {
        undoStopBefore: true,
        undoStopAfter: true,
        // Template files already contain their intended top-level formatting.
        keepWhitespace: true,
      }),
    );
  }

  private async wrapSelectionAsFraction(
    editor: vscode.TextEditor,
    config: TeXLeafConfig,
  ): Promise<boolean> {
    const selection = editor.selection;
    const context = this.runtime.contextAt(editor.document, selection.active);
    if (
      selection.isEmpty ||
      context.mathMode === "text" ||
      isExcludedContext(context, config)
    ) {
      return false;
    }
    const numerator = stripCompleteOuterParentheses(
      editor.document.getText(selection),
    );
    if (numerator.length === 0) {
      return false;
    }
    const parts: ReplacementPart[] = [
      { kind: "text", value: `${config.autoFractionCommand}{${numerator}}{` },
      { kind: "tabstop", index: 0 },
      { kind: "text", value: "}" },
      { kind: "tabstop", index: 1 },
    ];
    return this.insertParts(editor, parts, selection, config);
  }

  private canStartAutoFractionAfterType(
    editor: vscode.TextEditor,
    seed: string,
    config: TeXLeafConfig,
  ): boolean {
    if (!isFractionDenominatorSeed(seed, config.autoFractionBreakingCharacters)) {
      return false;
    }
    const cursorOffset = editor.document.offsetAt(editor.selection.active);
    const slashOffset = cursorOffset - 1;
    const text = editor.document.getText();
    if (
      slashOffset < 0 ||
      text[slashOffset] !== "/" ||
      text[slashOffset - 1] === "/" ||
      isEscapedAt(text, slashOffset)
    ) {
      return false;
    }
    const context = this.runtime.contextAt(
      editor.document,
      editor.selection.active,
    );
    if (context.mathMode === "text" || isExcludedContext(context, config)) {
      return false;
    }
    const region = innermostMathRegion(text, slashOffset);
    const plan = findFractionNumerator(text, slashOffset, {
      lowerBound: region?.innerStart ?? 0,
      breakingCharacters: config.autoFractionBreakingCharacters,
    });
    return plan !== undefined && plan.numerator.length > 0;
  }

  private async insertParts(
    editor: vscode.TextEditor,
    parts: readonly ReplacementPart[],
    range: vscode.Range,
    config: TeXLeafConfig,
    allowAutoEnlarge = true,
  ): Promise<boolean> {
    if (allowAutoEnlarge && config.autoEnlargeBrackets) {
      const enlarged = planInlineAutoEnlarge(
        editor.document,
        range,
        parts,
        config.autoEnlargeTriggers,
      );
      if (enlarged !== undefined) {
        return this.insertAutoEnlargedParts(editor, enlarged);
      }
    }
    const narrowed = narrowUnchangedLeadingReplacement(
      editor.document,
      range,
      parts,
    );
    const replacementRange = narrowed.range;
    const replacementParts = narrowed.parts;
    const plainReplacementText = replacementPartsToText(replacementParts);
    const usePlainTextEdit =
      replacementParts.every((part) => part.kind === "text") &&
      !hasLineBreak(editor.document.getText(replacementRange)) &&
      !hasLineBreak(plainReplacementText);
    const snippet = usePlainTextEdit
      ? undefined
      : replacementPartsToSnippetString(replacementParts);
    const replacementStartOffset = editor.document.offsetAt(
      replacementRange.start,
    );
    return this.withMutation(editor.document.uri, async () => {
      if (usePlainTextEdit) {
        const edited = await editor.edit(
          (builder) => builder.replace(replacementRange, plainReplacementText),
          { undoStopBefore: true, undoStopAfter: true },
        );
        if (!edited) {
          return false;
        }

        // A normal model edit can merge into an existing outer Snippet Session;
        // TextEditor.insertSnippet(range) cannot. Keep the caret at the end of
        // this inner normalization only while it is still inside the edit. A
        // very fast following Tab may already have selected the outer snippet's
        // next placeholder, which must never be pulled back here.
        const currentSelectionOffset = editor.document.offsetAt(
          editor.selection.active,
        );
        if (
          vscode.window.activeTextEditor === editor &&
          editor.selection.isEmpty &&
          currentSelectionOffset >= replacementStartOffset &&
          currentSelectionOffset <=
            replacementStartOffset + plainReplacementText.length &&
          editor.document
            .getText()
            .slice(
              replacementStartOffset,
              replacementStartOffset + plainReplacementText.length,
            ) === plainReplacementText
        ) {
          const target = editor.document.positionAt(
            replacementStartOffset + plainReplacementText.length,
          );
          editor.selection = new vscode.Selection(target, target);
        }
        return true;
      }

      if (snippet === undefined) {
        return false;
      }
      if (vscode.window.activeTextEditor !== editor) {
        return false;
      }
      // The TextEditor.insertSnippet(range) API applies snippet edits and
      // unconditionally replaces an existing Snippet Session. Selecting the
      // matched range and invoking VS Code's editor command instead uses the
      // native `SnippetController.insert` path, which merges an inner snippet
      // into the active outer session.
      editor.selection = new vscode.Selection(
        replacementRange.start,
        replacementRange.end,
      );
      await vscode.commands.executeCommand("editor.action.insertSnippet", {
        snippet: snippet.value,
      });
      return true;
    });
  }

  private async insertAutoEnlargedParts(
    editor: vscode.TextEditor,
    enlarged: EnlargedInsertion,
  ): Promise<boolean> {
    const document = editor.document;
    const rangeStart = document.offsetAt(enlarged.range.start);
    const rangeEnd = document.offsetAt(enlarged.range.end);
    const plain = replacementPartsToText(enlarged.parts);
    const hasTabstops = enlarged.parts.some((part) => part.kind === "tabstop");

    return this.withMutation(document.uri, async () => {
      if (vscode.window.activeTextEditor !== editor) {
        return false;
      }
      const sourceBeforeEdit = document.getText();
      if (
        enlarged.modifiers.some(
          (modifier) =>
            sourceBeforeEdit.slice(
              modifier.offset,
              modifier.offset + modifier.original.length,
            ) !== modifier.original,
        )
      ) {
        return false;
      }

      if (!hasTabstops) {
        const edited = await editor.edit(
          (builder) => {
            builder.replace(enlarged.range, plain);
            for (const modifier of enlarged.modifiers) {
              builder.replace(
                new vscode.Range(
                  document.positionAt(modifier.offset),
                  document.positionAt(modifier.offset + modifier.original.length),
                ),
                modifier.text,
              );
            }
          },
          { undoStopBefore: true, undoStopAfter: true },
        );
        if (!edited) {
          return false;
        }

        const leadingShift = enlarged.modifiers
          .filter((modifier) => modifier.offset < rangeStart)
          .reduce(
            (total, modifier) =>
              total + modifier.text.length - modifier.original.length,
            0,
          );
        const endAffinityShift = enlarged.modifiers
          .filter((modifier) => modifier.offset === rangeEnd)
          .reduce(
            (total, modifier) =>
              total + modifier.text.length - modifier.original.length,
            0,
          );
        const replacementStart = rangeStart + leadingShift;
        const replacementEnd = replacementStart + plain.length;
        const currentOffset = document.offsetAt(editor.selection.active);
        if (
          vscode.window.activeTextEditor === editor &&
          editor.selection.isEmpty &&
          (currentOffset === replacementEnd ||
            currentOffset === replacementEnd + endAffinityShift) &&
          document.getText().slice(replacementStart, replacementEnd) === plain
        ) {
          const target = document.positionAt(replacementEnd);
          editor.selection = new vscode.Selection(target, target);
        }
        return true;
      }

      // A model edit after `editor.action.insertSnippet` makes VS Code discard
      // the just-created inner Snippet Session. Insert every outside modifier
      // first, while the current outer placeholder can still track ordinary
      // edits, then merge the inner snippet into the shifted trigger range as
      // the final operation. VS Code's public command always creates its own
      // undo boundary, so this tabstop path intentionally has two safe undo
      // stages; preserving both inner and outer navigation takes precedence.
      const originalTriggerText = document.getText(enlarged.range);
      const leadingShift = enlarged.modifiers
        .filter((modifier) => modifier.offset < rangeStart)
        .reduce(
          (total, modifier) =>
            total + modifier.text.length - modifier.original.length,
          0,
        );
      const modifiersEdited = await editor.edit(
        (builder) => {
          for (const modifier of enlarged.modifiers) {
            builder.replace(
              new vscode.Range(
                document.positionAt(modifier.offset),
                document.positionAt(modifier.offset + modifier.original.length),
              ),
              modifier.text,
            );
          }
        },
        { undoStopBefore: true, undoStopAfter: true },
      );
      if (!modifiersEdited) {
        return false;
      }

      const shiftedStart = rangeStart + leadingShift;
      const shiftedEnd = shiftedStart + (rangeEnd - rangeStart);
      const versionAfterModifiers = document.version;
      const expectedSelectionAnchor = document.offsetAt(editor.selection.anchor);
      const expectedSelectionActive = document.offsetAt(editor.selection.active);
      const mergeInnerSnippet = async (): Promise<boolean> => {
        if (
          vscode.window.activeTextEditor !== editor ||
          document.version !== versionAfterModifiers ||
          document.getText().slice(shiftedStart, shiftedEnd) !== originalTriggerText ||
          editor.selections.length !== 1 ||
          document.offsetAt(editor.selection.anchor) !== expectedSelectionAnchor ||
          document.offsetAt(editor.selection.active) !== expectedSelectionActive
        ) {
          return false;
        }

        const snippet = replacementPartsToSnippetString(enlarged.parts);
        editor.selection = new vscode.Selection(
          document.positionAt(shiftedStart),
          document.positionAt(shiftedEnd),
        );
        await vscode.commands.executeCommand("editor.action.insertSnippet", {
          snippet: snippet.value,
        });
        // Replacing a document (or undoing an earlier automatic snippet) can
        // leave VS Code's native SnippetController in a stale session.  In
        // that state a newly merged snippet may visibly start at its second
        // placeholder even though its own first placeholder is still valid.
        // Re-anchor to the first neutral TeXLeaf stop after VS Code has
        // committed the insertion.  This is also correct for a genuine nested
        // snippet: its local numerator/body must own Tab before the enclosing
        // placeholder continues.
        const firstStop = firstReplacementTabstopSelection(enlarged.parts);
        if (firstStop !== undefined) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (
            vscode.window.activeTextEditor === editor &&
            document.getText().slice(shiftedStart, shiftedStart + plain.length) ===
              plain
          ) {
            const anchor = document.positionAt(shiftedStart + firstStop.start);
            const active = document.positionAt(shiftedStart + firstStop.end);
            if (
              !editor.selection.anchor.isEqual(anchor) ||
              !editor.selection.active.isEqual(active)
            ) {
              editor.selection = new vscode.Selection(anchor, active);
            }
          }
        }
        return true;
      };

      if (this.activeInputCommandCount > 0) {
        // A nested Snippet Session created before a contributed `type` command
        // returns is discarded by VS Code when that outer command unwinds.
        // Finish this handler first, but publish a queue barrier so any later
        // character or Tab waits for the native merge to complete.
        this.schedulePostInputCommand(async () => {
          await this.withMutation(document.uri, mergeInnerSnippet);
        });
        return true;
      }

      return mergeInnerSnippet();
    });
  }

  private scheduleContextUpdate(): void {
    if (this.contextTimer !== undefined) {
      clearTimeout(this.contextTimer);
    }
    this.contextTimer = setTimeout(() => {
      this.contextTimer = undefined;
      void this.updateContextKeys();
    }, 0);
  }

  private async updateContextKeys(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      await setAllContextKeys(false);
      return;
    }
    const config = readConfig(editor.document.uri);
    this.runtime.configure(config);
    const supported = isSupportedDocument(editor.document, config);
    if (!supported) {
      await setAllContextKeys(false);
      return;
    }

    const context = this.runtime.contextAt(editor.document, editor.selection.active);
    const manual = editor.selections.length === 1 && editor.selection.isEmpty
      ? this.runtime.matchAt(
          editor.document,
          editor.selection.active,
          "manual",
          config,
        )
      : undefined;
    const template = editor.selections.length === 1 && editor.selection.isEmpty
      ? this.templates.match(editor.document, editor.selection.active)
      : undefined;
    const matrix =
      editor.selections.length === 1 &&
      editor.selection.isEmpty &&
      config.matrixShortcuts &&
      isConfiguredMatrix(context, config);
    const smartEnter =
      editor.selection.isEmpty &&
      config.matrixShortcuts &&
      leftRightEnterPlan(editor.document, editor.selection.active) !== undefined;
    const canTabout =
      editor.selections.length === 1 &&
      editor.selection.isEmpty &&
      config.tabout &&
      context.mathMode !== "text";
    const mathTabContext = config.tabout && context.mathMode !== "text";
    const emptyMath =
      config.autoDeleteMathDelimiters &&
      emptyMathDelimiterRange(editor.document, editor.selection) !== undefined;

    await Promise.all([
      vscode.commands.executeCommand("setContext", "texleaf.enabled", true),
      vscode.commands.executeCommand(
        "setContext",
        "texleaf.mathTabContext",
        mathTabContext,
      ),
      vscode.commands.executeCommand(
        "setContext",
        "texleaf.tabActionAvailable",
        template !== undefined ||
          (config.manualTrigger === "tab" && manual !== undefined) ||
          matrix ||
          canTabout,
      ),
      vscode.commands.executeCommand(
        "setContext",
        "texleaf.snippetTabActionAvailable",
        template !== undefined ||
          (config.manualTrigger === "tab" && manual !== undefined),
      ),
      vscode.commands.executeCommand(
        "setContext",
        "texleaf.manualSpaceActionAvailable",
        config.manualTrigger === "space" && manual !== undefined,
      ),
      vscode.commands.executeCommand(
        "setContext",
        "texleaf.enterActionAvailable",
        matrix || smartEnter,
      ),
      vscode.commands.executeCommand(
        "setContext",
        "texleaf.matrixActionAvailable",
        matrix,
      ),
      vscode.commands.executeCommand(
        "setContext",
        "texleaf.emptyMathDelimiters",
        emptyMath,
      ),
    ]);
  }

  private async withMutation<T>(
    uri: vscode.Uri,
    action: () => Thenable<T>,
  ): Promise<T> {
    const key = uri.toString();
    this.applying.add(key);
    try {
      return await action();
    } finally {
      this.applying.delete(key);
      this.scheduleContextUpdate();
      this.hooks.onEditorStateChanged?.(vscode.window.activeTextEditor);
    }
  }

  private async withDelegatedInput<T>(
    document: vscode.TextDocument | undefined,
    action: () => Thenable<T> | T,
  ): Promise<T> {
    if (document === undefined) {
      return await action();
    }
    const key = document.uri.toString();
    this.delegatedInputDocuments.add(key);
    try {
      return await action();
    } finally {
      this.delegatedInputDocuments.delete(key);
    }
  }

  private async expandPostCommitAutoMatch(
    editor: vscode.TextEditor,
    inputTicket: InputCommandTicket,
    versionBeforeInput: number,
    expectedOffset?: number,
    respectNewerReplacement = true,
    autoFractionSeed?: string,
  ): Promise<void> {
    const changed = await this.waitForDocumentVersionAdvance(
      editor.document,
      versionBeforeInput,
    );
    if (changed) {
      this.cancelDocumentAutoTimer(editor.document);
    }
    if (changed) {
      if (expectedOffset === undefined) {
        // Replacement commands do not always expose enough information to
        // derive the final caret. Let their selection event settle once.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      } else {
        await this.waitForEditorOffset(editor, expectedOffset);
      }
    }
    if (
      !changed ||
      (respectNewerReplacement &&
        this.hasNewerReplacement(inputTicket)) ||
      vscode.window.activeTextEditor !== editor ||
      editor.selections.length !== 1 ||
      !editor.selection.isEmpty ||
      (expectedOffset !== undefined &&
        editor.document.offsetAt(editor.selection.active) !== expectedOffset)
    ) {
      return;
    }

    const config = readConfig(editor.document.uri);
    this.runtime.configure(config);
    if (
      !isSupportedDocument(editor.document, config) ||
      (!config.autoSnippets &&
        !(config.autoFraction && autoFractionSeed !== undefined))
    ) {
      return;
    }

    const candidateOffset = editor.document.offsetAt(editor.selection.active);
    const candidateVersion = editor.document.version;
    const template = config.autoSnippets
      ? this.templates.match(editor.document, editor.selection.active)
      : undefined;
    const automatic = config.autoSnippets && template === undefined
      ? this.runtime.matchAt(
          editor.document,
          editor.selection.active,
          "auto",
          config,
        )
      : undefined;
    const hasAutoFractionCandidate =
      config.autoFraction && autoFractionSeed !== undefined;
    if (
      template === undefined &&
      automatic === undefined &&
      !hasAutoFractionCandidate
    ) {
      return;
    }

    // Some input bridges deliver a provisional `type` command first and only
    // enqueue its replacement on the following event-loop turn. Yield once
    // after finding a real trigger, then revalidate the committed suffix before
    // mutating it. Explicit IME compositions are already held until
    // `compositionEnd`; this closes the equivalent no-lifecycle/dead-key race
    // without delaying ordinary characters that do not match a snippet.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (
      (respectNewerReplacement && this.hasNewerReplacement(inputTicket)) ||
      vscode.window.activeTextEditor !== editor ||
      editor.document.version !== candidateVersion ||
      editor.selections.length !== 1 ||
      !editor.selection.isEmpty ||
      editor.document.offsetAt(editor.selection.active) !== candidateOffset
    ) {
      return;
    }

    const committedTemplate = config.autoSnippets
      ? this.templates.match(editor.document, editor.selection.active)
      : undefined;
    if (committedTemplate !== undefined) {
      const inserted = await this.expandTemplate(editor, committedTemplate);
      if (inserted) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        return;
      }
    }

    const committedAutomatic = config.autoSnippets
      ? this.runtime.matchAt(
          editor.document,
          editor.selection.active,
          "auto",
          config,
        )
      : undefined;
    if (committedAutomatic !== undefined) {
      const inserted = await this.insertParts(
        editor,
        committedAutomatic.match.replacement,
        committedAutomatic.range,
        config,
      );
      if (inserted) {
        // `insertSnippet` can resolve just before its final tabstop selection
        // becomes observable to callers of the public `type` command.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      return;
    }

    if (hasAutoFractionCandidate) {
      await this.expandAutoFractionAfterChange(
        editor,
        candidateOffset,
        autoFractionSeed,
        config,
      );
    }
  }

  private async waitForDocumentVersionAdvance(
    document: vscode.TextDocument,
    previousVersion: number,
  ): Promise<boolean> {
    if (document.version > previousVersion) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let subscription: vscode.Disposable | undefined;
      const finish = (changed: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        subscription?.dispose();
        resolve(changed);
      };

      subscription = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === document && document.version > previousVersion) {
          finish(true);
        }
      });
      timer = setTimeout(
        () => finish(document.version > previousVersion),
        INPUT_DOCUMENT_CHANGE_TIMEOUT_MS,
      );
      if (document.version > previousVersion) {
        finish(true);
      }
    });
  }

  private async waitForEditorOffset(
    editor: vscode.TextEditor,
    expectedOffset: number,
  ): Promise<boolean> {
    const atExpectedOffset = (): boolean =>
      editor.selections.length === 1 &&
      editor.selection.isEmpty &&
      editor.document.offsetAt(editor.selection.active) === expectedOffset;
    if (atExpectedOffset()) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let subscription: vscode.Disposable | undefined;
      const finish = (matches: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        subscription?.dispose();
        resolve(matches);
      };
      subscription = vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === editor && atExpectedOffset()) {
          finish(true);
        }
      });
      timer = setTimeout(
        () => finish(atExpectedOffset()),
        INPUT_DOCUMENT_CHANGE_TIMEOUT_MS,
      );
      if (atExpectedOffset()) {
        finish(true);
      }
    });
  }

  private cancelDocumentAutoTimer(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const timer = this.autoTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.autoTimers.delete(key);
    }
  }

  private clearCompositionSession(sessionId: number | undefined): void {
    if (
      sessionId === undefined ||
      this.activeCompositionSessionId !== sessionId
    ) {
      return;
    }
    this.activeCompositionSessionId = undefined;
    this.compositionDocument = undefined;
    this.compositionStartVersion = undefined;
    this.compositionHadInput = false;
    if (this.queuedCompositionSessionId === sessionId) {
      this.queuedCompositionSessionId = undefined;
    }
  }

  private hasNewerReplacement(ticket: InputCommandTicket): boolean {
    return (
      ticket.sequence <
      (this.latestReplacementBySegment.get(ticket.segment) ?? 0)
    );
  }

  private enqueueInputCommand<T>(
    kind: "type" | "replacement" | "passive",
    action: (ticket: InputCommandTicket) => Thenable<T> | T,
    segment = this.inputCommandSegment,
  ): Promise<T> {
    // VS Code emits an IME composition's initial text through `type`, followed
    // by `replacePreviousChar` (or `compositionType`) to update that text. A
    // contributed `type` handler runs in the extension host, so the built-in
    // replacement command can otherwise overtake the asynchronous first
    // insertion and leave both copies in the document. Route every related
    // input command through one queue to preserve the order produced by the
    // editor. A replacement is marked as soon as it is queued, so an earlier
    // provisional `type` action cannot expand before the replacement runs.
    // Ordinary subsequent `type` commands do not invalidate the previous
    // committed match: the FIFO waits for that expansion before typing the
    // next character. Keep the queue usable even when one command rejects.
    const ticket: InputCommandTicket = {
      sequence: ++this.inputCommandSequence,
      segment,
    };
    if (kind === "replacement") {
      this.latestReplacementBySegment.set(segment, ticket.sequence);
    }
    const result = this.inputCommandQueue.then(async () => {
      // A previous contributed input may have deferred its final native
      // snippet merge until after that command returned to the renderer.
      await this.postInputCommandQueue;
      this.activeInputCommandCount += 1;
      try {
        return await action(ticket);
      } finally {
        this.activeInputCommandCount -= 1;
      }
    });
    this.inputCommandQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private schedulePostInputCommand(action: () => Thenable<void>): void {
    const previous = this.postInputCommandQueue;
    const scheduled = previous.then(async () => {
      // A timer turn is required: a microtask still runs before the contributed
      // command response has crossed back to the editor renderer. Once the
      // input action becomes inactive, wait one additional turn: the decrement
      // happens while the contributed command promise is still unwinding in
      // the extension host, before its RPC response reaches the renderer.
      while (this.activeInputCommandCount > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await action();
    });
    this.postInputCommandQueue = scheduled.then(
      () => undefined,
      () => {
        // Keep later input usable, but never make an asynchronous finalization
        // failure completely invisible during diagnostics. Do not include the
        // raw exception because command/provider errors can contain user paths.
        console.error("TeXLeaf deferred input finalization failed.");
      },
    );
  }
}

function coerceTypeArguments(value: unknown): TypeCommandArguments | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { text?: unknown }).text !== "string"
  ) {
    return undefined;
  }
  const candidate = value as { text: string; replacePreviousCharCnt?: unknown };
  return {
    text: candidate.text,
    ...(typeof candidate.replacePreviousCharCnt === "number"
      ? { replacePreviousCharCnt: candidate.replacePreviousCharCnt }
      : {}),
  };
}

function characterAt(document: vscode.TextDocument, position: vscode.Position): string {
  const offset = document.offsetAt(position);
  const text = document.getText();
  return offset < text.length ? text[offset] ?? "" : "";
}

function isExcludedContext(context: LatexContext, config: TeXLeafConfig): boolean {
  return (
    context.inComment ||
    context.inVerbatim ||
    context.environments.some((environment) =>
      config.excludedEnvironments.includes(environment),
    )
  );
}

function isConfiguredMatrix(context: LatexContext, config: TeXLeafConfig): boolean {
  if (context.mathMode === "text" || context.inTextCommandArgument) {
    return false;
  }
  return context.environments.some(
    (environment) =>
      config.matrixEnvironments.includes(environment) ||
      config.matrixEnvironments.includes(environment.replace(/\*$/, "")),
  );
}

function hasLineBreak(value: string): boolean {
  return value.includes("\n") || value.includes("\r");
}

/**
 * Keep a plain automatic replacement inside the active VS Code placeholder
 * when a regex only carries an unchanged prefix through to its output. For
 * example, the Greek normalizer matches ` tau` and emits ` \\tau`; replacing
 * only `tau` avoids crossing the left edge of an outer snippet tabstop.
 *
 * Auto-enlarge calls this only after deciding not to widen the range. Parts
 * with tabstops are deliberately left intact so their navigation contract is
 * never rewritten.
 */
function narrowUnchangedLeadingReplacement(
  document: vscode.TextDocument,
  range: vscode.Range,
  parts: readonly ReplacementPart[],
): { readonly range: vscode.Range; readonly parts: readonly ReplacementPart[] } {
  if (
    parts.length === 0 ||
    parts.some((part) => part.kind === "tabstop") ||
    parts[0]?.kind !== "text"
  ) {
    return { range, parts };
  }

  const currentText = document.getText(range);
  if (hasLineBreak(currentText) || hasLineBreak(replacementPartsToText(parts))) {
    return { range, parts };
  }
  const firstText = parts[0].value;
  const prefixLength = sharedCodePointPrefixLength(currentText, firstText);
  if (
    prefixLength === 0 ||
    (prefixLength === currentText.length && prefixLength === firstText.length)
  ) {
    return { range, parts };
  }

  const startOffset = document.offsetAt(range.start) + prefixLength;
  const remainingFirstText = firstText.slice(prefixLength);
  const narrowedParts =
    remainingFirstText.length === 0
      ? parts.slice(1)
      : [{ kind: "text" as const, value: remainingFirstText }, ...parts.slice(1)];
  return {
    range: new vscode.Range(document.positionAt(startOffset), range.end),
    parts: narrowedParts,
  };
}

/** Return a shared-prefix length in UTF-16 units without splitting surrogates. */
function sharedCodePointPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let offset = 0;
  while (offset < limit) {
    const leftCodePoint = left.codePointAt(offset);
    const rightCodePoint = right.codePointAt(offset);
    if (leftCodePoint === undefined || leftCodePoint !== rightCodePoint) {
      break;
    }
    offset += leftCodePoint > 0xffff ? 2 : 1;
  }
  return offset;
}

function snippetAppliesToContext(
  snippet: CompiledSnippet,
  context: LatexContext,
): boolean {
  const options = snippet.options;
  const hasMode =
    options.textMode ||
    options.anyMathMode ||
    options.blockMathMode ||
    options.inlineMathMode;
  return (
    !hasMode ||
    (options.textMode && context.mathMode === "text") ||
    (options.anyMathMode && context.mathMode !== "text") ||
    (options.blockMathMode && context.mathMode === "block") ||
    (options.inlineMathMode && context.mathMode === "inline")
  );
}

function innermostMathRegion(text: string, offset: number) {
  return scanLatexRegions(text)
    .filter((region) => offset >= region.innerStart && offset <= region.innerEnd)
    .sort(
      (left, right) =>
        left.innerEnd - left.innerStart - (right.innerEnd - right.innerStart),
    )[0];
}

function leftRightEnterPlan(
  document: vscode.TextDocument,
  position: vscode.Position,
): LeftRightEnterPlan | undefined {
  return planLeftRightEnter(document.getText(), document.offsetAt(position), {
    eol: document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
  });
}

function stripCompleteOuterParentheses(value: string): string {
  if (!value.startsWith("(") || !value.endsWith(")")) {
    return value;
  }
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") {
      depth += 1;
    } else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0 && index !== value.length - 1) {
        return value;
      }
    }
  }
  return depth === 0 ? value.slice(1, -1) : value;
}

function isFractionDenominatorSeed(
  value: string,
  breakingCharacters: string,
): boolean {
  return (
    [...value].length === 1 &&
    !/\s/u.test(value) &&
    value !== "/" &&
    !")]}$".includes(value) &&
    !breakingCharacters.includes(value)
  );
}

function isEscapedAt(text: string, offset: number): boolean {
  let backslashes = 0;
  for (
    let index = offset - 1;
    index >= 0 && text[index] === "\\";
    index -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function emptyMathDelimiterRange(
  document: vscode.TextDocument,
  selection: vscode.Selection,
): vscode.Range | undefined {
  if (!selection.isEmpty) {
    return undefined;
  }
  const text = document.getText();
  const offset = document.offsetAt(selection.active);
  const pairs = [
    ["\\(", "\\)"],
    ["\\[", "\\]"],
    ["$$", "$$"],
    ["$", "$"],
  ] as const;
  for (const [left, right] of pairs) {
    if (
      text.slice(offset - left.length, offset) === left &&
      text.slice(offset, offset + right.length) === right
    ) {
      return new vscode.Range(
        document.positionAt(offset - left.length),
        document.positionAt(offset + right.length),
      );
    }
  }
  return undefined;
}

function firstReplacementTabstopSelection(
  parts: readonly ReplacementPart[],
): { readonly start: number; readonly end: number } | undefined {
  const firstIndex = parts.reduce<number | undefined>(
    (lowest, part) =>
      part.kind !== "tabstop"
        ? lowest
        : lowest === undefined
          ? part.index
          : Math.min(lowest, part.index),
    undefined,
  );
  if (firstIndex === undefined) {
    return undefined;
  }

  let offset = 0;
  for (const part of parts) {
    if (part.kind === "text") {
      offset += part.value.length;
      continue;
    }
    const placeholderLength = part.placeholder?.length ?? 0;
    if (part.index === firstIndex) {
      return { start: offset, end: offset + placeholderLength };
    }
    offset += placeholderLength;
  }
  return undefined;
}

interface EnlargedInsertion {
  readonly range: vscode.Range;
  readonly parts: readonly ReplacementPart[];
  /** Delimiter replacements at offsets in the original document. */
  readonly modifiers: readonly SourceReplacement[];
}

interface SourceReplacement {
  readonly offset: number;
  readonly original: string;
  readonly text: string;
}

function planInlineAutoEnlarge(
  document: vscode.TextDocument,
  range: vscode.Range,
  parts: readonly ReplacementPart[],
  triggers: readonly string[],
): EnlargedInsertion | undefined {
  const plain = replacementPartsToText(parts);
  if (!triggers.some((trigger) => plain.includes(trigger))) {
    return undefined;
  }
  const text = document.getText();
  const start = document.offsetAt(range.start);
  const end = document.offsetAt(range.end);
  const hypothetical = `${text.slice(0, start)}${plain}${text.slice(end)}`;
  const contentRange = { start, end: start + plain.length };
  const mathRegion = innermostMathRegion(hypothetical, contentRange.start);
  const plans = planAutoEnlargeAncestors(hypothetical, contentRange, {
    triggers,
    ...(mathRegion === undefined
      ? {}
      : {
          bounds: {
            start: mathRegion.innerStart,
            end: mathRegion.innerEnd,
          },
        }),
  });
  if (plans.length === 0) {
    return undefined;
  }
  const delta = plain.length - (end - start);
  const modifiers: SourceReplacement[] = [];
  for (const plan of plans) {
    const originalCloseOffset = plan.closeOffset - delta;
    if (
      plan.openOffset < 0 ||
      plan.openOffset + plan.open.length > start ||
      originalCloseOffset < end ||
      originalCloseOffset + plan.close.length > text.length ||
      !text.startsWith(plan.open, plan.openOffset) ||
      !text.startsWith(plan.close, originalCloseOffset)
    ) {
      return undefined;
    }
    modifiers.push(
      {
        offset: plan.openOffset,
        original: plan.open,
        text: `${plan.insertLeftText}${plan.open}`,
      },
      {
        offset: originalCloseOffset,
        original: plan.close,
        text: `${plan.insertRightText}${plan.close}`,
      },
    );
  }
  return {
    range,
    parts,
    modifiers,
  };
}

async function setAllContextKeys(enabled: boolean): Promise<void> {
  await Promise.all([
    vscode.commands.executeCommand("setContext", "texleaf.enabled", enabled),
    vscode.commands.executeCommand(
      "setContext",
      "texleaf.mathTabContext",
      false,
    ),
    vscode.commands.executeCommand(
      "setContext",
      "texleaf.tabActionAvailable",
      false,
    ),
    vscode.commands.executeCommand(
      "setContext",
      "texleaf.snippetTabActionAvailable",
      false,
    ),
    vscode.commands.executeCommand(
      "setContext",
      "texleaf.manualSpaceActionAvailable",
      false,
    ),
    vscode.commands.executeCommand(
      "setContext",
      "texleaf.enterActionAvailable",
      false,
    ),
    vscode.commands.executeCommand(
      "setContext",
      "texleaf.matrixActionAvailable",
      false,
    ),
    vscode.commands.executeCommand(
      "setContext",
      "texleaf.emptyMathDelimiters",
      false,
    ),
  ]);
}
