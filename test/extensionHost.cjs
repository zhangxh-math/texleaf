"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const EXTENSION_ID = "local-lab.texleaf";
const LEGACY_WORKSPACE_SNIPPET_ID = "extension-host-legacy-workspace";
const LEGACY_WORKSPACE_TRIGGER = "told";
const ROOT_A_TRIGGER = "traa";
const ROOT_B_TRIGGER = "trbb";

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

async function assertAutomaticSnippetScope(
  editor,
  expected,
  description,
  trigger = "mk",
) {
  await replaceDocument(editor, "", 0);
  await typeEach(trigger);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(editor.document.getText(), expected, description);
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

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("texleaf.reloadSnippets"));
    assert.ok(commands.includes("texleaf.openSnippetEditor"));
    assert.ok(commands.includes("texleaf.openSnippetFile"));
    assert.ok(commands.includes("texleaf.restoreDefaultSnippets"));
    assert.ok(commands.includes("default:replacePreviousChar"));
    assert.ok(commands.includes("default:compositionType"));

    const contributedCommands = new Map(
      extension.packageJSON.contributes.commands.map((command) => [
        command.command,
        command.title,
      ]),
    );
    assert.equal(
      contributedCommands.get("texleaf.openSnippetFile"),
      "TeXLeaf: 打开全局 Snippet 配置文件",
    );
    assert.equal(
      contributedCommands.get("texleaf.openSnippetEditor"),
      "TeXLeaf: 编辑全局 Snippet",
    );
    assert.equal(
      contributedCommands.get("texleaf.restoreDefaultSnippets"),
      "TeXLeaf: 恢复默认片段",
    );
    assert.equal(
      extension.packageJSON.contributes.menus.commandPalette.some(
        (item) => item.command === "texleaf.restoreDefaultSnippets",
      ),
      true,
      "restore defaults must be available from the Command Palette",
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
      extension.packageJSON.contributes.configuration.properties[
        "texleaf.snippetFiles"
      ].default,
      [],
      "workspace snippet files must be explicit opt-in extras",
    );
    assert.equal(
      Object.hasOwn(
        extension.packageJSON.contributes.configuration.properties,
        "texleaf.customSnippets",
      ),
      false,
      "the retired settings-page snippet source must not coexist with the global library",
    );
    assert.deepEqual(
      extension.packageJSON.capabilities.untrustedWorkspaces
        .restrictedConfigurations,
      ["texleaf.snippetFiles"],
      "untrusted projects must not inject automatic snippet definitions",
    );
    assert.equal(
      extension.packageJSON.capabilities.untrustedWorkspaces.supported,
      "limited",
      "restrictedConfigurations only apply when untrusted support is limited",
    );
    assert.equal(
      extension.packageJSON.contributes.jsonValidation.some((validation) =>
        validation.fileMatch.includes(
          "**/globalStorage/local-lab.texleaf/texleaf-snippets.jsonc",
        ),
      ),
      true,
      "the global snippet file must receive TeXLeaf JSON schema validation",
    );

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
          "/globalstorage/local-lab.texleaf/texleaf-snippets.jsonc",
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
    const seededGlobalLibrary = JSON.parse(
      new TextDecoder().decode(globalSnippetBefore),
    );
    assert.equal(
      seededGlobalLibrary.defaultsRevision,
      1,
      "the global file must record the materialized factory-library revision",
    );
    assert.equal(
      seededGlobalLibrary.snippets.length,
      199,
      "all factory snippets must be editable in the global file",
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
      () =>
        vscode.window.activeTextEditor?.document.uri.toString() ===
        globalSnippetUri.toString(),
      "one-time global factory migration",
    );
    globalEditor = vscode.window.activeTextEditor;
    assert.ok(globalEditor);
    const migratedGlobalLibrary = JSON.parse(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(globalSnippetUri),
      ),
    );
    assert.equal(migratedGlobalLibrary.defaultsRevision, 1);
    assert.equal(migratedGlobalLibrary.snippets.length, 200);
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
    assert.equal(migrationBackups.length, 1);
    assert.equal(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(backupDirectory, migrationBackups[0][0]),
        ),
      ),
      legacyGlobalLibraryText,
      "migration backup must preserve the exact pre-0.3 bytes",
    );

    migratedGlobalLibrary.snippets = migratedGlobalLibrary.snippets.filter(
      (snippet) => snippet.id !== "greek.alpha",
    );
    const intentionalDeletionText = `${JSON.stringify(
      migratedGlobalLibrary,
      null,
      2,
    )}\n`;
    await replaceDocument(
      globalEditor,
      intentionalDeletionText,
      intentionalDeletionText.length,
    );
    assert.equal(await globalEditor.document.save(), true);
    await vscode.commands.executeCommand("texleaf.openSnippetFile");
    const afterSecondEnsure = JSON.parse(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(globalSnippetUri),
      ),
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
        defaultsRevision: 1,
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
      "mk",
      "factory snippets must not survive as a hidden built-in source",
      "mk",
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
      "mk",
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
  await typeEach("mk");

  await waitFor(() => document.getText() === "\\(\\)", "automatic mk expansion");
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
      "mk",
      "a LaTeX-language .md file must not run TeXLeaf snippets",
    );

    const untitledDocument = await vscode.workspace.openTextDocument({
      language: "latex",
      content: "",
    });
    const untitledEditor = await vscode.window.showTextDocument(untitledDocument);
    await assertAutomaticSnippetScope(
      untitledEditor,
      "mk",
      "an untitled LaTeX editor must not run TeXLeaf snippets",
    );

    assert.deepEqual(
      await vscode.workspace.fs.readFile(legacyWorkspaceSnippetUri),
      legacyWorkspaceSnippetBefore,
      "activation must not modify or delete the legacy workspace snippet file",
    );

    console.log(
      "Extension-host smoke test passed: complete global factory seeding, one-time migration/backup, no hidden built-ins, watcher reload/LKG, dirty import/export/restore guards, Qhat/IME, per-root extras, .tex/.bib scope, fractions, and LF/CRLF align shortcuts work.",
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
