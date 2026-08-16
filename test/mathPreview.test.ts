import assert from "node:assert/strict";
import test from "node:test";
import {
  createMathPreviewCursorRenderInput,
  createMathPreviewRenderInput,
  findSafeMathPreviewCursorOffset,
  findMathPreviewFormulaAt,
  scanMathPreviewDocument,
  toMathJaxMacroOptions,
} from "../src/core";
import { createMathPreviewSvgDataUri } from "../src/mathPreviewDataUri";

test("Math Preview SVG data URIs preserve internal references and Unicode", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" aria-label="公式 α"><defs>' +
    '<path id="字形-α" d="M0 0h1v1z"/></defs><use href="#字形-α"/></svg>';
  const prefix = "data:image/svg+xml;base64,";
  const dataUri = createMathPreviewSvgDataUri(svg);

  assert.ok(dataUri.startsWith(prefix));
  assert.equal(new URL(dataUri).hash, "");
  assert.doesNotMatch(dataUri, /#|公式|字形|α/u);
  assert.equal(
    Buffer.from(dataUri.slice(prefix.length), "base64").toString("utf8"),
    svg,
  );
});

test("Math Preview indexes every supported delimiter with exact UTF-16 ranges", () => {
  const text = String.raw`😀 $a$ \(b\) $$c$$ \[d\]`;
  const snapshot = scanMathPreviewDocument(text);
  assert.deepEqual(
    snapshot.formulas.map((formula) => ({
      syntax: formula.syntax,
      body: text.slice(formula.bodyRange.start, formula.bodyRange.end),
      outer: text.slice(formula.outerRange.start, formula.outerRange.end),
      mode: formula.mode,
    })),
    [
      { syntax: "dollar-inline", body: "a", outer: "$a$", mode: "inline" },
      { syntax: "paren-inline", body: "b", outer: String.raw`\(b\)`, mode: "inline" },
      { syntax: "dollar-display", body: "c", outer: "$$c$$", mode: "block" },
      { syntax: "bracket-display", body: "d", outer: String.raw`\[d\]`, mode: "block" },
    ],
  );
});

test("nested math environments produce one top-level preview", () => {
  const text = String.raw`\begin{align}
  f(x)&=\begin{cases}x,&x>0\\0,&x\le 0\end{cases}
\end{align}`;
  const snapshot = scanMathPreviewDocument(text);
  assert.equal(snapshot.formulas.length, 1);
  const formula = snapshot.formulas[0];
  assert.equal(formula?.environmentName, "align");
  const cursor = text.indexOf("x>0") + 1;
  assert.equal(findMathPreviewFormulaAt(snapshot, cursor), formula);

  const input = formula === undefined
    ? undefined
    : createMathPreviewRenderInput(text, formula, snapshot, cursor);
  assert.ok(input);
  assert.match(input.tex, /^\\begin\{align\}/u);
  assert.match(input.tex, /\\begin\{cases\}/u);
  assert.match(input.tex, /\\end\{align\}$/u);
  assert.equal(input.display, true);
});

test("comments, verb commands and verbatim environments never create previews", () => {
  const text = String.raw`% $comment$
\verb|$verb$|
\begin{verbatim}
\[hidden\]
\end{verbatim}
$visible$`;
  const snapshot = scanMathPreviewDocument(text);
  assert.equal(snapshot.formulas.length, 1);
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  assert.equal(text.slice(formula.bodyRange.start, formula.bodyRange.end), "visible");
});

test("an unclosed formula is provisionally rendered only through the cursor", () => {
  const text = "prefix $x^2 trailing prose";
  const snapshot = scanMathPreviewDocument(text);
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  assert.equal(formula.closed, false);
  const cursor = text.indexOf(" trailing");
  const input = createMathPreviewRenderInput(text, formula, snapshot, cursor);
  assert.equal(input?.tex, "x^2");
});

test("cursor render input maps trimmed source offsets without moving the caret", () => {
  const text = "$  x+y  $";
  const snapshot = scanMathPreviewDocument(text);
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  const marker = String.raw`\mathord{|}`;
  const cursor = text.indexOf("x") + 1;
  const input = createMathPreviewCursorRenderInput(
    text,
    formula,
    snapshot,
    cursor,
    marker,
  );
  assert.equal(input?.tex, `x${marker}+y`);
});

test("cursor input preserves an align wrapper and inserts inside its active cell", () => {
  const text = String.raw`\begin{align}
q(x,y)&=x+y\\
r&=\frac{a}{b}
\end{align}`;
  const snapshot = scanMathPreviewDocument(text);
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  const marker = String.raw`\mathord{|}`;
  const cursor = text.indexOf("x+y") + 1;
  const input = createMathPreviewCursorRenderInput(
    text,
    formula,
    snapshot,
    cursor,
    marker,
  );
  assert.ok(input);
  assert.match(input.tex, /^\\begin\{align\}/u);
  assert.match(input.tex, /x\\mathord\{\|\}\+y/u);
  assert.match(input.tex, /\\end\{align\}$/u);
});

test("cursor planner never splits commands or steals fraction arguments", () => {
  const fraction = String.raw`\frac{a}{b}`;
  const afterCommand = fraction.indexOf("{");
  const betweenArguments = fraction.indexOf("}{") + 1;
  assert.equal(
    findSafeMathPreviewCursorOffset(fraction, afterCommand),
    fraction.indexOf("{") + 1,
  );
  assert.equal(
    findSafeMathPreviewCursorOffset(fraction, betweenArguments),
    fraction.lastIndexOf("{") + 1,
  );

  const lambda = String.raw`\lambda+x`;
  const insideControlWord = lambda.indexOf("m");
  const safe = findSafeMathPreviewCursorOffset(lambda, insideControlWord);
  assert.equal(safe, 0);
  const marked = `${lambda.slice(0, safe)}<caret>${lambda.slice(safe)}`;
  assert.doesNotMatch(marked, /\\lam<caret>bda/u);
});

test("cursor planner fails closed for unknown commands with unbraced arguments", () => {
  for (const tex of [String.raw`\not=`, String.raw`\bigl(`, String.raw`\foo x`]) {
    const commandEnd = tex.indexOf(" ") >= 0
      ? tex.indexOf(" ")
      : tex.length - 1;
    const safe = findSafeMathPreviewCursorOffset(tex, commandEnd);
    assert.notEqual(
      safe,
      commandEnd,
      `the marker must not become the next token consumed by ${tex}`,
    );
    assert.equal(
      safe,
      tex.length,
      `an ambiguous invocation should snap after its possible argument in ${tex}`,
    );
  }

  const lambda = String.raw`\lambda+x`;
  const afterLambda = lambda.indexOf("+");
  assert.equal(
    findSafeMathPreviewCursorOffset(lambda, afterLambda),
    afterLambda,
    "a known no-argument symbol keeps its exact following boundary",
  );

  const sine = String.raw`\sin x`;
  const afterSine = sine.indexOf(" ");
  assert.equal(
    findSafeMathPreviewCursorOffset(sine, afterSine),
    afterSine,
    "a standard named operator must not be mistaken for an argument-taking macro",
  );

  const nineArguments = String.raw`\foo{1}{2}{3}{4}{5}{6}{7}{8}9`;
  const beforeNinth = nineArguments.length - 1;
  assert.equal(
    findSafeMathPreviewCursorOffset(nineArguments, beforeNinth),
    nineArguments.length,
    "the ninth and final TeX macro argument must not consume the marker",
  );
});

test("cursor planner keeps postfix limit modifiers attached to their operator", () => {
  for (const modifier of ["limits", "nolimits", "displaylimits"]) {
    const tex = `\\sum\\${modifier}_{i=0}`;
    const betweenOperatorAndModifier = String.raw`\sum`.length;
    const safe = findSafeMathPreviewCursorOffset(tex, betweenOperatorAndModifier);
    assert.notEqual(safe, betweenOperatorAndModifier);
    assert.equal(
      safe,
      0,
      `the caret should snap before the complete \\sum\\${modifier} atom`,
    );
  }
});

test("cursor planner abandons pathological nested macros within a linear budget", () => {
  const depth = 500;
  const tex = `${String.raw`\foo{`.repeat(depth)}x${"}".repeat(depth)}`;
  assert.equal(
    findSafeMathPreviewCursorOffset(tex, Math.floor(tex.length / 2)),
    undefined,
  );
});

test("cursor planner bounds long script chains without recursion", () => {
  const tex = `x${"^1".repeat(12_000)}`;
  assert.doesNotThrow(() => {
    assert.equal(
      findSafeMathPreviewCursorOffset(tex, tex.length),
      undefined,
    );
  });
});

test("cursor planner protects delimiters, scripts, comments, and UTF-16 pairs", () => {
  const delimited = String.raw`\left( x \right)`;
  assert.equal(
    findSafeMathPreviewCursorOffset(delimited, delimited.indexOf("f")),
    delimited.indexOf("(") + 1,
  );

  const scripts = "x^2_3";
  const beforeSubscript = scripts.indexOf("_");
  assert.equal(
    findSafeMathPreviewCursorOffset(scripts, beforeSubscript),
    scripts.length,
    "a marker between two unbraced scripts must not become the new subscript base",
  );

  const comment = "x% hidden marker\ny";
  const insideComment = comment.indexOf("marker") + 2;
  const commentSafe = findSafeMathPreviewCursorOffset(comment, insideComment);
  assert.ok(commentSafe === comment.indexOf("%") || commentSafe === comment.indexOf("\n") + 1);

  const unicode = "x😀y";
  const insideSurrogatePair = unicode.indexOf("😀") + 1;
  assert.equal(
    findSafeMathPreviewCursorOffset(unicode, insideSurrogatePair),
    unicode.indexOf("😀") + "😀".length,
  );
});

test("configured macro argument slots use the resolved macro signature", () => {
  const tex = String.raw`\pair{y}`;
  const macros = {
    pair: {
      name: "pair",
      replacement: String.raw`\left(#1,#2\right)`,
      argumentCount: 2,
      optionalDefault: "x",
    },
  } as const;
  assert.equal(
    findSafeMathPreviewCursorOffset(tex, tex.indexOf("{"), macros),
    tex.indexOf("{") + 1,
  );
});

test("configured and preamble macros resolve without evaluating arbitrary TeX", () => {
  const text = String.raw`
% \newcommand{\ignored}{bad}
\newcommand{\RR}{\mathbb{R}}
\providecommand{\fromConfig}{document-should-not-win}
\newcommand{\pair}[2][x]{\left(#1,#2\right)}
\DeclareMathOperator*{\argmax}{arg\,max}
\begin{document}
\renewcommand{\RR}{ignored-after-document}
$\pair{y}\subset\RR$
\end{document}`;
  const snapshot = scanMathPreviewDocument(text, {
    configuredMacros: {
      fromConfig: "configured",
      abs: String.raw`\left|#1\right|`,
    },
  });
  assert.equal(snapshot.macros.RR?.replacement, String.raw`\mathbb{R}`);
  assert.equal(snapshot.macros.fromConfig?.replacement, "configured");
  assert.equal(snapshot.macros.abs?.argumentCount, 1);
  assert.deepEqual(snapshot.macros.pair, {
    name: "pair",
    replacement: String.raw`\left(#1,#2\right)`,
    argumentCount: 2,
    optionalDefault: "x",
  });
  assert.equal(
    snapshot.macros.argmax?.replacement,
    String.raw`\operatorname*{arg\,max}`,
  );

  const options = toMathJaxMacroOptions(snapshot.macros);
  assert.deepEqual(options.abs, [String.raw`\left|#1\right|`, 1]);
  assert.deepEqual(options.pair, [String.raw`\left(#1,#2\right)`, 2, "x"]);
});

test("macro tables stay within the worker's serialized request budget", () => {
  const replacement = `#1${"x".repeat(2_046)}`;
  const configuredMacros = Object.fromEntries(
    "abcdefghij".split("").map((suffix) => [`macro${suffix}`, replacement]),
  );
  const text = String.raw`\newcommand{\documenthuge}[1]{${replacement}}
\newcommand{\tail}{ok}
\begin{document}$x$\end{document}`;
  const snapshot = scanMathPreviewDocument(text, { configuredMacros });
  const options = toMathJaxMacroOptions(snapshot.macros);

  assert.ok(JSON.stringify(options).length <= 16_384);
  assert.equal(snapshot.macros.macroa?.replacement, replacement);
  assert.equal(snapshot.macros.macroh, undefined);
  assert.equal(snapshot.macros.documenthuge, undefined);
  assert.equal(snapshot.macros.tail?.replacement, "ok");
});

test("macro fingerprints depend on resolved definitions, not source offsets", () => {
  const first = scanMathPreviewDocument(String.raw`\newcommand{\foo}{x}\begin{document}$\foo$`);
  const shifted = scanMathPreviewDocument(String.raw`% comment
\newcommand{\foo}{x}\begin{document}$\foo$`);
  const changed = scanMathPreviewDocument(String.raw`\newcommand{\foo}{y}\begin{document}$\foo$`);
  assert.equal(first.macroFingerprint, shifted.macroFingerprint);
  assert.notEqual(first.macroFingerprint, changed.macroFingerprint);
});

test("source length limit rejects oversized formulas without hiding later formulas", () => {
  const text = `$${"x".repeat(300)}$ and $y$`;
  const snapshot = scanMathPreviewDocument(text, { maxSourceLength: 256 });
  assert.equal(snapshot.formulas.length, 1);
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  assert.equal(text.slice(formula.bodyRange.start, formula.bodyRange.end), "y");
});

test("a full LaTeX document previews only its document body", () => {
  const text = String.raw`\newcommand{\sample}{$preamble$}
\begin{document}
$visible$
\end{document}
$after$`;
  const snapshot = scanMathPreviewDocument(text);
  assert.deepEqual(
    snapshot.formulas.map((formula) =>
      text.slice(formula.bodyRange.start, formula.bodyRange.end),
    ),
    ["visible"],
  );
  assert.equal(snapshot.macros.sample?.replacement, "$preamble$");
});

test("starred command definitions work and starred verbatim stays inert", () => {
  const text = String.raw`\begin{Verbatim*}
\newcommand{\hidden}{bad}
\end{Verbatim*}
\newcommand*{\visible}[1]{\mathbf{#1}}
\begin{document}$\visible{x}$\end{document}`;
  const snapshot = scanMathPreviewDocument(text);
  assert.equal(snapshot.macros.hidden, undefined);
  assert.equal(snapshot.macros.visible?.replacement, String.raw`\mathbf{#1}`);
  assert.equal(snapshot.macros.visible?.argumentCount, 1);
  assert.equal(snapshot.formulas.length, 1);
});
