"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");
const { parse: parseJsonc } = require("jsonc-parser");
const {
  LEGACY_PUBLISHER_LIBRARY_TEXT,
  LEGACY_PUBLISHER_SNIPPET_ID,
} = require("./storageMigrationFixture.cjs");

const EXTENSION_ID = "zhangxh-math.texleaf";
const DIRTY_LEGACY_PUBLISHER_PREFIX =
  "// Unsaved old-publisher edit must be saved before migration.\n";
const LEGACY_WORKSPACE_SNIPPET_ID = "extension-host-legacy-workspace";
const LEGACY_WORKSPACE_TRIGGER = "told";
const ROOT_A_TRIGGER = "traa";
const ROOT_B_TRIGGER = "trbb";

function contributedConfigurationProperties(extension) {
  const configuration = extension.packageJSON.contributes.configuration;
  const groups = Array.isArray(configuration) ? configuration : [configuration];
  return Object.assign(
    {},
    ...groups.map((group) => group.properties ?? {}),
  );
}

async function waitFor(predicate, description, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function settlesWithin(promise, description, timeoutMs = 1_500) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function replaceDocument(editor, text, cursorOffset) {
  const document = editor.document;
  const replaced = await editor.edit(
    (builder) => {
      builder.replace(
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        ),
        text,
      );
    },
    { undoStopBefore: true, undoStopAfter: true },
  );
  assert.equal(replaced, true, "test document replacement failed");
  const prefix = text.slice(0, cursorOffset);
  const prefixLines = prefix.split(/\r\n|\r|\n/);
  const cursor = new vscode.Position(
    prefixLines.length - 1,
    prefixLines.at(-1)?.length ?? 0,
  );
  editor.selection = new vscode.Selection(cursor, cursor);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function typeEach(text) {
  for (const character of text) {
    await vscode.commands.executeCommand("type", { text: character });
  }
}

async function editEach(editor, text) {
  for (const character of text) {
    const document = editor.document;
    const versionBeforeEdit = document.version;
    const inserted = await editor.edit(
      (builder) => builder.insert(editor.selection.active, character),
      { undoStopBefore: false, undoStopAfter: false },
    );
    assert.equal(inserted, true, `test document insertion failed for ${character}`);

    await waitFor(
      () => document.version > versionBeforeEdit,
      `document-change event for ${character}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function setDocumentEndOfLine(editor, endOfLine) {
  const changed = await editor.edit(
    (builder) => builder.setEndOfLine(endOfLine),
    { undoStopBefore: false, undoStopAfter: false },
  );
  assert.equal(changed, true, "test document EOL update failed");
  assert.equal(editor.document.eol, endOfLine);
}

function displayMathText(document) {
  const newline =
    document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  return `\\[${newline}${newline}\\]`;
}

async function assertMatrixShortcuts(
  editor,
  environment,
  endOfLine,
  enterThroughType = false,
) {
  await setDocumentEndOfLine(editor, endOfLine);
  const newline = endOfLine === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const source = [
    `\\begin{${environment}}`,
    "  x",
    `\\end{${environment}}`,
  ].join(newline);
  await replaceDocument(editor, source, source.indexOf("x") + 1);

  await vscode.commands.executeCommand("texleaf.handleTab");
  await waitFor(
    () => editor.document.lineAt(1).text === "  x & ",
    `${environment} Tab column insertion`,
  );
  assert.equal(editor.selection.active.line, 1);
  assert.equal(editor.selection.active.character, 6);

  if (enterThroughType) {
    // LaTeX Workshop's higher-priority Enter binding delegates its ordinary
    // newline case to `type`; keep that real interoperability path covered.
    await vscode.commands.executeCommand("type", {
      source: "keyboard",
      text: "\n",
    });
  } else {
    await vscode.commands.executeCommand("texleaf.matrixEnter");
  }
  await waitFor(
    () => editor.document.lineCount === 4,
    `${environment} Enter row insertion`,
  );
  assert.equal(
    editor.document.getText(),
    [
      `\\begin{${environment}}`,
      "  x &  \\\\",
      "  ",
      `\\end{${environment}}`,
    ].join(newline),
  );
  assert.equal(editor.document.eol, endOfLine);
  assert.equal(editor.selection.active.line, 2);
  assert.equal(editor.selection.active.character, 2);
}

async function assertLeftRightEnter(
  editor,
  environment,
  endOfLine,
  enterThroughType = false,
) {
  await setDocumentEndOfLine(editor, endOfLine);
  const newline = endOfLine === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const source = [
    `\\begin{${environment}}`,
    "  F &= \\left(a + b\\right)",
    `\\end{${environment}}`,
  ].join(newline);
  const cursorOffset = source.indexOf("b\\right)");
  await replaceDocument(editor, source, cursorOffset);

  if (enterThroughType) {
    await vscode.commands.executeCommand("type", {
      source: "keyboard",
      text: newline,
    });
  } else {
    await vscode.commands.executeCommand("texleaf.matrixEnter");
  }

  const expected = [
    `\\begin{${environment}}`,
    "  F &= \\left(a + \\right.\\\\",
    "  \\left.b\\right)",
    `\\end{${environment}}`,
  ].join(newline);
  await waitFor(
    () => editor.document.getText() === expected,
    `${environment} matched left/right Enter split`,
  );
  assert.equal(editor.document.eol, endOfLine);
  assert.equal(editor.selection.active.line, 2);
  assert.equal(editor.selection.active.character, 8);
}

async function assertUnsafeLeftRightEnterFallsBack(editor) {
  const source = [
    "\\begin{equation}",
    "  x = \\left(a + \\left[b+c\\right]\\right)",
    "\\end{equation}",
  ].join("\n");
  const cursorOffset = source.indexOf("b+c") + 1;
  await replaceDocument(editor, source, cursorOffset);
  await vscode.commands.executeCommand("texleaf.matrixEnter");
  await waitFor(
    () => editor.document.lineCount === 4,
    "unsafe nested left/right Enter fallback",
  );
  assert.equal(
    editor.document.getText().includes("\\right.\\\\"),
    false,
    "a cursor-crossing nested pair must not receive the smart rewrite",
  );
  assert.equal(
    editor.document.getText().includes("\\left."),
    false,
    "the unsafe fallback must not inject an invisible opening delimiter",
  );
}

async function openTestFile(root, name, language = "latex") {
  const uri = vscode.Uri.joinPath(root, name);
  await vscode.workspace.fs.writeFile(uri, new Uint8Array());
  let document = await vscode.workspace.openTextDocument(uri);
  if (document.languageId !== language) {
    document = await vscode.languages.setTextDocumentLanguage(document, language);
  }
  const editor = await vscode.window.showTextDocument(document);
  return { document, editor };
}

async function provideCompletionList(document, cursorOffset) {
  const result = await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    document.uri,
    document.positionAt(cursorOffset),
  );
  assert.ok(result, "VS Code must return a completion list");
  return result;
}

async function provideCompletions(document, cursorOffset) {
  return (await provideCompletionList(document, cursorOffset)).items;
}

function findCitationCompletion(items, sourceDescription, citationKey) {
  return items.find(
    (item) =>
      typeof item.label === "object" &&
      item.label.description === sourceDescription &&
      item.kind === vscode.CompletionItemKind.Reference &&
      completionInsertText(item) === citationKey,
  );
}

function completionInsertText(item) {
  return item.insertText instanceof vscode.SnippetString
    ? item.insertText.value
    : item.insertText;
}

function completionDocumentationText(item) {
  return typeof item.documentation === "string"
    ? item.documentation
    : item.documentation?.value ?? "";
}

function findTeXLeafSnippetCompletion(items, trigger) {
  return items.find(
    (item) =>
      item.label === trigger &&
      completionDocumentationText(item).includes(`触发器：\`${trigger}\``),
  );
}

async function assertAutomaticSnippetScope(
  editor,
  expected,
  description,
  trigger = "lm",
) {
  await replaceDocument(editor, "", 0);
  await typeEach(trigger);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(editor.document.getText(), expected, description);
}

async function assertTemplateExpansion(editor, trigger, expectedClass) {
  await replaceDocument(editor, "", 0);
  await typeEach(trigger);
  await waitFor(
    () => editor.document.getText().includes(expectedClass),
    `${trigger} automatic independent template expansion`,
  );
  const expanded = editor.document.getText();
  assert.match(expanded, /\\begin\{document\}/u, trigger);
  assert.match(expanded, /\\end\{document\}/u, trigger);
  if (trigger.startsWith("tmpa-")) {
    assert.match(expanded, /\\bibliographystyle\{alpha\}/u, trigger);
    assert.doesNotMatch(expanded, /\\bibliographystyle\{plain\}/u, trigger);
  }
  assert.doesNotMatch(
    expanded,
    /Xuhui Zhang|张旭辉|Jian Zhou|Tsinghua University|清华大学|zhangxh\.math@gmail\.com|jianzhou@mail\.tsinghua\.edu\.cn/iu,
    `${trigger} must not contain personal data from the supplied HSnips file`,
  );
}

async function waitForAutomaticSnippet(
  editor,
  trigger,
  expected,
  description,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  let actual = "";
  while (Date.now() < deadline) {
    await replaceDocument(editor, "", 0);
    await typeEach(trigger);
    await new Promise((resolve) => setTimeout(resolve, 100));
    actual = editor.document.getText();
    if (actual === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(actual, expected, description);
}

async function assertImePunctuation(editor, punctuation, replacementCommand) {
  await replaceDocument(editor, "", 0);

  // Windows IMEs first dispatch the composition text as `type`, then replace
  // that provisional text. Do not await the first command: the real editor
  // emits the replacement while the contributed type handler is still making
  // its extension-host round trip.
  const initialType = vscode.commands.executeCommand("type", {
    text: punctuation,
  });
  const replacement = vscode.commands.executeCommand(
    replacementCommand,
    replacementCommand === "replacePreviousChar"
      ? { text: punctuation, replaceCharCnt: 1 }
      : {
          text: punctuation,
          replacePrevCharCnt: 1,
          replaceNextCharCnt: 0,
          positionDelta: 0,
        },
  );
  await Promise.all([initialType, replacement]);
  await waitFor(
    () => editor.document.getText() === punctuation,
    `single ${punctuation} after IME composition`,
  );
  assert.equal(
    editor.document.getText(),
    punctuation,
    `IME punctuation ${punctuation} must not be duplicated`,
  );
}

async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} was not discovered by the extension host`);

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  assert.equal(
    workspaceFolders.length,
    2,
    "the isolated extension-host fixture must open two workspace roots",
  );
  const texWorkspace = workspaceFolders.find((folder) => folder.name === "paper-a");
  const bibWorkspace = workspaceFolders.find((folder) => folder.name === "library-b");
  assert.ok(texWorkspace, "paper-a workspace fixture was not opened");
  assert.ok(bibWorkspace, "library-b workspace fixture was not opened");

  const legacyPublisherSnippetPath =
    process.env.TEXLEAF_TEST_LEGACY_PUBLISHER_SNIPPET_PATH;
  assert.ok(
    legacyPublisherSnippetPath,
    "the extension-host runner must provide the legacy publisher fixture path",
  );
  const legacyPublisherSnippetUri = vscode.Uri.file(
    legacyPublisherSnippetPath,
  ).with({ scheme: "vscode-userdata" });
  const expectedLegacyPublisherText =
    `${DIRTY_LEGACY_PUBLISHER_PREFIX}${LEGACY_PUBLISHER_LIBRARY_TEXT}`;
  const expectedNewPublisherSnippetUri = vscode.Uri.joinPath(
    legacyPublisherSnippetUri,
    "..",
    "..",
    EXTENSION_ID,
    "texleaf-snippets.jsonc",
  );

  const testRoot = vscode.Uri.joinPath(
    vscode.Uri.file(os.tmpdir()),
    `texleaf-extension-host-${process.pid}-${Date.now()}`,
  );
  const orphanRoot = vscode.Uri.joinPath(testRoot, "orphan");
  const texProjectRoot = texWorkspace.uri;
  const bibProjectRoot = bibWorkspace.uri;
  const legacyWorkspaceSnippetUri = vscode.Uri.joinPath(
    texProjectRoot,
    ".vscode",
    "texleaf-snippets.jsonc",
  );
  const rootAExtraSnippetUri = vscode.Uri.joinPath(
    texProjectRoot,
    ".vscode",
    "texleaf-root-a-snippets.jsonc",
  );
  const rootBExtraSnippetUri = vscode.Uri.joinPath(
    bibProjectRoot,
    ".vscode",
    "texleaf-root-b-snippets.jsonc",
  );
  await vscode.workspace.fs.createDirectory(testRoot);
  await vscode.workspace.fs.createDirectory(orphanRoot);
  let globalSnippetUri;
  let globalSnippetBefore;
  let rootAConfiguration;
  let rootBConfiguration;
  let rootASnippetFilesBefore;
  let rootBSnippetFilesBefore;
  let rootAExtraCreated = false;
  let rootBExtraCreated = false;
  let workspaceExtrasConfigured = false;

  try {
    const openedMain = await openTestFile(texProjectRoot, "main.tex");
    const { document } = openedMain;
    let { editor } = openedMain;
    assert.equal(document.isUntitled, false, "scope tests require a saved .tex URI");
    assert.equal(
      vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString(),
      texWorkspace.uri.toString(),
      "the first global snippet test must run in workspace root A",
    );

    await waitFor(() => extension.isActive, "onLanguage:latex activation");
    // Activation can also happen through onStartupFinished, so first let the
    // clean fixture exercise normal publisher migration. Then remove only the
    // isolated test profile's new target and retry with the old source dirty.
    await vscode.workspace.fs.delete(expectedNewPublisherSnippetUri, {
      recursive: false,
    });
    const legacyPublisherDocument = await vscode.workspace.openTextDocument(
      legacyPublisherSnippetUri,
    );
    const legacyPublisherEditor = await vscode.window.showTextDocument(
      legacyPublisherDocument,
    );
    assert.equal(
      await legacyPublisherEditor.edit((builder) => {
        builder.insert(new vscode.Position(0, 0), DIRTY_LEGACY_PUBLISHER_PREFIX);
      }),
      true,
      "the migration test must create an unsaved old-publisher edit",
    );
    assert.equal(legacyPublisherDocument.isDirty, true);
    await vscode.commands.executeCommand("texleaf.openSnippetFile");
    let newTargetExistsWhileOldIsDirty = true;
    try {
      await vscode.workspace.fs.stat(expectedNewPublisherSnippetUri);
    } catch (error) {
      if (
        error instanceof vscode.FileSystemError &&
        error.code === "FileNotFound"
      ) {
        newTargetExistsWhileOldIsDirty = false;
      } else {
        throw error;
      }
    }
    assert.equal(
      newTargetExistsWhileOldIsDirty,
      false,
      "a dirty old-publisher document must defer migration and default seeding",
    );
    assert.equal(
      await legacyPublisherDocument.save(),
      true,
      "the old-publisher edit must reach disk before migration retries",
    );
    await vscode.commands.executeCommand("texleaf.openSnippetFile");
    await waitFor(
      () =>
        vscode.window.activeTextEditor?.document.uri.toString() ===
        expectedNewPublisherSnippetUri.toString(),
      "publisher-ID snippet migration after saving the dirty source",
    );
    assert.equal(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(legacyPublisherSnippetUri),
      ),
      expectedLegacyPublisherText,
      "publisher-ID migration must never delete or rewrite the old source",
    );
    const initiallyMigratedPublisherText = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(expectedNewPublisherSnippetUri),
    );
    assert.equal(
      initiallyMigratedPublisherText.includes(DIRTY_LEGACY_PUBLISHER_PREFIX),
      true,
      "the saved old-publisher JSONC edit must be the snapshot that migrates",
    );
    assert.equal(
      initiallyMigratedPublisherText.includes(LEGACY_PUBLISHER_SNIPPET_ID),
      true,
      "the migrated target must include old-publisher user snippets",
    );

    // A malformed old file must be left byte-for-byte intact while the new ID
    // receives a usable default library. Restore the valid fixture afterwards
    // so the remainder of the smoke test exercises the migrated user rule.
    await vscode.workspace.fs.delete(expectedNewPublisherSnippetUri, {
      recursive: false,
    });
    const invalidLegacyPublisherText = "{ this is not valid JSONC\n";
    const invalidLegacyPublisherEditor = await vscode.window.showTextDocument(
      legacyPublisherDocument,
    );
    await replaceDocument(
      invalidLegacyPublisherEditor,
      invalidLegacyPublisherText,
      invalidLegacyPublisherText.length,
    );
    assert.equal(await legacyPublisherDocument.save(), true);
    await vscode.commands.executeCommand("texleaf.openSnippetFile");
    const invalidFallbackText = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(expectedNewPublisherSnippetUri),
    );
    assert.equal(
      parseJsonc(invalidFallbackText).snippets.length,
      212,
      "an invalid old-publisher library must fall back to the complete factory library",
    );
    assert.equal(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(legacyPublisherSnippetUri),
      ),
      invalidLegacyPublisherText,
      "invalid publisher migration must not repair, replace, or delete the old source",
    );

    await vscode.workspace.fs.delete(expectedNewPublisherSnippetUri, {
      recursive: false,
    });
    const restoredLegacyPublisherEditor = await vscode.window.showTextDocument(
      legacyPublisherDocument,
    );
    await replaceDocument(
      restoredLegacyPublisherEditor,
      expectedLegacyPublisherText,
      expectedLegacyPublisherText.length,
    );
    assert.equal(await legacyPublisherDocument.save(), true);
    await vscode.commands.executeCommand("texleaf.openSnippetFile");
    assert.equal(
      new TextDecoder()
        .decode(await vscode.workspace.fs.readFile(expectedNewPublisherSnippetUri))
        .includes(LEGACY_PUBLISHER_SNIPPET_ID),
      true,
      "restoring a valid old source must allow publisher migration to retry",
    );
    editor = await vscode.window.showTextDocument(document);

    const configurationGroups = Array.isArray(
      extension.packageJSON.contributes.configuration,
    )
      ? extension.packageJSON.contributes.configuration
      : [extension.packageJSON.contributes.configuration];
    const configurationProperties = contributedConfigurationProperties(extension);
    assert.equal(
      extension.packageJSON.contributes.configurationDefaults["[latex]"]?.[
        "editor.wordBasedSuggestions"
      ],
      "off",
      "LaTeX word-based suggestions must default off so raw citation keys do not duplicate TeXLeaf citations",
    );
    assert.equal(
      extension.packageJSON.contributes.configurationDefaults["[tex]"]?.[
        "editor.wordBasedSuggestions"
      ],
      "off",
      "TeX word-based suggestions must default off so raw citation keys do not duplicate TeXLeaf citations",
    );

    const legacyWorkspaceSnippetBefore =
      await vscode.workspace.fs.readFile(legacyWorkspaceSnippetUri);
    const legacyWorkspaceSnippetText = new TextDecoder().decode(
      legacyWorkspaceSnippetBefore,
    );
    assert.match(legacyWorkspaceSnippetText, new RegExp(LEGACY_WORKSPACE_SNIPPET_ID));
    await assertAutomaticSnippetScope(
      editor,
      LEGACY_WORKSPACE_TRIGGER,
      "legacy workspace snippet files must not be loaded by default",
      LEGACY_WORKSPACE_TRIGGER,
    );

    for (const command of ["label", "tag", "tag*"]) {
      const commandSyntax = `\\${command}{`;
      const fixture = `\\begin{equation}${commandSyntax}}\\end{equation}`;
      const argumentOffset = fixture.indexOf(commandSyntax) + commandSyntax.length;
      await replaceDocument(editor, fixture, argumentOffset);
      await typeEach(";a");
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        document.getText(),
        `\\begin{equation}${commandSyntax};a}\\end{equation}`,
        `automatic math snippets must stay literal inside a ${command} argument`,
      );
      await vscode.commands.executeCommand("texleaf.handleTab");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        document.getText(),
        `\\begin{equation}${commandSyntax};a}\\end{equation}`,
        `manual Tab snippets must stay literal inside a ${command} argument`,
      );
    }

    const equationFixture = "\\begin{equation}\\label{eq:test}\\end{equation}";
    const equationBodyOffset = equationFixture.indexOf("\\end{equation}");
    await replaceDocument(editor, equationFixture, equationBodyOffset);
    await typeEach(";a");
    await waitFor(
      () =>
        document.getText() ===
        "\\begin{equation}\\label{eq:test}\\alpha\\end{equation}",
      "automatic math snippets after a closed label argument",
    );

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("texleaf.reloadSnippets"));
    assert.ok(commands.includes("texleaf.openSnippetEditor"));
    assert.ok(commands.includes("texleaf.openSnippetFile"));
    assert.ok(commands.includes("texleaf.openTemplateFile"));
    assert.ok(commands.includes("texleaf.restoreDefaultSnippets"));
    assert.ok(commands.includes("texleaf.pickCitation"));
    assert.ok(commands.includes("texleaf.refreshZotero"));
    assert.ok(commands.includes("texleaf.toggleMathPreview"));
    assert.ok(commands.includes("texleaf.refreshMathPreview"));
    assert.ok(commands.includes("texleaf.dismissMathPreview"));
    assert.ok(commands.includes("default:replacePreviousChar"));
    assert.ok(commands.includes("default:compositionType"));

    const tabKeybindings = extension.packageJSON.contributes.keybindings.filter(
      (keybinding) =>
        keybinding.command === "texleaf.handleTab" && keybinding.key === "tab",
    );
    const exactSnippetTabKeybinding = tabKeybindings.find((keybinding) =>
      keybinding.when.includes("texleaf.snippetTabActionAvailable"),
    );
    assert.ok(
      exactSnippetTabKeybinding,
      "exact TeXLeaf snippet matches need a dedicated Tab keybinding",
    );
    for (const competingContext of [
      "suggestWidgetVisible",
      "inlineSuggestionVisible",
      "inSnippetMode",
    ]) {
      assert.equal(
        exactSnippetTabKeybinding.when.includes(competingContext),
        false,
        `the exact snippet Tab keybinding must work while ${competingContext} is active`,
      );
    }
    const genericTabKeybinding = tabKeybindings.find(
      (keybinding) =>
        keybinding.when.includes("texleaf.tabActionAvailable") &&
        !keybinding.when.includes("texleaf.snippetTabActionAvailable"),
    );
    assert.ok(
      genericTabKeybinding,
      "matrix and tabout behavior must retain a separate generic Tab keybinding",
    );
    for (const guardedContext of [
      "!suggestWidgetVisible",
      "!inlineSuggestionVisible",
      "!inSnippetMode",
    ]) {
      assert.equal(
        genericTabKeybinding.when.includes(guardedContext),
        true,
        `the generic Tab keybinding must retain its ${guardedContext} guard`,
      );
    }

    const contributedCommands = new Map(
      extension.packageJSON.contributes.commands.map((command) => [
        command.command,
        command.title,
      ]),
    );
    assert.equal(
      contributedCommands.get("texleaf.openSnippetFile"),
      "TeXLeaf: 打开高级 Snippet JSONC",
    );
    assert.equal(
      contributedCommands.get("texleaf.openSnippetEditor"),
      "TeXLeaf: 管理 Snippet 与模板",
    );
    assert.equal(
      contributedCommands.get("texleaf.openTemplateFile"),
      "TeXLeaf: 管理 TeX 模板",
    );
    assert.equal(
      contributedCommands.get("texleaf.restoreDefaultSnippets"),
      "TeXLeaf: 恢复默认片段",
    );
    assert.equal(
      contributedCommands.get("texleaf.pickCitation"),
      "TeXLeaf: 显示参考文献补全",
    );
    assert.equal(
      contributedCommands.get("texleaf.refreshZotero"),
      "TeXLeaf: 刷新 Zotero 参考文献缓存",
    );
    assert.equal(
      configurationProperties["texleaf.bibliographyFile"].default,
      "reference.bib",
    );
    assert.deepEqual(
      configurationProperties["texleaf.bibliographyFormat"].enum,
      ["bibtex", "biblatex"],
    );
    assert.equal(
      configurationProperties["texleaf.bibliographyFormat"].default,
      "bibtex",
    );
    assert.equal(
      Object.hasOwn(
        configurationProperties,
        "texleaf.zoteroExportFormat",
      ),
      false,
      "the legacy export-format key must only remain as a runtime compatibility input",
    );
    assert.equal(
      configurationProperties["texleaf.zoteroPort"].default,
      23119,
    );
    assert.equal(
      extension.packageJSON.contributes.menus.commandPalette.some(
        (item) => item.command === "texleaf.restoreDefaultSnippets",
      ),
      true,
      "restore defaults must be available from the Command Palette",
    );
    assert.equal(
      extension.packageJSON.contributes.menus.commandPalette.some(
        (item) => item.command === "texleaf.openTemplateFile",
      ),
      true,
      "independent templates must be discoverable from the Command Palette",
    );
    assert.equal(
      extension.packageJSON.contributes.menus["view/title"].some(
        (item) =>
          item.command === "texleaf.restoreDefaultSnippets" &&
          item.when === "view == texleaf.snippets",
      ),
      true,
      "restore defaults must be available from the snippet tree title",
    );
    assert.equal(
      extension.packageJSON.contributes.viewsWelcome.some(
        (item) =>
          item.view === "texleaf.snippets" &&
          item.contents.includes("command:texleaf.restoreDefaultSnippets"),
      ),
      true,
      "the empty snippet tree must offer the guarded restore command",
    );
    assert.deepEqual(
      configurationProperties["texleaf.snippetFiles"].default,
      [],
      "workspace snippet files must be explicit opt-in extras",
    );
    assert.equal(
      Object.hasOwn(
        configurationProperties,
        "texleaf.customSnippets",
      ),
      false,
      "the retired settings-page snippet source must not coexist with the global library",
    );
    assert.deepEqual(
      extension.packageJSON.capabilities.untrustedWorkspaces
        .restrictedConfigurations,
      [
        "texleaf.snippetFiles",
        "texleaf.bibliographyFile",
        "texleaf.zoteroPort",
        "texleaf.zoteroLibrary",
        "texleaf.mathPreview.macros",
      ],
      "untrusted projects must not inject snippet or Zotero connection settings",
    );
    assert.equal(
      extension.packageJSON.capabilities.untrustedWorkspaces.supported,
      "limited",
      "restrictedConfigurations only apply when untrusted support is limited",
    );
    assert.deepEqual(
      configurationGroups.map((group) => group.title),
      [
        "TeXLeaf · 片段",
        "TeXLeaf · 文献",
        "TeXLeaf · 预览",
      ],
      "Settings UI must expose exactly the snippet, reference, and preview categories",
    );
    assert.deepEqual(
      configurationGroups.map((group) => Object.keys(group.properties)),
      [
        [
          "texleaf.enabled",
          "texleaf.autoSnippets",
          "texleaf.manualTrigger",
          "texleaf.autoFraction",
          "texleaf.autoFractionCommand",
          "texleaf.autoEnlargeBrackets",
          "texleaf.visualSnippets",
          "texleaf.matrixShortcuts",
          "texleaf.tabout",
          "texleaf.skipPairedClosingCharacters",
          "texleaf.autoDeleteMathDelimiters",
          "texleaf.colorizeBrackets",
          "texleaf.highlightActiveBracketPair",
          "texleaf.enableCompletions",
          "texleaf.languageIds",
          "texleaf.snippetFiles",
          "texleaf.excludedEnvironments",
          "texleaf.matrixEnvironments",
          "texleaf.autoFractionBreakingCharacters",
          "texleaf.autoEnlargeTriggers",
          "texleaf.maxRegexScanLength",
          "texleaf.wordDelimiters",
        ],
        [
          "texleaf.zoteroCitations",
          "texleaf.autoShowCitationPicker",
          "texleaf.bibliographyFile",
          "texleaf.citationCommands",
          "texleaf.zoteroPort",
          "texleaf.zoteroLibrary",
          "texleaf.zoteroRequestTimeoutMs",
          "texleaf.zoteroCacheSeconds",
          "texleaf.bibliographyFormat",
        ],
        [
          "texleaf.mathPreview.enabled",
          "texleaf.mathPreview.presentation",
          "texleaf.mathPreview.placement",
          "texleaf.mathPreview.debounceMs",
          "texleaf.mathPreview.scale",
          "texleaf.mathPreview.maxSourceLength",
          "texleaf.mathPreview.macros",
        ],
      ],
      "every contributed setting must remain visible in its sole functional category",
    );
    assert.equal(
      configurationProperties["texleaf.zoteroCitations"].default,
      true,
      "the Zotero category must expose a master switch",
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.enabled"].default,
      true,
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.presentation"].default,
      "cursor",
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.placement"].default,
      "auto",
    );
    assert.deepEqual(
      configurationProperties["texleaf.mathPreview.placement"].enum,
      ["auto", "above", "below"],
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.debounceMs"].default,
      120,
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.maxSourceLength"].default,
      8192,
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.macros"].maxProperties,
      128,
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.macros"].propertyNames.pattern,
      "^[A-Za-z@]+$",
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.macros"].additionalProperties
        .maxLength,
      2048,
    );
    assert.equal(
      extension.packageJSON.contributes.jsonValidation.some((validation) =>
        validation.fileMatch.includes(
          "**/globalStorage/zhangxh-math.texleaf/texleaf-snippets.jsonc",
        ),
      ),
      true,
      "the global snippet file must receive TeXLeaf JSON schema validation",
    );

    await assertTemplateExpansion(
      editor,
      "tmpa-cn",
      "\\documentclass[UTF8,11pt,reqno]{ctexart}",
    );
    await assertTemplateExpansion(
      editor,
      "tmpa-en",
      "\\documentclass[11pt,reqno]{article}",
    );
    await assertTemplateExpansion(
      editor,
      "beamer-cn",
      "\\documentclass[UTF8,aspectratio=169]{ctexbeamer}",
    );
    await assertTemplateExpansion(
      editor,
      "beamer-en",
      "\\documentclass[aspectratio=169]{beamer}",
    );
    await replaceDocument(editor, "", 0);
    await editEach(editor, "beamer-en");
    await waitFor(
      () =>
        document
          .getText()
          .includes("\\documentclass[aspectratio=169]{beamer}"),
      "template automatic expansion from the document-change fallback",
    );

    const whitespaceTemplateSource = "\n  tmpa-en \n";
    const whitespaceTemplateCursor =
      whitespaceTemplateSource.indexOf("tmpa-en") + "tmpa-en".length;
    await replaceDocument(
      editor,
      whitespaceTemplateSource,
      whitespaceTemplateCursor,
    );
    await vscode.commands.executeCommand("texleaf.handleTab");
    assert.equal(
      document.getText().includes("\\documentclass[11pt,reqno]{article}"),
      true,
      `a template must replace the trigger and all surrounding document whitespace; got ${JSON.stringify(document.getText())}`,
    );
    assert.equal(
      document.getText().startsWith("\n"),
      false,
      "template expansion must not leave leading blank lines from the empty document",
    );

    await replaceDocument(editor, "tmpa-en", "tmpa-en".length);
    editor.selections = [
      new vscode.Selection(0, "tmpa-en".length, 0, "tmpa-en".length),
      new vscode.Selection(0, 0, 0, 0),
    ];
    await vscode.commands.executeCommand("texleaf.handleTab");
    assert.doesNotMatch(
      document.getText(),
      /\\documentclass/u,
      "a whole-document template must not expand with multiple cursors",
    );

    await replaceDocument(editor, "tmpa-e", "tmpa-e".length);
    editor.selections = [
      new vscode.Selection(0, "tmpa-e".length, 0, "tmpa-e".length),
      new vscode.Selection(0, 0, 0, 0),
    ];
    await vscode.commands.executeCommand("type", { text: "n" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.doesNotMatch(
      document.getText(),
      /\\documentclass/u,
      "automatic whole-document templates must require one cursor",
    );

    await replaceDocument(editor, "已有正文 ", "已有正文 ".length);
    await typeEach("tmpa-en");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      document.getText(),
      "已有正文 tmpa-en",
      "an automatic document template must not expand into a non-blank TeX file",
    );
    await replaceDocument(editor, "已有正文 tmpa-en", "已有正文 tmpa-en".length);
    await vscode.commands.executeCommand("texleaf.handleTab");
    assert.doesNotMatch(
      document.getText(),
      /\\documentclass/u,
      "a document template must not expand into a non-blank TeX file",
    );

    await replaceDocument(editor, "", 0);
    await typeEach("dm");
    await waitFor(
      () => document.getText() === displayMathText(document),
      "ordinary text-mode dm automatic expansion",
    );

    await replaceDocument(editor, "", 0);
    await typeEach("tmpa-en");
    await waitFor(
      () =>
        document
          .getText()
          .includes("\\documentclass[11pt,reqno]{article}"),
      "template fixture for nested automatic snippets",
    );
    for (let index = 0; index < 4; index += 1) {
      await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
    }
    assert.equal(
      document.getText(editor.selection),
      "Introduce the problem, context, and main contribution.",
      "the nested dm regression must run inside a live template snippet placeholder",
    );
    await typeEach("dm");
    await waitFor(
      () =>
        /\\section\{Introduction\}\r?\n\r?\n\\\[\r?\n\r?\n\\\]/u.test(
          document.getText(),
        ),
      "dm automatic expansion inside a live template snippet session",
    );

    await replaceDocument(editor, "", 0);
    await typeEach("\\thm");
    await waitFor(
      () =>
        /^\\begin\{theorem\}\r?\n[\s\S]*\\end\{theorem\}\r?\n$/u.test(
          document.getText(),
        ),
      "automatic \\thm theorem environment",
    );
    assert.equal(
      editor.selection.active.line,
      1,
      "the first theorem tabstop must be in the environment body",
    );
    await typeEach("The statement.");
    assert.equal(
      document.lineAt(1).text.trim(),
      "The statement.",
      "typing at the first theorem tabstop must fill the body",
    );
    await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
    assert.equal(
      editor.selection.active.isEqual(
        document.positionAt(document.getText().length),
      ),
      true,
      "the final theorem tabstop must follow the complete environment",
    );

    const snippetBehaviorConfiguration = vscode.workspace.getConfiguration(
      "texleaf",
      document.uri,
    );
    const autoSnippetsBefore = snippetBehaviorConfiguration.inspect(
      "autoSnippets",
    )?.workspaceFolderValue;
    await snippetBehaviorConfiguration.update(
      "autoSnippets",
      false,
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
    try {
      await waitFor(
        () =>
          vscode.workspace
            .getConfiguration("texleaf", document.uri)
            .get("autoSnippets") === false,
        "autoSnippets=false configuration",
      );
      for (const trigger of [
        "tmpa-cn",
        "tmpa-en",
        "beamer-cn",
        "beamer-en",
      ]) {
        await replaceDocument(editor, "", 0);
        await typeEach(trigger);
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(
          document.getText(),
          trigger,
          `autoSnippets=false must keep ${trigger} literal while typing`,
        );
      }

      await replaceDocument(editor, "", 0);
      await typeEach("tmpa-en");
      await vscode.commands.executeCommand("editor.action.triggerSuggest");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await vscode.commands.executeCommand("texleaf.handleTab");
      await waitFor(
        () =>
          document
            .getText()
            .includes("\\documentclass[11pt,reqno]{article}"),
        "manual template expansion while native Suggest is visible",
      );

      await replaceDocument(editor, "", 0);
      await typeEach("dm");
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        document.getText(),
        "dm",
        "autoSnippets=false must keep an automatic trigger literal while typing",
      );
      await vscode.commands.executeCommand("editor.action.triggerSuggest");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await vscode.commands.executeCommand("texleaf.handleTab");
      await waitFor(
        () => document.getText() === displayMathText(document),
        "manual dm expansion while native Suggest is visible",
      );

      await replaceDocument(editor, "", 0);
      await typeEach("tmpa-en");
      await vscode.commands.executeCommand("texleaf.handleTab");
      await waitFor(
        () =>
          document
            .getText()
            .includes("\\documentclass[11pt,reqno]{article}"),
        "template fixture for the manual dm fallback",
      );
      for (let index = 0; index < 4; index += 1) {
        await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
      }
      assert.equal(
        document.getText(editor.selection),
        "Introduce the problem, context, and main contribution.",
        "the dm fallback must start inside a live outer snippet session",
      );
      await typeEach("dm");
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.match(
        document.getText(),
        /\\section\{Introduction\}\s+dm\s+\\section\{Main Results\}/u,
        "autoSnippets=false must keep dm literal inside a template placeholder",
      );
      await vscode.commands.executeCommand("editor.action.triggerSuggest");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await vscode.commands.executeCommand("texleaf.handleTab");
      await waitFor(
        () =>
          /\\section\{Introduction\}\r?\n\r?\n\\\[\r?\n\r?\n\\\]/u.test(
            document.getText(),
          ),
        "exact dm Tab fallback with Suggest and an outer snippet session active",
      );
    } finally {
      await snippetBehaviorConfiguration.update(
        "autoSnippets",
        autoSnippetsBefore,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await waitFor(
        () =>
          vscode.workspace
            .getConfiguration("texleaf", document.uri)
            .get("autoSnippets", true) === true,
        "restored autoSnippets configuration",
      );
    }

    const editorSuggestConfiguration = vscode.workspace.getConfiguration(
      "editor",
      document.uri,
    );
    const snippetSuggestionsBefore = editorSuggestConfiguration.inspect(
      "snippetSuggestions",
    )?.workspaceFolderValue;
    await editorSuggestConfiguration.update(
      "snippetSuggestions",
      "bottom",
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
    try {
      const theoremEnvironmentTriggers = new Map([
        ["\\axm", "axiom"],
        ["\\dfn", "definition"],
        ["\\lem", "lemma"],
        ["\\prp", "proposition"],
        ["\\thm", "theorem"],
        ["\\cor", "corollary"],
        ["\\clm", "claim"],
        ["\\asm", "assumption"],
        ["\\exm", "example"],
        ["\\exr", "exercise"],
        ["\\cnj", "conjecture"],
        ["\\hyp", "hypothesis"],
        ["\\rmk", "remark"],
      ]);
      for (const [trigger, environment] of theoremEnvironmentTriggers) {
        await replaceDocument(editor, trigger, trigger.length);
        const exactList = await provideCompletionList(
          document,
          trigger.length,
        );
        const exactItem = findTeXLeafSnippetCompletion(
          exactList.items,
          trigger,
        );
        assert.ok(exactItem, `missing exact ${trigger} TeXLeaf completion`);
        assert.equal(
          exactItem.kind,
          vscode.CompletionItemKind.Keyword,
          `exact ${trigger} must escape editor.snippetSuggestions=bottom grouping`,
        );
        assert.equal(
          exactItem.preselect,
          true,
          `exact ${trigger} must be the preselected native Suggest item`,
        );
        assert.match(
          exactItem.sortText ?? "",
          /^0000000:/u,
          `exact ${trigger} must receive the exact-only sort key`,
        );
        assert.equal(
          exactItem.insertText instanceof vscode.SnippetString,
          true,
          `changing the exact ${trigger} item kind must preserve SnippetString insertion`,
        );
        assert.equal(
          exactItem.insertText.value.includes("begin") &&
            exactItem.insertText.value.includes(environment) &&
            exactItem.insertText.value.includes("end") &&
            exactItem.insertText.value !== trigger,
          true,
          `the exact ${trigger} completion must retain the full ${environment} SnippetString`,
        );
        assert.equal(
          exactList.isIncomplete,
          true,
          "TeXLeaf must refresh completion metadata as a trigger becomes exact",
        );
      }

      await replaceDocument(editor, "\\th", "\\th".length);
      const fuzzyList = await provideCompletionList(document, "\\th".length);
      const fuzzyTheorem = findTeXLeafSnippetCompletion(
        fuzzyList.items,
        "\\thm",
      );
      assert.ok(
        fuzzyTheorem,
        "the fuzzy \\th prefix must retain the \\thm candidate",
      );
      assert.equal(
        fuzzyTheorem.kind,
        vscode.CompletionItemKind.Snippet,
        "a partial trigger must remain an ordinary Snippet candidate",
      );
      assert.notEqual(
        fuzzyTheorem.preselect,
        true,
        "a partial trigger must not override native Suggest selection",
      );
      assert.equal(
        typeof fuzzyTheorem.sortText === "string" &&
          !fuzzyTheorem.sortText.startsWith("0000000:"),
        true,
        "a partial trigger must retain TeXLeaf priority/order without the exact-match bucket",
      );

      const suggestCompetition = "theorem document\n\\thm";
      await replaceDocument(
        editor,
        suggestCompetition,
        suggestCompetition.length,
      );
      await vscode.commands.executeCommand("editor.action.triggerSuggest");
      await new Promise((resolve) => setTimeout(resolve, 250));
      await vscode.commands.executeCommand("acceptSelectedSuggestion");
      await waitFor(
        () =>
          document.getText().includes("\\begin{theorem}") &&
          document.getText().includes("\\end{theorem}"),
        "exact \\thm must beat word completions with snippetSuggestions=bottom",
      );
    } finally {
      await editorSuggestConfiguration.update(
        "snippetSuggestions",
        snippetSuggestionsBefore,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
    }

    assert.equal(
      vscode.workspace.isTrusted,
      true,
      "the isolated runner disables workspace trust so citation integration tests can write their fixtures",
    );
    const citationConfiguration = vscode.workspace.getConfiguration(
      "texleaf",
      document.uri,
    );
    const workbenchConfiguration =
      vscode.workspace.getConfiguration("workbench");
    const colorThemeBefore = workbenchConfiguration.inspect(
      "colorTheme",
    )?.globalValue;
    assert.equal(
      citationConfiguration.get("bibliographyFile"),
      "reference.bib",
      "the effective bibliography filename must default to reference.bib",
    );
    assert.equal(
      citationConfiguration.get("bibliographyFormat"),
      "bibtex",
      "the effective bibliography format must default to BibTeX",
    );
    assert.equal(
      citationConfiguration.get("mathPreview.placement"),
      "auto",
      "the effective Math Preview placement must default to auto",
    );
    const citationSettingNames = [
      "autoShowCitationPicker",
      "bibliographyFile",
      "bibliographyFormat",
      "zoteroPort",
      "zoteroRequestTimeoutMs",
      "mathPreview.enabled",
      "mathPreview.presentation",
      "mathPreview.placement",
      "mathPreview.debounceMs",
    ];
    const citationSettingsBefore = new Map(
      citationSettingNames.map((name) => [
        name,
        citationConfiguration.inspect(name)?.workspaceFolderValue,
      ]),
    );
    const referenceBibUri = vscode.Uri.joinPath(
      texProjectRoot,
      "reference.bib",
    );
    const customBibUri = vscode.Uri.joinPath(
      texProjectRoot,
      "sources",
      "custom-library.bib",
    );
    const defaultBibliography = [
      "@article{Lovelace1843,",
      "  title = {Notes on the Analytical Engine},",
      "  author = {Ada Lovelace},",
      "  journal = {Scientific Memoirs},",
      "  year = {1843}",
      "}",
      "",
      "@article{Turing1936,",
      "  title = {On Computable Numbers},",
      "  author = {Alan Turing},",
      "  journal = {Proceedings of the London Mathematical Society},",
      "  year = {1936}",
      "}",
      "",
    ].join("\n");
    const customBibliography = [
      "@book{Custom2026,",
      "  title = {A Custom Bibliography},",
      "  author = {Casey Author},",
      "  publisher = {Example Press},",
      "  year = {2026}",
      "}",
      "",
    ].join("\n");
    await vscode.workspace.fs.writeFile(
      referenceBibUri,
      new TextEncoder().encode(defaultBibliography),
    );
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(customBibUri, ".."),
    );
    await vscode.workspace.fs.writeFile(
      customBibUri,
      new TextEncoder().encode(customBibliography),
    );
    try {
      await workbenchConfiguration.update(
        "colorTheme",
        "Default Dark Modern",
        vscode.ConfigurationTarget.Global,
      );
      await waitFor(
        () => vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark,
        "the isolated Extension Host to apply its dark color theme",
      );
      await citationConfiguration.update(
        "mathPreview.enabled",
        true,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await citationConfiguration.update(
        "mathPreview.presentation",
        "hover",
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await citationConfiguration.update(
        "mathPreview.debounceMs",
        50,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );

      const previewSource = String.raw`Inline $x^2 + \frac{1}{2}$ preview`;
      const previewCursor = previewSource.indexOf("x^2") + 1;
      await replaceDocument(editor, previewSource, previewCursor);
      const previewHovers = await settlesWithin(
        vscode.commands.executeCommand(
          "vscode.executeHoverProvider",
          document.uri,
          document.positionAt(previewCursor),
        ),
        "Math Preview worker-backed hover",
        8_000,
      );
      const previewMarkdown = (previewHovers ?? [])
        .flatMap((hover) => hover.contents)
        .map((content) =>
          typeof content === "string" ? content : (content.value ?? ""),
        )
        .find((content) => content.includes("TeXLeaf Math Preview"));
      assert.ok(
        previewMarkdown,
        "the built-in Math Preview provider must return its rendered SVG inside a formula",
      );
      const previewUriMatch = /\]\(([^)]+\.svg)\)/u.exec(previewMarkdown);
      assert.ok(
        previewUriMatch,
        "Math Preview hover must reference a cached local SVG asset",
      );
      const previewAssetUri = vscode.Uri.parse(previewUriMatch[1]);
      const previewAssetName = path.basename(previewAssetUri.fsPath);
      assert.match(
        previewAssetName,
        /^p-[0-9a-z]+\.svg$/u,
        "Math Preview assets need short session-local names so the full Windows path stays below MAX_PATH",
      );
      assert.ok(
        previewAssetName.length <= 24,
        "Math Preview asset basenames must retain ample Windows path-length headroom",
      );
      const previewSvg = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(previewAssetUri),
      );
      assert.match(previewSvg, /^<svg\b/u);
      assert.doesNotMatch(
        previewSvg,
        /<script\b|<foreignObject\b|\son[a-z]+\s*=|javascript:/iu,
        "rendered Math Preview SVG must not contain active content",
      );
      assert.match(
        previewSvg,
        /#ffffff/iu,
        "a cursor/hover render created under a dark editor theme must use light glyphs",
      );
      assert.match(previewSvg, /shape-rendering="geometricPrecision"/iu);
      assert.match(previewSvg, /text-rendering="geometricPrecision"/iu);
      assert.doesNotMatch(
        previewSvg,
        /#202020|currentColor/iu,
        "the dark-theme asset must not retain the light-theme foreground or unresolved currentColor",
      );
      assert.match(
        previewSvg,
        /<rect\s+data-texleaf-preview-card="true"[^>]*fill="#0b0f14"[^>]*fill-opacity="1"[^>]*stroke="#ffffff"[^>]*stroke-opacity="0\.32"/iu,
        "dark-theme previews must carry their rounded, fully opaque card inside the safe SVG",
      );

      await workbenchConfiguration.update(
        "colorTheme",
        "Default Light Modern",
        vscode.ConfigurationTarget.Global,
      );
      await waitFor(
        () => vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light,
        "the isolated Extension Host to apply its light color theme",
      );
      const lightPreviewSource = String.raw`Light $y^2 + \frac{3}{4}$ preview`;
      const lightPreviewCursor = lightPreviewSource.indexOf("y^2") + 1;
      await replaceDocument(editor, lightPreviewSource, lightPreviewCursor);
      const lightPreviewHovers = await settlesWithin(
        vscode.commands.executeCommand(
          "vscode.executeHoverProvider",
          document.uri,
          document.positionAt(lightPreviewCursor),
        ),
        "light-theme Math Preview worker-backed hover",
        8_000,
      );
      const lightPreviewMarkdown = (lightPreviewHovers ?? [])
        .flatMap((hover) => hover.contents)
        .map((content) =>
          typeof content === "string" ? content : (content.value ?? ""),
        )
        .find((content) => content.includes("TeXLeaf Math Preview"));
      assert.ok(
        lightPreviewMarkdown,
        "the Math Preview provider must rerender after a dark-to-light theme change",
      );
      const lightPreviewUriMatch = /\]\(([^)]+\.svg)\)/u.exec(
        lightPreviewMarkdown,
      );
      assert.ok(lightPreviewUriMatch);
      const lightPreviewAssetUri = vscode.Uri.parse(lightPreviewUriMatch[1]);
      const lightPreviewSvg = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(lightPreviewAssetUri),
      );
      assert.match(
        lightPreviewSvg,
        /#202020/iu,
        "a cursor/hover render created under a light editor theme must use dark glyphs",
      );
      assert.doesNotMatch(lightPreviewSvg, /#ffffff|currentColor/iu);
      assert.match(
        lightPreviewSvg,
        /<rect\s+data-texleaf-preview-card="true"[^>]*fill="#fafafc"[^>]*fill-opacity="1"[^>]*stroke="#000000"[^>]*stroke-opacity="0\.28"/iu,
        "light-theme previews must rerender with the light rounded-card palette",
      );

      await replaceDocument(editor, previewSource, previewCursor);

      await citationConfiguration.update(
        "mathPreview.enabled",
        false,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await new Promise((resolve) => setTimeout(resolve, 75));
      const disabledPreviewHovers = await settlesWithin(
        vscode.commands.executeCommand(
          "vscode.executeHoverProvider",
          document.uri,
          document.positionAt(previewCursor),
        ),
        "disabled Math Preview hover",
      );
      assert.equal(
        (disabledPreviewHovers ?? [])
          .flatMap((hover) => hover.contents)
          .map((content) =>
            typeof content === "string" ? content : (content.value ?? ""),
          )
          .some((content) => content.includes("TeXLeaf Math Preview")),
        false,
        "the Math Preview master switch must disable TeXLeaf's provider",
      );
      await citationConfiguration.update(
        "mathPreview.enabled",
        true,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await citationConfiguration.update(
        "mathPreview.presentation",
        "cursor",
        vscode.ConfigurationTarget.WorkspaceFolder,
      );

      await citationConfiguration.update(
        "autoShowCitationPicker",
        false,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await citationConfiguration.update(
        "zoteroPort",
        1,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await citationConfiguration.update(
        "zoteroRequestTimeoutMs",
        500,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );

      const emptyCitationSource = "Before \\cite{} after";
      const emptyCitationCursor = emptyCitationSource.indexOf("}");
      await replaceDocument(editor, emptyCitationSource, emptyCitationCursor);
      const emptyCitationCompletionList = await provideCompletionList(
        document,
        emptyCitationCursor,
      );
      assert.equal(
        emptyCitationCompletionList.isIncomplete,
        true,
        "citation completions must be recomputed while the user continues typing a title or author query",
      );
      const emptyCitationItems = emptyCitationCompletionList.items;
      const lovelaceCompletion = findCitationCompletion(
        emptyCitationItems,
        "reference.bib",
        "Lovelace1843",
      );
      assert.ok(
        lovelaceCompletion,
        "an entry from the default reference.bib must be visible inside \\cite{}",
      );
      assert.deepEqual(lovelaceCompletion.label, {
        label: "Notes on the Analytical Engine",
        description: "reference.bib",
      });
      assert.equal(lovelaceCompletion.kind, vscode.CompletionItemKind.Reference);
      assert.equal(
        lovelaceCompletion.detail,
        undefined,
        "the Suggest details pane must not repeat author, publication, and year in a summary line",
      );
      assert.equal(completionInsertText(lovelaceCompletion), "Lovelace1843");
      assert.match(
        completionDocumentationText(lovelaceCompletion).replaceAll(
          "&nbsp;",
          " ",
        ),
        /### Notes on the Analytical Engine[\s\S]*\*\*作者：\*\* Ada Lovelace[\s\S]*\*\*期刊 \/ 出版物：\*\* Scientific Memoirs[\s\S]*\*\*年份：\*\* 1843[\s\S]*\*\*Citation key：\*\* `Lovelace1843`[\s\S]*\*\*来源：\*\* reference\.bib · 已收录/u,
        "native Suggest details must separate title, authors, publication, year, citation key, and source",
      );
      assert.equal(
        [
          lovelaceCompletion.label.label,
          lovelaceCompletion.label.description,
          lovelaceCompletion.detail ?? "",
        ].join("\n").includes("Lovelace1843"),
        false,
        "citation keys must not appear in the compact left-hand Suggest row",
      );
      assert.equal(
        lovelaceCompletion.range.start.isEqual(
          document.positionAt(emptyCitationCursor),
        ),
        true,
      );
      assert.equal(
        lovelaceCompletion.range.end.isEqual(
          document.positionAt(emptyCitationCursor),
        ),
        true,
      );

      const titleQuerySource = "\\cite{Analytical}";
      const titleQueryCursor = titleQuerySource.indexOf("}");
      await replaceDocument(editor, titleQuerySource, titleQueryCursor);
      const titleQueryItems = await provideCompletions(
        document,
        titleQueryCursor,
      );
      assert.ok(
        findCitationCompletion(
          titleQueryItems,
          "reference.bib",
          "Lovelace1843",
        ),
        "typing a title substring must retain the matching bibliography entry",
      );
      assert.equal(
        findCitationCompletion(
          titleQueryItems,
          "reference.bib",
          "Turing1936",
        ),
        undefined,
        "title filtering must remove non-matching bibliography entries",
      );

      const authorQuerySource = "\\cite{Ada}";
      const authorQueryCursor = authorQuerySource.indexOf("}");
      await replaceDocument(editor, authorQuerySource, authorQueryCursor);
      const authorQueryItems = await provideCompletions(
        document,
        authorQueryCursor,
      );
      assert.ok(
        findCitationCompletion(
          authorQueryItems,
          "reference.bib",
          "Lovelace1843",
        ),
        "typing an author substring must retain the matching bibliography entry",
      );
      assert.equal(
        findCitationCompletion(
          authorQueryItems,
          "reference.bib",
          "Turing1936",
        ),
        undefined,
        "author filtering must remove non-matching bibliography entries",
      );

      const yearQuerySource = "\\cite{1843}";
      const yearQueryCursor = yearQuerySource.indexOf("}");
      await replaceDocument(editor, yearQuerySource, yearQueryCursor);
      const yearQueryItems = await provideCompletions(
        document,
        yearQueryCursor,
      );
      assert.ok(
        findCitationCompletion(
          yearQueryItems,
          "reference.bib",
          "Lovelace1843",
        ),
        "typing a publication year must retain the matching bibliography entry",
      );

      const keyQuerySource = "\\cite{Lovelace1843}";
      const keyQueryCursor = keyQuerySource.indexOf("}");
      await replaceDocument(editor, keyQuerySource, keyQueryCursor);
      const keyQueryItems = await provideCompletions(
        document,
        keyQueryCursor,
      );
      assert.ok(
        findCitationCompletion(
          keyQueryItems,
          "reference.bib",
          "Lovelace1843",
        ),
        "citation keys must remain searchable without appearing in the left label",
      );

      await citationConfiguration.update(
        "autoShowCitationPicker",
        true,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      const retriggerCitationSource = "\\cite{}";
      const retriggerCitationCursor = retriggerCitationSource.indexOf("}");
      await replaceDocument(
        editor,
        retriggerCitationSource,
        retriggerCitationCursor,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await vscode.commands.executeCommand("type", { text: "a" });
      await waitFor(
        () => document.getText() === "\\cite{a}",
        "the first citation query character",
      );
      // VS Code may close an incomplete native Suggest session when Backspace
      // returns its range to zero width. Make that native dismissal
      // deterministic so this guards TeXLeaf's automatic reopening, not a
      // widget implementation detail of one VS Code release.
      await vscode.commands.executeCommand("hideSuggestWidget");
      await vscode.commands.executeCommand("deleteLeft");
      await waitFor(
        () => document.getText() === "\\cite{}",
        "Backspace to restore an empty citation segment",
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await typeEach("Ada");
      await new Promise((resolve) => setTimeout(resolve, 350));
      await vscode.commands.executeCommand("acceptSelectedSuggestion");
      await waitFor(
        () => document.getText() === "\\cite{Lovelace1843}",
        "native citation Suggest to reopen after a query is erased",
      );
      await citationConfiguration.update(
        "autoShowCitationPicker",
        false,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );

      const outsideCitationSource = "Plain text Lovelace";
      await replaceDocument(
        editor,
        outsideCitationSource,
        outsideCitationSource.length,
      );
      const outsideItems = await provideCompletions(
        document,
        outsideCitationSource.length,
      );
      assert.equal(
        findCitationCompletion(
          outsideItems,
          "reference.bib",
          "Lovelace1843",
        ),
        undefined,
        "TeXLeaf citation entries must not leak outside cite-like arguments",
      );

      const multiCitationSource =
        "\\cite{Lovelace1843, Tur, SiblingKey}";
      const currentTokenStart = multiCitationSource.indexOf("Tur");
      const currentTokenEnd = currentTokenStart + "Tur".length;
      const multiCitationCursor = currentTokenStart + "Tu".length;
      await replaceDocument(editor, multiCitationSource, multiCitationCursor);
      const multiCitationItems = await provideCompletions(
        document,
        multiCitationCursor,
      );
      const turingCompletion = findCitationCompletion(
        multiCitationItems,
        "reference.bib",
        "Turing1936",
      );
      assert.ok(
        turingCompletion,
        "the provider must filter from the prefix while keeping a completion for the current full token",
      );
      assert.equal(
        turingCompletion.range.start.isEqual(
          document.positionAt(currentTokenStart),
        ),
        true,
        "a multi-key completion must start at the current comma-delimited token",
      );
      assert.equal(
        turingCompletion.range.end.isEqual(
          document.positionAt(currentTokenEnd),
        ),
        true,
        "a multi-key completion must replace the full token, including text after the caret",
      );
      assert.equal(completionInsertText(turingCompletion), "Turing1936");
      assert.equal(
        findCitationCompletion(
          multiCitationItems,
          "reference.bib",
          "Lovelace1843",
        ),
        undefined,
        "a key already used by a sibling segment must not be suggested again",
      );

      await citationConfiguration.update(
        "bibliographyFile",
        "sources/custom-library.bib",
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await citationConfiguration.update(
        "bibliographyFormat",
        "biblatex",
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      assert.equal(
        vscode.workspace
          .getConfiguration("texleaf", document.uri)
          .get("bibliographyFile"),
        "sources/custom-library.bib",
      );
      assert.equal(
        vscode.workspace
          .getConfiguration("texleaf", document.uri)
          .get("bibliographyFormat"),
        "biblatex",
      );
      const customCitationSource = "\\cite{Cus}";
      const customCitationCursor = customCitationSource.indexOf("}");
      await replaceDocument(editor, customCitationSource, customCitationCursor);
      const customCitationItems = await provideCompletions(
        document,
        customCitationCursor,
      );
      const customCompletion = findCitationCompletion(
        customCitationItems,
        "custom-library.bib",
        "Custom2026",
      );
      assert.ok(
        customCompletion,
        "the native provider must read entries from the configured bibliography path",
      );
      assert.deepEqual(customCompletion.label, {
        label: "A Custom Bibliography",
        description: "custom-library.bib",
      });
      assert.equal(
        customCompletion.detail,
        undefined,
        "custom bibliography items must also avoid the duplicate metadata summary line",
      );
      assert.equal(
        findCitationCompletion(
          customCitationItems,
          "reference.bib",
          "Lovelace1843",
        ),
        undefined,
        "switching bibliographyFile must stop indexing the default file",
      );
    } finally {
      await replaceDocument(editor, "", 0);
      await workbenchConfiguration.update(
        "colorTheme",
        colorThemeBefore,
        vscode.ConfigurationTarget.Global,
      );
      for (const name of [...citationSettingNames].reverse()) {
        await citationConfiguration.update(
          name,
          citationSettingsBefore.get(name),
          vscode.ConfigurationTarget.WorkspaceFolder,
        );
      }
    }

    await vscode.commands.executeCommand("texleaf.openSnippetFile");
    await waitFor(
      () =>
        vscode.window.activeTextEditor?.document.uri.path.endsWith(
          "/texleaf-snippets.jsonc",
        ) === true,
      "global snippet configuration editor",
    );
    let globalEditor = vscode.window.activeTextEditor;
    assert.ok(globalEditor, "the global snippet command must reveal an editor");
    globalSnippetUri = globalEditor.document.uri;
    assert.equal(
      globalSnippetUri.path
        .toLowerCase()
        .endsWith(
          "/globalstorage/zhangxh-math.texleaf/texleaf-snippets.jsonc",
        ),
      true,
      "the primary snippet file must live under ExtensionContext.globalStorageUri",
    );
    assert.equal(
      globalEditor.document.isDirty,
      false,
      "refuse to overwrite an unsaved global snippet document during tests",
    );
    globalSnippetBefore = await vscode.workspace.fs.readFile(globalSnippetUri);
    const seededGlobalLibrary = parseJsonc(
      new TextDecoder().decode(globalSnippetBefore),
    );
    assert.equal(
      seededGlobalLibrary.defaultsRevision,
      3,
      "the global file must record the materialized factory-library revision",
    );
    assert.equal(
      seededGlobalLibrary.snippets.length,
      213,
      "the publisher-migrated user snippet and all factory snippets must be editable",
    );
    assert.equal(
      seededGlobalLibrary.snippets[0]?.id,
      LEGACY_PUBLISHER_SNIPPET_ID,
      "publisher migration must keep the user's old global snippet ahead of factory defaults",
    );
    assert.equal(
      new TextDecoder()
        .decode(globalSnippetBefore)
        .includes(DIRTY_LEGACY_PUBLISHER_PREFIX),
      true,
      "factory revision migration must preserve the copied JSONC comment",
    );
    assert.equal(
      seededGlobalLibrary.snippets.find(
        (snippet) => snippet.id === "mode.inline",
      )?.trigger,
      "lm",
      "the editable factory library must use the renamed inline-math trigger",
    );
    assert.equal(
      seededGlobalLibrary.snippets.find(
        (snippet) => snippet.id === "accent.auto-hat",
      )?.priority,
      1,
      "the generated global library must include the Qhat priority fix",
    );
    assert.equal(
      globalEditor.document.getText().includes(LEGACY_WORKSPACE_SNIPPET_ID),
      false,
      "legacy workspace snippets must never be promoted into global storage",
    );
    const changedOldPublisherText = LEGACY_PUBLISHER_LIBRARY_TEXT.replace(
      "tlegacyid",
      "tlegacyidchanged",
    );
    await vscode.workspace.fs.writeFile(
      legacyPublisherSnippetUri,
      new TextEncoder().encode(changedOldPublisherText),
    );
    await vscode.commands.executeCommand("texleaf.openSnippetFile");
    assert.deepEqual(
      await vscode.workspace.fs.readFile(globalSnippetUri),
      globalSnippetBefore,
      "an existing new-publisher global file must never be overwritten by later old-publisher changes",
    );

    const templateDirectoryUri = vscode.Uri.joinPath(
      globalSnippetUri,
      "..",
      "templates",
    );
    let templateNames = [];
    try {
      templateNames = (await vscode.workspace.fs.readDirectory(
        templateDirectoryUri,
      ))
        .filter(([, type]) => type === vscode.FileType.File)
        .map(([name]) => name)
        .sort();
    } catch (error) {
      if (
        !(error instanceof vscode.FileSystemError) ||
        error.code !== "FileNotFound"
      ) {
        throw error;
      }
    }
    assert.deepEqual(
      templateNames,
      [],
      "a clean profile must use the internal template catalog without materializing editable .tex dependencies",
    );
    // The four expansion assertions near the beginning of this test prove the
    // newly materialized internal catalog is live. Upgrade fixtures may still
    // leave old templates/*.tex files in place: activation reads them only
    // while creating the first catalog and deliberately never deletes them.

    const legacyGlobalLibraryText = `${JSON.stringify(
      {
        version: 1,
        variables: { GREEK: "alpha|customgreek" },
        snippets: [
          {
            id: "extension-host-pre-0.3-user",
            trigger: "toldglobal",
            replacement: "\\operatorname{OldGlobal}",
            options: "tA",
          },
        ],
      },
      null,
      2,
    )}\n`;
    await replaceDocument(
      globalEditor,
      legacyGlobalLibraryText,
      legacyGlobalLibraryText.length,
    );
    assert.equal(
      await globalEditor.document.save(),
      true,
      "the simulated pre-0.3 global library must reach disk",
    );
    await vscode.commands.executeCommand("texleaf.openSnippetFile");
    await waitFor(
      () => {
        const active = vscode.window.activeTextEditor;
        return active !== undefined &&
          !active.document.isClosed &&
          active.document.uri.toString() === globalSnippetUri.toString();
      },
      "one-time global factory migration",
    );
    globalEditor = vscode.window.activeTextEditor;
    assert.ok(globalEditor);
    const migratedGlobalLibrary = JSON.parse(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(globalSnippetUri),
      ),
    );
    assert.equal(migratedGlobalLibrary.defaultsRevision, 3);
    assert.equal(migratedGlobalLibrary.snippets.length, 213);
    assert.equal(
      migratedGlobalLibrary.snippets[0].id,
      "extension-host-pre-0.3-user",
      "migration must keep existing user rules ahead of appended factory rules",
    );
    assert.equal(
      migratedGlobalLibrary.variables.GREEK,
      "alpha|customgreek",
      "migration must not overwrite user-modified variables",
    );
    assert.equal(typeof migratedGlobalLibrary.variables.SYMBOL, "string");
    const backupDirectory = vscode.Uri.joinPath(
      globalSnippetUri,
      "..",
      "backups",
    );
    const migrationBackups = (await vscode.workspace.fs.readDirectory(
      backupDirectory,
    )).filter(([name]) => name.includes(".migration."));
    assert.equal(
      migrationBackups.length,
      4,
      "all valid publisher-ID migrations and the explicit pre-0.3 fixture require verified backups",
    );
    const migrationBackupTexts = await Promise.all(
      migrationBackups.map(async ([name]) =>
        new TextDecoder().decode(
          await vscode.workspace.fs.readFile(
            vscode.Uri.joinPath(backupDirectory, name),
          ),
        ),
      ),
    );
    assert.equal(
      migrationBackupTexts.includes(legacyGlobalLibraryText),
      true,
      "migration backup must preserve the exact pre-0.3 bytes",
    );
    assert.equal(
      migrationBackupTexts.includes(expectedLegacyPublisherText),
      true,
      "publisher-ID factory migration backup must preserve the exact copied JSONC bytes",
    );
    assert.equal(
      migrationBackupTexts.includes(LEGACY_PUBLISHER_LIBRARY_TEXT),
      true,
      "the clean publisher-ID activation must also preserve its exact copied JSONC bytes",
    );

    const theoremRevisionMigrations = new Map([
      ["environment.axiom", { oldTrigger: "axm", trigger: "\\axm" }],
      ["environment.definition", { oldTrigger: "def", trigger: "\\dfn" }],
      ["environment.lemma", { oldTrigger: "lem", trigger: "\\lem" }],
      ["environment.proposition", { oldTrigger: "prp", trigger: "\\prp" }],
      ["environment.theorem", { oldTrigger: "thm", trigger: "\\thm" }],
      ["environment.corollary", { oldTrigger: "cor", trigger: "\\cor" }],
      ["environment.claim", { oldTrigger: "clm", trigger: "\\clm" }],
      ["environment.assumption", { oldTrigger: "asm", trigger: "\\asm" }],
      ["environment.example", { oldTrigger: "exm", trigger: "\\exm" }],
      ["environment.exercise", { oldTrigger: "exr", trigger: "\\exr" }],
      ["environment.conjecture", { oldTrigger: "cnj", trigger: "\\cnj" }],
      ["environment.hypothesis", { oldTrigger: "hyp", trigger: "\\hyp" }],
      ["environment.remark", { oldTrigger: "rmk", trigger: "\\rmk" }],
    ]);
    const theoremSnippetIds = [...theoremRevisionMigrations.keys()];
    const migrateMaterializedFixture = async (fixture, description) => {
      const fixtureText = `${JSON.stringify(fixture, null, 2)}\n`;
      if (
        vscode.window.activeTextEditor?.document.uri.toString() ===
        globalSnippetUri.toString()
      ) {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      }
      await vscode.workspace.fs.writeFile(
        globalSnippetUri,
        new TextEncoder().encode(fixtureText),
      );
      await vscode.commands.executeCommand("texleaf.openSnippetFile");
      await waitFor(
        () => {
          const active = vscode.window.activeTextEditor;
          return active !== undefined &&
            !active.document.isClosed &&
            active.document.uri.toString() === globalSnippetUri.toString();
        },
        description,
      );
      globalEditor = vscode.window.activeTextEditor;
      assert.ok(globalEditor);
      const migratedText = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(globalSnippetUri),
      );
      await waitFor(
        () =>
          !globalEditor.document.isClosed &&
          !globalEditor.document.isDirty &&
          globalEditor.document.getText() === migratedText,
        `${description} document refresh`,
      );
      // The file was replaced through workspace.fs while its previous editor
      // was closed. Give VS Code's external-file refresh one event-loop turn
      // after text convergence before the next TextEditor.edit; otherwise the
      // pending model refresh can cancel that edit and make it return false.
      await new Promise((resolve) => setTimeout(resolve, 50));
      return JSON.parse(migratedText);
    };

    const revisionOneFixture = JSON.parse(JSON.stringify(seededGlobalLibrary));
    revisionOneFixture.defaultsRevision = 1;
    delete revisionOneFixture.variables.SYMBOL;
    revisionOneFixture.snippets = [
      null,
      ...revisionOneFixture.snippets
        .filter(
          (snippet) =>
            snippet.id !== "greek.beta" &&
            !theoremSnippetIds.includes(snippet.id),
        )
        .map((snippet) =>
          snippet.id === "mode.inline"
            ? { ...snippet, trigger: "mk" }
            : snippet,
        ),
    ];
    const revisionThreeFromOneResult = await migrateMaterializedFixture(
      revisionOneFixture,
      "revision-1 to revision-3 global migration editor refresh",
    );
    assert.equal(revisionThreeFromOneResult.defaultsRevision, 3);
    assert.equal(
      revisionThreeFromOneResult.snippets[0],
      null,
      "narrow migration must preserve invalid array positions instead of editing the wrong object",
    );
    assert.equal(
      revisionThreeFromOneResult.snippets.find(
        (snippet) => snippet?.id === "mode.inline",
      )?.trigger,
      "lm",
      "the untouched revision-1 inline trigger must migrate from mk to lm",
    );
    assert.equal(
      revisionThreeFromOneResult.snippets.some(
        (snippet) => snippet?.id === "greek.beta",
      ),
      false,
      "materialized-library upgrades must not resurrect an old factory rule deleted by the user",
    );
    assert.equal(
      Object.hasOwn(revisionThreeFromOneResult.variables, "SYMBOL"),
      false,
      "materialized-library upgrades must not restore a default variable deleted by the user",
    );
    for (const [id, migration] of theoremRevisionMigrations) {
      const snippet = revisionThreeFromOneResult.snippets.find(
        (candidate) => candidate?.id === id,
      );
      assert.equal(snippet?.trigger, migration.trigger, id);
      assert.equal(
        snippet?.options,
        "tAw",
        `revision 1 must receive automatic ${migration.trigger}`,
      );
    }

    const revisionTwoFixture = JSON.parse(JSON.stringify(seededGlobalLibrary));
    revisionTwoFixture.defaultsRevision = 2;
    delete revisionTwoFixture.variables.SYMBOL;
    revisionTwoFixture.snippets = revisionTwoFixture.snippets
      .filter((snippet) => snippet.id !== "greek.beta")
      .map((snippet) => {
        const migration = theoremRevisionMigrations.get(snippet.id);
        return migration === undefined
          ? snippet
          : { ...snippet, trigger: migration.oldTrigger, options: "tw" };
      });
    const revisionTwoLength = revisionTwoFixture.snippets.length;
    const revisionThreeResult = await migrateMaterializedFixture(
      revisionTwoFixture,
      "revision-2 to revision-3 global migration editor refresh",
    );
    assert.equal(revisionThreeResult.defaultsRevision, 3);
    assert.equal(
      revisionThreeResult.snippets.length,
      revisionTwoLength,
      "revision 2 to 3 must update theorem records in place",
    );
    assert.equal(
      revisionThreeResult.snippets.some(
        (snippet) => snippet?.id === "greek.beta",
      ),
      false,
      "revision 3 must not resurrect an old factory snippet deleted by the user",
    );
    assert.equal(
      Object.hasOwn(revisionThreeResult.variables, "SYMBOL"),
      false,
      "revision 3 must not restore a default variable deleted by the user",
    );
    for (const [id, migration] of theoremRevisionMigrations) {
      const snippet = revisionThreeResult.snippets.find(
        (candidate) => candidate?.id === id,
      );
      assert.equal(snippet?.trigger, migration.trigger, id);
      assert.equal(
        snippet?.options,
        "tAw",
        `revision 3 must enable automatic expansion for ${migration.trigger}`,
      );
    }

    const customizedRevisionTwoFixture = JSON.parse(
      JSON.stringify(revisionTwoFixture),
    );
    const customizedTheorem = customizedRevisionTwoFixture.snippets.find(
      (snippet) => snippet.id === "environment.theorem",
    );
    assert.ok(customizedTheorem);
    customizedTheorem.enabled = false;
    const customizedRevisionThreeResult = await migrateMaterializedFixture(
      customizedRevisionTwoFixture,
      "customized revision-2 theorem migration",
    );
    const preservedTheorem = customizedRevisionThreeResult.snippets.find(
      (snippet) => snippet?.id === "environment.theorem",
    );
    assert.equal(
      preservedTheorem.trigger,
      "thm",
      "revision 3 must not rename a customized revision-2 theorem trigger",
    );
    assert.equal(
      preservedTheorem.options,
      "tw",
      "revision 3 must not make a customized theorem automatic",
    );
    assert.equal(
      preservedTheorem.enabled,
      false,
      "revision 3 must preserve a customized theorem enabled state",
    );

    migratedGlobalLibrary.snippets = migratedGlobalLibrary.snippets.filter(
      (snippet) => snippet.id !== "greek.alpha",
    );
    const intentionalDeletionText = `${JSON.stringify(
      migratedGlobalLibrary,
      null,
      2,
    )}\n`;
    const afterSecondEnsure = await migrateMaterializedFixture(
      JSON.parse(intentionalDeletionText),
      "post-migration intentional-deletion editor refresh",
    );
    assert.equal(
      afterSecondEnsure.snippets.some((snippet) => snippet.id === "greek.alpha"),
      false,
      "a factory rule intentionally deleted after migration must not reappear",
    );

    const globalOnlyFixture = {
      id: "extension-host-global",
      trigger: "tglb",
      replacement: "\\operatorname{Global}",
      options: "tA",
      description: "Extension-host global storage test",
    };
    const minimalGlobalSnippetText = `${JSON.stringify(
      {
        version: 1,
        defaultsRevision: 2,
        variables: {},
        snippets: [globalOnlyFixture],
      },
      null,
      2,
    )}\n`;
    const globalSnippetText = `${JSON.stringify(
      {
        ...seededGlobalLibrary,
        snippets: [
          ...seededGlobalLibrary.snippets,
          globalOnlyFixture,
        ],
      },
      null,
      2,
    )}\n`;
    await replaceDocument(
      globalEditor,
      minimalGlobalSnippetText,
      minimalGlobalSnippetText.length,
    );
    assert.equal(
      await globalEditor.document.save(),
      true,
      "global snippet test library must save",
    );
    editor = await vscode.window.showTextDocument(document);
    await waitForAutomaticSnippet(
      editor,
      "tglb",
      "\\operatorname{Global}",
      "saving the global file must reload snippets through its file watcher",
    );
    await assertAutomaticSnippetScope(
      editor,
      "lm",
      "factory snippets must not survive as a hidden built-in source",
      "lm",
    );

    const restoredGlobalEditor = await vscode.window.showTextDocument(
      globalEditor.document,
    );
    await replaceDocument(
      restoredGlobalEditor,
      globalSnippetText,
      globalSnippetText.length,
    );
    assert.equal(
      await restoredGlobalEditor.document.save(),
      true,
      "the complete editable factory fixture must save",
    );
    editor = await vscode.window.showTextDocument(document);
    await waitForAutomaticSnippet(
      editor,
      "lm",
      "\\(\\)",
      "factory rules must return only after they are present in the global file",
    );

    assert.equal(
      vscode.languages
        .getDiagnostics(globalSnippetUri)
        .some((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error),
      false,
      "the valid global snippet fixture must not have error diagnostics",
    );
    const malformedGlobalEditor = await vscode.window.showTextDocument(
      globalEditor.document,
    );
    const malformedGlobalText = '{\n  "version": 1,\n  "snippets": [\n';
    await replaceDocument(
      malformedGlobalEditor,
      malformedGlobalText,
      malformedGlobalText.length,
    );
    assert.equal(
      await malformedGlobalEditor.document.save(),
      true,
      "malformed global snippet fixture must reach disk",
    );
    await waitFor(
      () =>
        vscode.languages
          .getDiagnostics(globalSnippetUri)
          .some(
            (diagnostic) =>
              diagnostic.severity === vscode.DiagnosticSeverity.Error &&
              diagnostic.message.startsWith("JSONC 解析失败"),
          ),
      "global snippet parse diagnostic from the file watcher",
    );
    editor = await vscode.window.showTextDocument(document);
    await assertAutomaticSnippetScope(
      editor,
      "\\operatorname{Global}",
      "malformed JSON must retain the last-known-good global snippet cache",
      "tglb",
    );

    const dirtyGlobalEditor = await vscode.window.showTextDocument(
      globalEditor.document,
    );
    const dirtyGlobalText = `${globalSnippetText}\n// unsaved import/export guard`;
    await replaceDocument(
      dirtyGlobalEditor,
      dirtyGlobalText,
      dirtyGlobalText.length,
    );
    assert.equal(
      dirtyGlobalEditor.document.isDirty,
      true,
      "import/export dirty guards require an unsaved global document",
    );
    const diskBeforeDirtyCommands =
      await vscode.workspace.fs.readFile(globalSnippetUri);
    await settlesWithin(
      vscode.commands.executeCommand("texleaf.importSnippets"),
      "dirty global import rejection before showing a file picker",
    );
    await settlesWithin(
      vscode.commands.executeCommand("texleaf.exportSnippets"),
      "dirty global export rejection before showing a save picker",
    );
    await settlesWithin(
      vscode.commands.executeCommand("texleaf.restoreDefaultSnippets"),
      "dirty global restore rejection before showing its modal confirmation",
    );
    assert.equal(
      dirtyGlobalEditor.document.isDirty,
      true,
      "rejected import/export/restore commands must preserve unsaved editor state",
    );
    assert.equal(dirtyGlobalEditor.document.getText(), dirtyGlobalText);
    assert.deepEqual(
      await vscode.workspace.fs.readFile(globalSnippetUri),
      diskBeforeDirtyCommands,
      "rejected import/export/restore commands must not overwrite the global file",
    );
    await vscode.commands.executeCommand("workbench.action.files.revert");
    assert.equal(
      dirtyGlobalEditor.document.isDirty,
      false,
      "the test must discard only its own unsaved dirty-guard fixture",
    );
    editor = await vscode.window.showTextDocument(document);

    await assertImePunctuation(editor, "（", "replacePreviousChar");
    await assertImePunctuation(editor, "、", "compositionType");

  await replaceDocument(editor, "", 0);
  await typeEach("lm");

  await waitFor(() => document.getText() === "\\(\\)", "automatic lm expansion");
  assert.equal(document.offsetAt(editor.selection.active), 2);

  await replaceDocument(editor, "\\(\\)", 2);
  await typeEach("Qhat");
  await waitFor(
    () => document.getText() === "\\(\\hat{Q}\\)",
    "type-command Qhat accent expansion",
  );
  assert.equal(document.offsetAt(editor.selection.active), 9);

  await replaceDocument(editor, "\\(\\)", 2);
  await editEach(editor, "Qhat");
  await waitFor(
    () => document.getText() === "\\(\\hat{Q}\\)",
    "document-change Qhat accent expansion",
  );

  await replaceDocument(editor, "    ", 4);
  await typeEach("dm");
  await waitFor(() => document.lineCount === 3, "indented dm expansion");
  assert.equal(document.lineAt(0).text, "    \\[");
  assert.equal(document.lineAt(2).text, "    \\]");
  assert.equal(editor.selection.active.line, 1);
  assert.equal(editor.selection.active.character, 4);

  const configuration = vscode.workspace.getConfiguration(
    "texleaf",
    document.uri,
  );
  assert.deepEqual(
    configuration.get("snippetFiles"),
    [],
    "workspace snippet files must be disabled by default",
  );
  assert.equal(
    configuration.get("autoFraction", true),
    true,
    "the extension-host fraction test requires texleaf.autoFraction=true",
  );
  await replaceDocument(editor, "\\(\\)", 2);
  await editEach(editor, "1/");
  assert.equal(document.getText(), "\\(1/\\)");
  await editEach(editor, "2");
  await waitFor(
    () => document.getText() === "\\(\\frac{1}{2}\\)",
    "document-change automatic fraction",
  );
  await waitFor(
    () => document.offsetAt(editor.selection.active) === 12,
    "document-change fraction tabstop",
  );
  assert.equal(document.offsetAt(editor.selection.active), 12);

  await assertMatrixShortcuts(editor, "align", vscode.EndOfLine.LF);
  await assertMatrixShortcuts(
    editor,
    "align*",
    vscode.EndOfLine.CRLF,
    true,
  );
  await assertLeftRightEnter(editor, "align*", vscode.EndOfLine.CRLF);
  await assertLeftRightEnter(
    editor,
    "equation",
    vscode.EndOfLine.LF,
    true,
  );
  await assertUnsafeLeftRightEnterFallsBack(editor);

    if (vscode.workspace.isTrusted) {
      rootAConfiguration = vscode.workspace.getConfiguration(
        "texleaf",
        document.uri,
      );
      rootBConfiguration = vscode.workspace.getConfiguration(
        "texleaf",
        vscode.Uri.joinPath(bibProjectRoot, "REFERENCES.BIB"),
      );
      rootASnippetFilesBefore = rootAConfiguration.inspect(
        "snippetFiles",
      )?.workspaceFolderValue;
      rootBSnippetFilesBefore = rootBConfiguration.inspect(
        "snippetFiles",
      )?.workspaceFolderValue;

      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(rootBExtraSnippetUri, ".."),
      );
      await vscode.workspace.fs.writeFile(
        rootAExtraSnippetUri,
        new TextEncoder().encode(
          `${JSON.stringify(
            {
              version: 1,
              snippets: [
                {
                  id: "extension-host-root-a",
                  trigger: ROOT_A_TRIGGER,
                  replacement: "\\operatorname{RootA}",
                  options: "tA",
                },
              ],
            },
            null,
            2,
          )}\n`,
        ),
      );
      rootAExtraCreated = true;
      await vscode.workspace.fs.writeFile(
        rootBExtraSnippetUri,
        new TextEncoder().encode(
          `${JSON.stringify(
            {
              version: 1,
              snippets: [
                {
                  id: "extension-host-root-b",
                  trigger: ROOT_B_TRIGGER,
                  replacement: "\\operatorname{RootB}",
                  options: "tA",
                },
              ],
            },
            null,
            2,
          )}\n`,
        ),
      );
      rootBExtraCreated = true;
      await rootAConfiguration.update(
        "snippetFiles",
        [".vscode/texleaf-root-a-snippets.jsonc"],
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await rootBConfiguration.update(
        "snippetFiles",
        [".vscode/texleaf-root-b-snippets.jsonc"],
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      try {
        await waitFor(
          () => {
            const currentRootAFiles = vscode.workspace
              .getConfiguration("texleaf", document.uri)
              .get("snippetFiles");
            const currentRootBFiles = vscode.workspace
              .getConfiguration(
                "texleaf",
                vscode.Uri.joinPath(bibProjectRoot, "REFERENCES.BIB"),
              )
              .get("snippetFiles");
            return (
              JSON.stringify(currentRootAFiles) ===
                JSON.stringify([".vscode/texleaf-root-a-snippets.jsonc"]) &&
              JSON.stringify(currentRootBFiles) ===
                JSON.stringify([".vscode/texleaf-root-b-snippets.jsonc"])
            );
          },
          "per-folder snippetFiles configuration updates",
          3_000,
        );
        workspaceExtrasConfigured = true;
      } catch (error) {
        const rootAInspection = vscode.workspace
          .getConfiguration("texleaf", document.uri)
          .inspect("snippetFiles");
        const rootBInspection = vscode.workspace
          .getConfiguration(
            "texleaf",
            vscode.Uri.joinPath(bibProjectRoot, "REFERENCES.BIB"),
          )
          .inspect("snippetFiles");
        console.warn(
          `Skipping workspace-extra isolation assertions because VS Code did not expose the restricted per-folder settings in this fixture: ${error.message}; rootA=${JSON.stringify(rootAInspection)}; rootB=${JSON.stringify(rootBInspection)}`,
        );
      }
      if (workspaceExtrasConfigured) {
        await vscode.commands.executeCommand("texleaf.reloadSnippets");
        editor = await vscode.window.showTextDocument(document);
        await assertAutomaticSnippetScope(
          editor,
          "\\operatorname{RootA}",
          "workspace root A must load its own explicitly configured snippet file",
          ROOT_A_TRIGGER,
        );
        await assertAutomaticSnippetScope(
          editor,
          ROOT_B_TRIGGER,
          "workspace root A must not see root B extra snippets",
          ROOT_B_TRIGGER,
        );
      }
    } else {
      console.warn(
        "Skipping workspace-extra isolation assertions because the isolated fixture is untrusted and snippetFiles is a restricted configuration.",
      );
    }

    const bib = await openTestFile(bibProjectRoot, "REFERENCES.BIB");
    assert.notEqual(
      vscode.Uri.joinPath(bib.document.uri, "..").toString(),
      vscode.Uri.joinPath(document.uri, "..").toString(),
      "the .tex and .bib regression documents must live in different directories",
    );
    assert.equal(
      vscode.workspace.getWorkspaceFolder(bib.document.uri)?.uri.toString(),
      bibWorkspace.uri.toString(),
      "the second global snippet test must run in workspace root B",
    );
    await assertAutomaticSnippetScope(
      bib.editor,
      "\\operatorname{Global}",
      "the same global snippet must persist in a different .bib document",
      "tglb",
    );
    if (workspaceExtrasConfigured) {
      await assertAutomaticSnippetScope(
        bib.editor,
        "\\operatorname{RootB}",
        "workspace root B must load its own explicitly configured snippet file",
        ROOT_B_TRIGGER,
      );
      await assertAutomaticSnippetScope(
        bib.editor,
        ROOT_A_TRIGGER,
        "workspace root B must not see root A extra snippets",
        ROOT_A_TRIGGER,
      );
    }
    await assertAutomaticSnippetScope(
      bib.editor,
      "\\(\\)",
      ".bib files must support TeXLeaf snippets case-insensitively",
    );
    await replaceDocument(bib.editor, "", 0);
    await typeEach("tmpa-en");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      bib.document.getText(),
      "tmpa-en",
      "automatic document templates must not expand in a .bib file",
    );
    await vscode.commands.executeCommand("texleaf.handleTab");
    assert.doesNotMatch(
      bib.document.getText(),
      /\\documentclass/u,
      "document templates must remain limited to saved .tex files",
    );

    const orphan = await openTestFile(orphanRoot, "orphan.tex");
    assert.equal(
      vscode.workspace.getWorkspaceFolder(orphan.document.uri),
      undefined,
      "the orphan regression document must have no owning workspace folder",
    );
    await assertAutomaticSnippetScope(
      orphan.editor,
      "\\operatorname{Global}",
      "global snippets must also work for a saved .tex file with no workspace owner",
      "tglb",
    );
    if (workspaceExtrasConfigured) {
      await assertAutomaticSnippetScope(
        orphan.editor,
        ROOT_A_TRIGGER,
        "an ownerless document must not see root A extra snippets",
        ROOT_A_TRIGGER,
      );
      await assertAutomaticSnippetScope(
        orphan.editor,
        ROOT_B_TRIGGER,
        "an ownerless document must not see root B extra snippets",
        ROOT_B_TRIGGER,
      );
    }

    const markdown = await openTestFile(texProjectRoot, "notes.md");
    await assertAutomaticSnippetScope(
      markdown.editor,
      "lm",
      "a LaTeX-language .md file must not run TeXLeaf snippets",
    );

    const untitledDocument = await vscode.workspace.openTextDocument({
      language: "latex",
      content: "",
    });
    const untitledEditor = await vscode.window.showTextDocument(untitledDocument);
    await assertAutomaticSnippetScope(
      untitledEditor,
      "lm",
      "an untitled LaTeX editor must not run TeXLeaf snippets",
    );
    await replaceDocument(untitledEditor, "", 0);
    await typeEach("tmpa-en");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      untitledDocument.getText(),
      "tmpa-en",
      "an untitled LaTeX editor must not run document templates",
    );

    assert.deepEqual(
      await vscode.workspace.fs.readFile(legacyWorkspaceSnippetUri),
      legacyWorkspaceSnippetBefore,
      "activation must not modify or delete the legacy workspace snippet file",
    );

    console.log(
      "Extension-host smoke test passed: grouped native settings, worker-backed Math Preview/toggle/safe SVG, native citation completion/filtering/ranges/configuration, complete global factory seeding, one-time migration/backup, no hidden built-ins, watcher reload/LKG, dirty import/export/restore guards, Qhat/IME, per-root extras, .tex/.bib scope, fractions, LF/CRLF align shortcuts, and safe left/right Enter splitting work.",
    );
  } finally {
    if (rootAConfiguration !== undefined) {
      await rootAConfiguration.update(
        "snippetFiles",
        rootASnippetFilesBefore,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
    }
    if (rootBConfiguration !== undefined) {
      await rootBConfiguration.update(
        "snippetFiles",
        rootBSnippetFilesBefore,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
    }
    if (rootAExtraCreated) {
      await vscode.workspace.fs.delete(rootAExtraSnippetUri, {
        recursive: false,
        useTrash: false,
      });
    }
    if (rootBExtraCreated) {
      await vscode.workspace.fs.delete(rootBExtraSnippetUri, {
        recursive: false,
        useTrash: false,
      });
    }
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
    await vscode.workspace.saveAll(false);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    if (globalSnippetUri !== undefined && globalSnippetBefore !== undefined) {
      await vscode.workspace.fs.writeFile(globalSnippetUri, globalSnippetBefore);
    }
    const resolvedTempRoot = path.resolve(os.tmpdir());
    const resolvedTestRoot = path.resolve(testRoot.fsPath);
    assert.equal(
      process.platform === "win32"
        ? path.dirname(resolvedTestRoot).toLowerCase()
        : path.dirname(resolvedTestRoot),
      process.platform === "win32"
        ? resolvedTempRoot.toLowerCase()
        : resolvedTempRoot,
      "refuse to clean an extension-host fixture outside os.tmpdir()",
    );
    assert.equal(
      path.basename(resolvedTestRoot).startsWith("texleaf-extension-host-"),
      true,
      "refuse to clean an extension-host fixture without the dedicated prefix",
    );
    await vscode.workspace.fs.delete(testRoot, {
      recursive: true,
      useTrash: false,
    });
  }
}

module.exports = { run };
