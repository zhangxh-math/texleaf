import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { renderSnippetManagerWebview } from "../src/snippetManagerWebview";

test("integrated manager Webview is CSP locked and its script parses", () => {
  const nonce = "unit-test-nonce";
  const html = renderSnippetManagerWebview(nonce);
  assert.match(
    html,
    new RegExp(`default-src 'none'.*style-src 'nonce-${nonce}'.*script-src 'nonce-${nonce}'`, "u"),
  );
  assert.doesNotMatch(html, /https?:|<script\s+src=|innerHTML\s*=/u);
  assert.doesNotMatch(html, /globalStorage|texleaf-snippets\.jsonc/u);

  const script = new RegExp(
    `<script nonce="${nonce}">([\\s\\S]*?)<\\/script>`,
    "u",
  ).exec(html)?.[1];
  assert.ok(script);
  assert.doesNotMatch(
    script,
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u,
    "rendered manager script must not contain embedded control characters",
  );
  assert.match(
    script,
    /\/\[\\s\\u0000-\\u001f\\u007f\]\/u/u,
    "template trigger validation must reach Chromium as escaped RegExp source",
  );
  assert.doesNotThrow(() => new Function(script));
});

test("integrated manager exposes structured CRUD, search, replace, and CAS messages", () => {
  const html = renderSnippetManagerWebview("features");
  for (const expected of [
    'id="search"',
    'id="snippet-trigger"',
    'id="snippet-replacement"',
    'id="template-trigger"',
    'id="template-content"',
    'id="find-replace"',
    'id="replace-preview"',
    'id="undo"',
    'send("saveLibrary"',
    'send("saveTemplates"',
    'send("restoreTemplates"',
    "expectedRevision",
    "protocol: 1",
    "Replacement 不能超过 1000000 个字符",
    "10000000",
    "state.library && anyDirty() && (message.requestId === null",
  ]) {
    assert.ok(html.includes(expected), `missing manager feature marker: ${expected}`);
  }
});

test("manager forms keep controls aligned and collapse to one column when narrow", () => {
  const html = renderSnippetManagerWebview("form-layout");

  for (const expected of [
    "container-name: editor-pane",
    "grid-template-columns: repeat(6, minmax(0, 1fr))",
    ".form-span-full { grid-column: 1 / -1; }",
    ".form-span-half { grid-column: span 3; }",
    ".form-span-third { grid-column: span 2; }",
    "align-content: start",
    "height: 32px",
    "line-height: 1.45",
    "@container editor-pane (max-width: 560px)",
    'class="field form-span-full">\n              <label for="snippet-replacement"',
    'class="field form-span-full">\n              <label for="snippet-description"',
    'class="field form-span-full">\n              <label for="template-description"',
    'class="field form-span-full">\n              <label for="template-content"',
    'aria-describedby="snippet-options-help"',
    'aria-describedby="template-trigger-help"',
  ]) {
    assert.ok(html.includes(expected), `missing form layout marker: ${expected}`);
  }

  assert.match(
    html,
    /\.field\s*\{[\s\S]*?align-self: start;[\s\S]*?align-content: start;[\s\S]*?min-width: 0;/u,
  );
  assert.match(
    html,
    /@container editor-pane \(max-width: 560px\)\s*\{\s*\.form-span-half, \.form-span-third \{ grid-column: 1 \/ -1; \}/u,
  );
});

test("saving one manager page cannot mark the other page clean before Webview acknowledgement", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "snippetEditorPanel.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /readonly type: "save"|saveFromPanel|case "save"/u);
  for (const [startMarker, endMarker] of [
    ["private async saveLibraryFromPanel", "private async saveTemplatesFromPanel"],
    ["private async saveTemplatesFromPanel", "private async runManagerCommand"],
  ] as const) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `missing method boundary: ${startMarker}`);
    assert.doesNotMatch(
      source.slice(start, end),
      /session\.webviewDirty\s*=\s*false/u,
      `${startMarker} must wait for the Webview's recomputed anyDirty notification`,
    );
  }
  assert.match(
    renderSnippetManagerWebview("dirty-race"),
    /state\.undo = state\.undo\.filter\(\(entry\) => entry\.active !== "snippets"\)[\s\S]*state\.undo = state\.undo\.filter\(\(entry\) => entry\.active !== "templates"\)/u,
  );
});

test("manager handshake retries ready until content and host deduplicates retries", () => {
  const html = renderSnippetManagerWebview("ready-retry");
  assert.match(html, /const announceReady = \(\) => \{[\s\S]*send\("ready"\)/u);
  assert.match(html, /readyTimer = setInterval\(announceReady, 750\)/u);
  assert.match(
    html,
    /contentReceived = true;[\s\S]*clearInterval\(readyTimer\)/u,
  );
  assert.match(
    html,
    /message\.action === "reload" && !message\.ok[\s\S]*重新尝试载入/u,
  );

  const host = readFileSync(
    path.join(process.cwd(), "src", "snippetEditorPanel.ts"),
    "utf8",
  );
  assert.match(
    host,
    /if \(parsed\.type === "ready"\) \{[\s\S]*session\.ready = true;[\s\S]*this\.loadIntoPanel\(session, null\)/u,
  );
  assert.match(host, /MANAGER_LOAD_TIMEOUT_MS = 15_000/u);
  assert.match(host, /withTimeout\([\s\S]*Promise\.all\(/u);
  const receiveStart = host.indexOf(
    "panel.webview.onDidReceiveMessage((message: unknown)",
  );
  const dirtyStart = host.indexOf(
    "// Dirty notifications are intentionally applied immediately",
    receiveStart,
  );
  assert.ok(receiveStart >= 0 && dirtyStart > receiveStart);
  const handshakeBlock = host.slice(receiveStart, dirtyStart);
  assert.match(handshakeBlock, /session\.ready\) \{\s*return;/u);
});

test("manager script boots against the Webview DOM and immediately announces ready", () => {
  const nonce = "boot";
  const html = renderSnippetManagerWebview(nonce);
  const script = new RegExp(
    `<script nonce="${nonce}">([\\s\\S]*?)<\\/script>`,
    "u",
  ).exec(html)?.[1];
  assert.ok(script);

  class FakeElement {
    public disabled = false;
    public hidden = false;
    public value = "";
    public checked = false;
    public type = "";
    public dataset: Record<string, string> = {};
    public addEventListener(): void {}
    public closest(): null {
      return null;
    }
  }
  const elements = new Map<string, FakeElement>();
  const element = (id: string): FakeElement => {
    const existing = elements.get(id);
    if (existing !== undefined) return existing;
    const created = new FakeElement();
    elements.set(id, created);
    return created;
  };
  const posted: unknown[] = [];
  const intervals: number[] = [];
  const context = {
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => posted.push(message) }),
    document: {
      getElementById: (id: string) => element(id),
      querySelectorAll: () => [],
      addEventListener: () => undefined,
    },
    window: { addEventListener: () => undefined },
    setInterval: (_callback: () => void, delay: number) => {
      intervals.push(delay);
      return 1;
    },
    clearInterval: () => undefined,
    TextEncoder,
    console,
  };
  assert.doesNotThrow(() => runInNewContext(script, context));
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [
    { protocol: 1, type: "ready" },
  ]);
  assert.deepEqual(intervals, [750]);
});

test("bulk replace is fail-closed while a save or reload is busy", () => {
  const html = renderSnippetManagerWebview("replace-busy");
  assert.match(
    html,
    /function applyReplacement\(\) \{\s*if \(state\.busy\) \{/u,
  );
  assert.match(
    html,
    /byId\("replace-apply"\)\.disabled = state\.busy \|\| plan\.count === 0/u,
  );
  assert.match(
    html,
    /document\.querySelectorAll\("input, textarea, select"\)[\s\S]*node\.disabled = value/u,
  );
  assert.match(
    html,
    /if \(!value && !byId\("replace-panel"\)\.hidden\) updateReplacePreview\(\)/u,
  );
});
