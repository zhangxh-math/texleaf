import * as vscode from "vscode";
import {
  findFractionNumerator,
  planAutoEnlarge,
  planTabout,
  replacementPartsToText,
  scanLatexRegions,
  type CompiledSnippet,
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

interface TypeCommandArguments {
  readonly text: string;
  readonly replacePreviousCharCnt?: number;
}

interface QuickPickSnippet extends vscode.QuickPickItem {
  readonly snippet: CompiledSnippet;
}

interface PendingAutoFraction {
  readonly documentVersion: number;
  readonly slashOffset: number;
  readonly cursorOffset: number;
}

export interface EditorControllerHooks {
  readonly onEditorStateChanged?: (editor: vscode.TextEditor | undefined) => void;
}

export class EditorController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly applying = new Set<string>();
  private readonly autoTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingFractions = new Map<string, PendingAutoFraction>();
  private inputCommandQueue: Promise<void> = Promise.resolve();
  private contextTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    _extensionContext: vscode.ExtensionContext,
    private readonly repository: SnippetRepository,
    private readonly runtime: SnippetRuntime,
    private readonly hooks: EditorControllerHooks = {},
  ) {}

  public register(): void {
    this.disposables.push(
      vscode.commands.registerCommand("type", (args: unknown) =>
        this.enqueueInputCommand(() => this.handleType(args)),
      ),
      vscode.commands.registerCommand("replacePreviousChar", (args: unknown) =>
        this.enqueueInputCommand(() =>
          vscode.commands.executeCommand("default:replacePreviousChar", args),
        ),
      ),
      vscode.commands.registerCommand("compositionType", (args: unknown) =>
        this.enqueueInputCommand(() =>
          vscode.commands.executeCommand("default:compositionType", args),
        ),
      ),
      vscode.commands.registerCommand("texleaf.handleTab", () => this.handleTab()),
      vscode.commands.registerCommand("texleaf.handleSpace", () => this.handleSpace()),
      vscode.commands.registerCommand("texleaf.matrixEnter", () => this.matrixEnter()),
      vscode.commands.registerCommand("texleaf.matrixExit", () => this.matrixExit()),
      vscode.commands.registerCommand("texleaf.deleteEmptyMathDelimiters", () =>
        this.deleteEmptyMathDelimiters(),
      ),
      vscode.commands.registerCommand("texleaf.openSnippetFile", () =>
        this.repository.openGlobalSnippetFile(),
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
        this.pendingFractions.delete(document.uri.toString());
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
    this.autoTimers.clear();
    this.pendingFractions.clear();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private async handleType(rawArguments: unknown): Promise<void> {
    const args = coerceTypeArguments(rawArguments);
    const editor = vscode.window.activeTextEditor;
    if (args === undefined || editor === undefined) {
      await vscode.commands.executeCommand("default:type", rawArguments);
      return;
    }

    const config = readConfig(editor.document.uri);
    this.runtime.configure(config);
    if (!isSupportedDocument(editor.document, config) || editor.selections.length !== 1) {
      this.pendingFractions.delete(editor.document.uri.toString());
      await vscode.commands.executeCommand("default:type", rawArguments);
      return;
    }
    if (!config.autoFraction) {
      this.pendingFractions.delete(editor.document.uri.toString());
    }
    if ((args.replacePreviousCharCnt ?? 0) > 0) {
      await vscode.commands.executeCommand("default:type", rawArguments);
      return;
    }

    const selection = editor.selection;
    const typedText = args.text;
    if (
      (typedText === "\n" || typedText === "\r\n") &&
      selection.isEmpty &&
      config.matrixShortcuts &&
      isConfiguredMatrix(
        this.runtime.contextAt(editor.document, selection.active),
        config,
      )
    ) {
      // LaTeX Workshop owns Enter by default and eventually delegates its
      // ordinary newline path to the public `type` command. Route that call
      // back through TeXLeaf while the cursor is in a configured matrix-like
      // environment, so Align row insertion does not depend on extension
      // keybinding order.
      await this.matrixEnter();
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

    if (typedText.length === 1 && selection.isEmpty && config.autoSnippets) {
      const automatic = this.syntheticAutomaticMatch(editor, typedText, config);
      if (
        automatic !== undefined &&
        (await this.insertParts(
          editor,
          automatic.match.replacement,
          automatic.range,
          config,
        ))
      ) {
        this.pendingFractions.delete(editor.document.uri.toString());
        return;
      }
    }

    if (typedText === "/" && config.autoFraction) {
      // Preserve the literal slash until the first denominator character is
      // typed.  This makes the visible edit match the natural `1/2` workflow
      // and leaves the explicit `//` automatic snippet reachable.
      this.pendingFractions.delete(editor.document.uri.toString());
      if (!selection.isEmpty && (await this.wrapSelectionAsFraction(editor, config))) {
        return;
      }
      await vscode.commands.executeCommand("default:type", rawArguments);
      this.armAutoFraction(editor, config);
      return;
    }

    if (
      typedText.length === 1 &&
      config.skipPairedClosingCharacters &&
      ")]}".includes(typedText) &&
      selection.isEmpty &&
      characterAt(editor.document, selection.active) === typedText
    ) {
      this.pendingFractions.delete(editor.document.uri.toString());
      const next = editor.document.positionAt(
        editor.document.offsetAt(selection.active) + typedText.length,
      );
      editor.selection = new vscode.Selection(next, next);
      return;
    }

    if (
      config.autoFraction &&
      selection.isEmpty &&
      (await this.completeAutoFraction(editor, typedText, config))
    ) {
      return;
    }

    await vscode.commands.executeCommand("default:type", rawArguments);
  }

  private async handleTab(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      return;
    }
    const config = readConfig(editor.document.uri);
    if (!isSupportedDocument(editor.document, config)) {
      await vscode.commands.executeCommand("tab");
      return;
    }

    if (
      config.manualTrigger === "tab" &&
      editor.selection.isEmpty &&
      (await this.expandManualSnippet(editor, config))
    ) {
      return;
    }

    const context = this.runtime.contextAt(editor.document, editor.selection.active);
    if (
      config.matrixShortcuts &&
      editor.selection.isEmpty &&
      isConfiguredMatrix(context, config)
    ) {
      await this.withMutation(editor.document.uri, () =>
        editor.edit(
          (builder) => builder.insert(editor.selection.active, " & "),
          { undoStopBefore: true, undoStopAfter: true },
        ),
      );
      return;
    }

    if (config.tabout && editor.selection.isEmpty && context.mathMode !== "text") {
      const offset = editor.document.offsetAt(editor.selection.active);
      const plan = planTabout(editor.document.getText(), offset, {
        arrayMode: isConfiguredMatrix(context, config),
      });
      if (plan !== undefined) {
        const target = editor.document.positionAt(plan.to);
        editor.selection = new vscode.Selection(target, target);
        editor.revealRange(new vscode.Range(target, target));
        return;
      }
    }

    await vscode.commands.executeCommand("tab");
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

  private async matrixEnter(): Promise<void> {
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
    const editor = vscode.window.activeTextEditor;
    if (editor?.document === event.document) {
      this.hooks.onEditorStateChanged?.(editor);
    }

    const key = event.document.uri.toString();
    if (
      this.applying.has(key) ||
      event.reason === vscode.TextDocumentChangeReason.Undo ||
      event.reason === vscode.TextDocumentChangeReason.Redo
    ) {
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
      document.version !== expectedVersion ||
      editor.selections.length !== 1 ||
      !editor.selection.isEmpty ||
      document.offsetAt(editor.selection.active) !== expectedOffset
    ) {
      return;
    }
    if (config.autoSnippets) {
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
  ): Promise<boolean> {
    const runtimeMatch = this.runtime.matchAt(
      editor.document,
      editor.selection.active,
      "manual",
      config,
    );
    return runtimeMatch === undefined
      ? false
      : this.insertParts(
          editor,
          runtimeMatch.match.replacement,
          runtimeMatch.range,
          config,
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

  private async completeAutoFraction(
    editor: vscode.TextEditor,
    seed: string,
    config: TeXLeafConfig,
  ): Promise<boolean> {
    const key = editor.document.uri.toString();
    const pending = this.pendingFractions.get(key);
    this.pendingFractions.delete(key);
    if (
      pending === undefined ||
      pending.documentVersion !== editor.document.version ||
      pending.cursorOffset !== editor.document.offsetAt(editor.selection.active)
    ) {
      return false;
    }
    if (!isFractionDenominatorSeed(seed, config.autoFractionBreakingCharacters)) {
      return false;
    }

    const selection = editor.selection;
    const cursorOffset = editor.document.offsetAt(selection.active);
    const slashOffset = pending.slashOffset;
    const text = editor.document.getText();
    if (
      slashOffset !== cursorOffset - 1 ||
      text[slashOffset] !== "/" ||
      isEscapedAt(text, slashOffset)
    ) {
      return false;
    }

    const context = this.runtime.contextAt(editor.document, selection.active);
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

    const parts: ReplacementPart[] = [
      {
        kind: "text",
        value: `${config.autoFractionCommand}{${plan.numerator}}{${seed}`,
      },
      { kind: "tabstop", index: 0 },
      { kind: "text", value: "}" },
      { kind: "tabstop", index: 1 },
    ];
    const range = new vscode.Range(
      editor.document.positionAt(plan.replacementRange.start),
      selection.active,
    );
    return this.insertParts(editor, parts, range, config);
  }

  private armAutoFraction(editor: vscode.TextEditor, config: TeXLeafConfig): void {
    if (vscode.window.activeTextEditor !== editor || !editor.selection.isEmpty) {
      return;
    }
    const document = editor.document;
    const cursorOffset = document.offsetAt(editor.selection.active);
    const slashOffset = cursorOffset - 1;
    const text = document.getText();
    if (
      slashOffset < 0 ||
      text[slashOffset] !== "/" ||
      text[slashOffset - 1] === "/" ||
      isEscapedAt(text, slashOffset)
    ) {
      return;
    }
    const context = this.runtime.contextAt(document, editor.selection.active);
    if (context.mathMode === "text" || isExcludedContext(context, config)) {
      return;
    }
    const region = innermostMathRegion(text, slashOffset);
    const plan = findFractionNumerator(text, slashOffset, {
      lowerBound: region?.innerStart ?? 0,
      breakingCharacters: config.autoFractionBreakingCharacters,
    });
    if (plan === undefined || plan.numerator.length === 0) {
      return;
    }
    this.pendingFractions.set(document.uri.toString(), {
      documentVersion: document.version,
      slashOffset,
      cursorOffset,
    });
  }

  private async insertParts(
    editor: vscode.TextEditor,
    parts: readonly ReplacementPart[],
    range: vscode.Range,
    config: TeXLeafConfig,
    allowAutoEnlarge = true,
  ): Promise<boolean> {
    let replacementRange = range;
    let replacementParts = parts;
    if (allowAutoEnlarge && config.autoEnlargeBrackets) {
      const enlarged = planInlineAutoEnlarge(
        editor.document,
        range,
        parts,
        config.autoEnlargeTriggers,
      );
      if (enlarged !== undefined) {
        replacementRange = enlarged.range;
        replacementParts = enlarged.parts;
      }
    }
    const snippet = replacementPartsToSnippetString(replacementParts);
    return this.withMutation(editor.document.uri, () =>
      editor.insertSnippet(snippet, replacementRange, {
        undoStopBefore: true,
        undoStopAfter: true,
        // Let VS Code re-indent every line of a multi-line snippet relative to
        // the insertion point.  Keeping the template whitespace verbatim makes
        // a display-math snippet typed after indentation put `\\]` in column 1.
        keepWhitespace: false,
      }),
    );
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
    const manual = editor.selection.isEmpty
      ? this.runtime.matchAt(
          editor.document,
          editor.selection.active,
          "manual",
          config,
        )
      : undefined;
    const matrix =
      editor.selection.isEmpty &&
      config.matrixShortcuts &&
      isConfiguredMatrix(context, config);
    const canTabout =
      editor.selection.isEmpty && config.tabout && context.mathMode !== "text";
    const emptyMath =
      config.autoDeleteMathDelimiters &&
      emptyMathDelimiterRange(editor.document, editor.selection) !== undefined;

    await Promise.all([
      vscode.commands.executeCommand("setContext", "texleaf.enabled", true),
      vscode.commands.executeCommand(
        "setContext",
        "texleaf.tabActionAvailable",
        (config.manualTrigger === "tab" && manual !== undefined) || matrix || canTabout,
      ),
      vscode.commands.executeCommand(
        "setContext",
        "texleaf.manualSpaceActionAvailable",
        config.manualTrigger === "space" && manual !== undefined,
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

  private enqueueInputCommand<T>(action: () => Thenable<T> | T): Promise<T> {
    // VS Code emits an IME composition's initial text through `type`, followed
    // by `replacePreviousChar` (or `compositionType`) to update that text. A
    // contributed `type` handler runs in the extension host, so the built-in
    // replacement command can otherwise overtake the asynchronous first
    // insertion and leave both copies in the document. Route every related
    // input command through one queue to preserve the order produced by the
    // editor. Keep the queue usable even when one command rejects.
    const result = this.inputCommandQueue.then(() => action());
    this.inputCommandQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
  return context.environments.some(
    (environment) =>
      config.matrixEnvironments.includes(environment) ||
      config.matrixEnvironments.includes(environment.replace(/\*$/, "")),
  );
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

interface EnlargedInsertion {
  readonly range: vscode.Range;
  readonly parts: readonly ReplacementPart[];
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
  const plan = planAutoEnlarge(hypothetical, contentRange, {
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
  if (plan === undefined) {
    return undefined;
  }
  const delta = plain.length - (end - start);
  const originalCloseOffset = plan.closeOffset - delta;
  if (
    plan.openOffset < 0 ||
    originalCloseOffset < end ||
    originalCloseOffset + plan.close.length > text.length
  ) {
    return undefined;
  }
  return {
    range: new vscode.Range(
      document.positionAt(plan.openOffset),
      document.positionAt(originalCloseOffset + plan.close.length),
    ),
    parts: [
      {
        kind: "text",
        value: `${plan.insertLeftText}${plan.open}${text.slice(
          plan.openOffset + plan.open.length,
          start,
        )}`,
      },
      ...parts,
      {
        kind: "text",
        value: `${text.slice(end, originalCloseOffset)}${plan.insertRightText}${plan.close}`,
      },
    ],
  };
}

async function setAllContextKeys(enabled: boolean): Promise<void> {
  await Promise.all([
    vscode.commands.executeCommand("setContext", "texleaf.enabled", enabled),
    vscode.commands.executeCommand(
      "setContext",
      "texleaf.tabActionAvailable",
      false,
    ),
    vscode.commands.executeCommand(
      "setContext",
      "texleaf.manualSpaceActionAvailable",
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
