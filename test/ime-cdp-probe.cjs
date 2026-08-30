/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

"use strict";

const port = Number(process.argv[2]);
const command = process.argv[3] ?? "read";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("Usage: node test/ime-cdp-probe.cjs <port> [install|read|compact|verify|state|clear]");
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((candidate) => candidate.type === "iframe");
  if (target === undefined) {
    throw new Error("VS Code Webview target not found");
  }
  const client = await connectCdp(target.webSocketDebuggerUrl);
  try {
    await client.request("Runtime.enable");
    const response = await client.request("Runtime.evaluate", {
      expression: expressionFor(command),
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails !== undefined) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    process.stdout.write(`${JSON.stringify(response.result?.value, null, 2)}\n`);
  } finally {
    client.close();
  }
}

function expressionFor(commandName) {
  if (commandName === "install") {
    return `(() => {
      const old = window.__texleafImeProbe;
      if (old?.listener) {
        for (const type of old.types) document.removeEventListener(type, old.listener, true);
      }
      const probe = {
        events: [],
        types: ["compositionstart", "compositionupdate", "compositionend", "beforeinput", "input", "keydown", "keyup"],
        snapshot() {
          const editorDocument = document.querySelector("iframe")?.contentDocument ?? document;
          const selection = editorDocument.defaultView?.getSelection();
          const anchorNode = selection?.anchorNode;
          const focusNode = selection?.focusNode;
          const describeNode = (node) => node == null ? null : {
            type: node.nodeType,
            text: node.nodeType === Node.TEXT_NODE ? node.nodeValue : node.textContent,
            parentClass: node.parentElement?.className ?? null,
          };
          const activeFormula = editorDocument.querySelector(".texleaf-formula-source-active")?.closest(".cm-line");
          const lines = [...editorDocument.querySelectorAll(".cm-line")];
          const lineSnapshot = (needle) => {
            const line = lines.find((candidate) => candidate.textContent?.includes(needle));
            if (line == null) return null;
            const rect = line.getBoundingClientRect();
            return {
              text: line.textContent,
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
            };
          };
          return {
            outerActiveTag: document.activeElement?.tagName ?? null,
            activeTag: editorDocument.activeElement?.tagName ?? null,
            activeClass: editorDocument.activeElement?.className ?? null,
            iframeCount: document.querySelectorAll("iframe").length,
            editorLineCount: editorDocument.querySelectorAll(".cm-line").length,
            anchorOffset: selection?.anchorOffset ?? null,
            focusOffset: selection?.focusOffset ?? null,
            anchorNode: describeNode(anchorNode),
            focusNode: describeNode(focusNode),
            activeFormulaText: activeFormula?.textContent ?? null,
            activeFormulaHtml: activeFormula?.innerHTML ?? null,
            selectedText: selection?.toString() ?? "",
            targets: {
              semicolon: lineSnapshot("Full-width semicolon probe"),
              complexFormula: lineSnapshot("\\Delta_{2}^{\\prime*}"),
            },
          };
        },
      };
      probe.listener = (event) => {
        const entry = {
          type: event.type,
          data: "data" in event ? event.data : undefined,
          inputType: "inputType" in event ? event.inputType : undefined,
          isComposing: "isComposing" in event ? event.isComposing : undefined,
          key: "key" in event ? event.key : undefined,
          code: "code" in event ? event.code : undefined,
          time: performance.now(),
          snapshot: probe.snapshot(),
        };
        probe.events.push(entry);
        if (probe.events.length > 200) probe.events.splice(0, probe.events.length - 200);
      };
      const editorDocument = document.querySelector("iframe")?.contentDocument ?? document;
      for (const type of probe.types) editorDocument.addEventListener(type, probe.listener, true);
      window.__texleafImeProbe = probe;
      return { installed: true, snapshot: probe.snapshot() };
    })()`;
  }
  if (commandName === "clear") {
    return `(() => {
      if (!window.__texleafImeProbe) return { installed: false };
      window.__texleafImeProbe.events.length = 0;
      return { installed: true, snapshot: window.__texleafImeProbe.snapshot() };
    })()`;
  }
  if (commandName === "compact") {
    return `(() => {
      const probe = window.__texleafImeProbe;
      if (probe == null) return { installed: false };
      const snapshot = probe.snapshot();
      const editorDocument = document.querySelector("iframe")?.contentDocument ?? document;
      const selection = editorDocument.defaultView?.getSelection();
      const anchorElement = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      const activeSegment = anchorElement?.closest?.(".texleaf-formula-source-active") ?? null;
      const from = activeSegment?.getAttribute("data-texleaf-formula-from") ?? null;
      const to = activeSegment?.getAttribute("data-texleaf-formula-to") ?? null;
      const segments = [...editorDocument.querySelectorAll(".texleaf-formula-source-active")]
        .filter((segment) => from == null || to == null || (
          segment.getAttribute("data-texleaf-formula-from") === from &&
          segment.getAttribute("data-texleaf-formula-to") === to
        ));
      const formulaText = segments.map((segment) => segment.textContent ?? "").join("");
      return {
        installed: true,
        selection: {
          anchorOffset: selection?.anchorOffset ?? null,
          anchorText: selection?.anchorNode?.nodeValue ?? selection?.anchorNode?.textContent ?? null,
          anchorClass: anchorElement?.className ?? null,
          formulaFrom: from,
          formulaTo: to,
        },
        formulaText,
        segments: segments.map((segment) => ({
          text: segment.textContent ?? "",
          className: segment.className,
          repairVersion: segment.getAttribute("data-texleaf-ime-repair-version"),
        })),
        recentEvents: probe.events.slice(-16).map((entry) => ({
          type: entry.type,
          data: entry.data,
          inputType: entry.inputType,
          isComposing: entry.isComposing,
          key: entry.key,
          code: entry.code,
          anchorOffset: entry.snapshot?.anchorOffset,
          anchorText: entry.snapshot?.anchorNode?.text,
          anchorClass: entry.snapshot?.anchorNode?.parentClass,
          activeFormulaText: entry.snapshot?.activeFormulaText,
        })),
        snapshot: {
          activeFormulaText: snapshot.activeFormulaText,
          selectedText: snapshot.selectedText,
        },
      };
    })()`;
  }
  if (commandName === "verify") {
    return `(() => {
      const probe = window.__texleafImeProbe;
      if (probe == null) return { installed: false };
      const editorDocument = document.querySelector("iframe")?.contentDocument ?? document;
      const selection = editorDocument.defaultView?.getSelection();
      const anchorElement = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      const activeSegment = anchorElement?.closest?.(".texleaf-formula-source-active") ?? null;
      const from = activeSegment?.getAttribute("data-texleaf-formula-from") ?? null;
      const to = activeSegment?.getAttribute("data-texleaf-formula-to") ?? null;
      const segments = [...editorDocument.querySelectorAll(".texleaf-formula-source-active")]
        .filter((segment) => from != null && to != null &&
          segment.getAttribute("data-texleaf-formula-from") === from &&
          segment.getAttribute("data-texleaf-formula-to") === to);
      const formulaText = segments.map((segment) => segment.textContent ?? "").join("");
      const content = editorDocument.querySelector(".cm-content");
      const view = content?.cmView?.view ?? content?.cmTile?.view ?? null;
      const doc = view?.state?.doc?.toString?.() ?? "";
      const stateSelection = view?.state?.selection?.main ?? null;
      const head = Number.isInteger(stateSelection?.head) ? stateSelection.head : 0;
      const context = doc.slice(Math.max(0, head - 100), Math.min(doc.length, head + 100));
      const latest = probe.events.at(-1);
      return {
        installed: true,
        formulaText,
        formulaHasBracedPrimeS: formulaText.includes("\\\\Delta_{2}^{\\\\prime*}s"),
        formulaHasMissingOpeningBrace: formulaText.includes("\\\\Delta_{2}^\\\\prime*}s"),
        stateContext: context,
        stateHasBracedPrimeS: context.includes("\\\\Delta_{2}^{\\\\prime*}s"),
        stateHasMissingOpeningBrace: context.includes("\\\\Delta_{2}^\\\\prime*}s"),
        selection: {
          anchorOffset: selection?.anchorOffset ?? null,
          anchorText: selection?.anchorNode?.nodeValue ?? selection?.anchorNode?.textContent ?? null,
          anchorClass: anchorElement?.className ?? null,
          stateHead: stateSelection?.head ?? null,
        },
        latestEvent: latest == null ? null : {
          type: latest.type,
          data: latest.data,
          inputType: latest.inputType,
          isComposing: latest.isComposing,
          anchorClass: latest.snapshot?.anchorNode?.parentClass,
          anchorText: latest.snapshot?.anchorNode?.text,
        },
      };
    })()`;
  }
  if (commandName === "state") {
    return `(() => {
      const editorDocument = document.querySelector("iframe")?.contentDocument ?? document;
      const candidates = [
        editorDocument.querySelector(".cm-editor"),
        editorDocument.querySelector(".cm-content"),
        editorDocument.querySelector(".cm-line"),
      ];
      const descriptions = candidates.map((element) => ({
        className: element?.className ?? null,
        ownKeys: element == null ? [] : Object.getOwnPropertyNames(element),
        cmViewKeys: element?.cmView == null
          ? []
          : Object.getOwnPropertyNames(element.cmView),
        cmTileKeys: element?.cmTile == null
          ? []
          : Object.getOwnPropertyNames(element.cmTile),
        cmTileViewKeys: element?.cmTile?.view == null
          ? []
          : Object.getOwnPropertyNames(element.cmTile.view),
      }));
      const holder = candidates.find((element) =>
        element?.cmView?.view?.state?.doc != null ||
        element?.cmTile?.view?.state?.doc != null
      );
      const view = holder?.cmView?.view ?? holder?.cmTile?.view ?? null;
      const doc = view?.state?.doc?.toString?.() ?? null;
      const selection = view?.state?.selection?.main ?? null;
      return { descriptions, doc, selection };
    })()`;
  }
  return `(() => {
    const probe = window.__texleafImeProbe;
    return probe == null
      ? { installed: false }
      : { installed: true, snapshot: probe.snapshot(), events: probe.events };
  })()`;
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener("open", () => resolve({
      request(method, params = {}) {
        const id = nextId++;
        return new Promise((requestResolve, requestReject) => {
          pending.set(id, { resolve: requestResolve, reject: requestReject });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { socket.close(); },
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) return;
      const waiter = pending.get(message.id);
      if (waiter === undefined) return;
      pending.delete(message.id);
      if (message.error !== undefined) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed")));
  });
}
