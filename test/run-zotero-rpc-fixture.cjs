/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

"use strict";

/** A deterministic Better BibTeX JSON-RPC fixture for visual citation QA. */

const { createServer } = require("node:http");

const port = parsePort(process.argv.slice(2));
let exportCalls = 0;
const reference = {
  title: "Visual Zotero Bridge Fixture",
  author: [{ given: "Verity", family: "VisualAuthor" }],
  "container-title": "Custom Editor Integration Journal",
  issued: { "date-parts": [[2027]] },
  DOI: "10.5555/texleaf.visual.2027",
  citekey: "VisualZotero2027",
};

const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      let result;
      switch (body.method) {
        case "api.ready":
          result = { zotero: "8.0-visual-test", betterbibtex: "9.0-visual-test" };
          break;
        case "user.groups":
          result = [{ id: 1, name: "My Library" }];
          break;
        case "item.search":
          result = [reference];
          break;
        case "item.export":
          exportCalls += 1;
          result = [
            "@article{VisualZotero2027,",
            "  title = {Visual Zotero Bridge Fixture},",
            "  author = {VisualAuthor, Verity},",
            "  journal = {Custom Editor Integration Journal},",
            "  year = {2027},",
            "  doi = {10.5555/texleaf.visual.2027}",
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

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`${JSON.stringify({
    pid: process.pid,
    port: typeof address === "object" && address !== null ? address.port : port,
    citekey: reference.citekey,
    title: reference.title,
  })}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}

function parsePort(argv) {
  const index = argv.indexOf("--port");
  const raw = index >= 0 ? argv[index + 1] : "0";
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error("Usage: node test/run-zotero-rpc-fixture.cjs [--port <0-65535>]");
  }
  return parsed;
}
