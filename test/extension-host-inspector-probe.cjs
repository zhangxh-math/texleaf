/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

"use strict";

/** Evaluate a read-only expression in an isolated VS Code extension host. */

const http = require("node:http");

const port = Number(process.argv[2]);
const expression = process.argv.slice(3).join(" ");
if (!Number.isInteger(port) || expression.length === 0) {
  throw new Error("Usage: node extension-host-inspector-probe.cjs <port> <expression>");
}

void (async () => {
const targets = await new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${port}/json/list`, (response) => {
    let raw = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { raw += chunk; });
    response.on("end", () => resolve(JSON.parse(raw)));
  }).on("error", reject);
});
const target = targets.find((candidate) => candidate.webSocketDebuggerUrl);
if (target === undefined) {
  throw new Error("No extension-host inspector target found.");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Inspector timed out.")), 10_000);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
    }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) {
      return;
    }
    clearTimeout(timeout);
    resolve(message);
  });
  socket.addEventListener("error", reject);
});
socket.close();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
