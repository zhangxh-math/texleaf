/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

"use strict";

const port = Number(process.argv[2]);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((candidate) => candidate.type === "page");
  if (target === undefined) throw new Error("VS Code page target not found");
  const client = await connectCdp(target.webSocketDebuggerUrl);
  try {
    await client.request("Runtime.enable");
    const response = await client.request("Runtime.evaluate", {
      expression: `(() => ({
        screenX: window.screenX,
        screenY: window.screenY,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        frames: [...document.querySelectorAll("iframe, webview")].map((element) => {
          const box = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            id: element.id,
            className: String(element.className),
            src: element.getAttribute("src"),
            box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
          };
        }),
      }))()`,
      returnByValue: true,
    });
    process.stdout.write(`${JSON.stringify(response.result?.value, null, 2)}\n`);
  } finally {
    client.close();
  }
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
