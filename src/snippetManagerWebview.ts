/**
 * Static, CSP-locked markup for the integrated Snippet/template manager.
 *
 * User content is never interpolated into this string. The Webview receives it
 * through postMessage and writes it only through DOM value/textContent APIs.
 */
export function renderSnippetManagerWebview(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TeXLeaf 片段与模板管理器</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font: var(--vscode-font-size) var(--vscode-font-family);
    }
    button, input, textarea, select { font: inherit; }
    button {
      min-height: 28px;
      border: 1px solid transparent;
      border-radius: 3px;
      padding: 4px 10px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    button.danger {
      color: var(--vscode-errorForeground);
      background: transparent;
      border-color: var(--vscode-errorForeground);
    }
    button:disabled { cursor: default; opacity: .55; }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      padding: 6px 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
    }
    input:focus, textarea:focus, select:focus, button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    textarea {
      resize: vertical;
      min-height: 92px;
      font-family: var(--vscode-editor-font-family, monospace);
      line-height: 1.45;
      tab-size: 2;
    }
    .shell {
      display: grid;
      grid-template-rows: auto auto auto minmax(0, 1fr) auto;
      min-height: 100vh;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 20px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    h1 { margin: 0 0 4px; font-size: 1.3rem; }
    .subtitle {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }
    .actions, .toolbar, .row-actions, .replace-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 7px;
    }
    .tabs {
      display: flex;
      gap: 2px;
      padding: 0 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .tab {
      border-radius: 0;
      padding: 9px 14px;
      color: var(--vscode-foreground);
      background: transparent;
      border-bottom: 2px solid transparent;
    }
    .tab.active {
      border-bottom-color: var(--vscode-focusBorder);
      color: var(--vscode-textLink-foreground);
    }
    .toolbar {
      padding: 10px 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    .toolbar .search { min-width: 220px; flex: 1 1 320px; }
    .toolbar select { width: auto; min-width: 125px; }
    .workspace {
      display: grid;
      grid-template-columns: minmax(250px, 34%) minmax(360px, 1fr);
      min-height: 0;
    }
    .list-pane {
      min-width: 0;
      overflow: auto;
      border-right: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    .list-summary {
      position: sticky;
      top: 0;
      z-index: 2;
      padding: 7px 11px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .items { list-style: none; margin: 0; padding: 0; }
    .item {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 4px 8px;
      min-height: 52px;
      padding: 8px 11px;
      text-align: left;
      border: 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      border-radius: 0;
      color: var(--vscode-foreground);
      background: transparent;
    }
    .item:hover { background: var(--vscode-list-hoverBackground) !important; }
    .item.selected {
      color: var(--vscode-list-activeSelectionForeground);
      background: var(--vscode-list-activeSelectionBackground) !important;
    }
    .item-title {
      overflow: hidden;
      font-family: var(--vscode-editor-font-family, monospace);
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-meta, .item-detail {
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      font-size: .9em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item.selected .item-meta, .item.selected .item-detail {
      color: inherit;
      opacity: .82;
    }
    .badge {
      align-self: start;
      border-radius: 10px;
      padding: 1px 6px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      font-size: .82em;
    }
    .badge.off { opacity: .62; }
    .badge.warning {
      color: var(--vscode-editorWarning-foreground);
      background: transparent;
      border: 1px solid currentColor;
    }
    .editor-pane {
      min-width: 0;
      overflow: auto;
      padding: 17px 20px 28px;
      container-name: editor-pane;
      container-type: inline-size;
    }
    .empty {
      max-width: 560px;
      margin: 70px auto;
      color: var(--vscode-descriptionForeground);
      text-align: center;
    }
    .form {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
      max-width: 960px;
    }
    .form h2 { margin: 0; font-size: 1.1rem; }
    .grow { flex: 1; }
    .template-content { min-height: 420px; }
    .form-fields {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      align-items: start;
      gap: 16px;
    }
    .form-span-full { grid-column: 1 / -1; }
    .form-span-half { grid-column: span 3; }
    .form-span-third { grid-column: span 2; }
    .field {
      display: grid;
      align-self: start;
      align-content: start;
      gap: 6px;
      min-width: 0;
    }
    .field > label, .field-label {
      display: flex;
      align-items: center;
      min-height: 20px;
      font-weight: 600;
      line-height: 20px;
    }
    .field > input, .field > select {
      height: 32px;
      min-height: 32px;
    }
    .field-help {
      display: block;
      color: var(--vscode-descriptionForeground);
      font-size: .9em;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .field-check .check {
      min-height: 32px;
      padding: 0 2px;
    }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; align-items: start; gap: 12px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: start; gap: 12px; }
    .check {
      display: flex;
      align-items: center;
      gap: 7px;
      font-weight: 600;
    }
    .check input { width: auto; }
    .validation {
      border-left: 3px solid var(--vscode-editorInfo-foreground);
      padding: 8px 10px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-textBlockQuote-background);
    }
    .validation.error {
      border-left-color: var(--vscode-errorForeground);
      color: var(--vscode-errorForeground);
    }
    .validation.warning {
      border-left-color: var(--vscode-editorWarning-foreground);
      color: var(--vscode-editorWarning-foreground);
    }
    .replace-panel {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(0, 0, 0, .38);
    }
    .replace-panel[hidden] { display: none; }
    .replace-card {
      width: min(760px, 100%);
      max-height: min(700px, calc(100vh - 48px));
      overflow: auto;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      padding: 16px;
      background: var(--vscode-editorWidget-background);
      box-shadow: 0 8px 28px var(--vscode-widget-shadow);
    }
    .replace-card h2 { margin: 0 0 13px; }
    .scope-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 7px;
      margin: 11px 0;
    }
    .preview {
      max-height: 240px;
      overflow: auto;
      margin: 10px 0;
      padding: 7px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }
    .preview-row {
      padding: 5px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    footer {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      min-height: 34px;
      padding: 8px 20px;
      border-top: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
    }
    #status.success { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
    #status.warning { color: var(--vscode-editorWarning-foreground); }
    #status.error { color: var(--vscode-errorForeground); }
    [hidden] { display: none !important; }
    @container editor-pane (max-width: 560px) {
      .form-span-half, .form-span-third { grid-column: 1 / -1; }
    }
    @media (max-width: 760px) {
      header { flex-direction: column; }
      .workspace { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 38vh) minmax(0, 1fr); }
      .list-pane { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); }
      .grid-2, .grid-3 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div>
        <h1>TeXLeaf 片段与模板管理器</h1>
        <p id="target" class="subtitle">正在载入当前 VS Code Profile 的内部库…</p>
      </div>
      <div class="actions">
        <button id="save" disabled>保存当前页</button>
        <button id="reload" class="secondary" disabled>撤销未保存修改</button>
        <button id="import" class="secondary" disabled>导入…</button>
        <button id="export" class="secondary" disabled>导出…</button>
        <button id="advanced-json" class="secondary" disabled>高级 JSONC</button>
      </div>
    </header>

    <nav class="tabs" aria-label="管理类型">
      <button id="tab-snippets" class="tab active" data-tab="snippets">Snippets</button>
      <button id="tab-templates" class="tab" data-tab="templates">TeX 模板</button>
    </nav>

    <div class="toolbar">
      <input id="search" class="search" type="search" placeholder="搜索 trigger、replacement、说明或分类" aria-label="搜索">
      <select id="category-filter" aria-label="分类筛选"><option value="">全部分类</option></select>
      <select id="state-filter" aria-label="启用状态">
        <option value="">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option>
      </select>
      <button id="add">添加</button>
      <button id="copy" class="secondary" disabled>复制</button>
      <button id="delete" class="danger" disabled>删除</button>
      <button id="find-replace" class="secondary">查找替换…</button>
      <button id="undo" class="secondary" disabled>撤销编辑</button>
      <button id="restore" class="secondary">恢复默认…</button>
    </div>

    <div class="workspace">
      <aside class="list-pane">
        <div id="list-summary" class="list-summary">等待载入…</div>
        <ul id="items" class="items"></ul>
      </aside>
      <main class="editor-pane">
        <div id="empty" class="empty">从左侧选择一个条目，或点击“添加”。</div>

        <form id="snippet-form" class="form" hidden>
          <div class="row-actions">
            <h2 class="grow">Snippet 定义</h2>
            <span id="snippet-id" class="subtitle"></span>
          </div>
          <div class="form-fields">
            <div class="field form-span-half">
              <label for="snippet-trigger">Trigger</label>
              <input id="snippet-trigger" autocomplete="off" spellcheck="false" aria-describedby="snippet-trigger-help">
              <span id="snippet-trigger-help" class="field-help">可以直接修改；输入完整 trigger 后按片段选项触发。</span>
            </div>
            <div class="field form-span-half">
              <label for="snippet-category">分类</label>
              <input id="snippet-category" list="categories" autocomplete="off">
              <datalist id="categories"></datalist>
            </div>
            <div class="field form-span-full">
              <label for="snippet-replacement">Replacement</label>
              <textarea id="snippet-replacement" spellcheck="false" aria-describedby="snippet-replacement-help"></textarea>
              <span id="snippet-replacement-help" class="field-help">安全字符串；支持 @0、@1、@{1:默认值}、@{VISUAL}。字面量 @ 写成 @@。</span>
            </div>
            <div class="field form-span-full">
              <label for="snippet-description">说明</label>
              <input id="snippet-description" autocomplete="off">
            </div>
            <div class="field form-span-third">
              <label for="snippet-options">Options</label>
              <input id="snippet-options" autocomplete="off" spellcheck="false" placeholder="例如 tAw" aria-describedby="snippet-options-help">
              <span id="snippet-options-help" class="field-help">t 文本，m 数学，M 行间，n 行内，A 自动，r 正则，v Visual，w 词边界。</span>
            </div>
            <div class="field form-span-third">
              <label for="snippet-flags">正则 flags</label>
              <input id="snippet-flags" autocomplete="off" spellcheck="false" placeholder="例如 iu">
            </div>
            <div class="field form-span-third">
              <label for="snippet-priority">优先级</label>
              <input id="snippet-priority" type="number" step="1">
            </div>
            <div class="field form-span-half">
              <label for="snippet-version">占位符语法版本</label>
              <select id="snippet-version"><option value="2">v2（@0）</option><option value="1">v1（$0）</option></select>
            </div>
            <div class="field field-check form-span-half">
              <span class="field-label">状态</span>
              <label class="check"><input id="snippet-enabled" type="checkbox"> 启用此片段</label>
            </div>
          </div>
          <div id="snippet-validation" class="validation">定义有效。</div>
        </form>

        <form id="template-form" class="form" hidden>
          <div class="row-actions">
            <h2 class="grow">TeX 模板</h2>
            <span id="template-kind" class="badge"></span>
          </div>
          <div class="form-fields">
            <div class="field form-span-half">
              <label for="template-name">名称</label>
              <input id="template-name" autocomplete="off">
            </div>
            <div class="field form-span-half">
              <label for="template-trigger">Trigger</label>
              <input id="template-trigger" autocomplete="off" spellcheck="false" aria-describedby="template-trigger-help">
              <span id="template-trigger-help" class="field-help">在已保存的空白 .tex 文档中输入完整 trigger 自动展开。</span>
            </div>
            <div class="field form-span-full">
              <label for="template-description">说明</label>
              <input id="template-description" autocomplete="off">
            </div>
            <div class="field form-span-full">
              <label for="template-content">模板正文</label>
              <textarea id="template-content" class="template-content" spellcheck="false" aria-describedby="template-content-help"></textarea>
              <span id="template-content-help" class="field-help">正文直接保存在当前 Profile 的插件内部模板库；支持 v2 占位符 @0、@1、@{1:默认值}，字面量 @ 写成 @@。</span>
            </div>
          </div>
          <div id="template-validation" class="validation">模板有效。</div>
        </form>
      </main>
    </div>

    <footer>
      <span id="status" role="status" aria-live="polite">等待载入…</span>
      <span><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd> 保存当前页</span>
    </footer>
  </div>

  <section id="replace-panel" class="replace-panel" hidden aria-modal="true" role="dialog" aria-labelledby="replace-title">
    <div class="replace-card">
      <h2 id="replace-title">批量查找替换</h2>
      <div class="grid-2">
        <div class="field"><label for="replace-find">查找</label><input id="replace-find" autocomplete="off"></div>
        <div class="field"><label for="replace-with">替换为</label><input id="replace-with" autocomplete="off"></div>
      </div>
      <div class="scope-grid" id="replace-scopes"></div>
      <div class="row-actions">
        <label class="check"><input id="replace-case" type="checkbox"> 区分大小写</label>
        <label class="check"><input id="replace-regex" type="checkbox"> 使用正则表达式</label>
      </div>
      <p id="replace-summary" class="subtitle">输入查找内容以生成预览。</p>
      <div id="replace-preview" class="preview"></div>
      <div class="replace-actions">
        <button id="replace-apply" disabled>应用替换</button>
        <button id="replace-close" class="secondary">取消</button>
      </div>
    </div>
  </section>

  <script nonce="${nonce}">
    (() => {
      "use strict";
      const vscode = acquireVsCodeApi();
      const byId = (id) => document.getElementById(id);
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const canonical = (value) => JSON.stringify(value);
      const send = (type, detail) => vscode.postMessage(Object.assign({ protocol: 1, type }, detail || {}));
      const state = {
        active: "snippets",
        busy: true,
        library: null,
        templates: null,
        baselineLibrary: "",
        baselineTemplates: "",
        selectedSnippet: null,
        selectedTemplate: null,
        templatesAvailable: false,
        undo: [],
        lastUndoKey: "",
        lastUndoAt: 0,
        request: 0,
        reloadArmed: false,
        pendingAction: new Map()
      };
      let readyTimer = null;
      let contentReceived = false;
      const fieldIds = {
        trigger: "snippet-trigger", replacement: "snippet-replacement",
        category: "snippet-category", description: "snippet-description",
        options: "snippet-options", flags: "snippet-flags",
        priority: "snippet-priority", syntaxVersion: "snippet-version",
        enabled: "snippet-enabled"
      };
      const templateFieldIds = {
        name: "template-name", trigger: "template-trigger",
        description: "template-description", content: "template-content"
      };

      function nextRequest(action) {
        state.request += 1;
        const id = "manager-" + state.request;
        state.pendingAction.set(id, action);
        return id;
      }
      function setStatus(message, tone) {
        const status = byId("status");
        status.textContent = message;
        status.className = tone || "";
      }
      function libraryDirty() {
        return !!state.library && canonical(state.library) !== state.baselineLibrary;
      }
      function templatesDirty() {
        return !!state.templates && canonical(state.templates) !== state.baselineTemplates;
      }
      function currentDirty() {
        return state.active === "snippets" ? libraryDirty() : templatesDirty();
      }
      function anyDirty() { return libraryDirty() || templatesDirty(); }
      function reportDirty() {
        send("dirty", { dirty: anyDirty() });
        refreshButtons();
      }
      function setBusy(value, message) {
        state.busy = value;
        if (message) setStatus(message, "");
        refreshButtons();
        document.querySelectorAll("input, textarea, select").forEach((node) => {
          node.disabled = value;
        });
        byId("replace-apply").disabled = value || byId("replace-apply").disabled;
        if (!value && !byId("replace-panel").hidden) updateReplacePreview();
      }
      function validationForSnippet(snippet) {
        const errors = [], warnings = [];
        if (!snippet) return { errors, warnings, conflicts: new Set() };
        if (!snippet.id || snippet.id.length > 256 || snippet.id !== snippet.id.trim() || snippet.id.indexOf("\\0") >= 0) errors.push("内部 id 无效，请复制为新条目后再删除原条目。");
        if (!snippet.trigger) errors.push("Trigger 不能为空。");
        if (snippet.trigger.length > 4096) errors.push("Trigger 不能超过 4096 个字符。");
        if (snippet.trigger.indexOf("\\0") >= 0) errors.push("Trigger 不能包含 NUL。");
        if (snippet.replacement.length > 1000000) errors.push("Replacement 不能超过 1000000 个字符。");
        if (snippet.replacement.indexOf("\\0") >= 0) errors.push("Replacement 不能包含 NUL。");
        if (snippet.options.length > 32) errors.push("Options 不能超过 32 个字符。");
        if ((snippet.category || "").length > 256 || (snippet.category || "").indexOf("\\0") >= 0) errors.push("分类不能超过 256 个字符且不能含 NUL。");
        if ((snippet.description || "").length > 16384 || (snippet.description || "").indexOf("\\0") >= 0) errors.push("说明不能超过 16384 个字符且不能含 NUL。");
        if ((snippet.flags || "").length > 16 || (snippet.flags || "").indexOf("\\0") >= 0) errors.push("Flags 不能超过 16 个字符且不能含 NUL。");
        const invalid = Array.from(snippet.options).filter((option) => !"tMmnrAvw".includes(option));
        if (invalid.length) errors.push("未知 options：" + invalid.join(""));
        if (snippet.options.includes("r") && snippet.options.includes("v")) errors.push("r 与 v 不能同时使用。");
        if (snippet.options.includes("r")) {
          try {
            const regex = new RegExp("(?:" + snippet.trigger + ")(?![\\\\s\\\\S])", snippet.flags || "");
            if (regex.test("")) errors.push("正则 trigger 不能匹配空字符串。");
          } catch (error) { errors.push("正则表达式无效：" + String(error.message || error)); }
        } else if (snippet.flags) {
          warnings.push("只有含 r 的正则片段会使用 flags。");
        }
        if (!Number.isFinite(Number(snippet.priority))) errors.push("优先级必须是有限数字。");
        const conflicts = new Set();
        if (state.library) {
          state.library.snippets.forEach((other) => {
            if (other.id === snippet.id || !other.enabled || !snippet.enabled) return;
            if (other.trigger === snippet.trigger && other.options === snippet.options && (other.flags || "") === (snippet.flags || "")) {
              conflicts.add(other.id);
            }
          });
        }
        if (conflicts.size) warnings.push("有 " + conflicts.size + " 条已启用片段使用相同 trigger、options 与 flags。");
        return { errors, warnings, conflicts };
      }
      function validateAllSnippets() {
        if (!state.library) return ["片段库尚未载入。"];
        const errors = [], ids = new Set();
        if (state.library.snippets.length > 100000) errors.push("片段数量不能超过 100000 条。");
        const { revision: _revision, ...persisted } = state.library;
        if (new TextEncoder().encode(JSON.stringify(persisted)).byteLength > 10000000) errors.push("片段库（包括变量）不能超过 10 MB。");
        state.library.snippets.forEach((snippet, index) => {
          if (ids.has(snippet.id)) errors.push("第 " + (index + 1) + " 条 id 重复。");
          ids.add(snippet.id);
          const result = validationForSnippet(snippet);
          result.errors.forEach((error) => errors.push(snippet.trigger + "：" + error));
        });
        return errors;
      }
      function validationForTemplate(template) {
        const errors = [], warnings = [];
        if (!template) return { errors, warnings };
        if (!template.name.trim()) errors.push("名称不能为空。");
        if (template.name.length > 128) errors.push("名称不能超过 128 个字符。");
        if (!template.trigger) errors.push("Trigger 不能为空。");
        if (template.trigger.length > 80) errors.push("模板 trigger 不能超过 80 个字符。");
        // This code lives inside the outer TypeScript template literal. Keep
        // the browser-side RegExp escapes double-escaped here; otherwise the
        // rendered HTML contains literal U+0000..U+001F characters and
        // Chromium rejects the entire manager script before it can post
        // ready to the extension host.
        if (/[\\s\\u0000-\\u001f\\u007f]/u.test(template.trigger)) errors.push("模板 trigger 不能包含空白或控制字符。");
        if (template.description.length > 2048) errors.push("说明不能超过 2048 个字符。");
        if (template.content.indexOf("\\0") >= 0) errors.push("模板正文不能包含 NUL。");
        if (new TextEncoder().encode(template.content).byteLength > 192 * 1024) errors.push("模板正文不能超过 192 KiB。");
        if (!/\\\\begin\\s*\\{document\\}/u.test(template.content)) warnings.push("正文中没有检测到 \\\\begin{document}。");
        if (state.templates) {
          const duplicate = state.templates.templates.find((other) => other.id !== template.id && other.trigger === template.trigger);
          if (duplicate) errors.push("Trigger 已被模板“" + duplicate.name + "”使用。");
          const prefix = state.templates.templates.find((other) => other.id !== template.id && (other.trigger.startsWith(template.trigger) || template.trigger.startsWith(other.trigger)));
          if (prefix && !duplicate) errors.push("Trigger 与模板“" + prefix.name + "”存在前缀冲突，短 trigger 会提前展开。");
        }
        return { errors, warnings };
      }
      function validateAllTemplates() {
        if (!state.templates) return ["模板目录尚未载入。"];
        const errors = [], ids = new Set();
        if (state.templates.templates.length > 128) errors.push("模板数量不能超过 128 个。");
        if (new TextEncoder().encode(JSON.stringify(state.templates.templates)).byteLength > 256 * 1024) errors.push("模板目录不能超过 256 KiB。");
        state.templates.templates.forEach((template, index) => {
          if (ids.has(template.id)) errors.push("第 " + (index + 1) + " 个模板 id 重复。");
          ids.add(template.id);
          validationForTemplate(template).errors.forEach((error) => errors.push(template.name + "：" + error));
        });
        return errors;
      }
      function refreshButtons() {
        const loaded = !!state.library && !!state.templates;
        const currentErrors = state.active === "snippets" ? validateAllSnippets() : validateAllTemplates();
        byId("save").disabled = state.busy || !loaded || !currentDirty() || currentErrors.length > 0 || (state.active === "templates" && !state.templatesAvailable);
        byId("reload").disabled = state.busy || (loaded && !anyDirty());
        byId("import").disabled = state.busy || !loaded || anyDirty() || state.active !== "snippets";
        byId("export").disabled = state.busy || !loaded || state.active !== "snippets";
        byId("advanced-json").disabled = state.busy || !loaded || anyDirty();
        const selected = state.active === "snippets" ? selectedSnippet() : selectedTemplate();
        byId("copy").disabled = state.busy || !selected || (state.active === "templates" && !state.templatesAvailable);
        byId("delete").disabled = state.busy || !selected || (state.active === "templates" && !state.templatesAvailable);
        byId("add").disabled = state.busy || !loaded || (state.active === "templates" && !state.templatesAvailable);
        byId("find-replace").disabled = state.busy || !loaded || (state.active === "templates" && !state.templatesAvailable);
        byId("undo").disabled = state.busy || state.undo.length === 0;
        byId("restore").disabled = state.busy || !loaded || anyDirty() || (state.active === "templates" && !state.templatesAvailable);
      }
      function selectedSnippet() {
        return state.library && state.library.snippets.find((snippet) => snippet.id === state.selectedSnippet);
      }
      function selectedTemplate() {
        return state.templates && state.templates.templates.find((template) => template.id === state.selectedTemplate);
      }
      function pushUndo(key, label) {
        const now = Date.now();
        if (state.lastUndoKey === key && now - state.lastUndoAt < 650) {
          state.lastUndoAt = now;
          return;
        }
        const snapshot = clone(state.active === "snippets" ? state.library : state.templates);
        const bytes = new TextEncoder().encode(canonical(snapshot)).byteLength;
        state.undo.push({
          active: state.active,
          label,
          library: state.active === "snippets" ? snapshot : null,
          templates: state.active === "templates" ? snapshot : null,
          bytes,
          selectedSnippet: state.selectedSnippet,
          selectedTemplate: state.selectedTemplate
        });
        if (state.undo.length > 40) state.undo.shift();
        while (state.undo.length > 1 && state.undo.reduce((sum, entry) => sum + entry.bytes, 0) > 24 * 1024 * 1024) state.undo.shift();
        state.lastUndoKey = key;
        state.lastUndoAt = now;
      }
      function undo() {
        const entry = state.undo.pop();
        if (!entry) return;
        if (entry.library) state.library = entry.library;
        if (entry.templates) state.templates = entry.templates;
        state.selectedSnippet = entry.selectedSnippet;
        state.selectedTemplate = entry.selectedTemplate;
        state.active = entry.active;
        state.lastUndoKey = "";
        render();
        reportDirty();
        setStatus("已撤销：" + entry.label, "success");
      }
      function uniqueId(prefix, collection) {
        let value;
        do {
          const random = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
          value = prefix + "." + random;
        } while (collection.some((entry) => entry.id === value));
        return value;
      }
      function categories() {
        if (!state.library) return [];
        return Array.from(new Set(state.library.snippets.map((snippet) => snippet.category || "User"))).sort((a, b) => a.localeCompare(b));
      }
      function renderFilters() {
        const select = byId("category-filter");
        const previous = select.value;
        const suggestions = byId("categories");
        select.replaceChildren(new Option("全部分类", ""));
        suggestions.replaceChildren();
        categories().forEach((category) => {
          select.append(new Option(category, category));
          suggestions.append(new Option(category, category));
        });
        if (Array.from(select.options).some((option) => option.value === previous)) select.value = previous;
        select.hidden = state.active !== "snippets";
        byId("state-filter").hidden = state.active !== "snippets";
        byId("search").placeholder = state.active === "snippets"
          ? "搜索 trigger、replacement、说明或分类"
          : "搜索模板 trigger、名称、说明或正文";
      }
      function filteredEntries() {
        const query = byId("search").value.trim().toLocaleLowerCase();
        if (state.active === "templates") {
          return state.templates.templates.filter((item) => !query || [item.trigger, item.name, item.description, item.content].some((value) => String(value).toLocaleLowerCase().includes(query)));
        }
        const category = byId("category-filter").value;
        const enabled = byId("state-filter").value;
        return state.library.snippets.filter((item) => {
          if (category && item.category !== category) return false;
          if (enabled === "enabled" && !item.enabled) return false;
          if (enabled === "disabled" && item.enabled) return false;
          return !query || [item.trigger, item.replacement, item.description || "", item.category, item.options].some((value) => String(value).toLocaleLowerCase().includes(query));
        });
      }
      function renderList() {
        const items = byId("items");
        items.replaceChildren();
        if (!state.library || !state.templates) return;
        const entries = filteredEntries();
        const total = state.active === "snippets" ? state.library.snippets.length : state.templates.templates.length;
        byId("list-summary").textContent = "显示 " + entries.length + " / " + total + (currentDirty() ? " · 尚未保存" : "");
        entries.forEach((entry) => {
          const li = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "item" + ((state.active === "snippets" ? state.selectedSnippet : state.selectedTemplate) === entry.id ? " selected" : "");
          const title = document.createElement("span");
          title.className = "item-title";
          title.textContent = entry.trigger;
          const badge = document.createElement("span");
          badge.className = "badge";
          const detail = document.createElement("span");
          detail.className = "item-detail";
          const meta = document.createElement("span");
          meta.className = "item-meta";
          if (state.active === "snippets") {
            badge.textContent = entry.enabled ? entry.options || "手动" : "停用";
            if (!entry.enabled) badge.classList.add("off");
            detail.textContent = entry.description || entry.replacement.replace(/\\s+/gu, " ").slice(0, 100);
            meta.textContent = entry.category || "User";
            const validation = validationForSnippet(entry);
            if (validation.errors.length) {
              badge.textContent = "错误";
              badge.classList.add("warning");
            } else if (validation.warnings.length) {
              badge.classList.add("warning");
            }
          } else {
            badge.textContent = entry.isFactory ? "默认" : "自定义";
            detail.textContent = entry.name;
            meta.textContent = entry.description || "TeX 模板";
          }
          button.append(title, badge, detail, meta);
          button.addEventListener("click", () => {
            if (state.active === "snippets") state.selectedSnippet = entry.id;
            else state.selectedTemplate = entry.id;
            state.lastUndoKey = "";
            renderList();
            renderEditor();
            refreshButtons();
          });
          li.append(button);
          items.append(li);
        });
      }
      function showValidation(element, result) {
        element.className = "validation";
        if (result.errors.length) {
          element.classList.add("error");
          element.textContent = result.errors.join(" ");
        } else if (result.warnings.length) {
          element.classList.add("warning");
          element.textContent = result.warnings.join(" ");
        } else {
          element.textContent = "定义有效，未检测到冲突。";
        }
      }
      function renderEditor() {
        const snippet = selectedSnippet();
        const template = selectedTemplate();
        const showSnippet = state.active === "snippets" && !!snippet;
        const showTemplate = state.active === "templates" && !!template;
        byId("empty").hidden = showSnippet || showTemplate;
        byId("snippet-form").hidden = !showSnippet;
        byId("template-form").hidden = !showTemplate;
        if (showSnippet) {
          byId("snippet-id").textContent = snippet.id;
          Object.entries(fieldIds).forEach(([field, id]) => {
            const node = byId(id);
            const value = snippet[field];
            if (node.type === "checkbox") node.checked = !!value;
            else node.value = value === undefined ? "" : String(value);
          });
          showValidation(byId("snippet-validation"), validationForSnippet(snippet));
        }
        if (showTemplate) {
          Object.entries(templateFieldIds).forEach(([field, id]) => byId(id).value = template[field] || "");
          byId("template-kind").textContent = template.isFactory ? "默认模板（可修改）" : "自定义模板";
          showValidation(byId("template-validation"), validationForTemplate(template));
        }
      }
      function render() {
        document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === state.active));
        renderFilters();
        renderList();
        renderEditor();
        refreshButtons();
      }
      function mutateSnippet(field, rawValue) {
        const snippet = selectedSnippet();
        if (!snippet) return;
        pushUndo("snippet:" + snippet.id + ":" + field, "修改 " + field);
        if (field === "priority") snippet[field] = Number(rawValue);
        else if (field === "syntaxVersion") snippet[field] = Number(rawValue);
        else if (field === "enabled") snippet[field] = !!rawValue;
        else if (field === "description" || field === "flags") {
          if (rawValue) snippet[field] = rawValue;
          else delete snippet[field];
        } else snippet[field] = rawValue;
        if (field === "category") renderFilters();
        renderList();
        showValidation(byId("snippet-validation"), validationForSnippet(snippet));
        reportDirty();
      }
      function mutateTemplate(field, value) {
        const template = selectedTemplate();
        if (!template) return;
        pushUndo("template:" + template.id + ":" + field, "修改模板 " + field);
        template[field] = value;
        renderList();
        showValidation(byId("template-validation"), validationForTemplate(template));
        reportDirty();
      }
      function addEntry() {
        if (state.active === "snippets") {
          pushUndo("add-snippet", "添加 Snippet");
          const snippet = {
            id: uniqueId("user", state.library.snippets), trigger: "new-trigger",
            replacement: "@0", options: "t", priority: 0, category: "User",
            syntaxVersion: 2, enabled: true
          };
          state.library.snippets.push(snippet);
          state.selectedSnippet = snippet.id;
        } else {
          pushUndo("add-template", "添加模板");
          const template = {
            id: uniqueId("template.user", state.templates.templates),
            name: "新模板", trigger: "new-template", description: "",
            content: "\\\\documentclass{article}\\n\\n\\\\begin{document}\\n@0\\n\\\\end{document}\\n",
            isFactory: false
          };
          state.templates.templates.push(template);
          state.selectedTemplate = template.id;
        }
        state.lastUndoKey = "";
        render();
        reportDirty();
      }
      function copyEntry() {
        if (state.active === "snippets") {
          const source = selectedSnippet(); if (!source) return;
          pushUndo("copy-snippet", "复制 Snippet");
          const copy = clone(source);
          copy.id = uniqueId("user", state.library.snippets);
          copy.trigger = source.trigger + "-copy";
          state.library.snippets.push(copy);
          state.selectedSnippet = copy.id;
        } else {
          const source = selectedTemplate(); if (!source) return;
          pushUndo("copy-template", "复制模板");
          const copy = clone(source);
          copy.id = uniqueId("template.user", state.templates.templates);
          copy.name = source.name + "（副本）";
          copy.trigger = source.trigger + "-copy";
          copy.isFactory = false;
          state.templates.templates.push(copy);
          state.selectedTemplate = copy.id;
        }
        state.lastUndoKey = "";
        render();
        reportDirty();
      }
      function deleteEntry() {
        const entry = state.active === "snippets" ? selectedSnippet() : selectedTemplate();
        if (!entry) return;
        const label = state.active === "snippets" ? entry.trigger : entry.name;
        if (!confirm("确定删除“" + label + "”吗？保存前仍可通过“撤销编辑”恢复。")) return;
        pushUndo("delete:" + entry.id, "删除 " + label);
        if (state.active === "snippets") {
          state.library.snippets = state.library.snippets.filter((item) => item.id !== entry.id);
          state.selectedSnippet = null;
        } else {
          state.templates.templates = state.templates.templates.filter((item) => item.id !== entry.id);
          state.selectedTemplate = null;
        }
        state.lastUndoKey = "";
        render();
        reportDirty();
      }
      function requestSave() {
        if (state.busy || !currentDirty()) return;
        if (state.active === "snippets") {
          const errors = validateAllSnippets();
          if (errors.length) { setStatus("无法保存：" + errors[0], "error"); return; }
          const requestId = nextRequest("saveLibrary");
          setBusy(true, "正在安全保存片段库…");
          const library = clone(state.library);
          const expectedRevision = library.revision;
          delete library.revision;
          send("saveLibrary", { requestId, expectedRevision, library });
        } else {
          const errors = validateAllTemplates();
          if (errors.length) { setStatus("无法保存：" + errors[0], "error"); return; }
          const requestId = nextRequest("saveTemplates");
          setBusy(true, "正在安全保存模板目录…");
          send("saveTemplates", {
            requestId,
            expectedRevision: state.templates.revision,
            templates: clone(state.templates.templates)
          });
        }
      }
      function requestReload() {
        if (state.busy) return;
        if (anyDirty() && !state.reloadArmed) {
          state.reloadArmed = true;
          setStatus("再次点击“撤销未保存修改”以从内部存储重新载入全部内容。", "warning");
          return;
        }
        state.reloadArmed = false;
        const requestId = nextRequest("reload");
        setBusy(true, "正在重新载入…");
        send("reload", { requestId });
      }
      function runCommand(command) {
        const requestId = nextRequest("command");
        setBusy(true, "正在执行命令…");
        send("runCommand", { requestId, command });
      }
      function restoreDefaults() {
        if (anyDirty()) { setStatus("请先保存或撤销未保存的修改。", "warning"); return; }
        if (state.active === "snippets") {
          const requestId = nextRequest("restoreDefaults");
          setBusy(true, "正在恢复默认片段…");
          send("restoreDefaults", { requestId });
        } else {
          if (!confirm("恢复四个出厂模板？自定义模板和修改后的模板将被替换。")) return;
          const requestId = nextRequest("restoreTemplates");
          setBusy(true, "正在恢复默认模板…");
          send("restoreTemplates", { requestId });
        }
      }
      function replaceFields() {
        return state.active === "snippets"
          ? [["trigger", "Trigger"], ["replacement", "Replacement"], ["description", "说明"], ["category", "分类"]]
          : [["trigger", "Trigger"], ["name", "名称"], ["description", "说明"], ["content", "模板正文"]];
      }
      function openReplace() {
        const scopes = byId("replace-scopes");
        scopes.replaceChildren();
        replaceFields().forEach(([field, label], index) => {
          const wrapper = document.createElement("label");
          wrapper.className = "check";
          const input = document.createElement("input");
          input.type = "checkbox"; input.value = field; input.checked = index < 2;
          input.addEventListener("change", updateReplacePreview);
          wrapper.append(input, document.createTextNode(label));
          scopes.append(wrapper);
        });
        byId("replace-panel").hidden = false;
        byId("replace-find").focus();
        updateReplacePreview();
      }
      function replacementPlan() {
        const needle = byId("replace-find").value;
        if (!needle) return { error: "请输入查找内容。", changes: [], count: 0 };
        const fields = Array.from(byId("replace-scopes").querySelectorAll("input:checked")).map((input) => input.value);
        if (!fields.length) return { error: "至少选择一个字段。", changes: [], count: 0 };
        const regexMode = byId("replace-regex").checked;
        const caseSensitive = byId("replace-case").checked;
        let regex;
        try {
          const source = regexMode ? needle : needle.replace(/[.*+?^\${}()|[\\]\\\\]/gu, "\\\\$&");
          regex = new RegExp(source, "g" + (caseSensitive ? "" : "i") + (regexMode ? "u" : "u"));
        } catch (error) {
          return { error: "正则表达式无效：" + String(error.message || error), changes: [], count: 0 };
        }
        const replacement = byId("replace-with").value;
        const entries = state.active === "snippets" ? state.library.snippets : state.templates.templates;
        const changes = [];
        let count = 0;
        entries.forEach((entry) => fields.forEach((field) => {
          const before = typeof entry[field] === "string" ? entry[field] : "";
          const matches = Array.from(before.matchAll(regex));
          if (!matches.length) return;
          regex.lastIndex = 0;
          const after = regexMode
            ? before.replace(regex, replacement)
            : before.replace(regex, () => replacement);
          changes.push({ id: entry.id, label: entry.trigger || entry.name, field, before, after, count: matches.length });
          count += matches.length;
        }));
        return { changes, count };
      }
      function updateReplacePreview() {
        const plan = replacementPlan();
        const preview = byId("replace-preview");
        preview.replaceChildren();
        if (plan.error) {
          byId("replace-summary").textContent = plan.error;
          byId("replace-apply").disabled = true;
          return;
        }
        byId("replace-summary").textContent = "将在 " + plan.changes.length + " 个字段中替换 " + plan.count + " 处。";
        plan.changes.slice(0, 100).forEach((change) => {
          const row = document.createElement("div");
          row.className = "preview-row";
          const before = change.before.replace(/\\s+/gu, " ").slice(0, 120);
          const after = change.after.replace(/\\s+/gu, " ").slice(0, 120);
          row.textContent = change.label + " · " + change.field + "\\n" + before + "  →  " + after;
          preview.append(row);
        });
        if (plan.changes.length > 100) {
          const more = document.createElement("div");
          more.className = "preview-row";
          more.textContent = "另有 " + (plan.changes.length - 100) + " 个字段未在预览中展开。";
          preview.append(more);
        }
        byId("replace-apply").disabled = state.busy || plan.count === 0;
      }
      function applyReplacement() {
        if (state.busy) {
          setStatus("当前操作完成前不能应用查找替换。", "warning");
          return;
        }
        const plan = replacementPlan();
        if (plan.error || !plan.count) return;
        if (!confirm("确认应用预览中的 " + plan.count + " 处替换？保存前可一键撤销。")) return;
        pushUndo("bulk-replace:" + Date.now(), "批量查找替换");
        const entries = state.active === "snippets" ? state.library.snippets : state.templates.templates;
        const index = new Map(entries.map((entry) => [entry.id, entry]));
        plan.changes.forEach((change) => {
          const entry = index.get(change.id);
          if (entry) entry[change.field] = change.after;
        });
        state.lastUndoKey = "";
        byId("replace-panel").hidden = true;
        render();
        reportDirty();
        setStatus("已在草稿中应用 " + plan.count + " 处替换；请检查后保存。", "success");
      }
      function loadContent(message) {
        if (!message.library || !message.templateCatalog) return;
        if (state.library && anyDirty() && (message.requestId === null || message.requestId === undefined)) {
          send("dirty", { dirty: true });
          setStatus("内部存储已在其他窗口或同步设备中变化；为保护当前草稿未自动覆盖。请保存时处理冲突，或主动撤销未保存修改。", "warning");
          return;
        }
        contentReceived = true;
        if (readyTimer !== null) {
          clearInterval(readyTimer);
          readyTimer = null;
        }
        if (message.initialTab === "templates" || message.initialTab === "snippets") state.active = message.initialTab;
        state.library = clone(message.library);
        state.templates = clone(message.templateCatalog);
        state.baselineLibrary = canonical(state.library);
        state.baselineTemplates = canonical(state.templates);
        state.templatesAvailable = message.templatesAvailable === true;
        state.undo = [];
        state.selectedSnippet = state.library.snippets[0] ? state.library.snippets[0].id : null;
        state.selectedTemplate = state.templates.templates[0] ? state.templates.templates[0].id : null;
        state.reloadArmed = false;
        byId("reload").textContent = "撤销未保存修改";
        byId("target").textContent = "当前 VS Code Profile 内部存储（所有工作区共用）";
        setBusy(false);
        render();
        reportDirty();
        setStatus("已载入 " + state.library.snippets.length + " 条片段和 " + state.templates.templates.length + " 个模板。", "success");
      }

      document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
        state.active = tab.dataset.tab;
        state.lastUndoKey = "";
        byId("search").value = "";
        render();
      }));
      Object.entries(fieldIds).forEach(([field, id]) => {
        const node = byId(id);
        node.addEventListener(node.type === "checkbox" ? "change" : "input", () => mutateSnippet(field, node.type === "checkbox" ? node.checked : node.value));
      });
      Object.entries(templateFieldIds).forEach(([field, id]) => {
        const node = byId(id);
        node.addEventListener("input", () => mutateTemplate(field, node.value));
      });
      ["snippet-form", "template-form"].forEach((id) => byId(id).addEventListener("submit", (event) => event.preventDefault()));
      ["search", "category-filter", "state-filter"].forEach((id) => byId(id).addEventListener(id === "search" ? "input" : "change", renderList));
      byId("add").addEventListener("click", addEntry);
      byId("copy").addEventListener("click", copyEntry);
      byId("delete").addEventListener("click", deleteEntry);
      byId("undo").addEventListener("click", undo);
      byId("save").addEventListener("click", requestSave);
      byId("reload").addEventListener("click", requestReload);
      byId("import").addEventListener("click", () => runCommand("import"));
      byId("export").addEventListener("click", () => runCommand("export"));
      byId("advanced-json").addEventListener("click", () => runCommand("openJson"));
      byId("restore").addEventListener("click", restoreDefaults);
      byId("find-replace").addEventListener("click", openReplace);
      byId("replace-close").addEventListener("click", () => byId("replace-panel").hidden = true);
      byId("replace-apply").addEventListener("click", applyReplacement);
      ["replace-find", "replace-with"].forEach((id) => byId(id).addEventListener("input", updateReplacePreview));
      ["replace-case", "replace-regex"].forEach((id) => byId(id).addEventListener("change", updateReplacePreview));
      document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") {
          event.preventDefault(); requestSave();
        }
        if (event.key === "Escape" && !byId("replace-panel").hidden) byId("replace-panel").hidden = true;
      });
      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || typeof message !== "object" || typeof message.type !== "string") return;
        if (message.protocol !== undefined && message.protocol !== 1) return;
        if (message.type === "activateTab" && (message.tab === "snippets" || message.tab === "templates")) {
          state.active = message.tab;
          state.lastUndoKey = "";
          byId("search").value = "";
          render();
          return;
        }
        if (message.type === "content") { loadContent(message); return; }
        if (message.type === "busy" && typeof message.value === "boolean") {
          setBusy(message.value, message.message); return;
        }
        if (message.type === "error") {
          setBusy(false); setStatus(String(message.message || "操作失败。"), "error"); return;
        }
        if (message.type !== "result") return;
        if (!contentReceived && message.action === "reload" && !message.ok && readyTimer !== null) {
          clearInterval(readyTimer);
          readyTimer = null;
          byId("reload").textContent = "重新尝试载入";
        }
        state.pendingAction.delete(message.requestId);
        if (message.ok && message.action === "saveLibrary" && message.library) {
          state.library = clone(message.library);
          state.baselineLibrary = canonical(state.library);
          state.undo = state.undo.filter((entry) => entry.active !== "snippets");
        }
        if (message.ok && (message.action === "saveTemplates" || message.action === "restoreTemplates") && message.templateCatalog) {
          state.templates = clone(message.templateCatalog);
          state.baselineTemplates = canonical(state.templates);
          state.undo = state.undo.filter((entry) => entry.active !== "templates");
        }
        setBusy(false);
        render();
        reportDirty();
        setStatus(String(message.message || (message.ok ? "操作完成。" : "操作失败。")), typeof message.tone === "string" ? message.tone : (message.ok ? "success" : "error"));
      });
      const announceReady = () => {
        if (!contentReceived) send("ready");
      };
      announceReady();
      if (!contentReceived) readyTimer = setInterval(announceReady, 750);
      window.addEventListener("pagehide", () => {
        if (readyTimer !== null) clearInterval(readyTimer);
      }, { once: true });
    })();
  </script>
</body>
</html>`;
}
