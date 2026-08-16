"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const bundlePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "dist", "extension.js");
const bundle = fs.readFileSync(bundlePath, "utf8");

assert.doesNotMatch(
  bundle,
  /\brequire\w*\(\s*["']\.\.?[\\/]/,
  "production bundle must not retain relative runtime require() calls",
);
assert.doesNotMatch(
  bundle,
  /["']\.\/impl\/(?:format|edit|scanner|parser)["']/,
  "jsonc-parser implementation modules must be bundled into extension.js",
);

const runtimeRequests = [
  ...bundle.matchAll(/\brequire\w*\(\s*["']([^"']+)["']\s*\)/g),
].map((match) => match[1]);
assert.deepEqual(
  [...new Set(runtimeRequests)],
  ["vscode", "node:crypto", "node:worker_threads"],
  "only VS Code and explicitly approved Node built-ins may remain external",
);

const originalLoad = Module._load;
Module._load = function loadWithVsCodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  delete require.cache[bundlePath];
  const extension = require(bundlePath);
  assert.equal(typeof extension.activate, "function");
  assert.equal(typeof extension.deactivate, "function");
} finally {
  Module._load = originalLoad;
  delete require.cache[bundlePath];
}

console.log("Bundle smoke test passed: extension.js is self-contained and loadable.");
