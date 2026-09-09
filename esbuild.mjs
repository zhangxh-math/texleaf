/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import * as esbuild from "esbuild";
import { copyFile, cp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
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

const visualEditorOptions = {
  absWorkingDir: workspaceRoot,
  bundle: true,
  format: "iife",
  mainFields: ["browser", "module", "main"],
  platform: "browser",
  target: "es2022",
  sourcemap: watch,
  logLevel: "info",
  entryPoints: [path.join(workspaceRoot, "src", "visualEditorWebview.ts")],
  outfile: path.join(workspaceRoot, "dist", "visualEditor.js"),
};

// VS Code Webviews only support workers loaded from data:/blob: URLs and ask
// extensions to bundle worker code into one file. Keep PDF.js' named ESM export
// and global initializer so the same pinned module can run in the PDF-only
// Webview realm. A dedicated Webview Worker is deliberately not used: Electron
// can postpone its Promise continuations for roughly 30 seconds even when the
// PDF split is visible, while the isolated PDF Webview realm remains responsive.
const pdfWorkerOptions = {
  absWorkingDir: workspaceRoot,
  bundle: true,
  format: "esm",
  mainFields: ["browser", "module", "main"],
  platform: "browser",
  target: "es2022",
  sourcemap: watch,
  logLevel: "info",
  entryPoints: [path.join(workspaceRoot, "node_modules", "pdfjs-dist", "build", "pdf.worker.mjs")],
  outfile: path.join(workspaceRoot, "dist", "pdfjs", "pdf.worker.bundle.mjs"),
};

async function buildQuiver(dist) {
  const source = path.join(workspaceRoot, "vendor", "quiver");
  const icons = {};
  for (const name of await readdir(path.join(source, "icons"))) {
    if (name.endsWith(".svg")) icons[name] = "data:image/svg+xml;base64," + (await readFile(path.join(source, "icons", name))).toString("base64");
  }
  const result = await esbuild.build({
    entryPoints: ["src/quiver/embedded.mjs"], bundle: true, write: false, format: "iife",
    platform: "browser", target: "es2022", minify: !watch,
    define: {TEXLEAF_QUIVER_ICONS: JSON.stringify(icons)},
  });
  let katex = await readFile(path.join(source, "KaTeX", "katex.css"), "utf8");
  // Chromium needs only WOFF2. Inline assets keep the sandbox independent of
  // VS Code's service worker, which cannot route resource requests from child frames.
  katex = katex.replace(/src:.*?url\((fonts\/[^)]+\.woff2)\) format\("woff2"\)[^;]*;/g, 'src:url($1) format("woff2");');
  for (const name of new Set([...katex.matchAll(/url\((fonts\/[^)]+)\)/g)].map(match => match[1]))) {
    katex = katex.replaceAll(`url(${name})`, `url(data:font/woff2;base64,${(await readFile(path.join(source, "KaTeX", name))).toString("base64")})`);
  }
  const css = await readFile(path.join(source, "main.css"), "utf8") + katex + await readFile("src/quiver/embedded.css", "utf8");
  const script = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
  await writeFile(path.join(dist, "quiver", "editor.html"), `<!doctype html><html lang="zh-CN" data-token="TEXLEAF_QUIVER_TOKEN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-TEXLEAF_QUIVER_NONCE'; style-src 'nonce-TEXLEAF_QUIVER_NONCE'; style-src-attr 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style nonce="TEXLEAF_QUIVER_NONCE">${css}</style><script type="module" nonce="TEXLEAF_QUIVER_NONCE">${script}</script></head><body><a id="logo-link"></a><div class="loading-screen hidden"></div></body></html>`);
}

async function copyRuntimeAssets() {
  const dist = path.join(workspaceRoot, "dist");
  const pdfJsSource = path.join(workspaceRoot, "node_modules", "pdfjs-dist");
  const pdfJsDestination = path.join(dist, "pdfjs");
  await mkdir(dist, { recursive: true });
  const quiverDestination = path.join(dist, "quiver");
  await rm(quiverDestination, {recursive: true, force: true});
  await mkdir(path.join(quiverDestination, "KaTeX"), {recursive: true});
  for (const name of ["LICENSE", "UPSTREAM.md", "quiver.sty", "KaTeX/LICENSE"]) {
    await copyFile(path.join(workspaceRoot, "vendor", "quiver", name), path.join(quiverDestination, name));
  }
  await buildQuiver(dist);
  await mkdir(pdfJsDestination, { recursive: true });
  await Promise.all([
    copyFile(
      path.join(
        workspaceRoot,
        "node_modules",
        "vscode-oniguruma",
        "release",
        "onig.wasm",
      ),
      path.join(dist, "onig.wasm"),
    ),
    copyFile(
      path.join(pdfJsSource, "LICENSE"),
      path.join(pdfJsDestination, "LICENSE"),
    ),
    ...["cmaps", "standard_fonts", "wasm", "iccs"].map((directory) =>
      cp(
        path.join(pdfJsSource, directory),
        path.join(pdfJsDestination, directory),
        { recursive: true, force: true },
      ),
    ),
  ]);
}

await copyRuntimeAssets();

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(extensionOptions),
    esbuild.context(workerOptions),
    esbuild.context(visualEditorOptions),
    esbuild.context(pdfWorkerOptions),
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("TeXLeaf is watching for changes...");
} else {
  // Release bundles share large dependency graphs; build them one at a time
  // so their peak memory usage does not accumulate on constrained machines.
  for (const options of [extensionOptions, workerOptions, visualEditorOptions, pdfWorkerOptions]) {
    await esbuild.build(options);
  }
}
