/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { beamerForwardSynctexLine, beamerReverseSynctexOffset } from "../src/core/beamerSynctex";

const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{First}
First body.
\end{frame}
\begin{frame}[plain]{Second}
Second body.
\end{frame} % deferred title
\begin{frame}[fragile=singleslide]{Third}
Third body.
\end{frame}
\end{document}`;

test("collected Beamer frames use their own end line, while direct frames keep precise SyncTeX", () => {
  assert.equal(beamerForwardSynctexLine(source, source.indexOf("Second body")), 8);
  assert.equal(beamerForwardSynctexLine(source, source.indexOf("First body")), 5);
  assert.equal(beamerForwardSynctexLine(source, source.indexOf("Third body")), undefined);
  assert.equal(beamerForwardSynctexLine(source, source.indexOf("documentclass")), undefined);
  assert.equal(beamerForwardSynctexLine(String.raw`\begin{document}Text\end{document}`, 20), undefined);
});

test("a frame-end reverse hit reveals its frame header without changing ordinary body hits", () => {
  const end = source.indexOf(String.raw`\end{frame} %`);
  assert.equal(beamerReverseSynctexOffset(source, end), source.indexOf(String.raw`\begin{frame}[plain]`));
  const body = source.indexOf("Third body");
  assert.equal(beamerReverseSynctexOffset(source, body), undefined);
  assert.equal(beamerReverseSynctexOffset(source, source.indexOf(String.raw`\end{document}`)), undefined);
  const fake = String.raw`\begin{document}\begin{verbatim}
\begin{frame}Fake\end{frame}
\end{verbatim}\end{document}`;
  assert.equal(beamerForwardSynctexLine(fake, fake.indexOf("Fake")), undefined);
});


test("fragile frames retain precise queries after overlays or header comments", () => {
  for (const header of ['<1->[fragile=singleslide]', '[<+->][fragile=singleslide]', '% options follow\n[fragile=singleslide]']) {
    const text = source.replace('[plain]', header);
    assert.equal(beamerForwardSynctexLine(text, text.indexOf('Second body')), undefined, header);
  }
  const collected = source.replace('[plain]', '<1->[plain]');
  assert.equal(beamerForwardSynctexLine(collected, collected.indexOf('Second body')), 8);
});
