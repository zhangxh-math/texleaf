import assert from "node:assert/strict";
import test from "node:test";
import { scanVisualDocumentStructure } from "../src/core/visualStructure";

test("enhanced front matter folds only verified disjoint fields and leaves intervening report text", () => {
  const text = String.raw`\documentclass{article}
\title{A title}\author{An author}\institute{Institute\vspace{2mm}\\City}
\begin{document}
\begin{abstract}Abstract $x+1$.\end{abstract}
Report ABC-123. Ordinary text must stay.
\maketitle
\section{Body}
\end{document}`;
  const basic = scanVisualDocumentStructure(text).records.find(r => r.kind === "maketitle")!;
  const enhanced = scanVisualDocumentStructure(text, { compatibilityMode: "maximum" }).records.find(r => r.kind === "maketitle")!;
  assert.equal(basic.frontMatter?.sections.length ?? 0, 0);
  assert.equal(enhanced.frontMatter?.sections[0]?.source.text, "Abstract $x+1$.");
  assert.equal(enhanced.frontMatter?.replacements?.length, 1);
  const ranges = [enhanced.frontMatter!.replacement, ...enhanced.frontMatter!.replacements!];
  assert.ok(ranges.every(range => !text.slice(range.from, range.to).includes("Report ABC")));
  assert.equal(enhanced.affiliations.map(item => item.text).join(" "), "Institute City");
  assert.equal(text.slice(enhanced.frontMatter!.sections[0]!.source.from, enhanced.frontMatter!.sections[0]!.source.to), "Abstract $x+1$.");
  const separated = text.replace("Report ABC-123.", String.raw`\section{Prior section} Report ABC-123.`);
  assert.equal(scanVisualDocumentStructure(separated, { compatibilityMode: "maximum" }).records.find(r => r.kind === "maketitle")!.frontMatter?.sections.length ?? 0, 0);
});


test("literal tcolorbox aliases keep source-backed headings and nested contents; code examples are inert", () => {
  const text = String.raw`\newenvironment{notice}[1]{\begin{tcolorbox}[title={#1}]}{\end{tcolorbox}}
\newenvironment{sample}{\begin{tcolorbox}[title={Code},colback=black!2]}{\end{tcolorbox}}
\newcommand{\check}[1]{\begin{notice}{Check}#1\end{notice}}
\begin{document}
\begin{notice}{Actual title}Body $x$ and \footnote{A note}.\end{notice}
\check{Keep $y$ and text.}
\begin{sample}\begin{Verbatim}
\begin{notice}{Fake title}\appendix\includegraphics{missing.pdf}\end{notice}
\end{Verbatim}\end{sample}
\end{document}`;
  const records = scanVisualDocumentStructure(text).records;
  const boxes = records.filter(r => r.kind === "theorem");
  assert.deepEqual(boxes.map(box => box.label), ["Actual title", "Check", "Code"]);
  assert.equal(text.slice(boxes[1]!.bodyFrom, boxes[1]!.bodyTo), "Keep $y$ and text.");
  assert.ok(records.some(r => r.kind === "footnote"));
  assert.equal(records.some(r => r.kind === "image"), false);
  assert.equal(boxes.some(box => box.label === "Fake title"), false);
});


test("disjoint abstract sections remain ordered and nested keywords fold once", () => {
  const source = String.raw`\begin{document}\title{Title}
\begin{abstract}First.\keywords{Keyword}\end{abstract}
Report 1.
\begin{abstract}Second.\end{abstract}
Report 2.\maketitle\end{document}`;
  const title = scanVisualDocumentStructure(source, {compatibilityMode: "maximum"}).records.find(r => r.kind === "maketitle")!;
  assert.deepEqual(title.frontMatter?.sections.map(s => s.source.text), ["First.", "Keyword", "Second."]);
  const ranges = title.frontMatter!.replacements!;
  assert.ok(ranges.every((range, i) => ranges.every((other, j) => i === j || range.to <= other.from || range.from >= other.to)));
});

test("body institutions accept bounded spacing and unsupported redefinitions remove old boxes", () => {
  const source = String.raw`\title{Title}\begin{document}
\address{{\vspace{0.1cm}$^{a}$\,Institute A}\\{\vspace{0.1cm}$^{b}$\,Institute B}}
Report.\maketitle\end{document}`;
  const title = scanVisualDocumentStructure(source, {compatibilityMode: "maximum"}).records.find(r => r.kind === "maketitle")!;
  assert.ok([...(title.metadataReplacements ?? []), ...(title.frontMatter?.replacements ?? [])].some(range => source.slice(range.sourceFrom, range.sourceTo).startsWith("\\address")));
  const redefined = scanVisualDocumentStructure(String.raw`\newenvironment{note}{\begin{tcolorbox}[title={Old}]}{\end{tcolorbox}}
\newcommand{\check}[1]{\begin{note}#1\end{note}}
\renewenvironment{note}{\begin{center}}{\end{center}}
\begin{document}\begin{note}Text\end{note}\check{Text}\end{document}`);
  assert.equal(redefined.records.some(r => r.kind === "theorem"), false);
});

test("standalone Young diagram pairs stay together while literal examples remain inert", () => {
  const pair = String.raw`\ydiagram{4,2,1}\hspace{18mm}\ydiagram{3,2,2}`;
  const source = `\\begin{document}\n${pair}\n\\begin{Verbatim}\n${pair}\n\\end{Verbatim}\n\\end{document}`;
  const records = scanVisualDocumentStructure(source).records.filter(r => r.kind === "figure");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.tex, pair);
});
