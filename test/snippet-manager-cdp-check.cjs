"use strict";

/**
 * Read-only diagnostics for an already-running isolated Snippet manager
 * Webview. The launcher owns the VS Code process; this helper only attaches to
 * the Webview iframe through its explicitly enabled loopback CDP port.
 */

const port = Number.parseInt(process.argv[2] || "9341", 10);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const target = targets.find((entry) => entry.type === "iframe" && entry.url.startsWith("vscode-webview://"));
  if (!target?.webSocketDebuggerUrl) throw new Error("Snippet manager Webview iframe was not found");
  const client = await connectCdp(target.webSocketDebuggerUrl);
  try {
    await client.request("Runtime.enable");
    const result = await client.request("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const outerDocument = window.document;
        const frames = [...outerDocument.querySelectorAll("iframe")];
        const selected = frames.find((frame) => frame.contentDocument?.title.includes("TeXLeaf"))
          || frames.find((frame) => frame.contentDocument?.getElementById("target"))
          || outerDocument.getElementById("active-frame");
        const document = selected?.contentDocument;
        return ({
        selectedFrame: selected?.id,
        frames: frames.map((frame) => ({
          id: frame.id,
          title: frame.contentDocument?.title,
          display: getComputedStyle(frame).display,
          visibility: getComputedStyle(frame).visibility,
          text: frame.contentDocument?.body?.innerText.slice(0, 200)
        })),
        title: document?.title,
        readyState: document?.readyState,
        status: document?.getElementById("status")?.textContent,
        target: document?.getElementById("target")?.textContent,
        scripts: [...(document?.scripts || [])].map((script) => ({
          nonce: script.nonce,
          length: script.textContent.length,
          containsReady: script.textContent.includes("announceReady")
        })),
        csp: document?.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
        hasVsCodeApi: typeof selected?.contentWindow?.acquireVsCodeApi,
        vscodeGlobals: Object.keys(selected?.contentWindow || {})
          .filter((key) => key.toLowerCase().includes("vscode") || key.toLowerCase().includes("message")),
        html: document?.documentElement?.outerHTML.slice(0, 3000),
        bodyText: document?.body?.innerText.slice(0, 1000)
      })})()`,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    }
    process.stdout.write(`${JSON.stringify(result.result.value, null, 2)}\n`);
  } finally {
    client.close();
  }
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 0;
    socket.addEventListener("open", () => resolve({
      request(method, params = {}) {
        const id = ++nextId;
        return new Promise((requestResolve, requestReject) => {
          pending.set(id, { resolve: requestResolve, reject: requestReject });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() {
        socket.close();
      },
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== "number") return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket connection failed")));
  });
}
