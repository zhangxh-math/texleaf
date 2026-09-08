import assert from "node:assert/strict";
import test from "node:test";
import { scanVisualDocumentStructure } from "../src/core/visualStructure";

test("title cards read REVTeX front matter after the document boundary with accurate source ranges", () => {
  const expectedTitle = "A synthetic REVTeX title declared after document start";
  const metadata = String.raw`\preprint{APS/123-QED}
\title[Short title]{A synthetic REVTeX title declared after document start}
\author{First Author}
\email{first@example.test}
\affiliation{Institute of Quantum Physics}
\author{Second Author}
\date{September 2026}
% \title{A comment must not replace the title}
`;
  for (const layout of ["preamble", "revtex", "body-fragment"] as const) {
    const source = layout === "body-fragment" ? metadata + String.raw`\maketitle`
      : String.raw`\documentclass[aps,prl,reprint]{revtex4-2}` + "\n"
        + (layout === "preamble" ? metadata + String.raw`\begin{document}` : String.raw`\begin{document}` + "\n" + metadata)
        + "\n" + String.raw`\begin{abstract}Abstract text.\end{abstract}
\maketitle
\section{Introduction}
Body text.
\end{document}`;
    const record = scanVisualDocumentStructure(source, { fragmentKind: layout === "body-fragment" ? "body" : "standalone" })
      .records.find(record => record.kind === "maketitle");
    assert.ok(record?.kind === "maketitle");
    assert.equal(record.title?.text, expectedTitle, layout);
    assert.equal(source.slice(record.title!.from, record.title!.to), expectedTitle);
    assert.deepEqual(record.authors.map(author => author.text), ["First Author", "Second Author"]);
    assert.deepEqual(record.affiliations.map(affiliation => affiliation.text), ["Institute of Quantum Physics"]);
    assert.deepEqual(record.emails.map(email => email.text), ["first@example.test"]);
    assert.equal(record.date?.text, "September 2026");
    assert.equal(source.slice(record.replacement.sourceFrom, record.replacement.sourceTo), String.raw`\maketitle`);
  }
});

test("body title and email wrappers retain nested styles and references", () => {
  const source = String.raw`\documentclass{article}
\renewcommand{\title}[1]{#1}
\newcommand{\email}[1]{#1}
\begin{document}
\section{Results}\label{sec:results}
\title{\textbf{Summary} and \ref{sec:results}}
\email{See \ref{sec:results}}
\end{document}`;
  const { records } = scanVisualDocumentStructure(source);
  const references = records.filter(record => record.kind === "reference");
  assert.equal(references.length, 2);
  for (const reference of references) {
    assert.deepEqual(reference.keys, ["sec:results"]);
    assert.equal(source.slice(reference.from, reference.to), String.raw`\ref{sec:results}`);
  }
  const styles = records.filter(record => record.kind === "textStyle");
  assert.equal(styles.length, 1);
  assert.equal(source.slice(styles[0]!.from, styles[0]!.to), String.raw`\textbf{Summary}`);
});

test("front matter groups contiguous abstracts and metadata without consuming the body", () => {
  for (const documentClass of ["article", "ctexart", "revtex4-2"]) {
    const source = `\\documentclass{${documentClass}}\n\\begin{document}\n` + String.raw`\title{Grouped paper}
\author{A}
\begin{abstract}A short abstract.\end{abstract}
\maketitle
\keywords{geometry, analysis}
\subjclass[2020]{53C20}
\section{Introduction}
Body remains editable.`;
    const { records } = scanVisualDocumentStructure(source);
    const title = records.find(record => record.kind === "maketitle");
    assert.ok(title?.frontMatter);
    assert.equal(source.slice(title.frontMatter.replacement.sourceFrom, title.frontMatter.replacement.sourceTo), String.raw`\title{Grouped paper}
\author{A}
\begin{abstract}A short abstract.\end{abstract}
\maketitle
\keywords{geometry, analysis}
\subjclass[2020]{53C20}`);
    assert.deepEqual(title.frontMatter.sections.map(section => [section.role, section.source.text]), [
      ["abstract", "A short abstract."], ["keywords", "geometry, analysis"], ["classification", "53C20"],
    ]);
    assert.deepEqual(title.frontMatter.sections.map(section => source.slice(section.source.from, section.source.to)), [
      "A short abstract.", "geometry, analysis", "53C20",
    ]);
    assert.equal(records.filter(record => record.kind === "abstract").length, 1);
    assert.equal(records.filter(record => record.kind === "keywords").length, 2);
  }
});

test("front matter stops at prose, custom commands, headings, ToC and frames", () => {
  for (const barrier of ["Ordinary prose.", String.raw`\customlayout{Hello}`, String.raw`\tableofcontents`, String.raw`\section{Body}`, String.raw`\begin{frame}Slide\end{frame}`]) {
    const source = String.raw`\documentclass{article}\title{Paper}\begin{document}
\maketitle
` + barrier + String.raw`
\begin{abstract}Separate abstract.\end{abstract}`;
    const title = scanVisualDocumentStructure(source).records.find(record => record.kind === "maketitle");
    assert.ok(title);
    assert.equal(title.frontMatter?.sections.length ?? 0, 0, barrier);
    assert.equal(title.frontMatter?.replacement.sourceTo ?? title.replacement.sourceTo, source.indexOf("\\maketitle") + 10, barrier);
  }
  const customTitle = String.raw`\documentclass{article}\renewcommand{\title}[1]{Visible #1}\begin{document}
\title{Visible body}
\maketitle`;
  const title = scanVisualDocumentStructure(customTitle).records.find(record => record.kind === "maketitle");
  assert.equal(title?.frontMatter?.replacement.sourceFrom ?? title?.replacement.sourceFrom, customTitle.indexOf("\\maketitle"));
});

test("amsart preamble keyword and classification definitions are attached in execution order", () => {
  const source = String.raw`\documentclass{amsart}
\title{Paper}
\keywords{early keywords}
\subjclass[2020]{53C20}
\begin{document}
\maketitle
\keywords{later keywords}
\maketitle`;
  const titles = scanVisualDocumentStructure(source).records.filter(record => record.kind === "maketitle");
  assert.deepEqual(titles[0]?.frontMatter?.sections.map(section => section.source.text), ["early keywords", "53C20", "later keywords"]);
  assert.ok(titles[0]?.frontMatter?.sections.every(section => section.source.from < titles[1]!.replacement.sourceFrom));
  assert.equal(source.slice(titles[0]!.frontMatter!.sections[0]!.source.from, titles[0]!.frontMatter!.sections[0]!.source.to), "early keywords");
});

test("explicit author markers preserve distinct authors with identical names", () => {
  const source = String.raw`\documentclass{article}
\usepackage{authblk}
\title{Paper}
\author[1]{Same Name}
\author[2]{Same Name}
\affil[1]{North University}
\affil[2]{South University}
\begin{document}\maketitle`;
  const title = scanVisualDocumentStructure(source).records.find(record => record.kind === "maketitle");
  assert.deepEqual(title?.authors.map(author => [author.text, author.markers]), [["Same Name", ["1"]], ["Same Name", ["2"]]]);
  assert.deepEqual(title?.affiliations.map(value => value.markers), [["1"], ["2"]]);
  const beamer = scanVisualDocumentStructure(String.raw`\documentclass{beamer}\title{Talk}
\author[Short]{Alice\inst{1,2}\and Bob\inst{2}}
\institute{\inst{1}North\and\inst{2}South}
\begin{document}\frame{\titlepage}`).records.find(record => record.kind === "maketitle");
  assert.deepEqual(beamer?.authors.map(author => author.markers), [["1", "2"], ["2"]]);
  assert.deepEqual(beamer?.affiliations.map(value => value.markers), [["1"], ["2"]]);
});

test("REVTeX affiliations associate author groups by declaration identity", () => {
  const source = String.raw`\documentclass{revtex4-2}\begin{document}
\title{Paper}
\author{Same Name}
\author{Second Author}
\affiliation{North}
\affiliation{South}
\author{Same Name}
\affiliation{East}
\maketitle`;
  const title = scanVisualDocumentStructure(source).records.find(record => record.kind === "maketitle");
  assert.deepEqual(title?.authors.map(author => [author.text, author.markers]), [["Same Name", ["1", "2"]], ["Second Author", ["1", "2"]], ["Same Name", ["3"]]]);
  assert.deepEqual(title?.affiliations.map(value => value.markers), [["1"], ["2"], ["3"]]);
});

test("simple title macros resolve at the trigger while preserving declaration and definition ranges", () => {
  const source = String.raw`\documentclass{article}
\newcommand{\PaperTitle}{Old title}
\title{\PaperTitle}
\renewcommand{\PaperTitle}{A \textbf{resolved} title}
\newcommand{\Unused}{\title{Wrong title}}
\begin{document}\maketitle
\renewcommand{\PaperTitle}[1]{Unknown #1}
\maketitle`;
  const titles = scanVisualDocumentStructure(source).records.filter(record => record.kind === "maketitle");
  assert.equal(titles[0]?.title?.text, "A resolved title");
  assert.equal(source.slice(titles[0]!.title!.from, titles[0]!.title!.to), String.raw`\PaperTitle`);
  assert.equal(source.slice(titles[0]!.title!.definition!.from, titles[0]!.title!.definition!.to), String.raw`A \textbf{resolved} title`);
  assert.equal(titles[1]?.title?.definition, undefined);
  assert.equal(titles[1]?.title?.text, String.raw`\PaperTitle`);
});

test("grouped abstracts preserve inline math and leave unsupported body structures editable", () => {
  const prefix = String.raw`\documentclass{article}\title{Paper}\begin{document}\maketitle` + "\n";
  const source = prefix + String.raw`\begin{abstract}An estimate $x^2$ holds.\end{abstract}`;
  const title = scanVisualDocumentStructure(source).records.find(record => record.kind === "maketitle");
  const math = title?.frontMatter?.sections[0]?.source.segments?.find(segment => segment.kind === "math");
  assert.ok(math?.kind === "math");
  assert.equal(math.math.tex, "x^2");
  assert.equal(source.slice(math.math.sourceFrom, math.math.sourceTo), "$x^2$");
  for (const body of [String.raw`See \ref{sec:a}.`, String.raw`See \cite{paper}.`, String.raw`\begin{custom}Body\end{custom}`, String.raw`Text\label{abs:a}`, String.raw`\begin{itemize}\item List\end{itemize}`]) {
    const records = scanVisualDocumentStructure(prefix + String.raw`\begin{abstract}` + body + String.raw`\end{abstract}`).records;
    const record = records.find(value => value.kind === "maketitle");
    assert.equal(record?.frontMatter?.sections.length ?? 0, 0, body);
    assert.ok(records.some(value => value.kind === "abstract"));
  }
});

test("abstract tail metadata from article templates becomes separate front matter fields", () => {
  const prefix = String.raw`\documentclass{article}
\newcommand{\subjclass}[2][2020]{\par\smallskip\noindent\textbf{#1 Mathematics Subject Classification:} #2\par}
\newcommand{\keywords}[1]{\par\smallskip\noindent\textbf{Keywords:} #1\par}
\title{Paper}\begin{document}\maketitle
\begin{abstract}
An estimate $x^2$ holds.
`;
  for (const tail of [String.raw`% Classification guidance remains source.
\subjclass[2020]{53C20}
\keywords{geometry}`, String.raw`\par\smallskip
\noindent{\bf 2020 Mathematics Subject Classification:} 53C20
\medskip
\noindent{\bf Keywords}: geometry`]) {
    const source = prefix + tail + "\n" + String.raw`\end{abstract}`;
    const records = scanVisualDocumentStructure(source).records;
    const title = records.find(record => record.kind === "maketitle");
    assert.deepEqual(title?.frontMatter?.sections.map(section => [section.role, section.source.text]), [["abstract", "An estimate $x^2$ holds."], ["classification", "53C20"], ["keywords", "geometry"]]);
    assert.equal(records.filter(record => record.kind === "keywords").length, 2);
    assert.equal(source.slice(title!.frontMatter!.sections[0]!.source.from, title!.frontMatter!.sections[0]!.source.to), "An estimate $x^2$ holds.");
  }
  const interleaved = scanVisualDocumentStructure(prefix + String.raw`\keywords{geometry}
Ordinary prose after metadata.
\end{abstract}`).records.find(record => record.kind === "maketitle");
  assert.equal(interleaved?.frontMatter?.sections.length ?? 0, 0);
});

test("a starred Abstract section groups only up to the next explicit section boundary", () => {
  const source = String.raw`\documentclass{article}\title{Paper}\begin{document}
\maketitle
\section*{Abstract}
A plain abstract paragraph.
\section{Introduction}
Ordinary body.`;
  const { records } = scanVisualDocumentStructure(source);
  const title = records.find(record => record.kind === "maketitle");
  assert.equal(title?.frontMatter?.sections[0]?.source.text, "A plain abstract paragraph.");
  assert.ok((title?.frontMatter?.replacement.to ?? source.length) <= source.indexOf("\\section{Introduction}"));
  assert.equal(records.filter(record => record.kind === "heading").length, 2);
});

test("title dates render literal dates, localized today and simple macros with original source ranges", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 8, 12) });
  for (const [language, today] of [["en", "September 8, 2026"], ["zh", "2026年9月8日"]] as const) {
    for (const [date, expected] of [["10 May 2025", "10 May 2025"], [String.raw`\today`, today], [String.raw`\PaperDate`, "Submission day"], ["", ""]]) {
      const source = String.raw`\documentclass{article}\newcommand{\PaperDate}{Submission day}\title{Paper}\date{` + date + String.raw`}\begin{document}\maketitle`;
      const record = scanVisualDocumentStructure(source, { documentLanguage: language }).records.find(value => value.kind === "maketitle");
      assert.equal(record?.date?.text, expected);
      assert.equal(source.slice(record!.date!.from, record!.date!.to), date);
      if (date === String.raw`\PaperDate`) assert.equal(source.slice(record!.date!.definition!.from, record!.date!.definition!.to), "Submission day");
    }
  }
});

test("folded body metadata leaves interactive and unknown contents visible in their original source", () => {
  for (const declaration of [
    String.raw`\title{See \ref{sec:r}}`,
    String.raw`\author{Author \cite{paper}}`,
    String.raw`\email{Institute $x^2$}`,
    String.raw`\email{See \ref{sec:r}}`,
    String.raw`\author{Author\thanks{\customnote{Important}}}`,
    String.raw`\author{Author\inst{1,\ref{sec:r}}}`,
    String.raw`\date{Version \(x^2\)}`,
  ]) {
    const source = String.raw`\documentclass{article}\begin{document}` + "\n" + declaration + "\n" + String.raw`\maketitle`;
    const records = scanVisualDocumentStructure(source).records;
    const title = records.find(value => value.kind === "maketitle");
    const range = title?.frontMatter?.replacement ?? title?.replacement;
    assert.equal(range?.sourceFrom, source.indexOf("\\maketitle"), declaration);
    for (const nested of records.filter(value => value.kind === "reference" || value.kind === "citation")) {
      assert.ok(nested.to <= range!.sourceFrom, declaration);
    }
  }
  const safe = String.raw`\documentclass{beamer}\newcommand{\PaperTitle}{A literal title}\begin{document}
\title{\PaperTitle}
\author{Alice\inst{1}}
\institute{\inst{1}University}
\maketitle`;
  const title = scanVisualDocumentStructure(safe).records.find(value => value.kind === "maketitle");
  assert.equal(title?.frontMatter?.replacement.sourceFrom, safe.indexOf("\\title{\\PaperTitle}"));
  const mathAffiliation = String.raw`\documentclass{article}\begin{document}
\affiliation{Institute $x^2$}
\maketitle`;
  const mathTitle = scanVisualDocumentStructure(mathAffiliation).records.find(value => value.kind === "maketitle");
  assert.equal(mathTitle?.frontMatter?.replacement.sourceFrom, mathAffiliation.indexOf("\\affiliation"));
  assert.ok(mathTitle?.affiliations[0]?.segments?.some(segment => segment.kind === "math"));
});
