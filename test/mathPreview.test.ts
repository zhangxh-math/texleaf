/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createMathPreviewMacroEnvironment,
  createMathPreviewCursorRenderInput,
  createMathPreviewRenderInput,
  findSafeMathPreviewCursorOffset,
  findMathPreviewFormulaAt,
  scanMathPreviewDocument,
  mathPreviewMacroEnvironmentAtOffset,
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
\begin{comment}
$commentHidden$
\end{comment}
\begin{filecontents*}{generated.tex}
$fileHidden$
\end{filecontents*}
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

test("split align delimiters, substack rows, and labels keep preview input available", () => {
  const text = String.raw`\begin{align}
C(\mathbf{d}) & =\sum_{j=1}^{n}\frac{2d_{j}+1}{\chi(\mathbf{d})-1}C(d_{1},\dots,d_{j}+d_{0},\dots,d_{n})+\sum_{\substack{a,b\geq0\\a+b=d_{0}-1}}\left(\frac{2}{\chi(\mathbf{d})-1}C(a,b,d_{1},\dots,d_{n})\right.\label{eq:bgw-recursion-linear}\\
&\left.+\sum_{I\sqcup J=\{ 1,\dots n \}}\frac{(\chi(a,\mathbf{d}_{I})-1)!(\chi(b,\mathbf{d}_{J})-1)!}{(\chi(d)-1)!}C(a.\mathbf{d}_{I})C(b,\mathbf{d}_{J})\right).\label{eq:bgw-recursion-quadric}
\end{align}`;
  const snapshot = scanMathPreviewDocument(text);
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  assert.equal(snapshot.formulas.length, 1);
  assert.equal(formula.environmentName, "align");

  const plain = createMathPreviewRenderInput(
    text,
    formula,
    snapshot,
    text.indexOf("quadric"),
  );
  assert.ok(plain);
  assert.equal(
    plain.tex,
    `\\begin{align}${text.slice(formula.bodyRange.start, formula.bodyRange.end).trim()}\\end{align}`,
  );

  const marker = String.raw`\mathord{\color{#ffb454}\rule[-0.2em]{0.07em}{1.2em}}`;
  const cursorOffsets = [
    text.indexOf(String.raw`a,b\geq0`) + "a,b".length,
    text.indexOf("recursion-linear") + "recursion".length,
    text.indexOf(String.raw`\label{eq:bgw-recursion-linear}`) + String.raw`\label{eq:bgw-recursion-linear}`.length,
    text.indexOf(String.raw`&\left.`) + 1,
    text.indexOf("recursion-quadric") + "recursion".length,
    text.indexOf("}\n\\end{align}") + 1,
  ];
  assert.equal(
    cursorOffsets.every(
      (offset) =>
        offset >= formula.bodyRange.start && offset <= formula.bodyRange.end,
    ),
    true,
    "every regression cursor must resolve to a real position inside the align body",
  );
  for (const cursorOffset of cursorOffsets) {
    assert.equal(findMathPreviewFormulaAt(snapshot, cursorOffset), formula);
    const marked = createMathPreviewCursorRenderInput(
      text,
      formula,
      snapshot,
      cursorOffset,
      marker,
    );
    assert.ok(marked, `cursor preview input at offset ${cursorOffset}`);
    assert.match(marked.tex, /^\\begin\{align\}/u);
    assert.match(marked.tex, /\\end\{align\}$/u);
    assert.equal(marked.tex.split(marker).length, 2);
    const markerOffset = marked.tex.indexOf(marker);
    for (const label of marked.tex.matchAll(/\\label\{[^}]*\}/gu)) {
      assert.ok(label.index !== undefined);
      assert.ok(
        markerOffset <= label.index || markerOffset >= label.index + label[0].length,
        "the visual caret marker must not enter a label argument that will be removed before rendering",
      );
    }
  }
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
  assert.equal(
    mathPreviewMacroEnvironmentAtOffset(
      snapshot,
      text.indexOf(String.raw`\renewcommand`),
    ).macros.RR?.replacement,
    String.raw`\mathbb{R}`,
  );
  assert.equal(snapshot.macros.RR?.replacement, "ignored-after-document");
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
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  assert.equal(
    createMathPreviewRenderInput(text, formula, snapshot)?.macros.RR?.replacement,
    "ignored-after-document",
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

test("opaque formula scanning requires exact physical closing markers", () => {
  const text = String.raw`\begin{comment}
prefix \end{comment} $ghostComment$
\end{comment}
$liveAfterComment$
\begin{verbatim}
\begin{verbatim}
\end{verbatim}
$liveAfterLiteralBegin$
\begin{verbatim}
\end {verbatim}
$ghostAfterSpacedEnd$
\end{verbatim}
$liveAfterExactEnd$`;
  const snapshot = scanMathPreviewDocument(text, { fragmentKind: "body" });

  assert.deepEqual(
    snapshot.formulas.map((formula) => text.slice(formula.bodyRange.start, formula.bodyRange.end)),
    ["liveAfterComment", "liveAfterLiteralBegin", "liveAfterExactEnd"],
  );
});

test("project macro environments are canonical, detached, immutable, and bounded", () => {
  const source = {
    beta: {
      name: "beta",
      replacement: String.raw`\mathbf{#1}`,
      argumentCount: 1,
    },
    alpha: {
      name: String.raw`\alpha`,
      replacement: "#1+#2",
      argumentCount: 0,
    },
  };
  const environment = createMathPreviewMacroEnvironment(source);
  const reordered = createMathPreviewMacroEnvironment({
    alpha: source.alpha,
    beta: source.beta,
  });

  assert.equal(environment.macroFingerprint, reordered.macroFingerprint);
  assert.equal(Object.getPrototypeOf(environment.macros), null);
  assert.equal(Object.isFrozen(environment), true);
  assert.equal(Object.isFrozen(environment.macros), true);
  assert.equal(Object.isFrozen(environment.macros.alpha), true);
  assert.equal(environment.macros.alpha?.name, "alpha");
  assert.equal(environment.macros.alpha?.argumentCount, 2);
  source.alpha.replacement = "mutated-after-copy";
  assert.equal(environment.macros.alpha?.replacement, "#1+#2");

  const oversized = createMathPreviewMacroEnvironment(
    Object.fromEntries(
      Array.from({ length: 160 }, (_, index) => {
        const name = `macro${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}`;
        return [name, { name, replacement: "x", argumentCount: 0 }];
      }),
    ),
  );
  assert.ok(Object.keys(oversized.macros).length <= 128);
  assert.ok(JSON.stringify(toMathJaxMacroOptions(oversized.macros)).length <= 16_384);
});

test("configured, inherited, and local macros merge in project order", () => {
  const inherited = createMathPreviewMacroEnvironment({
    shared: { name: "shared", replacement: "project", argumentCount: 0 },
    localWins: {
      name: "localWins",
      replacement: "project",
      argumentCount: 0,
    },
    projectOnly: {
      name: "projectOnly",
      replacement: "project-only",
      argumentCount: 0,
    },
  });
  const text = String.raw`\providecommand{\shared}{provided-must-not-win}
\renewcommand{\localWins}{local}
\begin{document}
$\shared+\localWins$
\newcommand{\bodyDefined}{body}
\end{document}`;
  const snapshot = scanMathPreviewDocument(text, {
    fragmentKind: "preamble",
    configuredMacros: {
      shared: "configured",
      localWins: "configured",
      configuredOnly: "configured-only",
    },
    inheritedMacroEnvironment: inherited,
  });

  assert.equal(snapshot.formulas.length, 0);
  assert.equal(snapshot.macros.shared?.replacement, "project");
  assert.equal(snapshot.macros.localWins?.replacement, "local");
  assert.equal(snapshot.macros.configuredOnly?.replacement, "configured-only");
  assert.equal(snapshot.macros.projectOnly?.replacement, "project-only");
  assert.equal(snapshot.macros.bodyDefined?.replacement, "body");
  assert.equal(Object.getPrototypeOf(snapshot.macros), null);
  assert.equal(Object.isFrozen(snapshot.macros), true);
});

test("a static ThuThesis-shaped preamble snapshot can directly seed a body file", () => {
  const preamble = scanMathPreviewDocument(
    String.raw`\providecommand{\uppi}{\mathrm{\pi}}
\newcommand{\symup}[1]{\mathrm{#1}}
\newcommand{\symbf}[1]{\mathbf{#1}}
\newcommand{\symbfsf}[1]{\mathbf{\mathsf{#1}}}
\newcommand{\increment}{\mathop{\Delta}}
\newcommand{\dif}{\mathop{}\!\mathrm{d}}`,
    { fragmentKind: "preamble" },
  );
  assert.equal(preamble.formulas.length, 0);

  const bodyText = String.raw`$\increment f=\symbf{x}+\symbfsf{y}+\symup{i}+\uppi+\dif x$`;
  const body = scanMathPreviewDocument(bodyText, {
    fragmentKind: "body",
    inheritedMacroEnvironment: preamble,
  });
  const formula = body.formulas[0];
  assert.ok(formula);
  const input = createMathPreviewRenderInput(bodyText, formula, body);
  assert.ok(input);
  for (const name of ["uppi", "symup", "symbf", "symbfsf", "increment", "dif"]) {
    assert.ok(input.macros[name], `inherited ${name}`);
  }
  assert.equal(input.macroFingerprint, preamble.macroFingerprint);
});

test("dynamic source definitions fail closed without shadowing capability fallbacks", () => {
  const inherited = createMathPreviewMacroEnvironment({
    dif: {
      name: "dif",
      replacement: String.raw`\mathop{}\!\mathrm{d}`,
      argumentCount: 0,
    },
    indirect: { name: "indirect", replacement: "I", argumentCount: 0 },
    reader: { name: "reader", replacement: "R", argumentCount: 0 },
    defines: { name: "defines", replacement: "D", argumentCount: 0 },
    safe: { name: "safe", replacement: "project-safe", argumentCount: 1 },
  });
  const text = String.raw`\newcommand\dif{\ifthu@math@style@TeX \mathrm{d}\else \mathop{}\!\mathrm{d}\fi}
\newcommand{\indirect}{\csname hidden\endcsname}
\newcommand{\reader}{\input{secret}$hidden-definition$}
\newcommand{\defines}{\def\inner{bad}\inner}
\renewcommand{\safe}[1]{\mathbf{#1}}
$\dif x+\indirect+\reader+\defines+\safe{x}$`;
  const snapshot = scanMathPreviewDocument(text, {
    fragmentKind: "body",
    inheritedMacroEnvironment: inherited,
  });
  assert.equal(snapshot.formulas.length, 1);
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  const input = createMathPreviewRenderInput(text, formula, snapshot);
  assert.ok(input);
  assert.equal(input.macros.dif?.replacement, String.raw`\mathop{}\!\mathrm{d}`);
  assert.equal(input.macros.indirect?.replacement, "I");
  assert.equal(input.macros.reader?.replacement, "R");
  assert.equal(input.macros.defines?.replacement, "D");
  assert.equal(input.macros.safe?.replacement, String.raw`\mathbf{#1}`);

  const rejectedEnvironment = createMathPreviewMacroEnvironment({
    unsafe: {
      name: "unsafe",
      replacement: String.raw`\csname dynamically-built\endcsname`,
      argumentCount: 0,
    },
  });
  assert.equal(rejectedEnvironment.macros.unsafe, undefined);
});

test("box-register macro definitions do not shadow double-angle preview fallbacks", () => {
  const inherited = createMathPreviewMacroEnvironment({
    llangle: {
      name: "llangle",
      replacement: String.raw`\langle\!\langle`,
      argumentCount: 0,
    },
    rrangle: {
      name: "rrangle",
      replacement: String.raw`\rangle\!\rangle`,
      argumentCount: 0,
    },
  });
  const text = String.raw`\renewcommand{\llangle}[1][]{\savebox{\@brx}{\(#1\langle\)}\mathopen{\copy\@brx\kern-0.5\wd\@brx\usebox{\@brx}}}
\renewcommand{\rrangle}[1][]{\savebox{\@brx}{\(#1\rangle\)}\mathclose{\copy\@brx\kern-0.5\wd\@brx\usebox{\@brx}}}
$\llangle\tau_n(P)\rrangle_0$`;
  const snapshot = scanMathPreviewDocument(text, {
    fragmentKind: "body",
    inheritedMacroEnvironment: inherited,
  });
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  const input = createMathPreviewRenderInput(text, formula, snapshot);
  assert.ok(input);
  assert.equal(input.macros.llangle?.replacement, String.raw`\langle\!\langle`);
  assert.equal(input.macros.rrangle?.replacement, String.raw`\rangle\!\rangle`);
});

test("fragment kinds separate standalone documents, body files, and preambles", () => {
  const text = String.raw`$before$
\newcommand{\wrapped}{$hidden-definition$}
\begin{document}$inside$\end{document}
$after$`;
  const bodies = (fragmentKind: "standalone" | "body" | "preamble") =>
    scanMathPreviewDocument(text, { fragmentKind }).formulas.map((formula) =>
      text.slice(formula.bodyRange.start, formula.bodyRange.end),
    );

  assert.deepEqual(bodies("standalone"), ["inside"]);
  assert.deepEqual(bodies("body"), ["before", "inside", "after"]);
  assert.deepEqual(bodies("preamble"), []);
});

test("body fragments resolve a bounded macro timeline per formula", () => {
  const inherited = createMathPreviewMacroEnvironment({
    foo: { name: "foo", replacement: "project", argumentCount: 0 },
  });
  const text = String.raw`$\foo$
\providecommand{\foo}{ignored}
$\foo$
\renewcommand{\foo}{local}
$\foo$
\newcommand{\late}{after}
$\foo+\late$`;
  const snapshot = scanMathPreviewDocument(text, {
    fragmentKind: "body",
    configuredMacros: { foo: "configured" },
    inheritedMacroEnvironment: {
      macros: inherited.macros,
      macroFingerprint: "forged-stale-fingerprint",
    },
  });
  assert.equal(snapshot.formulas.length, 4);
  assert.ok(snapshot.macroEnvironments);
  assert.equal(snapshot.macroEnvironments.length, 3);
  assert.ok(snapshot.macroEnvironments.length <= 129);

  const inputs = snapshot.formulas.map((formula) => {
    const input = createMathPreviewRenderInput(text, formula, snapshot);
    assert.ok(input);
    return input;
  });
  assert.equal(inputs[0]?.macros.foo?.replacement, "project");
  assert.equal(inputs[1]?.macros.foo?.replacement, "project");
  assert.equal(inputs[2]?.macros.foo?.replacement, "local");
  assert.equal(inputs[3]?.macros.foo?.replacement, "local");
  assert.equal(inputs[3]?.macros.late?.replacement, "after");
  assert.equal(inputs[0]?.macroFingerprint, inputs[1]?.macroFingerprint);
  assert.notEqual(inputs[1]?.macroFingerprint, inputs[2]?.macroFingerprint);
  assert.notEqual(inputs[2]?.macroFingerprint, inputs[3]?.macroFingerprint);
  assert.notEqual(inputs[0]?.macroFingerprint, "forged-stale-fingerprint");
  assert.equal(snapshot.macros.foo?.replacement, "local");
  assert.equal(snapshot.macros.late?.replacement, "after");

  const thirdFormula = snapshot.formulas[2];
  assert.ok(thirdFormula);
  const cursorInput = createMathPreviewCursorRenderInput(
    text,
    thirdFormula,
    snapshot,
    thirdFormula.bodyRange.end,
    String.raw`\mathord{|}`,
  );
  assert.ok(cursorInput);
  assert.equal(cursorInput.macros.foo?.replacement, "local");
  assert.equal(cursorInput.macroFingerprint, inputs[2]?.macroFingerprint);
});

test("standalone body macros remain position-sensitive after the preamble", () => {
  const inherited = createMathPreviewMacroEnvironment({
    foo: { name: "foo", replacement: "project", argumentCount: 0 },
  });
  const text = String.raw`$\foo$\renewcommand{\foo}{local}$\foo$`;
  const snapshot = scanMathPreviewDocument(text, {
    inheritedMacroEnvironment: inherited,
  });
  const first = snapshot.formulas[0];
  const second = snapshot.formulas[1];
  assert.ok(first);
  assert.ok(second);
  const firstInput = createMathPreviewRenderInput(text, first, snapshot);
  const secondInput = createMathPreviewRenderInput(text, second, snapshot);
  assert.ok(firstInput);
  assert.ok(secondInput);
  assert.equal(firstInput.macros.foo?.replacement, "project");
  assert.equal(secondInput.macros.foo?.replacement, "local");
  assert.notEqual(first.macroEnvironmentIndex, undefined);
  assert.ok(snapshot.macroEnvironments);
  assert.equal(
    mathPreviewMacroEnvironmentAtOffset(snapshot, first.outerRange.start)
      .macros.foo?.replacement,
    "project",
  );
  assert.equal(
    mathPreviewMacroEnvironmentAtOffset(snapshot, second.outerRange.start)
      .macros.foo?.replacement,
    "local",
  );
});

test("local groups and literal false branches cannot leak Math Preview macros", () => {
  const text = String.raw`{\newcommand{\local}{inside}$\local$}
$\local$
\iffalse
\newcommand{\dead}{never}
$\dead$
\fi
\iftrue
\newcommand{\conditional}{unproven}
$\conditional$
\fi
$x$`;
  const snapshot = scanMathPreviewDocument(text, { fragmentKind: "body" });

  assert.deepEqual(
    snapshot.formulas.map((formula) =>
      text.slice(formula.bodyRange.start, formula.bodyRange.end)
    ),
    [String.raw`\local`, String.raw`\local`, "x"],
  );
  for (const formula of snapshot.formulas) {
    const input = createMathPreviewRenderInput(text, formula, snapshot);
    assert.ok(input);
    assert.equal(input.macros.local, undefined);
    assert.equal(input.macros.dead, undefined);
    assert.equal(input.macros.conditional, undefined);
  }
});

test("newif targets are declarations and custom conditional macros stay inactive", () => {
  const text = String.raw`\newif\ifdraft
\newcommand{\beforebranch}{B}
\ifdraft
\newcommand{\conditional}{unsafe}
$\conditional$
\fi
\newcommand{\afterbranch}{A}
$\beforebranch+\afterbranch$`;
  const snapshot = scanMathPreviewDocument(text, { fragmentKind: "body" });

  assert.deepEqual(
    snapshot.formulas.map((formula) =>
      text.slice(formula.bodyRange.start, formula.bodyRange.end)
    ),
    [String.raw`\beforebranch+\afterbranch`],
  );
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  const environment = mathPreviewMacroEnvironmentAtOffset(
    snapshot,
    formula.outerRange.start,
  );
  assert.equal(environment.macros.beforebranch?.replacement, "B");
  assert.equal(environment.macros.afterbranch?.replacement, "A");
  assert.equal(environment.macros.conditional, undefined);
});

test("function-style conditional branches never publish formulas or macros", () => {
  const text = String.raw`\IfFileExists{choice.tex}{
  \newcommand{\branch}{A}$a$
}{
  \newcommand{\branch}{B}$b$
}
\newcommand{\after}{safe}
$\after$`;
  const snapshot = scanMathPreviewDocument(text, { fragmentKind: "body" });

  assert.deepEqual(
    snapshot.formulas.map((formula) =>
      text.slice(formula.bodyRange.start, formula.bodyRange.end)
    ),
    [String.raw`\after`],
  );
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  const environment = mathPreviewMacroEnvironmentAtOffset(
    snapshot,
    formula.outerRange.start,
  );
  assert.equal(environment.macros.branch, undefined);
  assert.equal(environment.macros.after?.replacement, "safe");
});

test("ordinary LaTeX environments cannot leak local Math Preview macros", () => {
  const text = String.raw`\newcommand{\body}{B}
\begin{table}
\newcommand{\local}{L}
$\local+\body$
\end{table}
$\local+\body$`;
  const snapshot = scanMathPreviewDocument(text, { fragmentKind: "body" });
  assert.equal(snapshot.formulas.length, 2);
  for (const formula of snapshot.formulas) {
    const environment = mathPreviewMacroEnvironmentAtOffset(
      snapshot,
      formula.outerRange.start,
    );
    assert.equal(environment.macros.body?.replacement, "B");
    assert.equal(environment.macros.local, undefined);
  }
});

test("mismatched environments fail closed for later Math Preview macros", () => {
  const text = String.raw`\begin{table}
\end{figure}
\newcommand{\uncertain}{bad}
$\uncertain$`;
  const snapshot = scanMathPreviewDocument(text, { fragmentKind: "body" });
  const formula = snapshot.formulas[0];
  assert.ok(formula);
  assert.equal(
    mathPreviewMacroEnvironmentAtOffset(snapshot, formula.outerRange.start)
      .macros.uncertain,
    undefined,
  );
});
