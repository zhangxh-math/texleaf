import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import {
  createMathPreviewRenderInput,
  scanMathPreviewDocument,
  toMathJaxMacroOptions,
} from "../src/core/mathPreview";
import type { MathPreviewWorkerResponse } from "../src/mathPreviewProtocol";

test("shared formula previews render text comparison symbols without changing source or macro precedence", async () => {
  const workerSource = transpileModule(
    readFileSync(path.join(process.cwd(), "src/mathPreviewWorker.ts"), "utf8"),
    { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } },
  ).outputText;
  // Eval workers start relative to cwd. Resolve the worker's relative imports
  // alongside the compiled source modules, just as a file-backed worker does.
  const workerRequire = `"use strict";\nrequire = require("node:module").createRequire(${JSON.stringify(require.resolve("../src/mathPreviewProtocol"))});\n`;
  const worker = new Worker(workerRequire + workerSource, {
    eval: true,
    resourceLimits: { maxOldGenerationSizeMb: 128 },
  });
  let id = 0;
  try {
    const source = String.raw`$0 \leq \lambda t/(2\pi) \textless 10$ and
\(x \textgreater 0\) and $a\textminus b\texttimes c$.`;
    const snapshot = scanMathPreviewDocument(source);
    assert.equal(snapshot.formulas.length, 3);
    const expected = [
      { tex: String.raw`0 \leq \lambda t/(2\pi) \textless 10`, glyphs: ["2264", "3C"] },
      { tex: String.raw`x \textgreater 0`, glyphs: ["3E"] },
      { tex: String.raw`a\textminus b\texttimes c`, glyphs: ["2212", "D7"] },
    ];
    for (const [index, formula] of snapshot.formulas.entries()) {
      const input = createMathPreviewRenderInput(source, formula, snapshot);
      assert.ok(input);
      assert.equal(input.tex, expected[index]!.tex);
      const reply = once(worker, "message", { signal: AbortSignal.timeout(5_000) });
      worker.postMessage({ type: "render", id: ++id, ...input,
        macros: toMathJaxMacroOptions(input.macros), foreground: "#202020", scale: 1 });
      const [result] = await reply as [MathPreviewWorkerResponse];
      assert.equal(result.type, "result", result.type === "error" ? result.message : input.tex);
      if (result.type !== "result") continue;
      for (const glyph of expected[index]!.glyphs) {
        assert.match(result.svg, new RegExp(`data-c=["']${glyph}["']`, "iu"));
      }
    }
    const reply = once(worker, "message", { signal: AbortSignal.timeout(5_000) });
    worker.postMessage({ type: "render", id: ++id, tex: String.raw`x\textless 1`, display: false,
      macros: { textless: String.raw`\leq` }, macroFingerprint: "custom-textless", foreground: "#202020", scale: 1 });
    const [overridden] = await reply as [MathPreviewWorkerResponse];
    assert.equal(overridden.type, "result");
    if (overridden.type === "result") assert.match(overridden.svg, /data-c=["']2264["']/iu);
  } finally {
    await worker.terminate();
  }
});
