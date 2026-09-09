import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("PDF.js preview resource roots remain URLs with trailing slashes on every OS", () => {
  const provider = readFileSync(path.join(process.cwd(), "src/visualEditorProvider.ts"), "utf8");
  assert.match(provider, /const pdfAssetsUri = webview\.asWebviewUri\(\s*vscode\.Uri\.joinPath\(this\.context\.extensionUri, "dist", "pdfjs"\)/u);
  assert.ok(provider.includes('data-pdf-assets="${pdfAssetsUri}/"'));
  const source = ts.createSourceFile("webview.ts", readFileSync(path.join(process.cwd(), "src/visualEditorWebview.ts"), "utf8"), ts.ScriptTarget.ES2022, true);
  const roots: ts.PropertyAssignment[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ["cMapUrl", "standardFontDataUrl", "wasmUrl", "iccUrl"].includes(node.name.getText(source))) roots.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(roots.length, 4);
  for (const base of ["file:///C:/PDF%20资料/扩展/dist/pdfjs/", "file:///home/user/PDF%20资料/dist/pdfjs/"]) {
    const assets = `https://file+.vscode-resource.vscode-cdn.net${new URL(base).pathname}`;
    for (const root of roots) {
      const value = runInNewContext(root.initializer.getText(source), { assets }) as string;
      assert.ok(value.endsWith("/"), `${root.name.getText(source)} must satisfy PDF.js URL validation`);
      assert.ok(!value.includes("\\"), "filesystem separators must not enter resource URLs");
      assert.equal(new URL(value).protocol, "https:");
      assert.equal(new URL("asset.bin", value).href, new URL(value).href + "asset.bin");
    }
  }
});
