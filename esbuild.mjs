import * as esbuild from "esbuild";
import path from "node:path";

const watch = process.argv.includes("--watch");
const workspaceRoot = process.cwd();
const commonOptions = {
  absWorkingDir: workspaceRoot,
  bundle: true,
  format: "cjs",
  // jsonc-parser publishes a UMD `main` whose aliased `require` calls cannot
  // be statically bundled. Prefer its ESM entry so every implementation
  // module is included in the single-file VSIX runtime.
  mainFields: ["module", "main"],
  platform: "node",
  target: "node20",
  // Keep source maps for the development watcher, but do not leave a
  // sourceMappingURL in the self-contained production bundle when the map is
  // intentionally excluded from the VSIX.
  sourcemap: watch,
  logLevel: "info",
};

const extensionOptions = {
  ...commonOptions,
  entryPoints: [path.join(workspaceRoot, "src", "extension.ts")],
  outfile: path.join(workspaceRoot, "dist", "extension.js"),
  external: ["vscode"],
};

const workerOptions = {
  ...commonOptions,
  entryPoints: [path.join(workspaceRoot, "src", "mathPreviewWorker.ts")],
  outfile: path.join(workspaceRoot, "dist", "mathPreviewWorker.js"),
};

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(extensionOptions),
    esbuild.context(workerOptions),
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("TeXLeaf is watching for changes...");
} else {
  await Promise.all([
    esbuild.build(extensionOptions),
    esbuild.build(workerOptions),
  ]);
}
