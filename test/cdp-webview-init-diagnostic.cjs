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
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("Usage: node test/cdp-webview-init-diagnostic.cjs <port>");
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((candidate) => candidate.type === "iframe");
  if (target === undefined) {
    throw new Error("VS Code Webview target not found");
  }
  const client = await connectCdp(target.webSocketDebuggerUrl);
  const events = [];
  const record = (message) => {
    if (
      message.method === "Runtime.exceptionThrown" ||
      message.method === "Runtime.consoleAPICalled" ||
      message.method === "Log.entryAdded"
    ) {
      events.push(message);
    }
  };
  client.onEvent(record);
  try {
    await client.request("Runtime.enable");
    await client.request("Log.enable");
    await client.request("Runtime.evaluate", {
      expression: "location.reload()",
    });
    await delay(6_000);
    const response = await client.request("Runtime.evaluate", {
      expression: `(() => ({
        status: document.querySelector("#status")?.textContent ?? "",
        lines: document.querySelectorAll(".cm-line").length,
        inline: document.querySelectorAll(".texleaf-formula-widget-inline").length,
        block: document.querySelectorAll(".texleaf-formula-widget-block").length,
        structures: document.querySelectorAll(".texleaf-structure-widget").length,
        body: document.body.innerText.slice(0, 500),
      }))()`,
      returnByValue: true,
    });
    process.stdout.write(`${JSON.stringify({
      dom: response.result?.value,
      events: events.map(summarizeEvent),
    }, null, 2)}\n`);
  } finally {
    client.close();
  }
}

function summarizeEvent(message) {
  const details = message.params?.exceptionDetails;
  const entry = message.params?.entry;
  const args = message.params?.args;
  return {
    method: message.method,
    text: details?.text ?? entry?.text ??
      (Array.isArray(args)
        ? args.map((argument) => argument.value ?? argument.description ?? "").join(" ")
        : ""),
    exception: details?.exception?.description,
    stack: entry?.stackTrace,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    const listeners = new Set();
    let nextId = 1;
    socket.addEventListener("open", () => resolve({
      request(method, params = {}) {
        const id = nextId++;
        return new Promise((requestResolve, requestReject) => {
          pending.set(id, { resolve: requestResolve, reject: requestReject });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      onEvent(listener) {
        listeners.add(listener);
      },
      close() {
        socket.close();
      },
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) {
        for (const listener of listeners) {
          listener(message);
        }
        return;
      }
      const waiter = pending.get(message.id);
      if (waiter === undefined) {
        return;
      }
      pending.delete(message.id);
      if (message.error !== undefined) {
        waiter.reject(new Error(message.error.message));
      } else {
        waiter.resolve(message.result);
      }
    });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed")));
  });
}
