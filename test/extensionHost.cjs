/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createServer } = require("node:http");
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
    if (await predicate()) {
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

function assertNoAiDiagnostics(document, description) {
  assert.deepEqual(
    texLeafAiDiagnostics(document),
    [],
    description,
  );
}

function texLeafAiDiagnosticEntries(document) {
  const path = document.uri.path.toLowerCase();
  return vscode.languages
    .getDiagnostics()
    .filter(([uri]) => {
      // AI diagnostics for a visual-editor document intentionally live on a
      // selectable read-only mirror.  Its invisible basename guard prevents
      // the `*.tex` custom-editor association from claiming the transient tab,
      // while the remaining path and every diagnostic offset stay identical
      // to the source document.  Accept both the source URI (for ordinary text
      // editors/backward compatibility) and that guarded Problems mirror.
      const diagnosticPath = uri.path.replace(/\u2063+$/gu, "").toLowerCase();
      return diagnosticPath === path;
    })
    .flatMap(([uri, diagnostics]) => diagnostics
      .filter((diagnostic) => diagnostic.source === "TeXLeaf AI")
      .map((diagnostic) => ({ uri, diagnostic }))
    );
}

function texLeafAiDiagnostics(document) {
  return texLeafAiDiagnosticEntries(document).map(({ diagnostic }) => diagnostic);
}

function assertSingleAiDiagnostic(
  document,
  start,
  end,
  description,
) {
  const diagnostics = texLeafAiDiagnostics(document);
  assert.equal(diagnostics.length, 1, description);
  const [diagnostic] = diagnostics;
  assert.deepEqual(
    {
      start: document.offsetAt(diagnostic.range.start),
      end: document.offsetAt(diagnostic.range.end),
      severity: diagnostic.severity,
      source: diagnostic.source,
    },
    {
      start,
      end,
      severity: vscode.DiagnosticSeverity.Warning,
      source: "TeXLeaf AI",
    },
    `${description}: the native Problems diagnostic must preserve the exact issue range`,
  );
  assert.match(
    diagnostic.message,
    /建议修改用词/u,
    `${description}: the native Problems diagnostic must preserve the AI issue message`,
  );
}

function hoverContentsText(hover) {
  return hover.contents
    .map((content) => typeof content === "string" ? content : content.value ?? "")
    .join("\n");
}

function texLeafAiHover(hovers) {
  return Array.isArray(hovers) ? hovers.find((hover) =>
    hoverContentsText(hover).includes("TeXLeaf AI")
  ) : undefined;
}

async function hasTexLeafAiHover(document, offset) {
  const hovers = await vscode.commands.executeCommand(
    "vscode.executeHoverProvider",
    document.uri,
    document.positionAt(offset),
  );
  return texLeafAiHover(hovers) !== undefined;
}

async function getTexLeafAiHover(document, offset) {
  return texLeafAiHover(await vscode.commands.executeCommand(
    "vscode.executeHoverProvider",
    document.uri,
    document.positionAt(offset),
  ));
}

async function hasTexLeafAiQuickFix(document, start, end) {
  return (await texLeafAiQuickFix(document, start, end)) !== undefined;
}

async function texLeafAiQuickFix(document, start, end) {
  return (await texLeafAiQuickFixes(document, start, end)).find((action) =>
    action.command?.command === "texleaf.aiWriting.applyIssue"
  );
}

async function texLeafAiQuickFixes(document, start, end) {
  const actions = await vscode.commands.executeCommand(
    "vscode.executeCodeActionProvider",
    document.uri,
    new vscode.Range(document.positionAt(start), document.positionAt(end)),
    vscode.CodeActionKind.QuickFix.value,
  );
  return Array.isArray(actions) ? actions.filter((action) =>
    action.command?.command === "texleaf.aiWriting.applyIssue" ||
    action.command?.command === "texleaf.aiWriting.ignoreIssue"
  ) : [];
}

function markdownCommandLink(markdown, command) {
  const links = [...markdown.value.matchAll(/\]\((command:[^)]+)\)/gu)]
    .map((match) => match[1])
    .filter((link) => {
      try {
        const uri = vscode.Uri.parse(link);
        return uri.scheme === "command" && uri.path === command;
      } catch {
        return false;
      }
    });
  assert.equal(
    links.length,
    1,
    `the Hover must expose exactly one ${command} command link`,
  );
  return links[0];
}

function commandArgumentsFromLink(link) {
  const commandUri = vscode.Uri.parse(link);
  for (const query of [commandUri.query, decodeURIComponent(commandUri.query)]) {
    try {
      const parsed = JSON.parse(query);
      if (Array.isArray(parsed)) {
        return { command: commandUri.path, arguments: parsed };
      }
    } catch {
      // Try the once-decoded form next. VS Code preserves percent escapes in
      // Uri.query while Markdown command links encode JSON as a URI query.
    }
  }
  assert.fail("the Hover command link must contain a JSON argument array");
}

async function writeAiIssueSnapshotForSource(
  globalSnippetUri,
  uri,
  source,
  original,
  documentVersion = 1,
  replacement = "poor",
  category = "word-choice",
) {
  const start = source.indexOf(original);
  assert.ok(start >= 0, "the persistence fixture original must exist");
  const uriText = uri.toString();
  const fingerprint = createHash("sha256")
    .update(`${uriText}\0${start}\0${original}`, "utf8")
    .digest("hex");
  const record = {
    schema: 1,
    uri: uriText,
    sourceHash: createHash("sha256").update(source, "utf8").digest("hex"),
    sourceLength: source.length,
    documentVersion,
    savedAt: Date.now(),
    issues: [{
      id: `texleaf-ai-${fingerprint}`,
      fingerprint,
      start,
      end: start + original.length,
      original,
      replacement,
      message: "建议修改用词",
      explanation: "这里使用更准确的表达。",
      category,
      severity: vscode.DiagnosticSeverity.Warning,
    }],
  };
  const storageDirectory = vscode.Uri.joinPath(
    globalSnippetUri,
    "..",
    "ai-writing-issues-v1",
  );
  await vscode.workspace.fs.createDirectory(storageDirectory);
  const fileName = `${createHash("sha256").update(uriText, "utf8").digest("hex")}.json`;
  const cacheUri = vscode.Uri.joinPath(storageDirectory, fileName);
  await vscode.workspace.fs.writeFile(
    cacheUri,
    new TextEncoder().encode(`${JSON.stringify(record)}\n`),
  );
  return cacheUri;
}

async function replaceDocument(editor, text, cursorOffset) {
  const document = editor.document;
  const targetEditor =
    vscode.window.activeTextEditor?.document.uri.toString() ===
      document.uri.toString()
      ? editor
      : await vscode.window.showTextDocument(document, { preview: false });
  await waitFor(
    () =>
      vscode.window.activeTextEditor?.document.uri.toString() ===
      document.uri.toString(),
    "the target editor to receive test keyboard input",
  );
  const replaced = await targetEditor.edit(
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
  targetEditor.selection = new vscode.Selection(cursor, cursor);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function typeEach(text, expectedEditor) {
  for (const character of text) {
    const expectedDocument = expectedEditor?.document;
    if (
      expectedDocument !== undefined &&
      vscode.window.activeTextEditor?.document.uri.toString() !==
        expectedDocument.uri.toString()
    ) {
      await vscode.window.showTextDocument(expectedDocument, { preview: false });
    }
    if (expectedDocument !== undefined) {
      await waitFor(
        () =>
          vscode.window.activeTextEditor?.document.uri.toString() ===
          expectedDocument.uri.toString(),
        `the expected editor before typing ${JSON.stringify(character)}`,
      );
    }

    const versionBeforeType = expectedDocument?.version;
    await vscode.commands.executeCommand("type", { text: character });
    if (expectedDocument !== undefined && versionBeforeType !== undefined) {
      await waitFor(
        () => expectedDocument.version > versionBeforeType,
        `the expected document change after typing ${JSON.stringify(character)}`,
      );
    }
  }
}

async function typeBatch(text, expectedEditor) {
  const expectedDocument = expectedEditor?.document;
  if (
    expectedDocument !== undefined &&
    vscode.window.activeTextEditor?.document.uri.toString() !==
      expectedDocument.uri.toString()
  ) {
    await vscode.window.showTextDocument(expectedDocument, { preview: false });
  }
  if (expectedDocument !== undefined) {
    await waitFor(
      () =>
        vscode.window.activeTextEditor?.document.uri.toString() ===
        expectedDocument.uri.toString(),
      `the expected editor before batch typing ${JSON.stringify(text)}`,
    );
  }

  const versionBeforeType = expectedDocument?.version;
  await vscode.commands.executeCommand("type", { text });
  if (expectedDocument !== undefined && versionBeforeType !== undefined) {
    await waitFor(
      () => expectedDocument.version > versionBeforeType,
      `the expected document change after batch typing ${JSON.stringify(text)}`,
    );
  }
}

async function waitForDocumentText(document, expected, description) {
  try {
    await waitFor(() => document.getText() === expected, description);
  } catch {
    assert.equal(document.getText(), expected, description);
  }
}

function observeDocumentText(document, expected, description, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let subscription;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      subscription?.dispose();
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    subscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === document && document.getText() === expected) {
        finish();
      }
    });
    timer = setTimeout(
      () => finish(new Error(`Timed out waiting for ${description}`)),
      timeoutMs,
    );
    if (document.getText() === expected) {
      finish();
    }
  });
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

  await vscode.commands.executeCommand("texleaf.handleTab");
  await waitFor(
    () => editor.document.lineAt(2).text === "  & ",
    `${environment} row-start Tab without cumulative indentation`,
  );
  assert.equal(editor.selection.active.character, 4);

  if (enterThroughType) {
    await vscode.commands.executeCommand("type", {
      source: "keyboard",
      text: "\n",
    });
  } else {
    await vscode.commands.executeCommand("texleaf.matrixEnter");
  }
  await waitFor(
    () => editor.document.lineCount === 5,
    `${environment} second Enter row insertion`,
  );
  assert.equal(editor.document.lineAt(2).text, "  &  \\\\");
  assert.equal(editor.document.lineAt(3).text, "  ");
  await vscode.commands.executeCommand("texleaf.handleTab");
  await waitFor(
    () => editor.document.lineAt(3).text === "  & ",
    `${environment} repeated row-start Tab without indentation growth`,
  );
  assert.equal(
    editor.document.lineAt(3).text.match(/^ */u)?.[0].length,
    2,
    `${environment} repeated row indentation must remain stable`,
  );
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

function findZoteroCitationCompletion(items, citationKey) {
  return items.find(
    (item) =>
      typeof item.label === "object" &&
      item.label.description === "Zotero" &&
      item.kind === vscode.CompletionItemKind.Reference &&
      completionDocumentationText(item).includes(
        `**Citation key：** \`${citationKey}\``,
      ),
  );
}

async function startZoteroRpcFixture() {
  let exportCalls = 0;
  const reference = {
    title: "Snapshot Identity Regression",
    author: [{ given: "Stable", family: "Author" }],
    "container-title": "Fixture Journal",
    issued: { "date-parts": [[2026]] },
    DOI: "10.5555/snapshot.2026",
    citekey: "Snapshot2026",
  };
  const duplicateReferences = [
    {
      title: "First Duplicate Key Record",
      author: [{ given: "First", family: "Author" }],
      issued: { "date-parts": [[2025]] },
      citekey: "Duplicate2025",
    },
    {
      title: "Second Duplicate Key Record",
      author: [{ given: "Second", family: "Author" }],
      issued: { "date-parts": [[2024]] },
      citekey: "Duplicate2025",
    },
  ];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        let result;
        switch (body.method) {
          case "api.ready":
            result = { zotero: "8.0-test", betterbibtex: "9.0-test" };
            break;
          case "user.groups":
            result = [{ id: 1, name: "My Library" }];
            break;
          case "item.search":
            result = [reference, ...duplicateReferences];
            break;
          case "item.export":
            exportCalls += 1;
            result = [
              "@article{Snapshot2026,",
              "  title = {Snapshot Identity Regression},",
              "  author = {Stable Author},",
              "  year = {2026}",
              "}",
              "",
            ].join("\n");
            break;
          default:
            throw new Error(`unexpected Better BibTeX method ${body.method}`);
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result,
        }));
      } catch (error) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: String(error) }));
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    port: address.port,
    get exportCalls() {
      return exportCalls;
    },
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
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
  await typeEach(trigger, editor);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(editor.document.getText(), expected, description);
}

async function assertTemplateExpansion(editor, trigger, expectedClass) {
  await replaceDocument(editor, "", 0);
  await typeEach(trigger, editor);
  try {
    await waitFor(
      () => editor.document.getText().includes(expectedClass),
      `${trigger} automatic independent template expansion`,
      10_000,
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; ` +
      `actual=${JSON.stringify(editor.document.getText())}; ` +
      `active=${JSON.stringify(vscode.window.activeTextEditor?.document.uri.toString())}; ` +
      `autoSnippets=${JSON.stringify(vscode.workspace.getConfiguration("texleaf", editor.document.uri).get("autoSnippets"))}`,
    );
  }
  const expanded = editor.document.getText();
  assert.match(expanded, /\\begin\{document\}/u, trigger);
  assert.match(expanded, /\\end\{document\}/u, trigger);
  if (trigger === "article-cn" || trigger === "article-en") {
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

async function commitImeText(editor, provisionalText, committedText, replacementCommand) {
  const document = editor.document;
  const versionBeforeComposition = document.version;
  const initialType = vscode.commands.executeCommand("type", {
    text: provisionalText,
  });
  const replacement = vscode.commands.executeCommand(
    replacementCommand,
    replacementCommand === "replacePreviousChar"
      ? { text: committedText, replaceCharCnt: provisionalText.length }
      : {
          text: committedText,
          replacePrevCharCnt: provisionalText.length,
          replaceNextCharCnt: 0,
          positionDelta: 0,
        },
  );
  await Promise.all([initialType, replacement]);
  await waitFor(
    () => document.version > versionBeforeComposition,
    `${replacementCommand} IME commit ${JSON.stringify(committedText)}`,
  );
}

async function commitImeSequence(editor, replacementSteps) {
  const document = editor.document;
  const versionBeforeComposition = document.version;
  const operations = [
    vscode.commands.executeCommand("compositionStart"),
    ...replacementSteps.map(([command, args]) =>
      vscode.commands.executeCommand(command, args)
    ),
    vscode.commands.executeCommand("compositionEnd"),
  ];
  // Real editor composition events can arrive while the contributed handler
  // for the previous event is still awaiting its extension-host round trip.
  // Queue the whole lifecycle first, then await it as one unit.
  await Promise.all(operations);
  await waitFor(
    () => document.version > versionBeforeComposition,
    "the concurrent IME composition lifecycle to change the document",
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
      223,
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
      await typeEach(";a", editor);
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
    await typeEach(";a", editor);
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
    assert.ok(commands.includes("texleaf.handleSnippetTab"));
    assert.ok(commands.includes("texleaf.handleSuggestSnippetTab"));
    assert.ok(commands.includes("texleaf.pickCitation"));
    assert.ok(commands.includes("texleaf.refreshZotero"));
    assert.ok(commands.includes("texleaf.toggleMathPreview"));
    assert.ok(commands.includes("texleaf.refreshMathPreview"));
    assert.ok(commands.includes("texleaf.dismissMathPreview"));
    assert.ok(commands.includes("texleaf.visualEditor.open"));
    assert.ok(commands.includes("texleaf.visualEditor.openSource"));
    assert.ok(commands.includes("texleaf.visualEditor.build"));
    assert.ok(commands.includes("texleaf.visualEditor.viewPdf"));
    assert.ok(commands.includes("texleaf.visualEditor.synctex"));
    assert.ok(commands.includes("texleaf.aiWriting.toggle"));
    assert.ok(commands.includes("texleaf.aiWriting.setApiKey"));
    assert.ok(commands.includes("texleaf.aiWriting.clearApiKey"));
    assert.ok(commands.includes("texleaf.aiWriting.reviewParagraph"));
    assert.ok(commands.includes("texleaf.aiWriting.reviewDocument"));
    assert.ok(commands.includes("texleaf.aiWriting.rewriteSelection"));
    assert.ok(commands.includes("texleaf.aiWriting.triggerCompletion"));
    assert.ok(commands.includes("texleaf.aiWriting.clearDiagnostics"));
    assert.ok(commands.includes("texleaf.aiWriting.showIssues"));
    assert.ok(commands.includes("texleaf.aiWriting.applyAll"));
    assert.ok(commands.includes("texleaf.aiWriting.revealIssue"));
    assert.ok(commands.includes("texleaf.aiWriting.applyIssue"));
    assert.ok(commands.includes("texleaf.aiWriting.ignoreIssue"));
    assert.ok(commands.includes("texleaf.aiIssues.reveal"));
    assert.ok(commands.includes("texleaf.aiIssues.apply"));
    assert.ok(commands.includes("texleaf.aiIssues.ignore"));
    assert.ok(commands.includes("default:replacePreviousChar"));
    assert.ok(commands.includes("default:compositionType"));
    assert.ok(commands.includes("compositionStart"));
    assert.ok(commands.includes("compositionEnd"));
    assert.ok(commands.includes("default:compositionStart"));
    assert.ok(commands.includes("default:compositionEnd"));
    await settlesWithin(
      vscode.commands.executeCommand("texleaf.aiWriting.showIssues"),
      "opening the dedicated AI issue list",
    );
    await settlesWithin(
      vscode.commands.executeCommand("texleaf.aiIssues.apply", {
        kind: "status",
      }),
      "rejecting a non-issue tree item without editing",
    );
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assertNoAiDiagnostics(
      document,
      "default-off AI writing must not create diagnostics in an edited .tex document",
    );
    const originalFetch = globalThis.fetch;
    assert.equal(typeof originalFetch, "function");
    let aiFetchCount = 0;
    const customDeepSeekEndpoint =
      "https://example.invalid/deepseek/chat/completions";
    const customResponsesEndpoint = "https://example.invalid/compatible/v1/responses";
    globalThis.fetch = async (input, init) => {
      if (
        String(input) === "https://api.deepseek.com/chat/completions" ||
        String(input) === "https://workspace.invalid/deepseek/chat/completions" ||
        String(input) === customDeepSeekEndpoint ||
        String(input) === "https://api.openai.com/v1/responses" ||
        String(input) === "https://workspace.invalid/v1/responses" ||
        String(input) === customResponsesEndpoint
      ) {
        aiFetchCount += 1;
        throw new Error("default-off AI attempted a forbidden test request");
      }
      return originalFetch(input, init);
    };
    try {
      const offlineFixture = "Default-off AI must keep this prose local.";
      await replaceDocument(editor, offlineFixture, offlineFixture.length);
      await document.save();
      await new Promise((resolve) => setTimeout(resolve, 1_800));

      const aiConfiguration = vscode.workspace.getConfiguration(
        "texleaf",
        document.uri,
      );
      assert.deepEqual(
        {
          enabled: aiConfiguration.get("aiWriting.enabled"),
          automaticReview: aiConfiguration.get("aiWriting.automaticReview"),
          inlineCompletions: aiConfiguration.get("aiWriting.inlineCompletions"),
          provider: aiConfiguration.get("aiWriting.provider"),
          deepseekModel: aiConfiguration.get("aiWriting.deepseekModel"),
          deepseekBaseUrl: aiConfiguration.get("aiWriting.deepseekBaseUrl"),
          openaiModel: aiConfiguration.get("aiWriting.openaiModel"),
          openaiBaseUrl: aiConfiguration.get("aiWriting.openaiBaseUrl"),
          language: aiConfiguration.get("aiWriting.language"),
          style: aiConfiguration.get("aiWriting.style"),
          reviewDelayMs: aiConfiguration.get("aiWriting.reviewDelayMs"),
          completionDelayMs: aiConfiguration.get("aiWriting.completionDelayMs"),
          maxParagraphLength: aiConfiguration.get("aiWriting.maxParagraphLength"),
          maxDocumentLength: aiConfiguration.get("aiWriting.maxDocumentLength"),
        },
        {
          enabled: false,
          automaticReview: true,
          inlineCompletions: true,
          provider: "deepseek",
          deepseekModel: "deepseek-v4-flash",
          deepseekBaseUrl: "https://api.deepseek.com",
          openaiModel: "gpt-5.6-luna",
          openaiBaseUrl: "https://api.openai.com/v1",
          language: "auto",
          style: "academic",
          reviewDelayMs: 900,
          completionDelayMs: 500,
          maxParagraphLength: 6_000,
          maxDocumentLength: 30_000,
        },
        "workspace settings must not enable, redirect, or change the cost profile of AI writing",
      );
      await aiConfiguration.update(
        "aiWriting.enabled",
        true,
        vscode.ConfigurationTarget.Global,
      );
      await waitFor(
        () => vscode.workspace
          .getConfiguration("texleaf", document.uri)
          .get("aiWriting.enabled") === true,
        "AI setting-only enablement",
      );
      const noConsentFixture = "A setting alone must not grant upload consent.";
      await replaceDocument(editor, noConsentFixture, noConsentFixture.length);
      await document.save();
      await new Promise((resolve) => setTimeout(resolve, 1_800));

      await aiConfiguration.update(
        "aiWriting.deepseekBaseUrl",
        "https://example.invalid/deepseek",
        vscode.ConfigurationTarget.Global,
      );
      const noCustomDeepSeekConsentFixture =
        "A custom DeepSeek endpoint must require independent consent and key.";
      await replaceDocument(
        editor,
        noCustomDeepSeekConsentFixture,
        noCustomDeepSeekConsentFixture.length,
      );
      await document.save();
      await new Promise((resolve) => setTimeout(resolve, 1_800));

      await aiConfiguration.update(
        "aiWriting.provider",
        "openai",
        vscode.ConfigurationTarget.Global,
      );
      await aiConfiguration.update(
        "aiWriting.openaiBaseUrl",
        "https://example.invalid/compatible/v1",
        vscode.ConfigurationTarget.Global,
      );
      const noOpenAIConsentFixture =
        "A custom endpoint must require its own explicit consent and key.";
      await replaceDocument(
        editor,
        noOpenAIConsentFixture,
        noOpenAIConsentFixture.length,
      );
      await document.save();
      await new Promise((resolve) => setTimeout(resolve, 1_800));

      await aiConfiguration.update(
        "aiWriting.enabled",
        false,
        vscode.ConfigurationTarget.Global,
      );
      await aiConfiguration.update(
        "aiWriting.provider",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      await aiConfiguration.update(
        "aiWriting.deepseekBaseUrl",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      await aiConfiguration.update(
        "aiWriting.openaiBaseUrl",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(
      aiFetchCount,
      0,
      "default-off and setting-only-without-consent AI must never call any provider",
    );

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
    ]) {
      assert.equal(
        exactSnippetTabKeybinding.when.includes(competingContext),
        false,
        `the exact snippet Tab keybinding must work while ${competingContext} is active`,
      );
    }
    assert.equal(
      exactSnippetTabKeybinding.when.includes("!editorHasMultipleSelections"),
      true,
      "an exact snippet Tab binding must not rewrite only one of multiple cursors",
    );
    assert.equal(
      exactSnippetTabKeybinding.when.includes("!inSnippetMode"),
      true,
      "the exact-match handleTab route must never compete with a live Snippet Session",
    );
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
      "!editorHasMultipleSelections",
    ]) {
      assert.equal(
        genericTabKeybinding.when.includes(guardedContext),
        true,
        `the generic Tab keybinding must retain its ${guardedContext} guard`,
      );
    }
    const suggestTaboutKeybinding = extension.packageJSON.contributes.keybindings.find(
      (keybinding) =>
        keybinding.command === "texleaf.handleSuggestTabout" &&
        keybinding.key === "tab",
    );
    assert.ok(
      suggestTaboutKeybinding,
      "Suggest-visible math editing needs a dedicated Tabout fallback binding",
    );
    for (const requiredContext of [
      "texleaf.tabActionAvailable",
      "!texleaf.snippetTabActionAvailable",
      "suggestWidgetVisible",
      "suggestWidgetHasFocusedSuggestion",
      "!inlineSuggestionVisible",
      "!inSnippetMode",
      "!editorHasMultipleSelections",
      "!renameInputVisible",
    ]) {
      assert.equal(
        suggestTaboutKeybinding.when.includes(requiredContext),
        true,
        `the Suggest-aware Tabout fallback must include ${requiredContext}`,
      );
    }
    assert.equal(
      suggestTaboutKeybinding.when.includes("!texleaf.matrixActionAvailable"),
      false,
      "Suggest-visible matrix cells must still route Tab through local Tabout before column insertion",
    );
    const suggestSnippetPlaceholderTabKeybinding =
      extension.packageJSON.contributes.keybindings.find(
        (keybinding) =>
          keybinding.command === "texleaf.handleSuggestSnippetTab" &&
          keybinding.key === "tab" &&
          keybinding.when.includes("suggestWidgetVisible"),
      );
    assert.ok(
      suggestSnippetPlaceholderTabKeybinding,
      "a live snippet placeholder needs a Suggest-visible Tab override",
    );
    for (const requiredContext of [
      "texleaf.enabled",
      "inSnippetMode",
      "hasNextTabstop",
      "suggestWidgetVisible",
      "!inlineSuggestionVisible",
      "!inSnippetChoice",
      "!renameInputVisible",
    ]) {
      assert.equal(
        suggestSnippetPlaceholderTabKeybinding.when.includes(requiredContext),
        true,
        `the Suggest-visible snippet-placeholder Tab override must include ${requiredContext}`,
      );
    }
    for (const forbiddenDependency of [
      "texleaf.mathTabContext",
      "texleaf.snippetTabActionAvailable",
    ]) {
      assert.equal(
        suggestSnippetPlaceholderTabKeybinding.when.includes(forbiddenDependency),
        false,
        `the Suggest-visible snippet wrapper must not depend on stale ${forbiddenDependency}`,
      );
    }
    const snippetPlaceholderTabKeybinding =
      extension.packageJSON.contributes.keybindings.find(
        (keybinding) =>
          keybinding.command === "texleaf.handleSnippetTab" &&
          keybinding.key === "tab" &&
          keybinding.when.includes("!suggestWidgetVisible"),
      );
    assert.ok(
      snippetPlaceholderTabKeybinding,
      "a live snippet placeholder needs a no-Suggest queued-input Tab override",
    );
    for (const requiredContext of [
      "texleaf.enabled",
      "editorTextFocus",
      "!editorReadonly",
      "!editorTabMovesFocus",
      "inSnippetMode",
      "hasNextTabstop",
      "!suggestWidgetVisible",
      "!inlineSuggestionVisible",
      "!inSnippetChoice",
      "!renameInputVisible",
    ]) {
      assert.equal(
        snippetPlaceholderTabKeybinding.when.includes(requiredContext),
        true,
        `the no-Suggest snippet-placeholder Tab override must include ${requiredContext}`,
      );
    }
    for (const forbiddenDependency of [
      "texleaf.mathTabContext",
      "texleaf.snippetTabActionAvailable",
    ]) {
      assert.equal(
        snippetPlaceholderTabKeybinding.when.includes(forbiddenDependency),
        false,
        `the no-Suggest snippet wrapper must not depend on stale ${forbiddenDependency}`,
      );
    }
    const liveSnippetTabKeybindings =
      extension.packageJSON.contributes.keybindings.filter(
        (keybinding) =>
          keybinding.key === "tab" &&
          keybinding.when.includes("inSnippetMode") &&
          !keybinding.when.includes("!inSnippetMode") &&
          keybinding.when.includes("hasNextTabstop"),
      );
    assert.deepEqual(
      liveSnippetTabKeybindings.map((keybinding) => keybinding.command).sort(),
      ["texleaf.handleSnippetTab", "texleaf.handleSuggestSnippetTab"],
      "all live next-stop Tab routes must be owned by the queued-input wrappers",
    );
    assert.ok(
      tabKeybindings.every((keybinding) =>
        keybinding.when.includes("!inSnippetMode")
      ),
      "legacy handleTab bindings must be completely excluded from live Snippet Sessions",
    );

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
    assert.deepEqual(
      [...contributedCommands]
        .filter(([id]) => id.startsWith("texleaf.aiWriting.")),
      [
        ["texleaf.aiWriting.toggle", "TeXLeaf: 切换 AI 写作助手"],
        ["texleaf.aiWriting.setApiKey", "TeXLeaf: 设置当前 AI 服务商 API Key"],
        ["texleaf.aiWriting.clearApiKey", "TeXLeaf: 清除当前 AI 服务商 API Key"],
        ["texleaf.aiWriting.reviewParagraph", "TeXLeaf: AI 检查当前段落或选区"],
        ["texleaf.aiWriting.reviewDocument", "TeXLeaf: AI 检查当前文档"],
        ["texleaf.aiWriting.rewriteSelection", "TeXLeaf: AI 改写选区或当前句"],
        ["texleaf.aiWriting.triggerCompletion", "TeXLeaf: 触发 AI 行内补全"],
        ["texleaf.aiWriting.clearDiagnostics", "TeXLeaf: 清除 AI 写作问题"],
        [
          "texleaf.aiWriting.showIssues",
          "TeXLeaf: 在“问题”面板显示 AI 写作问题",
        ],
        ["texleaf.aiWriting.applyAll", "TeXLeaf: 应用当前全部 AI 建议"],
      ],
      "all public AI writing commands must have stable titles",
    );
    assert.deepEqual(
      [
        "texleaf.aiIssues.reveal",
        "texleaf.aiIssues.apply",
        "texleaf.aiIssues.ignore",
      ].map((id) => [id, contributedCommands.get(id)]),
      [
        ["texleaf.aiIssues.reveal", "TeXLeaf: 定位 AI 写作问题"],
        ["texleaf.aiIssues.apply", "TeXLeaf: 应用这条 AI 建议"],
        ["texleaf.aiIssues.ignore", "TeXLeaf: 本次会话忽略这条 AI 建议"],
      ],
      "tree-only AI issue commands must have stable titles",
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
    assert.equal(
      extension.packageJSON.contributes.views.texleaf.some(
        (view) => view.id === "texleaf.aiIssues" || view.name === "文档问题",
      ),
      false,
      "AI language issues must use VS Code Problems instead of a custom document-problem view",
    );
    assert.equal(
      extension.packageJSON.contributes.viewsWelcome.some(
        (item) => item.view === "texleaf.aiIssues",
      ),
      false,
      "the retired AI issue view must not leave a stale welcome contribution",
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
        "texleaf.project.rootFile",
        "texleaf.zoteroPort",
        "texleaf.zoteroLibrary",
        "texleaf.mathPreview.macros",
        "texleaf.aiWriting.enabled",
        "texleaf.aiWriting.automaticReview",
        "texleaf.aiWriting.inlineCompletions",
        "texleaf.aiWriting.provider",
        "texleaf.aiWriting.deepseekModel",
        "texleaf.aiWriting.deepseekBaseUrl",
        "texleaf.aiWriting.openaiModel",
        "texleaf.aiWriting.openaiBaseUrl",
        "texleaf.aiWriting.language",
        "texleaf.aiWriting.style",
        "texleaf.aiWriting.reviewDelayMs",
        "texleaf.aiWriting.completionDelayMs",
        "texleaf.aiWriting.maxParagraphLength",
        "texleaf.aiWriting.maxDocumentLength",
      ],
      "untrusted projects must not inject project paths, snippets, provider, or Zotero connection settings",
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
        "TeXLeaf · AI 写作",
        "TeXLeaf · 可视化编辑器",
        "TeXLeaf · 预览",
      ],
      "Settings UI must expose exactly the snippet, reference, AI writing, visual editor, and preview categories",
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
          "texleaf.aiWriting.enabled",
          "texleaf.aiWriting.automaticReview",
          "texleaf.aiWriting.inlineCompletions",
          "texleaf.aiWriting.provider",
          "texleaf.aiWriting.deepseekModel",
          "texleaf.aiWriting.deepseekBaseUrl",
          "texleaf.aiWriting.openaiModel",
          "texleaf.aiWriting.openaiBaseUrl",
          "texleaf.aiWriting.language",
          "texleaf.aiWriting.style",
          "texleaf.aiWriting.reviewDelayMs",
          "texleaf.aiWriting.completionDelayMs",
          "texleaf.aiWriting.maxParagraphLength",
          "texleaf.aiWriting.maxDocumentLength",
        ],
        [
          "texleaf.project.rootFile",
          "texleaf.visualEditor.defaultMode",
          "texleaf.visualEditor.providerCompletions",
          "texleaf.visualEditor.latexWorkshopCompatibility",
          "texleaf.visualEditor.syntaxTheme",
          "texleaf.visualEditor.texBinPath",
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
      configurationProperties["texleaf.aiWriting.enabled"].default,
      false,
      "AI writing must remain explicit opt-in and make no default network requests",
    );
    assert.equal(
      configurationProperties["texleaf.aiWriting.provider"].default,
      "deepseek",
    );
    assert.deepEqual(
      configurationProperties["texleaf.aiWriting.provider"].enum,
      ["deepseek", "openai"],
    );
    assert.equal(
      configurationProperties["texleaf.aiWriting.deepseekModel"].default,
      "deepseek-v4-flash",
    );
    assert.deepEqual(
      configurationProperties["texleaf.aiWriting.deepseekModel"].enum,
      ["deepseek-v4-flash", "deepseek-v4-pro"],
    );
    assert.equal(
      configurationProperties["texleaf.aiWriting.deepseekBaseUrl"].default,
      "https://api.deepseek.com",
    );
    assert.equal(
      configurationProperties["texleaf.aiWriting.openaiModel"].default,
      "gpt-5.6-luna",
    );
    assert.equal(
      configurationProperties["texleaf.aiWriting.openaiBaseUrl"].default,
      "https://api.openai.com/v1",
    );
    assert.equal(
      Object.hasOwn(configurationProperties, "texleaf.aiWriting.model"),
      false,
      "the ambiguous 0.8.0 model setting must remain runtime-only compatibility input",
    );
    assert.equal(
      configurationProperties["texleaf.aiWriting.automaticReview"].default,
      true,
    );
    assert.equal(
      configurationProperties["texleaf.aiWriting.inlineCompletions"].default,
      true,
    );
    assert.equal(
      configurationProperties["texleaf.aiWriting.reviewDelayMs"].default,
      900,
      "automatic review should default to a responsive but debounced delay",
    );
    for (const key of Object.keys(
      configurationGroups.find((group) => group.title === "TeXLeaf · AI 写作")
        .properties,
    )) {
      assert.equal(
        configurationProperties[key].scope,
        "application",
        `${key} must remain a user/Profile-only AI transmission setting`,
      );
    }
    for (const key of [
      "texleaf.aiWriting.reviewDelayMs",
      "texleaf.aiWriting.completionDelayMs",
      "texleaf.aiWriting.maxParagraphLength",
      "texleaf.aiWriting.maxDocumentLength",
    ]) {
      assert.equal(Number.isInteger(configurationProperties[key].default), true);
      assert.equal(Number.isInteger(configurationProperties[key].minimum), true);
      assert.equal(Number.isInteger(configurationProperties[key].maximum), true);
    }
    assert.deepEqual(
      extension.packageJSON.contributes.menus.commandPalette
        .filter((item) => item.when !== "false")
        .map((item) => item.command)
        .filter((command) => command.startsWith("texleaf.aiWriting.")),
      [
        "texleaf.aiWriting.toggle",
        "texleaf.aiWriting.setApiKey",
        "texleaf.aiWriting.clearApiKey",
        "texleaf.aiWriting.reviewParagraph",
        "texleaf.aiWriting.reviewDocument",
        "texleaf.aiWriting.rewriteSelection",
        "texleaf.aiWriting.triggerCompletion",
        "texleaf.aiWriting.clearDiagnostics",
        "texleaf.aiWriting.showIssues",
        "texleaf.aiWriting.applyAll",
      ],
      "only public AI commands belong in the Command Palette",
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.enabled"].default,
      true,
    );
    assert.equal(
      configurationProperties["texleaf.visualEditor.defaultMode"].default,
      "visual",
    );
    assert.equal(
      configurationProperties["texleaf.visualEditor.defaultMode"].scope,
      "application",
    );
    assert.deepEqual(
      configurationProperties["texleaf.visualEditor.defaultMode"].enum,
      ["visual", "source"],
    );
    assert.equal(
      configurationProperties["texleaf.visualEditor.renderFormulas"],
      undefined,
    );
    assert.equal(
      configurationProperties["texleaf.visualEditor.providerCompletions"].default,
      true,
    );
    assert.equal(
      configurationProperties[
        "texleaf.visualEditor.latexWorkshopCompatibility"
      ].default,
      true,
    );
    assert.deepEqual(
      extension.packageJSON.contributes.customEditors,
      [
        {
          viewType: "texleaf.visualEditor",
          displayName: "TeXLeaf 可视化 LaTeX 编辑器",
          selector: [{ filenamePattern: "*.tex" }],
          priority: "default",
        },
      ],
      "TeXLeaf must make its visual editor the default .tex custom editor",
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.presentation"].default,
      "cursor",
    );
    assert.equal(
      configurationProperties["texleaf.mathPreview.placement"].default,
      "autoAbove",
    );
    assert.deepEqual(
      configurationProperties["texleaf.mathPreview.placement"].enum,
      ["autoAbove", "autoBelow", "above", "below"],
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
      "^(?:[A-Za-z@]+|[!-~])$",
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
      "article-cn",
      "\\documentclass[UTF8,11pt,reqno]{ctexart}",
    );
    await assertTemplateExpansion(
      editor,
      "article-en",
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

    const whitespaceTemplateSource = "\n  article-en \n";
    const whitespaceTemplateCursor =
      whitespaceTemplateSource.indexOf("article-en") + "article-en".length;
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

    await replaceDocument(editor, "article-en", "article-en".length);
    editor.selections = [
      new vscode.Selection(0, "article-en".length, 0, "article-en".length),
      new vscode.Selection(0, 0, 0, 0),
    ];
    await vscode.commands.executeCommand("texleaf.handleTab");
    assert.doesNotMatch(
      document.getText(),
      /\\documentclass/u,
      "a whole-document template must not expand with multiple cursors",
    );

    await replaceDocument(editor, "article-e", "article-e".length);
    editor.selections = [
      new vscode.Selection(0, "article-e".length, 0, "article-e".length),
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
    await typeEach("article-en");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      document.getText(),
      "已有正文 article-en",
      "an automatic document template must not expand into a non-blank TeX file",
    );
    await replaceDocument(editor, "已有正文 article-en", "已有正文 article-en".length);
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
    await typeEach("article-en");
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
    await typeEach("(1");
    await waitFor(
      () => document.lineAt(1).text.trim() === "(1)",
      "the theorem body parenthesis to auto-close",
    );
    const theoremBeforeLocalTabout = document.getText();
    const theoremCloseOffset = document.offsetAt(
      new vscode.Position(1, document.lineAt(1).text.indexOf(")")),
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      theoremCloseOffset,
      "the theorem snippet caret must begin immediately before the local parenthesis closer",
    );
    await vscode.commands.executeCommand("texleaf.handleSnippetTab");
    assert.equal(
      document.getText(),
      theoremBeforeLocalTabout,
      "leaving a local theorem-body parenthesis must not change the environment",
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      theoremCloseOffset + 1,
      "the first theorem-body Tab must leave the parenthesis before the snippet environment",
    );
    await typeEach(" The statement.");
    assert.equal(
      document.lineAt(1).text.trim(),
      "(1) The statement.",
      "typing at the first theorem tabstop must fill the body",
    );
    await vscode.commands.executeCommand("texleaf.handleSnippetTab");
    assert.equal(
      editor.selection.active.isEqual(
        document.positionAt(document.getText().length),
      ),
      true,
      "the final theorem tabstop must follow the complete environment",
    );

    const autoEnlargeSumSource = "$()$";
    const autoEnlargeSumCursor = autoEnlargeSumSource.indexOf(")");
    await replaceDocument(
      editor,
      autoEnlargeSumSource,
      autoEnlargeSumCursor,
    );
    await typeEach("sum", editor);
    await waitFor(
      () => document.getText() === "$\\left(\\sum\\right)$",
      "sum automatic expansion with scalable parentheses",
    );
    const enlargedSumRightOffset = document.getText().indexOf("\\right)");
    assert.equal(
      document.offsetAt(editor.selection.active),
      enlargedSumRightOffset,
      "a plain snippet enlarged with \\left/\\right must keep the caret inside the pair",
    );
    await typeEach("+", editor);
    assert.equal(
      document.getText(),
      "$\\left(\\sum+\\right)$",
      "typing after auto-enlarge must continue before the generated right delimiter",
    );
    const enlargedSumText = document.getText();
    await vscode.commands.executeCommand("texleaf.handleTab");
    await waitFor(
      () =>
        document.offsetAt(editor.selection.active) ===
        enlargedSumText.indexOf("\\right)") + "\\right)".length,
      "one Tabout command to leave the generated right delimiter",
    );
    assert.equal(
      document.getText(),
      enlargedSumText,
      "Tabout after a plain enlarged snippet must not alter the formula",
    );

    const autoEnlargeBinomSource = "$()$";
    const autoEnlargeBinomCursor = autoEnlargeBinomSource.indexOf(")");
    await replaceDocument(
      editor,
      autoEnlargeBinomSource,
      autoEnlargeBinomCursor,
    );
    await typeEach("bino", editor);
    const autoEnlargeBinomExpected = "$\\left(\\binom{}{}\\right)$";
    await waitForDocumentText(
      document,
      autoEnlargeBinomExpected,
      "binomial automatic expansion with scalable parentheses",
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      autoEnlargeBinomExpected.indexOf("\\binom{") + "\\binom{".length,
      "the enlarged binomial must keep the first caret in its numerator",
    );

    const cascadedFractionSource = "$(1-())$";
    const cascadedFractionCursor = cascadedFractionSource.indexOf(")");
    await replaceDocument(
      editor,
      cascadedFractionSource,
      cascadedFractionCursor,
    );
    await typeEach("/", editor);
    const cascadedFractionBeforeFinalKey = "$(1-(/))$";
    assert.equal(
      document.getText(),
      cascadedFractionBeforeFinalKey,
      "the first slash must remain literal before the built-in fraction trigger completes",
    );
    await typeEach("/", editor);
    const cascadedFractionExpected =
      "$\\left(1-\\left(\\frac{}{}\\right)\\right)$";
    await waitForDocumentText(
      document,
      cascadedFractionExpected,
      "one automatic fraction insertion to enlarge every enclosing parenthesis",
    );
    const cascadedFractionNumerator =
      cascadedFractionExpected.indexOf("\\frac{") + "\\frac{".length;
    assert.equal(
      editor.selection.isEmpty,
      true,
      "the cascaded fraction numerator must be an empty caret tabstop",
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      cascadedFractionNumerator,
      "cascading bracket edits must preserve the fraction numerator caret",
    );
    await vscode.commands.executeCommand("undo");
    const cascadedSizedRawTrigger =
      "$\\left(1-\\left(//\\right)\\right)$";
    await waitForDocumentText(
      document,
      cascadedSizedRawTrigger,
      "the first undo to restore the raw fraction trigger inside the sized pairs",
    );
    assert.equal(
      document.getText().includes("\\frac"),
      false,
      "the first tabstop-snippet undo must remove the inserted fraction",
    );
    await vscode.commands.executeCommand("undo");
    const cascadedRawTrigger = "$(1-(//))$";
    await waitForDocumentText(
      document,
      cascadedRawTrigger,
      "the second undo to remove every sizing modifier while preserving the typed trigger",
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      cascadedFractionCursor + 2,
      "the two-stage tabstop-snippet undo must preserve the committed trigger text",
    );

    await replaceDocument(
      editor,
      cascadedFractionSource,
      cascadedFractionCursor,
    );
    await typeEach("//", editor);
    await waitForDocumentText(
      document,
      cascadedFractionExpected,
      "standalone cascaded fraction used for tabstop navigation",
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      cascadedFractionNumerator,
      "the standalone cascaded fraction must restart at its numerator",
    );
    await vscode.commands.executeCommand("texleaf.handleSnippetTab");
    assert.equal(
      document.getText(),
      cascadedFractionExpected,
      "snippet navigation must not expand the structural numerator brace as a manual snippet",
    );
    const cascadedFractionDenominator = cascadedFractionNumerator + 2;
    await waitFor(
      () =>
        editor.selection.isEmpty &&
        document.offsetAt(editor.selection.active) ===
          cascadedFractionDenominator,
      "the standalone cascaded fraction denominator tabstop",
    );

    const cascadedPlainSource = "$(())$";
    const cascadedPlainCursor = cascadedPlainSource.indexOf(")");
    await replaceDocument(editor, cascadedPlainSource, cascadedPlainCursor);
    await typeEach("su", editor);
    const cascadedPlainBeforeFinalKey = "$((su))$";
    assert.equal(document.getText(), cascadedPlainBeforeFinalKey);
    await typeEach("m", editor);
    const cascadedPlainExpected =
      "$\\left(\\left(\\sum\\right)\\right)$";
    await waitForDocumentText(
      document,
      cascadedPlainExpected,
      "one no-tabstop snippet edit to enlarge both enclosing parentheses",
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      cascadedPlainExpected.indexOf("\\right)"),
      "the cascaded plain snippet caret must remain after \\sum",
    );
    await vscode.commands.executeCommand("undo");
    await waitForDocumentText(
      document,
      cascadedPlainBeforeFinalKey,
      "one undo to atomically revert a no-tabstop snippet and all sizing modifiers",
    );

    await replaceDocument(editor, "", 0);
    await editor.insertSnippet(
      new vscode.SnippetString("$(1-(${1}))$ ${2:after}"),
    );
    await typeEach("//", editor);
    const cascadedNestedFractionExpected =
      "$\\left(1-\\left(\\frac{}{}\\right)\\right)$ after";
    await waitForDocumentText(
      document,
      cascadedNestedFractionExpected,
      "cascaded fraction inside an outer VS Code snippet placeholder",
    );
    const nestedFractionStart =
      cascadedNestedFractionExpected.indexOf("\\frac");
    assert.equal(
      document.offsetAt(editor.selection.active),
      nestedFractionStart + "\\frac{".length,
      "the nested cascaded fraction must begin at its numerator tabstop",
    );
    await vscode.commands.executeCommand("texleaf.handleSnippetTab");
    const nestedFractionDenominator =
      nestedFractionStart + "\\frac{}{".length;
    try {
      await waitFor(
        () =>
          editor.selection.isEmpty &&
          document.offsetAt(editor.selection.active) ===
            nestedFractionDenominator,
        "the cascaded fraction denominator tabstop",
      );
    } catch {
      assert.equal(
        document.offsetAt(editor.selection.active),
        nestedFractionDenominator,
        `the cascaded fraction denominator tabstop; caret offset ${document.offsetAt(editor.selection.active)}`,
      );
    }
    await vscode.commands.executeCommand("texleaf.handleSnippetTab");
    await waitFor(
      () =>
        editor.selection.isEmpty &&
        document.offsetAt(editor.selection.active) ===
          nestedFractionStart + "\\frac{}{}".length,
      "the cascaded fraction final inner tabstop",
    );
    await vscode.commands.executeCommand("texleaf.handleSnippetTab");
    await waitFor(
      () => document.getText(editor.selection) === "after",
      "the outer snippet tabstop after completing a cascaded fraction",
    );
    assert.equal(
      document.getText(),
      cascadedNestedFractionExpected,
      "nested fraction navigation must not alter the cascaded source",
    );

    await replaceDocument(editor, "", 0);
    await editor.insertSnippet(
      new vscode.SnippetString("$(${1})$ ${2:after}"),
    );
    await typeEach("sum", editor);
    await waitFor(
      () => document.getText() === "$\\left(\\sum\\right)$ after",
      "sum auto-enlarge inside an existing snippet placeholder",
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      document.getText().indexOf("\\right)"),
      "nested auto-enlarge must keep the caret inside its generated pair",
    );
    await typeEach("+", editor);
    assert.equal(
      document.getText(),
      "$\\left(\\sum+\\right)$ after",
      "typing inside a nested enlarged pair must stay before its right delimiter",
    );
    const nestedEnlargedSumText = document.getText();
    await vscode.commands.executeCommand("texleaf.handleTab");
    await waitFor(
      () =>
        document.offsetAt(editor.selection.active) ===
        nestedEnlargedSumText.indexOf("\\right)") + "\\right)".length,
      "one Tabout command after nested sum auto-enlarge",
    );
    assert.equal(
      document.getText(),
      nestedEnlargedSumText,
      "Tabout after nested auto-enlarge must preserve the outer snippet text",
    );

    const autoEnlargeNewline =
      document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const alignCrossRowSource = [
      String.raw`\begin{align*}`,
      String.raw`  & (\Phi_{1,1}(z_1) \\ `,
      String.raw`  & -2z(\Phi_{1,2}(z_2)-1))`,
      String.raw`\end{align*}`,
    ].join(autoEnlargeNewline);
    const alignCrossRowCursor = alignCrossRowSource.indexOf(
      autoEnlargeNewline,
      alignCrossRowSource.indexOf(autoEnlargeNewline) + autoEnlargeNewline.length,
    );
    await replaceDocument(editor, alignCrossRowSource, alignCrossRowCursor);
    await typeEach("sum", editor);
    const alignCrossRowExpected =
      `${alignCrossRowSource.slice(0, alignCrossRowCursor)}\\sum` +
      alignCrossRowSource.slice(alignCrossRowCursor);
    await waitFor(
      () => document.getText() === alignCrossRowExpected,
      "sum expansion after an align row boundary without cross-row bracket enlargement",
    );
    assert.equal(
      document.getText().includes(String.raw`\left(`),
      false,
      "sum must not turn a delimiter spanning two align rows into \\left/\\right",
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      alignCrossRowCursor + String.raw`\sum`.length,
      "sum after an align row boundary must leave the caret immediately after \\sum",
    );
    await typeEach("+", editor);
    assert.equal(
      document.getText(),
      `${alignCrossRowSource.slice(0, alignCrossRowCursor)}\\sum+` +
        alignCrossRowSource.slice(alignCrossRowCursor),
      "typing after the guarded align-row sum must continue at its original cell boundary",
    );

    const alignSameCellSource = [
      String.raw`\begin{align*}`,
      String.raw`  & () \\`,
      String.raw`  & y`,
      String.raw`\end{align*}`,
    ].join(autoEnlargeNewline);
    const alignSameCellCursor = alignSameCellSource.indexOf(")");
    await replaceDocument(editor, alignSameCellSource, alignSameCellCursor);
    await typeEach("sum", editor);
    const alignSameCellExpected = alignSameCellSource.replace(
      "()",
      String.raw`\left(\sum\right)`,
    );
    await waitFor(
      () => document.getText() === alignSameCellExpected,
      "same-cell sum automatic bracket enlargement inside align",
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      document.getText().indexOf(String.raw`\right)`),
      "same-cell align enlargement must retain the caret before its generated right delimiter",
    );

    const alignPhysicalNewlineSource = [
      String.raw`\begin{align*}`,
      String.raw`  & (`,
      "      a + ",
      String.raw`        )`,
      String.raw`\end{align*}`,
    ].join(autoEnlargeNewline);
    const alignPhysicalNewlineOpenLineEnd = alignPhysicalNewlineSource.indexOf(
      autoEnlargeNewline,
      alignPhysicalNewlineSource.indexOf(autoEnlargeNewline) +
        autoEnlargeNewline.length,
    );
    const alignPhysicalNewlineCursor = alignPhysicalNewlineSource.indexOf(
      autoEnlargeNewline,
      alignPhysicalNewlineOpenLineEnd + autoEnlargeNewline.length,
    );
    await replaceDocument(
      editor,
      alignPhysicalNewlineSource,
      alignPhysicalNewlineCursor,
    );
    await typeEach("sum", editor);
    const alignPhysicalNewlineExpected = alignPhysicalNewlineSource
      .replace("  & (", String.raw`  & \left(`)
      .replace("      a + ", String.raw`      a + \sum`)
      .replace("        )", String.raw`        \right)`);
    await waitFor(
      () => document.getText() === alignPhysicalNewlineExpected,
      "same-cell multi-line bracket enlargement with verbatim indentation",
    );
    const alignPhysicalNewlineSumEnd =
      alignPhysicalNewlineExpected.indexOf(String.raw`\sum`) +
      String.raw`\sum`.length;
    assert.equal(
      document.offsetAt(editor.selection.active),
      alignPhysicalNewlineSumEnd,
      "same-cell multi-line enlargement must restore the caret immediately after \\sum",
    );
    assert.equal(
      alignPhysicalNewlineSumEnd <
        alignPhysicalNewlineExpected.indexOf(String.raw`\right)`),
      true,
      "same-cell multi-line enlargement must keep the caret before the generated right delimiter",
    );

    const taboutSuggestSource = "$(+)$";
    const taboutSuggestCursor = taboutSuggestSource.indexOf(")");
    await replaceDocument(
      editor,
      taboutSuggestSource,
      taboutSuggestCursor,
    );
    const taboutSuggestItems = await provideCompletions(
      document,
      taboutSuggestCursor,
    );
    assert.ok(
      findTeXLeafSnippetCompletion(taboutSuggestItems, "+-"),
      "the Tabout regression needs a real snippet completion competing for Tab",
    );
    await vscode.commands.executeCommand("editor.action.triggerSuggest");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await vscode.commands.executeCommand("texleaf.handleSuggestTabout");
    await waitFor(
      () =>
        editor.selection.active.isEqual(
          document.positionAt(taboutSuggestSource.indexOf(")") + 1),
        ),
      "Tabout to jump past a closer while native Suggest is visible",
    );
    assert.equal(
      document.getText(),
      taboutSuggestSource,
      "Tabout must not accept the selected snippet suggestion",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await vscode.commands.executeCommand("acceptSelectedSuggestion");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      document.getText(),
      taboutSuggestSource,
      "Tabout must dismiss the stale Suggest session after moving past the closer",
    );

    const unrelatedSuggestSource = "$x)$";
    const unrelatedSuggestCursor = unrelatedSuggestSource.indexOf(")");
    await replaceDocument(
      editor,
      unrelatedSuggestSource,
      unrelatedSuggestCursor,
    );
    const unrelatedSuggestItems = await provideCompletions(
      document,
      unrelatedSuggestCursor,
    );
    assert.equal(
      findTeXLeafSnippetCompletion(unrelatedSuggestItems, "+-"),
      undefined,
      "a snippet with no matching typed prefix must not keep Suggest open",
    );

    const acceptSuggestSource = "$+x$";
    const acceptSuggestCursor = acceptSuggestSource.indexOf("x");
    await replaceDocument(editor, acceptSuggestSource, acceptSuggestCursor);
    const acceptSuggestItems = await provideCompletions(
      document,
      acceptSuggestCursor,
    );
    assert.ok(
      findTeXLeafSnippetCompletion(acceptSuggestItems, "+-"),
      "the no-Tabout regression needs the selected +- suggestion",
    );
    await vscode.commands.executeCommand("editor.action.triggerSuggest");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await vscode.commands.executeCommand("texleaf.handleSuggestTabout");
    await waitFor(
      () => document.getText() === "$\\pmx$",
      "the selected suggestion to be accepted when no Tabout target exists",
    );

    await replaceDocument(editor, "", 0);
    await editor.insertSnippet(
      new vscode.SnippetString("$(${1})$ ${2:next}"),
    );
    await typeEach("+", editor);
    await waitFor(
      () => document.getText() === "$(+)$ next",
      "the live snippet placeholder used by the Suggest-visible Tab regression",
    );
    const placeholderSuggestItems = await provideCompletions(
      document,
      document.offsetAt(editor.selection.active),
    );
    assert.ok(
      findTeXLeafSnippetCompletion(placeholderSuggestItems, "+-"),
      "the live placeholder regression needs a competing +- suggestion",
    );
    await vscode.commands.executeCommand("editor.action.triggerSuggest");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await vscode.commands.executeCommand("texleaf.handleSuggestSnippetTab");
    await waitFor(
      () => document.getText(editor.selection) === "next",
      "Tab to advance the live snippet placeholder while Suggest is visible",
    );
    assert.equal(
      document.getText(),
      "$(+)$ next",
      "snippet-placeholder Tab must not accept the selected completion",
    );
    await vscode.commands.executeCommand("acceptSelectedSuggestion");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      document.getText(),
      "$(+)$ next",
      "advancing a snippet placeholder must dismiss the stale Suggest session",
    );
    await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");

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
        "article-cn",
        "article-en",
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
      await typeEach("article-en");
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
      await typeEach("article-en");
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

      const exactSuffixFixtureBefore = await vscode.workspace.fs.readFile(
        expectedNewPublisherSnippetUri,
      );
      const exactSuffixLibrary = parseJsonc(
        new TextDecoder().decode(exactSuffixFixtureBefore),
      );
      exactSuffixLibrary.snippets.push(
        {
          id: "extension-host-exact-suffix-ab",
          trigger: "ab",
          replacement: "\\operatorname{ExactAB}",
          options: "m",
          priority: 10,
          description: "Exact suffix completion regression",
        },
        {
          id: "extension-host-longer-prefix-xabx",
          trigger: "xabx",
          replacement: "\\operatorname{PartialXABX}",
          options: "m",
          description: "Longer partial completion regression",
        },
      );
      await vscode.workspace.fs.writeFile(
        expectedNewPublisherSnippetUri,
        new TextEncoder().encode(`${JSON.stringify(exactSuffixLibrary, null, 2)}\n`),
      );
      try {
        await replaceDocument(editor, "$xab$", 4);
        let exactSuffixList;
        await waitFor(async () => {
          const current = await provideCompletionList(document, 4);
          if (
            findTeXLeafSnippetCompletion(current.items, "ab") !== undefined &&
            findTeXLeafSnippetCompletion(current.items, "xabx") !== undefined
          ) {
            exactSuffixList = current;
            return true;
          }
          return false;
        }, "completion reload with exact-suffix regression fixtures");
        assert.ok(exactSuffixList);
        const exactSuffixItem = findTeXLeafSnippetCompletion(
          exactSuffixList.items,
          "ab",
        );
        const longerPartialItem = findTeXLeafSnippetCompletion(
          exactSuffixList.items,
          "xabx",
        );
        assert.ok(
          exactSuffixItem,
          "a shorter exact suffix must survive the global longest-prefix filter",
        );
        assert.ok(
          longerPartialItem,
          "the globally longest partial candidate must remain beside the shorter exact suffix",
        );
        assert.equal(
          exactSuffixItem.kind,
          vscode.CompletionItemKind.Keyword,
          "the preserved shorter exact suffix must retain Keyword ranking",
        );
        assert.equal(
          exactSuffixItem.preselect,
          true,
          "the preserved shorter exact suffix must remain preselected",
        );
        assert.match(
          exactSuffixItem.sortText ?? "",
          /^0000000:/u,
          "the preserved shorter exact suffix must retain the exact-only sort key",
        );
        assert.equal(
          longerPartialItem.kind,
          vscode.CompletionItemKind.Snippet,
          "the longer partial candidate must retain ordinary Snippet ranking",
        );

        exactSuffixLibrary.snippets.push({
          id: "extension-host-regex-shadow-ab",
          trigger: "ab",
          replacement: "\\operatorname{RegexShadowAB}",
          options: "rm",
          priority: 100,
          description: "Higher-priority regex exact-match shadow",
        });
        await vscode.workspace.fs.writeFile(
          expectedNewPublisherSnippetUri,
          new TextEncoder().encode(
            `${JSON.stringify(exactSuffixLibrary, null, 2)}\n`,
          ),
        );
        let regexShadowList;
        await waitFor(async () => {
          const current = await provideCompletionList(document, 4);
          const shadowedLiteral = findTeXLeafSnippetCompletion(
            current.items,
            "ab",
          );
          if (
            shadowedLiteral?.kind === vscode.CompletionItemKind.Snippet &&
            shadowedLiteral.preselect !== true &&
            findTeXLeafSnippetCompletion(current.items, "xabx") !== undefined
          ) {
            regexShadowList = current;
            return true;
          }
          return false;
        }, "completion reload with higher-priority regex shadow fixture");
        assert.ok(regexShadowList);
        const regexShadowedLiteral = findTeXLeafSnippetCompletion(
          regexShadowList.items,
          "ab",
        );
        const regexShadowLongerPartial = findTeXLeafSnippetCompletion(
          regexShadowList.items,
          "xabx",
        );
        assert.ok(
          regexShadowedLiteral,
          "a complete literal must survive longest-prefix filtering when a regex wins matchAt",
        );
        assert.ok(
          regexShadowLongerPartial,
          "the globally longest partial must remain when a regex shadows the complete literal",
        );
        assert.equal(
          regexShadowedLiteral.kind,
          vscode.CompletionItemKind.Snippet,
          "a regex-shadowed complete literal may remain an ordinary Snippet candidate",
        );
        assert.notEqual(
          regexShadowedLiteral.preselect,
          true,
          "a regex-shadowed literal must not claim exact-trigger preselection",
        );
        assert.equal(
          typeof regexShadowedLiteral.sortText === "string" &&
            !regexShadowedLiteral.sortText.startsWith("0000000:"),
          true,
          "a regex-shadowed literal must not claim the exact-only sort bucket",
        );
      } finally {
        await vscode.workspace.fs.writeFile(
          expectedNewPublisherSnippetUri,
          exactSuffixFixtureBefore,
        );
        await waitFor(async () => {
          const current = await provideCompletionList(document, 4);
          return (
            findTeXLeafSnippetCompletion(current.items, "ab") === undefined &&
            findTeXLeafSnippetCompletion(current.items, "xabx") === undefined
          );
        }, "restored global completion fixture after exact-suffix regression");
      }

      await replaceDocument(editor, "$xx$", 3);
      const longestPrefixList = await provideCompletionList(document, 3);
      const longestPrefixTeXLeafItems = longestPrefixList.items.filter((item) =>
        completionDocumentationText(item).includes("触发器：`")
      );
      assert.ok(
        findTeXLeafSnippetCompletion(longestPrefixTeXLeafItems, "xx"),
        "the globally longest two-character prefix must retain its candidate",
      );
      assert.equal(
        findTeXLeafSnippetCompletion(longestPrefixTeXLeafItems, "xnn"),
        undefined,
        "a one-character suffix match must not mix into a two-character prefix group",
      );
      assert.equal(
        findTeXLeafSnippetCompletion(longestPrefixTeXLeafItems, "xp1"),
        undefined,
        "all shorter nonzero prefix groups must be removed together",
      );
      assert.deepEqual(
        longestPrefixTeXLeafItems.map((item) => item.label),
        ["xx"],
        "TeXLeaf Suggest must expose only the globally longest applicable prefix group",
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
      "autoAbove",
      "the effective Math Preview placement must default to autoAbove",
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
      "@book{Chatelet1740Energy,",
      "  title = {Foundations of Energy},",
      "  author = {Émilie du Châtelet},",
      "  publisher = {Académie Press},",
      "  year = {1740},",
      "  doi = {10.1234/Energy.1740},",
      "  isbn = {978-0-12-345678-9}",
      "}",
      "",
      "@article{Rank:2024,",
      "  title = {Unrelated Exact Key Candidate},",
      "  author = {Exact Author},",
      "  year = {2024}",
      "}",
      "",
      "@article{Rank-2024,",
      "  title = {Earlier Compact Key Candidate},",
      "  author = {Compact Author},",
      "  year = {2024}",
      "}",
      "",
      "@article{Rank:2024Supplement,",
      "  title = {Earlier Prefix Key Candidate},",
      "  author = {Prefix Author},",
      "  year = {2024}",
      "}",
      "",
      "@article{ExistingSnapshotSurvey,",
      "  title = {A Survey of Snapshot Identity Regression},",
      "  author = {Collected Author},",
      "  year = {2025}",
      "}",
      "",
      ...Array.from({ length: 105 }, (_, index) => [
        `@article{BulkTail${String(index).padStart(3, "0")},`,
        `  title = {Synthetic Reference ${String(index).padStart(3, "0")}},`,
        "  author = {Capacity Fixture},",
        "  year = {2026}",
        "}",
        "",
      ].join("\n")),
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

      const twoLabelAlignPreviewSource = String.raw`\begin{align}
C(\mathbf{d}) & =\sum_{j=1}^{n}\frac{2d_{j}+1}{\chi(\mathbf{d})-1}C(d_{1},\dots,d_{j}+d_{0},\dots,d_{n})+\sum_{\substack{a,b\geq0\\a+b=d_{0}-1}}\left(\frac{2}{\chi(\mathbf{d})-1}C(a,b,d_{1},\dots,d_{n})\right.\label{eq:bgw-recursion-linear}\\
&\left.+\sum_{I\sqcup J=\{ 1,\dots n \}}\frac{(\chi(a,\mathbf{d}_{I})-1)!(\chi(b,\mathbf{d}_{J})-1)!}{(\chi(d)-1)!}C(a.\mathbf{d}_{I})C(b,\mathbf{d}_{J})\right).\label{eq:bgw-recursion-quadric}
\end{align}`;
      const twoLabelAlignPreviewCursor =
        twoLabelAlignPreviewSource.indexOf("recursion-quadric") +
        "recursion".length;
      await replaceDocument(
        editor,
        twoLabelAlignPreviewSource,
        twoLabelAlignPreviewCursor,
      );
      const twoLabelAlignHovers = await settlesWithin(
        vscode.commands.executeCommand(
          "vscode.executeHoverProvider",
          document.uri,
          document.positionAt(twoLabelAlignPreviewCursor),
        ),
        "two-label align Math Preview worker-backed hover",
        8_000,
      );
      const twoLabelAlignMarkdown = (twoLabelAlignHovers ?? [])
        .flatMap((hover) => hover.contents)
        .map((content) =>
          typeof content === "string" ? content : (content.value ?? ""),
        )
        .find((content) => content.includes("TeXLeaf Math Preview"));
      assert.ok(
        twoLabelAlignMarkdown,
        "an align with one inline label on each row must keep its preview even when the cursor is inside the second label",
      );
      const twoLabelAlignUriMatch = /\]\(([^)]+\.svg)\)/u.exec(
        twoLabelAlignMarkdown,
      );
      assert.ok(twoLabelAlignUriMatch);
      const twoLabelAlignSvg = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(
          vscode.Uri.parse(twoLabelAlignUriMatch[1]),
        ),
      );
      assert.match(twoLabelAlignSvg, /^<svg\b/u);
      assert.match(twoLabelAlignSvg, /#ffffff/iu);

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
      const emptyReferenceBibItems = emptyCitationItems.filter(
        (item) =>
          typeof item.label === "object" &&
          item.label.description === "reference.bib" &&
          item.kind === vscode.CompletionItemKind.Reference,
      );
      assert.equal(
        emptyReferenceBibItems.length,
        100,
        "TeXLeaf must cap its ranked citation completion list at 100 items",
      );
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

      const multiFieldQuerySource = "\\cite{emilie 1740 foundations}";
      const multiFieldQueryCursor = multiFieldQuerySource.indexOf("}");
      await replaceDocument(editor, multiFieldQuerySource, multiFieldQueryCursor);
      const multiFieldQueryItems = await provideCompletions(
        document,
        multiFieldQueryCursor,
      );
      assert.ok(
        findCitationCompletion(
          multiFieldQueryItems,
          "reference.bib",
          "Chatelet1740Energy",
        ),
        "citation search terms must combine author, year, and title fields with AND semantics",
      );

      const doiQuerySource = "\\cite{10.1234/energy.1740}";
      const doiQueryCursor = doiQuerySource.indexOf("}");
      await replaceDocument(editor, doiQuerySource, doiQueryCursor);
      const doiQueryItems = await provideCompletions(
        document,
        doiQueryCursor,
      );
      const doiCompletion = findCitationCompletion(
        doiQueryItems,
        "reference.bib",
        "Chatelet1740Energy",
      );
      assert.ok(doiCompletion, "an exact DOI must find its bibliography entry");
      assert.equal(
        doiCompletion.preselect,
        true,
        "a unique exact DOI match must be preselected",
      );

      const isbnQuerySource = "\\cite{9780123456789}";
      const isbnQueryCursor = isbnQuerySource.indexOf("}");
      await replaceDocument(editor, isbnQuerySource, isbnQueryCursor);
      const isbnQueryItems = await provideCompletions(
        document,
        isbnQueryCursor,
      );
      const isbnCompletion = findCitationCompletion(
        isbnQueryItems,
        "reference.bib",
        "Chatelet1740Energy",
      );
      assert.ok(isbnCompletion, "a compact exact ISBN must find its bibliography entry");
      assert.equal(
        isbnCompletion.preselect,
        true,
        "a unique exact ISBN match must be preselected",
      );

      const rankedKeyQuerySource = "\\cite{Rank:2024}";
      const rankedKeyQueryCursor = rankedKeyQuerySource.indexOf("}");
      await replaceDocument(editor, rankedKeyQuerySource, rankedKeyQueryCursor);
      const rankedKeyQueryItems = await provideCompletions(
        document,
        rankedKeyQueryCursor,
      );
      const exactRankedKey = findCitationCompletion(
        rankedKeyQueryItems,
        "reference.bib",
        "Rank:2024",
      );
      const compactRankedKey = findCitationCompletion(
        rankedKeyQueryItems,
        "reference.bib",
        "Rank-2024",
      );
      const prefixRankedKey = findCitationCompletion(
        rankedKeyQueryItems,
        "reference.bib",
        "Rank:2024Supplement",
      );
      assert.ok(exactRankedKey && compactRankedKey && prefixRankedKey);
      assert.equal(exactRankedKey.preselect, true);
      assert.equal(
        exactRankedKey.sortText < compactRankedKey.sortText &&
          exactRankedKey.sortText < prefixRankedKey.sortText,
        true,
        "an exact punctuation-preserving citation key must outrank compact and prefix matches",
      );

      const beyondEmptyCapSource = "\\cite{BulkTail104}";
      const beyondEmptyCapCursor = beyondEmptyCapSource.indexOf("}");
      await replaceDocument(editor, beyondEmptyCapSource, beyondEmptyCapCursor);
      const beyondEmptyCapItems = await provideCompletions(
        document,
        beyondEmptyCapCursor,
      );
      assert.ok(
        findCitationCompletion(
          beyondEmptyCapItems,
          "reference.bib",
          "BulkTail104",
        ),
        "ranking must happen before the UI cap so an exact key outside the empty-query top 100 can surface",
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

      const zoteroRpcFixture = await startZoteroRpcFixture();
      try {
        await citationConfiguration.update(
          "zoteroPort",
          zoteroRpcFixture.port,
          vscode.ConfigurationTarget.WorkspaceFolder,
        );
        const snapshotCitationSource = "\\cite{Snapshot}";
        const snapshotCitationCursor = snapshotCitationSource.indexOf("}");
        await replaceDocument(
          editor,
          snapshotCitationSource,
          snapshotCitationCursor,
        );
        let staleCompletion;
        await waitFor(async () => {
          const items = await provideCompletions(
            document,
            snapshotCitationCursor,
          );
          staleCompletion = findZoteroCitationCompletion(items, "Snapshot2026");
          return staleCompletion !== undefined;
        }, "the mock Zotero snapshot to populate native citation completion", 8_000);
        assert.ok(staleCompletion?.command);
        const staleArgument = staleCompletion.command.arguments?.[0];
        assert.equal(typeof staleArgument?.snapshotId, "string");
        assert.notEqual(staleArgument.snapshotId.length, 0);
        assert.equal(
          staleArgument.bibliographyUri,
          referenceBibUri.toString(),
          "a Zotero completion must bind the exact bibliography target resolved when it was created",
        );
        assert.equal(
          staleArgument.bibliographyPath,
          "reference.bib",
          "a Zotero completion must retain the relative bibliography path used by a visual custom editor",
        );

        const groupedCitationItems = await provideCompletions(
          document,
          snapshotCitationCursor,
        );
        const collectedSnapshot = findCitationCompletion(
          groupedCitationItems,
          "reference.bib",
          "ExistingSnapshotSurvey",
        );
        const uncollectedSnapshot = findZoteroCitationCompletion(
          groupedCitationItems,
          "Snapshot2026",
        );
        assert.ok(collectedSnapshot && uncollectedSnapshot);
        assert.equal(
          groupedCitationItems.indexOf(collectedSnapshot) <
            groupedCitationItems.indexOf(uncollectedSnapshot),
          true,
          "nonempty citation search must group collected .bib matches before uncollected Zotero matches",
        );
        assert.equal(
          collectedSnapshot.sortText < uncollectedSnapshot.sortText,
          true,
          "citation sortText must preserve the collected-before-uncollected grouping in VS Code",
        );

        const cachedEmptyCitationSource = "\\cite{}";
        const cachedEmptyCitationCursor = cachedEmptyCitationSource.indexOf("}");
        await replaceDocument(
          editor,
          cachedEmptyCitationSource,
          cachedEmptyCitationCursor,
        );
        const cachedEmptyCitationItems = await provideCompletions(
          document,
          cachedEmptyCitationCursor,
        );
        assert.ok(
          findCitationCompletion(
            cachedEmptyCitationItems,
            "reference.bib",
            "Lovelace1843",
          ),
          "empty citation completion must keep showing collected bibliography entries after Zotero has been cached",
        );
        assert.equal(
          cachedEmptyCitationItems.some((item) =>
            typeof item.label === "object" &&
            item.label.description === "Zotero" &&
            item.kind === vscode.CompletionItemKind.Reference
          ),
          false,
          "empty citation completion must exclude every uncollected Zotero candidate",
        );

        const duplicateCitationSource = "\\cite{Duplicate}";
        const duplicateCitationCursor = duplicateCitationSource.indexOf("}");
        await replaceDocument(
          editor,
          duplicateCitationSource,
          duplicateCitationCursor,
        );
        const duplicateCitationItems = await provideCompletions(
          document,
          duplicateCitationCursor,
        );
        assert.equal(
          findZoteroCitationCompletion(duplicateCitationItems, "Duplicate2025"),
          undefined,
          "every Zotero record in a duplicate citekey group must be excluded",
        );

        await replaceDocument(
          editor,
          snapshotCitationSource,
          snapshotCitationCursor,
        );
        await vscode.commands.executeCommand("texleaf.refreshZotero");
        const refreshedItems = await provideCompletions(
          document,
          snapshotCitationCursor,
        );
        const refreshedCompletion = findZoteroCitationCompletion(
          refreshedItems,
          "Snapshot2026",
        );
        assert.ok(refreshedCompletion?.command);
        const refreshedArgument = refreshedCompletion.command.arguments?.[0];
        assert.equal(typeof refreshedArgument?.snapshotId, "string");
        assert.equal(
          refreshedArgument?.bibliographyUri,
          referenceBibUri.toString(),
        );
        assert.notEqual(
          refreshedArgument.snapshotId,
          staleArgument.snapshotId,
          "a forced Zotero refresh must mint a new snapshot identity",
        );

        const citationBeforeStaleCommit = document.getText();
        const bibliographyBeforeStaleCommit = await vscode.workspace.fs.readFile(
          referenceBibUri,
        );
        await vscode.commands.executeCommand(
          staleCompletion.command.command,
          ...(staleCompletion.command.arguments ?? []),
        );
        assert.equal(
          document.getText(),
          citationBeforeStaleCommit,
          "an accepted completion from a stale Zotero snapshot must not edit the citation",
        );
        assert.deepEqual(
          await vscode.workspace.fs.readFile(referenceBibUri),
          bibliographyBeforeStaleCommit,
          "an accepted completion from a stale Zotero snapshot must not edit bibliography",
        );
        assert.equal(
          zoteroRpcFixture.exportCalls,
          0,
          "stale Zotero completion rejection must happen before item.export",
        );
      } finally {
        await zoteroRpcFixture.close();
      }

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
      224,
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
    assert.equal(migratedGlobalLibrary.snippets.length, 224);
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

    const inputBatchGlobalLibrary = parseJsonc(globalSnippetText);
    inputBatchGlobalLibrary.snippets.push(
      {
        id: "extension-host-residue-input-batch",
        trigger: "res",
        replacement: "\\operatorname{Res}",
        options: "mA",
        description: "Residue input-batch regression",
        category: "Extension Host",
      },
      {
        id: "extension-host-math-context-only",
        trigger: "mctx",
        replacement: "\\operatorname{MathContext}",
        options: "mA",
        description: "Math-context scanner regression",
        category: "Extension Host",
      },
      {
        id: "extension-host-text-context-only",
        trigger: "tctx",
        replacement: "\\textbf{TextContext}",
        options: "tA",
        description: "Text-context scanner regression",
        category: "Extension Host",
      },
    );
    const inputBatchGlobalText = `${JSON.stringify(
      inputBatchGlobalLibrary,
      null,
      2,
    )}\n`;
    const inputBatchGlobalEditor = await vscode.window.showTextDocument(
      globalEditor.document,
    );
    await replaceDocument(
      inputBatchGlobalEditor,
      inputBatchGlobalText,
      inputBatchGlobalText.length,
    );
    assert.equal(
      await inputBatchGlobalEditor.document.save(),
      true,
      "the automatic input-batch fixture must save",
    );
    await vscode.commands.executeCommand("texleaf.reloadSnippets");
    editor = await vscode.window.showTextDocument(document);

    try {
      const replaceMarkedDocument = async (markedSource) => {
        const cursorOffset = markedSource.indexOf("|");
        assert.notEqual(cursorOffset, -1, "the marked source must contain a cursor");
        assert.equal(
          markedSource.lastIndexOf("|"),
          cursorOffset,
          "the marked source must contain exactly one cursor",
        );
        const source = `${markedSource.slice(0, cursorOffset)}${markedSource.slice(cursorOffset + 1)}`;
        await replaceDocument(editor, source, cursorOffset);
        return { source, cursorOffset };
      };

      await replaceDocument(editor, "\\(\\)", 2);
      await typeEach("res", editor);
      await waitForDocumentText(
        document,
        "\\(\\operatorname{Res}\\)",
        "the temporary res automatic snippet fixture to load",
      );

      let markedContext = await replaceMarkedDocument(
        String.raw`\[\text{|}\]`,
      );
      await typeEach("mctx", editor);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        document.getText(),
        `${markedContext.source.slice(0, markedContext.cursorOffset)}mctx${markedContext.source.slice(markedContext.cursorOffset)}`,
        "a math-only automatic snippet must stay literal inside \\text{...}",
      );

      markedContext = await replaceMarkedDocument(String.raw`\[\text{|}\]`);
      await typeEach("tctx", editor);
      await waitForDocumentText(
        document,
        `${markedContext.source.slice(0, markedContext.cursorOffset)}\\textbf{TextContext}${markedContext.source.slice(markedContext.cursorOffset)}`,
        "a text-only automatic snippet must expand inside \\text{...}",
      );

      markedContext = await replaceMarkedDocument(
        String.raw`\[\text{outer {nested {|}}}\]`,
      );
      await typeEach("tctx", editor);
      await waitForDocumentText(
        document,
        `${markedContext.source.slice(0, markedContext.cursorOffset)}\\textbf{TextContext}${markedContext.source.slice(markedContext.cursorOffset)}`,
        "nested braces must remain in the enclosing \\text argument mode",
      );

      markedContext = await replaceMarkedDocument(
        String.raw`\[\text{copy} |\]`,
      );
      await typeEach("mctx", editor);
      await waitForDocumentText(
        document,
        `${markedContext.source.slice(0, markedContext.cursorOffset)}\\operatorname{MathContext}${markedContext.source.slice(markedContext.cursorOffset)}`,
        "closing \\text{...} must restore the surrounding block-math mode",
      );

      markedContext = await replaceMarkedDocument(
        String.raw`\[\text{copy \(|\) tail}\]`,
      );
      await typeEach("mctx", editor);
      await waitForDocumentText(
        document,
        `${markedContext.source.slice(0, markedContext.cursorOffset)}\\operatorname{MathContext}${markedContext.source.slice(markedContext.cursorOffset)}`,
        "an explicit math delimiter inside \\text must re-enter inline math mode",
      );

      markedContext = await replaceMarkedDocument(
        String.raw`\[\text{copy \(x\) |tail}\]`,
      );
      await typeEach("tctx", editor);
      await waitForDocumentText(
        document,
        `${markedContext.source.slice(0, markedContext.cursorOffset)}\\textbf{TextContext}${markedContext.source.slice(markedContext.cursorOffset)}`,
        "closing inner math must restore the enclosing \\text argument mode",
      );

      markedContext = await replaceMarkedDocument(
        String.raw`\begin{align*}
  \text{|}
\end{align*}`,
      );
      await vscode.commands.executeCommand("texleaf.handleTab");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        document.getText().includes("&"),
        false,
        "Tab inside \\text{...} in align* must remain text indentation, not insert a matrix cell separator",
      );

      await replaceDocument(editor, "\\(\\)", 2);
      await typeBatch("res", editor);
      await waitForDocumentText(
        document,
        "\\(\\operatorname{Res}\\)",
        "a multi-character type command ending in the literal res trigger",
      );

      await replaceDocument(editor, "\\(\\)", 2);
      await typeBatch("t,.", editor);
      await waitForDocumentText(
        document,
        "\\(\\mathbf{t}\\)",
        "a multi-character type command ending in the regex t,. trigger",
      );

      for (const replacementCommand of ["replacePreviousChar", "compositionType"]) {
        await replaceDocument(editor, "\\(\\)", 2);
        await commitImeText(editor, "t", "t,.", replacementCommand);
        await waitForDocumentText(
          document,
          "\\(\\mathbf{t}\\)",
          `${replacementCommand} must re-check an automatic trigger after the IME commit`,
        );
      }

      await replaceDocument(editor, "\\(\\)", 2);
      await commitImeSequence(editor, [
        ["type", { text: "s" }],
        ["replacePreviousChar", { text: "su", replaceCharCnt: 1 }],
        [
          "compositionType",
          {
            text: "sum",
            replacePrevCharCnt: 2,
            replaceNextCharCnt: 0,
            positionDelta: 0,
          },
        ],
      ]);
      await waitForDocumentText(
        document,
        "\\(\\sum\\)",
        "compositionEnd must expand sum only after the full concurrent IME lifecycle",
      );

      await replaceDocument(editor, "\\(\\)", 2);
      await commitImeSequence(editor, [
        ["type", { text: "t" }],
        [
          "compositionType",
          {
            text: "t,",
            replacePrevCharCnt: 1,
            replaceNextCharCnt: 0,
            positionDelta: 0,
          },
        ],
        ["replacePreviousChar", { text: "t,.", replaceCharCnt: 2 }],
      ]);
      await waitForDocumentText(
        document,
        "\\(\\mathbf{t}\\)",
        "compositionEnd must expand t,. only after the full concurrent IME lifecycle",
      );

      await replaceDocument(editor, "\\(old\\)", 5);
      editor.selection = new vscode.Selection(
        document.positionAt(2),
        document.positionAt(5),
      );
      const selectedCompositionOperations = [
        vscode.commands.executeCommand("compositionStart"),
        vscode.commands.executeCommand("type", { text: "s" }),
        vscode.commands.executeCommand("replacePreviousChar", {
          text: "su",
          replaceCharCnt: 1,
        }),
        vscode.commands.executeCommand("compositionType", {
          text: "sum",
          replacePrevCharCnt: 2,
          replaceNextCharCnt: 0,
          positionDelta: 0,
        }),
      ];
      await Promise.all(selectedCompositionOperations);
      await waitForDocumentText(
        document,
        "\\(sum\\)",
        "a composition that starts over a selection must retain its provisional text",
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        document.getText(),
        "\\(sum\\)",
        "provisional composition text must not expand before compositionEnd",
      );
      await vscode.commands.executeCommand("compositionEnd");
      await waitForDocumentText(
        document,
        "\\(\\sum\\)",
        "compositionEnd must expand the final text after replacing a selection",
      );

      await replaceDocument(editor, "\\(t,\\)", 4);
      const punctuationReplacementVersion = document.version;
      await Promise.all([
        vscode.commands.executeCommand("type", { text: "." }),
        vscode.commands.executeCommand("replacePreviousChar", {
          text: "。",
          replaceCharCnt: 1,
        }),
      ]);
      await waitFor(
        () => document.version > punctuationReplacementVersion,
        "the no-lifecycle punctuation replacement to change the document",
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        document.getText(),
        "\\(t,。\\)",
        "a later punctuation replacement must prevent a provisional t,. match from corrupting text",
      );

      await replaceDocument(editor, "\\(t,\\)", 4);
      const delayedProvisionalType = vscode.commands.executeCommand("type", {
        text: ".",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const delayedPunctuationReplacement = vscode.commands.executeCommand(
        "replacePreviousChar",
        {
          text: "。",
          replaceCharCnt: 1,
        },
      );
      await Promise.all([
        delayedProvisionalType,
        delayedPunctuationReplacement,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        document.getText(),
        "\\(t,。\\)",
        "a next-turn IME replacement must supersede a provisional single-character automatic match",
      );

      await replaceDocument(editor, "\\(\\)", 2);
      await Promise.all([
        vscode.commands.executeCommand("type", { text: "res" }),
        vscode.commands.executeCommand("type", { text: "+" }),
      ]);
      await waitForDocumentText(
        document,
        "\\(\\operatorname{Res}+\\)",
        "a queued ordinary character must follow the preceding input-batch expansion",
      );

      await replaceDocument(editor, "\\(\\)", 2);
      await Promise.all(
        [..."res"].map((text) =>
          vscode.commands.executeCommand("type", { text }),
        ),
      );
      await waitForDocumentText(
        document,
        "\\(\\operatorname{Res}\\)",
        "concurrent single-character commands must preserve and expand res in FIFO order",
      );

      await replaceDocument(editor, "\\(\\)", 2);
      await Promise.all([
        vscode.commands.executeCommand("compositionStart"),
        vscode.commands.executeCommand("type", { text: "s" }),
        vscode.commands.executeCommand("replacePreviousChar", {
          text: "su",
          replaceCharCnt: 1,
        }),
        vscode.commands.executeCommand("compositionType", {
          text: "sum",
          replacePrevCharCnt: 2,
          replaceNextCharCnt: 0,
          positionDelta: 0,
        }),
        vscode.commands.executeCommand("compositionEnd"),
        vscode.commands.executeCommand("type", { text: "+" }),
      ]);
      await waitForDocumentText(
        document,
        "\\(\\sum+\\)",
        "ordinary typing queued after compositionEnd must follow the final expansion",
      );

      await replaceDocument(editor, "\\(\\)", 2);
      await Promise.all([
        vscode.commands.executeCommand("compositionStart"),
        vscode.commands.executeCommand("type", { text: "s" }),
        vscode.commands.executeCommand("replacePreviousChar", {
          text: "sum",
          replaceCharCnt: 1,
        }),
        vscode.commands.executeCommand("compositionEnd"),
        vscode.commands.executeCommand("compositionStart"),
        vscode.commands.executeCommand("type", { text: "t" }),
        vscode.commands.executeCommand("replacePreviousChar", {
          text: "t,.",
          replaceCharCnt: 1,
        }),
        vscode.commands.executeCommand("compositionEnd"),
      ]);
      await waitForDocumentText(
        document,
        "\\(\\sum\\mathbf{t}\\)",
        "two rapid composition lifecycles must keep their provisional text isolated",
      );

      await replaceDocument(editor, "\\(\\)", 2);
      await Promise.all([
        vscode.commands.executeCommand("type", { text: "res" }),
        vscode.commands.executeCommand("compositionStart"),
        vscode.commands.executeCommand("type", { text: "s" }),
        vscode.commands.executeCommand("replacePreviousChar", {
          text: "sum",
          replaceCharCnt: 1,
        }),
        vscode.commands.executeCommand("compositionEnd"),
      ]);
      await waitForDocumentText(
        document,
        "\\(\\operatorname{Res}\\sum\\)",
        "a new composition must not suppress the preceding committed input segment",
      );

      const inputNewline =
        document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
      const displayBatchSource = ["\\[", "", "\\]"].join(inputNewline);
      const displayBatchCursor = displayBatchSource.indexOf(inputNewline) +
        inputNewline.length;
      await replaceDocument(editor, displayBatchSource, displayBatchCursor);
      await typeBatch("res", editor);
      await waitForDocumentText(
        document,
        ["\\[", "\\operatorname{Res}", "\\]"].join(inputNewline),
        "a multi-character literal trigger on a fresh display-math line",
      );

      await replaceDocument(editor, displayBatchSource, displayBatchCursor);
      assert.equal(
        await document.save(),
        true,
        "the display-math input-batch fixture must save before typing",
      );
      await typeBatch("res", editor);
      await waitForDocumentText(
        document,
        ["\\[", "\\operatorname{Res}", "\\]"].join(inputNewline),
        "a literal automatic trigger immediately after saving display math",
      );

      const alignBatchSource = [
        "\\begin{align*}",
        "  & ",
        "\\end{align*}",
      ].join(inputNewline);
      const alignBatchCursor = alignBatchSource.indexOf("  & ") + 4;
      await replaceDocument(editor, alignBatchSource, alignBatchCursor);
      await typeBatch("t,.", editor);
      await waitForDocumentText(
        document,
        ["\\begin{align*}", "  & \\mathbf{t}", "\\end{align*}"].join(
          inputNewline,
        ),
        "a multi-character regex trigger on a fresh align-math line",
      );

      await replaceDocument(editor, alignBatchSource, alignBatchCursor);
      assert.equal(
        await document.save(),
        true,
        "the align input-batch fixture must save before typing",
      );
      await typeBatch("t,.", editor);
      await waitForDocumentText(
        document,
        ["\\begin{align*}", "  & \\mathbf{t}", "\\end{align*}"].join(
          inputNewline,
        ),
        "a regex automatic trigger immediately after saving align math",
      );

      await replaceDocument(editor, "\\(\\)", 2);
      const versionBeforeProgrammaticBatch = document.version;
      assert.equal(
        await editor.edit(
          (builder) => builder.insert(editor.selection.active, "res"),
          { undoStopBefore: true, undoStopAfter: true },
        ),
        true,
        "the paste-style programmatic batch insertion must succeed",
      );
      await waitFor(
        () => document.version > versionBeforeProgrammaticBatch,
        "the paste-style programmatic batch document change",
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(
        document.getText(),
        "\\(res\\)",
        "a generic programmatic multi-character edit must not run automatic snippets",
      );

      const clipboardBeforeInputBatchTest = await vscode.env.clipboard.readText();
      try {
        await replaceDocument(editor, "\\(\\)", 2);
        await vscode.env.clipboard.writeText("res");
        const versionBeforePaste = document.version;
        await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
        await waitFor(
          () => document.version > versionBeforePaste,
          "the ordinary clipboard paste document change",
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(
          document.getText(),
          "\\(res\\)",
          "an ordinary paste must not run automatic snippets",
        );
      } finally {
        await vscode.env.clipboard.writeText(clipboardBeforeInputBatchTest);
      }
    } finally {
      const restoredInputBatchGlobalEditor = await vscode.window.showTextDocument(
        globalEditor.document,
      );
      await replaceDocument(
        restoredInputBatchGlobalEditor,
        globalSnippetText,
        globalSnippetText.length,
      );
      assert.equal(
        await restoredInputBatchGlobalEditor.document.save(),
        true,
        "the automatic input-batch fixture must restore the global library",
      );
      await vscode.commands.executeCommand("texleaf.reloadSnippets");
      editor = await vscode.window.showTextDocument(document);
    }

    await replaceDocument(editor, "\\(\\)", 2);
    await typeEach("tau", editor);
    const plainTauText = "\\(\\tau\\)";
    await waitForDocumentText(
      document,
      plainTauText,
      "ordinary automatic tau expansion",
    );
    assert.equal(
      editor.selection.isEmpty,
      true,
      "ordinary tau expansion must leave a caret rather than a selection",
    );
    assert.equal(
      document.offsetAt(editor.selection.active),
      plainTauText.indexOf("\\tau") + "\\tau".length,
      "ordinary tau expansion must leave the caret immediately after \\tau",
    );

    // Reproduce the physical sequence `par -> Tab -> tau -> Tab`. The first
    // Tab expands TeXLeaf's manual derivative snippet. Typing the automatic
    // Greek command into its selected numerator must not replace the outer
    // Snippet Session: the following native snippet Tab still selects x.
    await replaceDocument(editor, "\\(par\\)", 5);
    await vscode.commands.executeCommand("texleaf.handleTab");
    const partialDerivativeWithY =
      "\\(\\frac{ \\partial y }{ \\partial x } \\)";
    await waitForDocumentText(
      document,
      partialDerivativeWithY,
      "manual par partial-derivative expansion",
    );
    assert.equal(
      document.getText(editor.selection),
      "y",
      "the par snippet must initially select its numerator placeholder",
    );

    await typeEach("tau", editor);
    const partialDerivativeWithTau =
      "\\(\\frac{ \\partial \\tau }{ \\partial x } \\)";
    await waitForDocumentText(
      document,
      partialDerivativeWithTau,
      "automatic tau expansion inside the par numerator placeholder",
    );
    await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
    try {
      await waitFor(
        () => document.getText(editor.selection) === "x",
        "Tab after nested tau expansion to select the denominator x placeholder",
      );
    } catch {
      assert.equal(
        document.getText(editor.selection),
        "x",
        `Tab after nested tau expansion must select denominator x; caret offset ${document.offsetAt(editor.selection.active)}`,
      );
    }
    assert.equal(
      document.getText(),
      partialDerivativeWithTau,
      "advancing the par snippet after tau must not alter the derivative",
    );

    // Model a fast physical `u` then Tab without awaiting the contributed
    // type command. Snippet navigation is independent of Tabout, and the
    // wrapper must await the input queue before advancing the outer session.
    const taboutConfiguration = vscode.workspace.getConfiguration(
      "texleaf",
      document.uri,
    );
    const taboutBeforeRapidSnippetTab = taboutConfiguration.inspect("tabout")
      ?.workspaceFolderValue;
    await taboutConfiguration.update(
      "tabout",
      false,
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
    try {
      await waitFor(
        () =>
          vscode.workspace
            .getConfiguration("texleaf", document.uri)
            .get("tabout") === false,
        "tabout=false before rapid snippet navigation",
      );
      await replaceDocument(editor, "\\(par\\)", 5);
      await vscode.commands.executeCommand("texleaf.handleTab");
      await waitForDocumentText(
        document,
        partialDerivativeWithY,
        "outer partial derivative for the rapid tau-then-Tab race",
      );
      await typeEach("ta", editor);
      const rapidTauFinalType = vscode.commands.executeCommand("type", {
        text: "u",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const rapidTauTab = vscode.commands.executeCommand(
        "texleaf.handleSnippetTab",
      );
      await Promise.all([rapidTauFinalType, rapidTauTab]);
      await waitForDocumentText(
        document,
        partialDerivativeWithTau,
        "rapid final-key tau expansion before outer Tab settles with Tabout disabled",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        document.getText(editor.selection),
        "x",
        `rapid tau then Tab must reach outer x with Tabout disabled; caret offset ${document.offsetAt(editor.selection.active)}`,
      );
    } finally {
      await taboutConfiguration.update(
        "tabout",
        taboutBeforeRapidSnippetTab,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await waitFor(
        () =>
          vscode.workspace
            .getConfiguration("texleaf", document.uri)
            .get("tabout", true) ===
          (taboutBeforeRapidSnippetTab ?? true),
        "restored Tabout configuration after rapid snippet navigation",
      );
    }

    await replaceDocument(editor, "\\(par\\)", 5);
    await vscode.commands.executeCommand("texleaf.handleTab");
    await waitForDocumentText(
      document,
      partialDerivativeWithY,
      "outer partial derivative for a multiline plain nested snippet",
    );
    await typeEach("iden2", editor);
    await waitFor(
      () => {
        const text = document.getText();
        return (
          text.includes("\\begin{pmatrix}") &&
          text.includes("1 & 0 \\\\") &&
          text.includes("0 & 1") &&
          text.includes("\\end{pmatrix}") &&
          !text.includes("iden2")
        );
      },
      "multiline no-tabstop iden2 expansion inside the outer numerator",
    );
    const partialDerivativeWithIdentity = document.getText();
    await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
    await waitFor(
      () => document.getText(editor.selection) === "x",
      "Tab after multiline iden2 expansion to restore the outer denominator placeholder",
    );
    assert.equal(
      document.getText(),
      partialDerivativeWithIdentity,
      "resuming the outer snippet after iden2 must not alter the matrix",
    );

    await replaceDocument(editor, "\\(\\)", 2);
    await typeEach("lim", editor);
    const limitWithN = "\\(\\lim_{ n \\to \\infty } \\)";
    await waitForDocumentText(
      document,
      limitWithN,
      "automatic outer limit snippet",
    );
    assert.equal(
      document.getText(editor.selection),
      "n",
      "the limit snippet must initially select n",
    );
    await typeEach("sum", editor);
    const limitWithSum = "\\(\\lim_{ \\sum \\to \\infty } \\)";
    await waitForDocumentText(
      document,
      limitWithSum,
      "plain symbol expansion inside the first limit placeholder",
    );
    await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
    await waitFor(
      () => document.getText(editor.selection) === "\\infty",
      "Tab after nested sum expansion to select the next limit placeholder",
    );
    assert.equal(
      document.getText(),
      limitWithSum,
      "advancing the limit snippet after sum must not alter its text",
    );

    await replaceDocument(editor, "\\(\\)", 2);
    await typeEach("brk", editor);
    const braketWithEmptyStops = "\\(\\braket{  |  } \\)";
    await waitForDocumentText(
      document,
      braketWithEmptyStops,
      "automatic outer braket with two empty placeholders",
    );
    const firstBraketStop = braketWithEmptyStops.indexOf("  |") + 1;
    assert.equal(editor.selection.isEmpty, true);
    assert.equal(
      document.offsetAt(editor.selection.active),
      firstBraketStop,
      "the braket snippet must start at its first empty placeholder",
    );
    await typeEach("tau", editor);
    const braketWithTau = "\\(\\braket{ \\tau |  } \\)";
    await waitForDocumentText(
      document,
      braketWithTau,
      "plain Greek expansion inside an empty delimited placeholder",
    );
    await vscode.commands.executeCommand("texleaf.handleSnippetTab");
    const secondBraketStop = braketWithTau.indexOf("|  }") + 2;
    await waitFor(
      () =>
        editor.selection.isEmpty &&
        document.offsetAt(editor.selection.active) === secondBraketStop,
      "Tab after nested tau expansion to reach the second empty braket placeholder",
    );
    assert.equal(
      document.getText(),
      braketWithTau,
      "advancing the braket after tau must not alter its text",
    );

    await replaceDocument(editor, "\\(\\sum\\)", 6);
    await vscode.commands.executeCommand("texleaf.handleTab");
    const sumLimitsWithOne = "\\(\\sum_{i=1}^{N} \\)";
    await waitForDocumentText(
      document,
      sumLimitsWithOne,
      "manual outer summation-limits snippet",
    );
    assert.equal(
      document.getText(editor.selection),
      "i",
      "the summation-limits snippet must initially select i",
    );
    await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
    await waitFor(
      () => document.getText(editor.selection) === "1",
      "the middle summation-limits placeholder",
    );
    await typeEach("Qhat", editor);
    const sumLimitsWithAccent = "\\(\\sum_{i=\\hat{Q}}^{N} \\)";
    await waitForDocumentText(
      document,
      sumLimitsWithAccent,
      "plain accent expansion inside a middle summation placeholder",
    );
    await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
    await waitFor(
      () => document.getText(editor.selection) === "N",
      "Tab after nested accent expansion to select the next summation placeholder",
    );
    assert.equal(
      document.getText(),
      sumLimitsWithAccent,
      "advancing summation limits after Qhat must not alter its text",
    );

    // A nested automatic snippet with its own tabstops should own navigation
    // until its final stop, then resume the suspended outer Snippet Session.
    await replaceDocument(editor, "\\(par\\)", 5);
    await vscode.commands.executeCommand("texleaf.handleTab");
    await waitForDocumentText(
      document,
      partialDerivativeWithY,
      "outer partial derivative for nested-tabstop navigation",
    );
    await typeEach("li", editor);
    const rapidLimitFinalType = vscode.commands.executeCommand("type", {
      text: "m",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rapidLimitFirstTab = vscode.commands.executeCommand(
      "texleaf.handleSnippetTab",
    );
    await Promise.all([rapidLimitFinalType, rapidLimitFirstTab]);
    const partialDerivativeWithLimit =
      "\\(\\frac{ \\partial \\lim_{ n \\to \\infty }  }{ \\partial x } \\)";
    await waitForDocumentText(
      document,
      partialDerivativeWithLimit,
      "automatic limit with tabstops inside the outer numerator placeholder",
    );
    await waitFor(
      () => document.getText(editor.selection) === "\\infty",
      "queued rapid Tab from nested limit n to its infinity placeholder",
    );
    await vscode.commands.executeCommand("texleaf.handleSnippetTab");
    const nestedLimitFinalOffset =
      partialDerivativeWithLimit.indexOf("\\lim_") +
      "\\lim_{ n \\to \\infty } ".length;
    await waitFor(
      () =>
        editor.selection.isEmpty &&
        document.offsetAt(editor.selection.active) === nestedLimitFinalOffset,
      "the nested limit final tabstop",
    );
    await vscode.commands.executeCommand("texleaf.handleSnippetTab");
    try {
      await waitFor(
        () => document.getText(editor.selection) === "x",
        "return from nested limit tabstops to the outer denominator placeholder",
      );
    } catch {
      assert.equal(
        document.getText(editor.selection),
        "x",
        `nested tabstops must resume the outer x placeholder; caret offset ${document.offsetAt(editor.selection.active)}`,
      );
    }

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

  await replaceDocument(editor, "\\(\\leq\\)", "\\(\\leq".length);
  await typeEach("0", editor);
  await waitForDocumentText(
    document,
    "\\(\\leq0\\)",
    "a digit after \\leq must not become a suffix subscript",
  );

  await replaceDocument(editor, "\\(\\cdots\\)", "\\(\\cdots".length);
  await typeEach("0", editor);
  await waitForDocumentText(
    document,
    "\\(\\cdots0\\)",
    "a digit after \\cdots must not become a suffix subscript",
  );

  const lessThanFractionSource = "\\(<1/\\)";
  await replaceDocument(
    editor,
    lessThanFractionSource,
    lessThanFractionSource.indexOf("/") + 1,
  );
  await typeEach("2", editor);
  await waitForDocumentText(
    document,
    "\\(<\\frac{1}{2}\\)",
    "a leading less-than sign must remain outside the automatic numerator",
  );

  await replaceDocument(editor, "\\(1/\\)", 4);
  await typeEach("2", editor);
  await waitForDocumentText(
    document,
    "\\(\\frac{1}{2}\\)",
    "type-command automatic fraction from an existing numerator and slash",
  );
  await waitFor(
    () => document.offsetAt(editor.selection.active) === 12,
    "type-command fraction tabstop",
  );

  await replaceDocument(editor, "\\(\\)", 2);
  await typeEach("1/", editor);
  assert.equal(
    document.getText(),
    "\\(1/\\)",
    "typing the numerator and slash must retain the literal slash until a denominator",
  );
  assert.equal(
    await document.save(),
    true,
    "the pending denominator fixture must save before its first character",
  );
  await typeEach("2", editor);
  await waitForDocumentText(
    document,
    "\\(\\frac{1}{2}\\)",
    "saving after 1/ must not lose automatic fraction recognition",
  );

  await replaceDocument(editor, "\\(1/\\)", 4);
  const provisionalFractionText = "\\(1/2\\)";
  const provisionalFractionObserved = observeDocumentText(
    document,
    provisionalFractionText,
    "the provisional denominator before a next-turn IME replacement",
  );
  const provisionalDenominatorType = vscode.commands.executeCommand("type", {
    text: "2",
  });
  await provisionalFractionObserved;
  await new Promise((resolve) => setTimeout(resolve, 0));
  const provisionalDenominatorReplacement = vscode.commands.executeCommand(
    "replacePreviousChar",
    {
      text: "。",
      replaceCharCnt: 1,
    },
  );
  await Promise.all([
    provisionalDenominatorType,
    provisionalDenominatorReplacement,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(
    document.getText(),
    "\\(1/。\\)",
    "a next-turn replacement must supersede a provisional automatic-fraction seed",
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

  await setDocumentEndOfLine(editor, vscode.EndOfLine.LF);
  const squareInDenominatorSource = [
    String.raw`\begin{align*}`,
    String.raw`  & \frac{1}{}`,
    String.raw`\end{align*}`,
  ].join("\n");
  const squareInDenominatorCursor =
    squareInDenominatorSource.indexOf("{}") + 1;
  await replaceDocument(
    editor,
    squareInDenominatorSource,
    squareInDenominatorCursor,
  );
  await typeEach("nsr", editor);
  const squareInDenominatorExpected = squareInDenominatorSource.replace(
    "{}",
    "{n^{2}}",
  );
  await waitFor(
    () => document.getText() === squareInDenominatorExpected,
    "physical nsr square expansion inside an align denominator",
  );
  const squareInDenominatorInnerCaret =
    squareInDenominatorExpected.indexOf("n^{2}") + "n^{2}".length;
  assert.equal(
    document.offsetAt(editor.selection.active),
    squareInDenominatorInnerCaret,
    "nsr must finish after its exponent brace and before the enclosing denominator brace",
  );
  await vscode.commands.executeCommand("texleaf.handleSuggestTabout");
  assert.equal(
    document.getText(),
    squareInDenominatorExpected,
    "the first matrix Tab after nsr must not insert an alignment cell",
  );
  assert.equal(
    document.offsetAt(editor.selection.active),
    squareInDenominatorInnerCaret + 1,
    "the first matrix Tab after nsr must leave the enclosing denominator brace",
  );
  await vscode.commands.executeCommand("texleaf.handleTab");
  await waitFor(
    () =>
      document.getText() ===
      `${squareInDenominatorExpected.slice(0, squareInDenominatorInnerCaret + 1)} & ` +
        squareInDenominatorExpected.slice(squareInDenominatorInnerCaret + 1),
    "matrix column insertion after all local closers are exhausted",
  );

  const handwrittenCloserSource = [
    String.raw`\begin{align*}`,
    String.raw`  & \frac{1}{n^{2}}`,
    String.raw`\end{align*}`,
  ].join("\n");
  const handwrittenCloserCursor =
    handwrittenCloserSource.indexOf("n^{2}") + "n^{2}".length;
  await replaceDocument(editor, handwrittenCloserSource, handwrittenCloserCursor);
  await vscode.commands.executeCommand("texleaf.handleTab");
  assert.equal(
    document.getText(),
    handwrittenCloserSource,
    "handwritten braces must receive the same Tabout-before-matrix behavior",
  );
  assert.equal(
    document.offsetAt(editor.selection.active),
    handwrittenCloserCursor + 1,
    "Tabout must cross the handwritten denominator closer",
  );

  const nestedCloserSource = [
    String.raw`\begin{align*}`,
    String.raw`  & ([x])`,
    String.raw`\end{align*}`,
  ].join("\n");
  const nestedCloserCursor = nestedCloserSource.indexOf("x") + 1;
  await replaceDocument(editor, nestedCloserSource, nestedCloserCursor);
  await vscode.commands.executeCommand("texleaf.handleTab");
  assert.equal(
    document.offsetAt(editor.selection.active),
    nestedCloserCursor + 1,
    "nested Tabout must leave the innermost bracket first",
  );
  await vscode.commands.executeCommand("texleaf.handleTab");
  assert.equal(
    document.offsetAt(editor.selection.active),
    nestedCloserCursor + 2,
    "the following Tabout may then leave the enclosing parenthesis",
  );

  const explicitMathExitSource = String.raw`\(x   \)`;
  const explicitMathExitCursor = explicitMathExitSource.indexOf("x") + 1;
  await replaceDocument(
    editor,
    explicitMathExitSource,
    explicitMathExitCursor,
  );
  await vscode.commands.executeCommand("texleaf.handleTab");
  assert.equal(
    document.offsetAt(editor.selection.active),
    explicitMathExitSource.length,
    "Tabout must leave an explicit math delimiter when only whitespace remains",
  );

  const alignRowPrefixSource = [
    String.raw`\begin{align*}`,
    String.raw`  & \frac{1}{16}\left(\frac{z_1}{z_2}+\frac{z_2}{z_1}\right) \\`,
    String.raw`  &-2z(\Phi_{1,2}(z_{1}; \mathbf{s})-1)(\Phi_{1,2}(z_{2}; \mathbf{s})-1)`,
    String.raw`\end{align*}`,
  ].join("\n");
  const alignRowPrefixCursor = alignRowPrefixSource.indexOf("&-2z") + 1;
  await replaceDocument(editor, alignRowPrefixSource, alignRowPrefixCursor);
  await vscode.commands.executeCommand("texleaf.handleTab");
  const alignRowPrefixExpected =
    `${alignRowPrefixSource.slice(0, alignRowPrefixCursor)} & ` +
    alignRowPrefixSource.slice(alignRowPrefixCursor);
  await waitForDocumentText(
    document,
    alignRowPrefixExpected,
    "matrix column insertion after an existing align boundary before brace-heavy source",
  );
  assert.equal(
    document.offsetAt(editor.selection.active),
    alignRowPrefixCursor + " & ".length,
    "align cell-prefix Tab must stay at the inserted alignment marker",
  );

  const blankCellSource = [
    String.raw`\begin{align*}`,
    "  & ",
    String.raw`\end{align*}`,
  ].join("\n");
  const blankCellCursor = blankCellSource.indexOf("\n", blankCellSource.indexOf("\n") + 1);
  await replaceDocument(editor, blankCellSource, blankCellCursor);
  await vscode.commands.executeCommand("texleaf.handleTab");
  await waitFor(
    () => document.lineAt(1).text === "  &  & ",
    "matrix column insertion from an existing blank cell",
  );

  const multiCursorMatrixSource = [
    String.raw`\begin{align*}`,
    "  x",
    "  y",
    String.raw`\end{align*}`,
  ].join("\n");
  await replaceDocument(
    editor,
    multiCursorMatrixSource,
    multiCursorMatrixSource.indexOf("x") + 1,
  );
  const firstMatrixCursor = document.positionAt(
    multiCursorMatrixSource.indexOf("x") + 1,
  );
  const secondMatrixCursor = document.positionAt(
    multiCursorMatrixSource.indexOf("y") + 1,
  );
  editor.selections = [
    new vscode.Selection(firstMatrixCursor, firstMatrixCursor),
    new vscode.Selection(secondMatrixCursor, secondMatrixCursor),
  ];
  await vscode.commands.executeCommand("texleaf.handleTab");
  assert.equal(
    document.getText().includes("x & ") || document.getText().includes("y & "),
    false,
    "multiple cursors must fall back to native Tab instead of inserting one TeXLeaf matrix cell",
  );

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
    await typeEach("article-en");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      bib.document.getText(),
      "article-en",
      "automatic document templates must not expand in a .bib file",
    );
    await vscode.commands.executeCommand("texleaf.handleTab");
    assert.doesNotMatch(
      bib.document.getText(),
      /\\documentclass/u,
      "document templates must remain limited to saved .tex files",
    );
    assertNoAiDiagnostics(
      bib.document,
      ".bib files must never receive AI writing diagnostics",
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
    assertNoAiDiagnostics(
      markdown.document,
      "Markdown files must never receive AI writing diagnostics",
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
    await typeEach("article-en");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      untitledDocument.getText(),
      "article-en",
      "an untitled LaTeX editor must not run document templates",
    );
    assertNoAiDiagnostics(
      untitledDocument,
      "untitled LaTeX editors must never receive AI writing diagnostics",
    );

    // Persisted issue snapshots are restored only for the exact source and
    // only while the feature gate is open. Use never-before-opened documents
    // so onDidOpen exercises the real activation restoration path.
    const persistenceConfiguration = vscode.workspace.getConfiguration(
      "texleaf",
      document.uri,
    );
    await persistenceConfiguration.update(
      "aiWriting.enabled",
      true,
      vscode.ConfigurationTarget.Global,
    );
    await waitFor(
      () => vscode.workspace
        .getConfiguration("texleaf", document.uri)
        .get("aiWriting.enabled") === true,
      "AI persistence fixture enablement",
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    // The ordinary TeXLeaf master switch remains resource-scoped for snippet
    // behavior, but a workspace must not use it to override a user/Profile
    // master disable and reactivate AI uploads or persisted AI UI.
    await persistenceConfiguration.update(
      "enabled",
      false,
      vscode.ConfigurationTarget.Global,
    );
    await waitFor(
      () => persistenceConfiguration.inspect("enabled")?.globalValue === false,
      "user/Profile TeXLeaf master disable",
    );
    assert.equal(
      persistenceConfiguration.get("enabled"),
      true,
      "the hostile workspace fixture must demonstrate the resource-effective override",
    );
    const masterBlockedFixture = "This hidden prose is bad.";
    const masterBlockedUri = vscode.Uri.joinPath(
      texProjectRoot,
      "ai-master-disabled.tex",
    );
    await vscode.workspace.fs.writeFile(
      masterBlockedUri,
      new TextEncoder().encode(masterBlockedFixture),
    );
    await writeAiIssueSnapshotForSource(
      globalSnippetUri,
      masterBlockedUri,
      masterBlockedFixture,
      "bad",
    );
    let masterBlockedDocument = await vscode.workspace.openTextDocument(
      masterBlockedUri,
    );
    if (masterBlockedDocument.languageId !== "latex") {
      masterBlockedDocument = await vscode.languages.setTextDocumentLanguage(
        masterBlockedDocument,
        "latex",
      );
    }
    const masterBlockedStart = masterBlockedFixture.indexOf("bad");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
      await hasTexLeafAiHover(masterBlockedDocument, masterBlockedStart),
      false,
      "workspace texleaf.enabled=true must not override a user/Profile master disable for AI Hover",
    );
    assert.equal(
      await hasTexLeafAiQuickFix(
        masterBlockedDocument,
        masterBlockedStart,
        masterBlockedStart + "bad".length,
      ),
      false,
      "workspace texleaf.enabled=true must not override a user/Profile master disable for AI Quick Fix",
    );
    await persistenceConfiguration.update(
      "enabled",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
    await waitFor(
      () => persistenceConfiguration.inspect("enabled")?.globalValue === undefined,
      "restoring the user/Profile TeXLeaf master default",
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    await persistenceConfiguration.update(
      "languageIds",
      ["bibtex"],
      vscode.ConfigurationTarget.Global,
    );
    await waitFor(
      () => JSON.stringify(
        persistenceConfiguration.inspect("languageIds")?.globalValue,
      ) === JSON.stringify(["bibtex"]),
      "user/Profile LaTeX language exclusion",
    );
    assert.deepEqual(
      persistenceConfiguration.get("languageIds"),
      ["latex", "tex", "bibtex"],
      "the hostile workspace fixture must demonstrate its languageIds override",
    );
    const languageBlockedFixture = "This language-scoped prose is bad.";
    const languageBlockedUri = vscode.Uri.joinPath(
      texProjectRoot,
      "ai-language-disabled.tex",
    );
    await vscode.workspace.fs.writeFile(
      languageBlockedUri,
      new TextEncoder().encode(languageBlockedFixture),
    );
    await writeAiIssueSnapshotForSource(
      globalSnippetUri,
      languageBlockedUri,
      languageBlockedFixture,
      "bad",
    );
    let languageBlockedDocument = await vscode.workspace.openTextDocument(
      languageBlockedUri,
    );
    if (languageBlockedDocument.languageId !== "latex") {
      languageBlockedDocument = await vscode.languages.setTextDocumentLanguage(
        languageBlockedDocument,
        "latex",
      );
    }
    const languageBlockedStart = languageBlockedFixture.indexOf("bad");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
      await hasTexLeafAiHover(languageBlockedDocument, languageBlockedStart),
      false,
      "workspace languageIds must not override a user/Profile LaTeX exclusion for AI Hover",
    );
    await persistenceConfiguration.update(
      "languageIds",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
    await waitFor(
      () => persistenceConfiguration.inspect("languageIds")?.globalValue === undefined,
      "restoring the user/Profile language defaults",
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    const persistenceFixture = "This prose is bad.";
    assert.equal(vscode.workspace.isTrusted, true);
    const persistenceUri = vscode.Uri.joinPath(
      texProjectRoot,
      "ai-persistence.tex",
    );
    await vscode.workspace.fs.writeFile(
      persistenceUri,
      new TextEncoder().encode(persistenceFixture),
    );
    const aiIssueCacheUri = await writeAiIssueSnapshotForSource(
      globalSnippetUri,
      persistenceUri,
      persistenceFixture,
      "bad",
    );
    assert.ok((await vscode.workspace.fs.stat(aiIssueCacheUri)).size > 0);
    let reopenedPersistenceDocument = await vscode.workspace.openTextDocument(
      persistenceUri,
    );
    if (reopenedPersistenceDocument.languageId !== "latex") {
      reopenedPersistenceDocument = await vscode.languages.setTextDocumentLanguage(
        reopenedPersistenceDocument,
        "latex",
      );
    }
    editor = await vscode.window.showTextDocument(reopenedPersistenceDocument, {
      preview: false,
    });
    const badStart = reopenedPersistenceDocument.getText().indexOf("bad");
    await waitFor(
      () => hasTexLeafAiHover(reopenedPersistenceDocument, badStart),
      "exact-source persisted AI issue restoration",
    );
    assert.equal(
      await hasTexLeafAiQuickFix(
        reopenedPersistenceDocument,
        badStart,
        badStart + 3,
      ),
      true,
      "a restored issue must provide the same safe Quick Fix as a live issue",
    );
    assertSingleAiDiagnostic(
      reopenedPersistenceDocument,
      badStart,
      badStart + 3,
      "restored AI issues must be published to the native Problems panel",
    );

    await vscode.commands.executeCommand("texleaf.aiWriting.clearDiagnostics");
    await waitFor(
      async () => !(await hasTexLeafAiHover(reopenedPersistenceDocument, badStart)),
      "cleared persisted AI hover",
    );
    await waitFor(
      () => texLeafAiDiagnostics(reopenedPersistenceDocument).length === 0,
      "cleared native AI diagnostic",
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const clearedRecord = JSON.parse(new TextDecoder().decode(
      await vscode.workspace.fs.readFile(aiIssueCacheUri),
    ));
    assert.deepEqual(clearedRecord.issues, []);
    assert.equal(
      await hasTexLeafAiHover(reopenedPersistenceDocument, badStart),
      false,
      "a durable clear must remove the restored Hover immediately",
    );

    // Ctrl+. asks providers at the editor's collapsed selection, not across
    // the issue's full range. Keep this distinct from the persisted-clear
    // fixture above so applying the Hover action also proves durable consume.
    const hoverApplyFixture = "This wording is bad.";
    const hoverApplyOriginal = "bad";
    const hoverApplyReplacement = "poor";
    const hoverAppliedSource = hoverApplyFixture.replace(
      hoverApplyOriginal,
      hoverApplyReplacement,
    );
    const hoverApplyUri = vscode.Uri.joinPath(
      texProjectRoot,
      "ai-persistence-hover-apply.tex",
    );
    await vscode.workspace.fs.writeFile(
      hoverApplyUri,
      new TextEncoder().encode(hoverApplyFixture),
    );
    const hoverApplyCacheUri = await writeAiIssueSnapshotForSource(
      globalSnippetUri,
      hoverApplyUri,
      hoverApplyFixture,
      hoverApplyOriginal,
      1,
      hoverApplyReplacement,
      "grammar",
    );
    let hoverApplyDocument = await vscode.workspace.openTextDocument(
      hoverApplyUri,
    );
    if (hoverApplyDocument.languageId !== "latex") {
      hoverApplyDocument = await vscode.languages.setTextDocumentLanguage(
        hoverApplyDocument,
        "latex",
      );
    }
    editor = await vscode.window.showTextDocument(hoverApplyDocument, {
      preview: false,
    });
    const hoverApplyStart = hoverApplyDocument.getText().indexOf(
      hoverApplyOriginal,
    );
    const hoverApplyEnd = hoverApplyStart + hoverApplyOriginal.length;
    await waitFor(
      () => hasTexLeafAiHover(hoverApplyDocument, hoverApplyStart),
      "clickable persisted AI Hover restoration",
    );

    const expectedQuickFixCommands = [
      "texleaf.aiWriting.applyIssue",
      "texleaf.aiWriting.ignoreIssue",
    ];
    for (const [offset, description] of [
      [hoverApplyStart, "issue start"],
      [hoverApplyStart + 1, "issue interior"],
      [hoverApplyEnd - 1, "issue final character"],
      [hoverApplyEnd, "issue end boundary"],
    ]) {
      const actions = await texLeafAiQuickFixes(
        hoverApplyDocument,
        offset,
        offset,
      );
      assert.deepEqual(
        actions.map((action) => action.command?.command).sort(),
        expectedQuickFixCommands,
        `a collapsed cursor at the ${description} must expose Apply and Ignore`,
      );
    }
    for (const [offset, description] of [
      [hoverApplyStart - 1, "character before the issue"],
      [hoverApplyEnd + 1, "character after the issue"],
    ]) {
      assert.deepEqual(
        await texLeafAiQuickFixes(hoverApplyDocument, offset, offset),
        [],
        `a collapsed cursor at the ${description} must not expose TeXLeaf actions`,
      );
    }
    assertSingleAiDiagnostic(
      hoverApplyDocument,
      hoverApplyStart,
      hoverApplyEnd,
      "collapsed-cursor Quick Fixes must share the native Problems diagnostic",
    );

    const quickFixCursor = hoverApplyDocument.positionAt(hoverApplyStart + 1);
    editor.selection = new vscode.Selection(quickFixCursor, quickFixCursor);
    const sourceBeforeEditorQuickFix = hoverApplyDocument.getText();
    await settlesWithin(
      vscode.commands.executeCommand("editor.action.quickFix"),
      "the editor Quick Fix command at a persisted AI issue",
      5_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await settlesWithin(
      vscode.commands.executeCommand("hideCodeActionWidget"),
      "closing the editor Quick Fix widget without accepting an action",
    );
    assert.equal(
      hoverApplyDocument.getText(),
      sourceBeforeEditorQuickFix,
      "opening and dismissing Ctrl+. must not edit the document",
    );

    const hover = await getTexLeafAiHover(
      hoverApplyDocument,
      hoverApplyStart + 1,
    );
    assert.ok(hover, "the restored issue must expose a TeXLeaf Hover");
    const hoverMarkdown = hover.contents.find((content) =>
      typeof content !== "string" && content.value.includes("TeXLeaf AI")
    );
    assert.ok(
      hoverMarkdown,
      "the TeXLeaf Hover must keep its content in one auditable MarkdownString",
    );
    assert.deepEqual(
      hoverMarkdown.isTrusted,
      {
        enabledCommands: [
          "texleaf.aiWriting.applyIssue",
          "texleaf.aiWriting.ignoreIssue",
        ],
      },
      "the Hover must trust only its internal Apply and Ignore commands",
    );
    assert.equal(
      hoverMarkdown.supportThemeIcons,
      true,
      "the Hover action labels must render VS Code theme icons",
    );
    assert.match(hoverMarkdown.value, /应用修改/u);
    assert.match(hoverMarkdown.value, /忽略建议/u);
    const hoverCommandLink = markdownCommandLink(
      hoverMarkdown,
      "texleaf.aiWriting.applyIssue",
    );
    const hoverCommand = commandArgumentsFromLink(hoverCommandLink);
    const hoverIgnoreCommand = commandArgumentsFromLink(markdownCommandLink(
      hoverMarkdown,
      "texleaf.aiWriting.ignoreIssue",
    ));
    const hoverQuickFix = await texLeafAiQuickFix(
      hoverApplyDocument,
      hoverApplyStart,
      hoverApplyEnd,
    );
    assert.ok(hoverQuickFix, "the clickable Hover fixture must retain its Quick Fix");
    assert.deepEqual(
      hoverCommand,
      {
        command: "texleaf.aiWriting.applyIssue",
        arguments: [
          hoverApplyUri.toString(),
          hoverQuickFix.command.arguments[1],
        ],
      },
      "the Hover link must encode only the current document and opaque issue ID",
    );
    assert.deepEqual(
      hoverIgnoreCommand,
      {
        command: "texleaf.aiWriting.ignoreIssue",
        arguments: hoverCommand.arguments,
      },
      "the Ignore link must target the same opaque issue without exposing source text",
    );

    await vscode.commands.executeCommand(
      hoverCommand.command,
      ...hoverCommand.arguments,
    );
    await waitFor(
      () => hoverApplyDocument.getText() === hoverAppliedSource,
      "the real Hover apply command to edit the exact persisted issue",
    );
    await waitFor(
      async () => !(
        await hasTexLeafAiHover(hoverApplyDocument, hoverApplyStart)
      ),
      "the accepted Hover issue to disappear",
    );
    await waitFor(
      () => texLeafAiDiagnostics(hoverApplyDocument).length === 0,
      "the accepted native Problems diagnostic to disappear",
    );
    assert.equal(
      await hasTexLeafAiQuickFix(
        hoverApplyDocument,
        hoverApplyStart,
        hoverApplyStart + hoverApplyReplacement.length,
      ),
      false,
      "the accepted Hover issue must no longer expose a Quick Fix",
    );
    await waitFor(async () => {
      try {
        const record = JSON.parse(new TextDecoder().decode(
          await vscode.workspace.fs.readFile(hoverApplyCacheUri),
        ));
        return record.sourceLength === hoverAppliedSource.length &&
          record.sourceHash === createHash("sha256")
            .update(hoverAppliedSource, "utf8")
            .digest("hex") &&
          Array.isArray(record.issues) &&
          record.issues.length === 0;
      } catch {
        return false;
      }
    }, "durable removal of the issue accepted through its Hover link");
    await vscode.commands.executeCommand(
      hoverCommand.command,
      ...hoverCommand.arguments,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      hoverApplyDocument.getText(),
      hoverAppliedSource,
      "replaying a consumed Hover command link must not apply the replacement twice",
    );

    // A retained issue keeps the same user-facing lineage even when an edit
    // before it changes every absolute offset. Hold the actual Tree node from
    // the preceding snapshot, shift the issue, and invoke the real Tree
    // wrapper after the controller has remapped its live range. The nested
    // prefix-style correction can itself be reported by VS Code as a single
    // insertion at the old issue's right edge (`one take` -> `one takes`).
    const prefixApplyFixture = "Note that one take the limit.";
    const prefixApplyOriginal = "one take";
    const prefixApplyReplacement = "one takes";
    const retainedPrefix = "Earlier context. ";
    const prefixAppliedSource = `${retainedPrefix}${prefixApplyFixture.replace(
      prefixApplyOriginal,
      prefixApplyReplacement,
    )}`;
    const prefixApplyUri = vscode.Uri.joinPath(
      texProjectRoot,
      "ai-persistence-prefix-apply.tex",
    );
    await vscode.workspace.fs.writeFile(
      prefixApplyUri,
      new TextEncoder().encode(prefixApplyFixture),
    );
    const prefixApplyCacheUri = await writeAiIssueSnapshotForSource(
      globalSnippetUri,
      prefixApplyUri,
      prefixApplyFixture,
      prefixApplyOriginal,
      1,
      prefixApplyReplacement,
      "grammar",
    );
    let prefixApplyDocument = await vscode.workspace.openTextDocument(prefixApplyUri);
    if (prefixApplyDocument.languageId !== "latex") {
      prefixApplyDocument = await vscode.languages.setTextDocumentLanguage(
        prefixApplyDocument,
        "latex",
      );
    }
    editor = await vscode.window.showTextDocument(prefixApplyDocument, {
      preview: false,
    });
    const prefixApplyStart = prefixApplyDocument.getText().indexOf(
      prefixApplyOriginal,
    );
    await waitFor(
      () => hasTexLeafAiHover(prefixApplyDocument, prefixApplyStart),
      "prefix-style persisted AI issue restoration",
    );
    let prefixQuickFix;
    await waitFor(async () => {
      prefixQuickFix = await texLeafAiQuickFix(
        prefixApplyDocument,
        prefixApplyStart,
        prefixApplyStart + prefixApplyOriginal.length,
      );
      return prefixQuickFix !== undefined;
    }, "prefix-style AI Quick Fix");
    assert.equal(
      prefixQuickFix.command?.command,
      "texleaf.aiWriting.applyIssue",
      "the prefix-style regression must invoke TeXLeaf's real apply command",
    );
    const prefixIssueId = prefixQuickFix.command.arguments?.[1];
    assert.equal(
      typeof prefixIssueId,
      "string",
      "the real Quick Fix must expose an opaque issue ID to the Tree wrapper",
    );
    const stalePrefixTreeNode = {
      kind: "issue",
      id: `texleaf-ai-issue:${prefixApplyUri.toString()}:${prefixIssueId}`,
      uriText: prefixApplyUri.toString(),
      issue: {
        id: prefixIssueId,
        range: new vscode.Range(
          prefixApplyDocument.positionAt(prefixApplyStart),
          prefixApplyDocument.positionAt(
            prefixApplyStart + prefixApplyOriginal.length,
          ),
        ),
        original: prefixApplyOriginal,
        replacement: prefixApplyReplacement,
        message: "建议修改用词",
        explanation: "这里使用更准确的表达。",
        category: "grammar",
        severity: vscode.DiagnosticSeverity.Warning,
      },
    };
    const versionBeforeRemap = prefixApplyDocument.version;
    const remapped = await editor.edit((builder) => {
      builder.insert(prefixApplyDocument.positionAt(0), retainedPrefix);
    });
    assert.equal(remapped, true, "the stale Tree fixture prefix insertion failed");
    await waitFor(
      () => prefixApplyDocument.version > versionBeforeRemap,
      "the retained issue document version to advance",
    );
    const remappedPrefixApplyStart = prefixApplyStart + retainedPrefix.length;
    let remappedQuickFix;
    await waitFor(async () => {
      remappedQuickFix = await texLeafAiQuickFix(
        prefixApplyDocument,
        remappedPrefixApplyStart,
        remappedPrefixApplyStart + prefixApplyOriginal.length,
      );
      return remappedQuickFix !== undefined;
    }, "the retained issue Quick Fix after an earlier insertion");
    assert.equal(
      remappedQuickFix.command?.arguments?.[1],
      prefixIssueId,
      "a safely retained issue must keep its Tree command lineage across offset remapping",
    );
    const versionAfterFirstRemap = prefixApplyDocument.version;
    const restoredSameSource = await editor.edit((builder) => {
      builder.delete(new vscode.Range(
        prefixApplyDocument.positionAt(0),
        prefixApplyDocument.positionAt(retainedPrefix.length),
      ));
    });
    assert.equal(
      restoredSameSource,
      true,
      "the same-source Tree lineage fixture prefix deletion failed",
    );
    await waitFor(
      () => prefixApplyDocument.version > versionAfterFirstRemap &&
        prefixApplyDocument.getText() === prefixApplyFixture,
      "the document to return to the same source at a later version",
    );
    let sameSourceQuickFix;
    await waitFor(async () => {
      sameSourceQuickFix = await texLeafAiQuickFix(
        prefixApplyDocument,
        prefixApplyStart,
        prefixApplyStart + prefixApplyOriginal.length,
      );
      return sameSourceQuickFix !== undefined;
    }, "the retained Quick Fix at the later same-source version");
    assert.equal(
      sameSourceQuickFix?.command?.arguments?.[1],
      prefixIssueId,
      "a later document version with identical source must keep the old Tree lineage actionable",
    );
    const versionBeforeFinalRemap = prefixApplyDocument.version;
    const finalRemap = await editor.edit((builder) => {
      builder.insert(prefixApplyDocument.positionAt(0), retainedPrefix);
    });
    assert.equal(finalRemap, true, "the final stale Tree fixture remap failed");
    await waitFor(
      () => prefixApplyDocument.version > versionBeforeFinalRemap,
      "the final retained issue version to advance",
    );
    await waitFor(async () => {
      remappedQuickFix = await texLeafAiQuickFix(
        prefixApplyDocument,
        remappedPrefixApplyStart,
        remappedPrefixApplyStart + prefixApplyOriginal.length,
      );
      return remappedQuickFix?.command?.arguments?.[1] === prefixIssueId;
    }, "the stable Tree lineage after the final offset remap");
    const revealCursor = prefixApplyDocument.positionAt(
      prefixApplyDocument.getText().length,
    );
    editor.selection = new vscode.Selection(revealCursor, revealCursor);
    const selectionBeforeTreeReveal = {
      anchor: prefixApplyDocument.offsetAt(editor.selection.anchor),
      active: prefixApplyDocument.offsetAt(editor.selection.active),
    };
    await settlesWithin(
      vscode.commands.executeCommand(
        "texleaf.aiIssues.reveal",
        stalePrefixTreeNode,
      ),
      "Tree reveal of a stable issue after offset remapping",
      5_000,
    );
    assert.deepEqual(
      {
        anchor: prefixApplyDocument.offsetAt(editor.selection.anchor),
        active: prefixApplyDocument.offsetAt(editor.selection.active),
      },
      selectionBeforeTreeReveal,
      "Tree reveal must scroll/highlight the live remapped issue without moving the cursor",
    );
    await vscode.commands.executeCommand(
      "texleaf.aiIssues.apply",
      stalePrefixTreeNode,
    );
    await waitFor(
      () => prefixApplyDocument.getText() === prefixAppliedSource,
      "stale Tree node application against the retained live issue",
    );
    await waitFor(
      async () => !(
        await hasTexLeafAiHover(prefixApplyDocument, remappedPrefixApplyStart)
      ),
      "consumed prefix-style AI Hover",
    );
    assert.equal(
      await hasTexLeafAiQuickFix(
        prefixApplyDocument,
        remappedPrefixApplyStart,
        remappedPrefixApplyStart + prefixApplyReplacement.length,
      ),
      false,
      "an accepted prefix-style issue must no longer expose a Quick Fix",
    );
    await vscode.commands.executeCommand(
      "texleaf.aiIssues.apply",
      stalePrefixTreeNode,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      prefixApplyDocument.getText(),
      prefixAppliedSource,
      "replaying a consumed stale Tree node must not append a second suffix",
    );
    await waitFor(async () => {
      try {
        const record = JSON.parse(new TextDecoder().decode(
          await vscode.workspace.fs.readFile(prefixApplyCacheUri),
        ));
        return record.sourceLength === prefixAppliedSource.length &&
          record.sourceHash === createHash("sha256")
            .update(prefixAppliedSource, "utf8")
            .digest("hex") &&
          Array.isArray(record.issues) &&
          record.issues.length === 0;
      } catch {
        return false;
      }
    }, "durable removal of the accepted prefix-style AI issue");

    await persistenceConfiguration.update(
      "aiWriting.enabled",
      false,
      vscode.ConfigurationTarget.Global,
    );
    await waitFor(
      () => vscode.workspace
        .getConfiguration("texleaf", reopenedPersistenceDocument.uri)
        .get("aiWriting.enabled") === false,
      "AI persistence fixture disablement",
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const disabledUri = vscode.Uri.joinPath(
      texProjectRoot,
      "ai-persistence-disabled.tex",
    );
    await vscode.workspace.fs.writeFile(
      disabledUri,
      new TextEncoder().encode(persistenceFixture),
    );
    await writeAiIssueSnapshotForSource(
      globalSnippetUri,
      disabledUri,
      persistenceFixture,
      "bad",
    );
    reopenedPersistenceDocument = await vscode.workspace.openTextDocument(disabledUri);
    if (reopenedPersistenceDocument.languageId !== "latex") {
      reopenedPersistenceDocument = await vscode.languages.setTextDocumentLanguage(
        reopenedPersistenceDocument,
        "latex",
      );
    }
    editor = await vscode.window.showTextDocument(reopenedPersistenceDocument, {
      preview: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      await hasTexLeafAiHover(reopenedPersistenceDocument, badStart),
      false,
      "disabled AI must not restore or expose a stale cached Hover",
    );
    assert.equal(
      await hasTexLeafAiQuickFix(
        reopenedPersistenceDocument,
        badStart,
        badStart + 3,
      ),
      false,
      "disabled AI must not expose a cached Quick Fix hidden from the issue tree",
    );

    const closedCacheUri = vscode.Uri.joinPath(
      texProjectRoot,
      "ai-persistence-closed.tex",
    );
    await vscode.workspace.fs.writeFile(
      closedCacheUri,
      new TextEncoder().encode(persistenceFixture),
    );
    const closedRecordUri = await writeAiIssueSnapshotForSource(
      globalSnippetUri,
      closedCacheUri,
      persistenceFixture,
      "bad",
    );
    await persistenceConfiguration.update(
      "aiWriting.enabled",
      true,
      vscode.ConfigurationTarget.Global,
    );
    await waitFor(
      () => vscode.workspace
        .getConfiguration("texleaf", document.uri)
        .get("aiWriting.enabled") === true,
      "closed-document global cache invalidation",
    );
    await waitFor(async () => {
      try {
        await vscode.workspace.fs.stat(closedRecordUri);
        return false;
      } catch {
        return true;
      }
    }, "closed-document AI cache file deletion");
    reopenedPersistenceDocument = await vscode.workspace.openTextDocument(closedCacheUri);
    if (reopenedPersistenceDocument.languageId !== "latex") {
      reopenedPersistenceDocument = await vscode.languages.setTextDocumentLanguage(
        reopenedPersistenceDocument,
        "latex",
      );
    }
    editor = await vscode.window.showTextDocument(reopenedPersistenceDocument, {
      preview: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
      await hasTexLeafAiHover(reopenedPersistenceDocument, badStart),
      false,
      "a global AI setting change must clear cached issues for closed documents too",
    );

    const nativeProblemVisualFixture = "This visual problem is bad.";
    const nativeProblemVisualUri = vscode.Uri.joinPath(
      texProjectRoot,
      "ai-native-problems-visual-route.tex",
    );
    await vscode.workspace.fs.writeFile(
      nativeProblemVisualUri,
      new TextEncoder().encode(nativeProblemVisualFixture),
    );
    await writeAiIssueSnapshotForSource(
      globalSnippetUri,
      nativeProblemVisualUri,
      nativeProblemVisualFixture,
      "bad",
    );
    let nativeProblemVisualDocument = await vscode.workspace.openTextDocument(
      nativeProblemVisualUri,
    );
    if (nativeProblemVisualDocument.languageId !== "latex") {
      nativeProblemVisualDocument = await vscode.languages.setTextDocumentLanguage(
        nativeProblemVisualDocument,
        "latex",
      );
    }
    const nativeProblemBadStart = nativeProblemVisualDocument.getText().indexOf("bad");
    await waitFor(
      () => texLeafAiDiagnostics(nativeProblemVisualDocument).length === 1,
      "native Problems diagnostic for visual navigation",
    );
    const nativeProblemEntry = texLeafAiDiagnosticEntries(nativeProblemVisualDocument)[0];
    assert.ok(nativeProblemEntry, "the native Problems navigation diagnostic must exist");
    assert.equal(
      nativeProblemEntry.uri.scheme,
      "texleaf-ai-problem",
      "AI Problems navigation must publish on the selectable read-only mirror",
    );
    assert.equal(
      nativeProblemVisualDocument.offsetAt(nativeProblemEntry.diagnostic.range.start),
      nativeProblemBadStart,
      "the Problems diagnostic must preserve the exact source offset",
    );
    await vscode.commands.executeCommand(
      "vscode.openWith",
      nativeProblemVisualUri,
      "texleaf.visualEditor",
      { preview: false, viewColumn: vscode.ViewColumn.One },
    );
    await waitFor(
      () =>
        vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType ===
        "texleaf.visualEditor",
      "the visual editor before simulating a native Problems click",
    );
    const nativeProblemMirrorDocument = await vscode.workspace.openTextDocument(
      nativeProblemEntry.uri,
    );
    const nativeProblemSourceEditor = await vscode.window.showTextDocument(
      nativeProblemMirrorDocument,
      {
        viewColumn: vscode.ViewColumn.Two,
        preview: false,
        preserveFocus: false,
      },
    );
    const nativeProblemPosition = nativeProblemEntry.diagnostic.range.start;
    nativeProblemSourceEditor.selection = new vscode.Selection(
      nativeProblemPosition,
      nativeProblemPosition,
    );
    await waitFor(
      () =>
        vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType ===
        "texleaf.visualEditor",
      "a native Problems selection to return to the existing visual editor",
    );
    assert.notEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      nativeProblemEntry.uri.toString(),
      "the read-only Problems mirror must not remain active",
    );
    assert.equal(
      vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => {
        const input = tab.input;
        return input instanceof vscode.TabInputText &&
          input.uri.toString() === nativeProblemEntry.uri.toString();
      })),
      false,
      "the transient Problems mirror tab must close after the visual redirect",
    );

    // The explicit source-mode toolbar/command must remain an escape hatch and
    // must not be mistaken for another Problems navigation on the same issue.
    await vscode.commands.executeCommand("texleaf.visualEditor.openSource");
    await waitFor(
      () => vscode.window.activeTextEditor?.document.uri.toString() ===
        nativeProblemVisualUri.toString(),
      "explicit source mode after a native Problems visual redirect",
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      nativeProblemVisualUri.toString(),
      "explicit source mode must not be redirected back to the visual editor",
    );
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await vscode.commands.executeCommand("texleaf.aiWriting.clearDiagnostics");

    await persistenceConfiguration.update(
      "aiWriting.enabled",
      false,
      vscode.ConfigurationTarget.Global,
    );

    const defaultModeConfiguration = vscode.workspace.getConfiguration("texleaf");
    const previousDefaultMode = defaultModeConfiguration.inspect(
      "visualEditor.defaultMode",
    )?.globalValue;
    const visualModeWorkbenchConfiguration = vscode.workspace.getConfiguration("workbench");
    const previousEditorAssociations = visualModeWorkbenchConfiguration.inspect(
      "editorAssociations",
    )?.globalValue;
    await defaultModeConfiguration.update(
      "visualEditor.defaultMode",
      "source",
      vscode.ConfigurationTarget.Global,
    );
    await waitFor(
      () => vscode.workspace.getConfiguration("workbench").get(
        "editorAssociations",
      )?.["*.tex"] === "default",
      "the default source-editor association setting",
    );
    await defaultModeConfiguration.update(
      "visualEditor.defaultMode",
      "visual",
      vscode.ConfigurationTarget.Global,
    );
    await waitFor(
      () => vscode.workspace.getConfiguration("workbench").get(
        "editorAssociations",
      )?.["*.tex"] === "texleaf.visualEditor",
      "the default visual-editor association setting",
    );
    await defaultModeConfiguration.update(
      "visualEditor.defaultMode",
      previousDefaultMode,
      vscode.ConfigurationTarget.Global,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await visualModeWorkbenchConfiguration.update(
      "editorAssociations",
      previousEditorAssociations,
      vscode.ConfigurationTarget.Global,
    );

    const visualEditorUri = vscode.Uri.joinPath(
      testRoot,
      "visual-editor-smoke.tex",
    );
    const visualEditorSource = [
      "\\documentclass{article}",
      "\\begin{document}",
      "A visual formula $x^2+y^2=z^2$ remains in the same document.",
      "\\[\\frac{1}{2}\\]",
      "\\end{document}",
      "",
    ].join("\n");
    await vscode.workspace.fs.writeFile(
      visualEditorUri,
      new TextEncoder().encode(visualEditorSource),
    );
    const visualEditorDocument = await vscode.workspace.openTextDocument(
      visualEditorUri,
    );
    await vscode.commands.executeCommand(
      "vscode.openWith",
      visualEditorUri,
      "texleaf.visualEditor",
      { preview: false, viewColumn: vscode.ViewColumn.One },
    );
    await waitFor(
      () =>
        vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType ===
        "texleaf.visualEditor",
      "the registered TeXLeaf visual custom editor",
    );
    const sourceEditor = await vscode.window.showTextDocument(
      visualEditorDocument,
      {
        viewColumn: vscode.ViewColumn.Two,
        preview: false,
        preserveFocus: false,
      },
    );
    assert.strictEqual(
      sourceEditor.document,
      visualEditorDocument,
      "source and visual views must share the canonical TextDocument object",
    );
    await waitFor(
      () => {
        const matchingTabs = vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter(
            (tab) => tab.input?.uri?.toString() === visualEditorUri.toString(),
          );
        return matchingTabs.some(
          (tab) => tab.input?.viewType === "texleaf.visualEditor",
        ) && matchingTabs.some(
          (tab) => tab.input?.viewType === undefined,
        );
      },
      "simultaneously open visual and native source views for one URI",
    );

    // Allow a newly opened background webview to finish its first paint.
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.strictEqual(vscode.window.activeTextEditor, sourceEditor,
      "late visual initialization must not steal native source focus");
    const sourceWordOffset = visualEditorDocument.getText().indexOf("visual");
    const versionBeforeSourceEdit = visualEditorDocument.version;
    assert.equal(
      await sourceEditor.edit(
        (builder) => {
          builder.insert(
            visualEditorDocument.positionAt(sourceWordOffset),
            "synchronized ",
          );
        },
        { undoStopBefore: true, undoStopAfter: true },
      ),
      true,
      "the native source view must edit the shared visual-editor document",
    );
    await waitFor(
      () =>
        visualEditorDocument.version > versionBeforeSourceEdit &&
        visualEditorDocument.getText().includes(
          "A synchronized visual formula",
        ),
      "a source-view edit to reach the shared visual-editor TextDocument",
    );
    assert.equal(
      visualEditorDocument.isDirty,
      true,
      "source edits must expose one shared dirty state",
    );

    await vscode.commands.executeCommand("undo");
    await waitFor(
      () =>
        visualEditorDocument.getText().includes("A visual formula") &&
        !visualEditorDocument.getText().includes("synchronized visual"),
      "native undo to update the shared visual-editor document",
    );
    await vscode.commands.executeCommand("redo");
    await waitFor(
      () =>
        visualEditorDocument.getText().includes(
          "A synchronized visual formula",
        ),
      "native redo to update the shared visual-editor document",
    );

    // The visual editor uses the same WorkspaceEdit primitive after validating
    // each versioned CodeMirror message. This also exercises a non-editor
    // external change while both views remain open.
    const sharedEdit = new vscode.WorkspaceEdit();
    sharedEdit.insert(
      visualEditorUri,
      visualEditorDocument.positionAt(
        visualEditorDocument.getText().indexOf("visual"),
      ),
      "live ",
    );
    assert.equal(await vscode.workspace.applyEdit(sharedEdit), true);
    await waitFor(
      () =>
        visualEditorDocument.getText().includes(
          "A synchronized live visual formula",
        ),
      "an external TextDocument edit shared with the visual editor",
    );
    assert.equal(
      await visualEditorDocument.save(),
      true,
      "saving either view must save the canonical visual-editor document",
    );
    await waitFor(
      () => !visualEditorDocument.isDirty,
      "the shared dirty state to clear after save",
    );
    assert.equal(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(visualEditorUri),
      ),
      visualEditorDocument.getText(),
      "disk, source view, and visual view must converge on one saved text",
    );

    await vscode.commands.executeCommand(
      "vscode.openWith",
      visualEditorUri,
      "texleaf.visualEditor",
      { preview: false, viewColumn: vscode.ViewColumn.One },
    );
    await waitFor(
      () =>
        vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType ===
        "texleaf.visualEditor",
      "the existing visual editor tab before testing its source bridge",
    );
    await vscode.commands.executeCommand("texleaf.visualEditor.openSource");
    await waitFor(
      () => vscode.window.activeTextEditor?.document.uri.toString() ===
        visualEditorUri.toString(),
      "the visual editor source-mode bridge",
    );
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

    assert.deepEqual(
      await vscode.workspace.fs.readFile(legacyWorkspaceSnippetUri),
      legacyWorkspaceSnippetBefore,
      "activation must not modify or delete the legacy workspace snippet file",
    );

    console.log(
      "Extension-host smoke test passed: simultaneous visual/source TextDocument identity, bidirectional document synchronization contract, shared dirty/save/undo/redo state and source bridge, grouped native settings, default-off and persisted AI writing gates/clear/reopen, collapsed-cursor Quick Fix and safe Hover apply, worker-backed Math Preview/toggle/safe SVG, ranked/capped native citation completion with stale-snapshot and duplicate-key guards, complete global factory seeding, one-time migration/backup, no hidden built-ins, watcher reload/LKG, dirty import/export/restore guards, Qhat/IME, per-root extras, .tex/.bib scope, fractions, LF/CRLF align shortcuts, and safe left/right Enter splitting work.",
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
