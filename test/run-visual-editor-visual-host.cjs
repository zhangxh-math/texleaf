/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

"use strict";

/** Launch an isolated Extension Development Host for TeXLeaf visual-editor QA. */

const fs = require("node:fs");
const { createHash } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn, spawnSync } = require("node:child_process");

const extensionDevelopmentPath = path.resolve(__dirname, "..");
const { debugPort, windowTitle, validPdf } = parseArguments(process.argv.slice(2));
const isolatedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "texleaf-visual-editor-visual-"),
);
const userDataDir = path.join(isolatedRoot, "user-data");
const extensionsDir = path.join(isolatedRoot, "extensions");
const workspaceRoot = path.join(isolatedRoot, "workspace");
const vscodeDirectory = path.join(workspaceRoot, ".vscode");
const texFile = path.join(workspaceRoot, "visual-preview.tex");
const bibliographyFile = path.join(workspaceRoot, "reference.bib");
const imageFile = path.join(workspaceRoot, "preview.png");
const qaColorTheme = process.env.TEXLEAF_VISUAL_QA_COLOR_THEME?.trim() ||
  "Default Dark Modern";
const qaZoteroPort = parseOptionalPort(
  process.env.TEXLEAF_VISUAL_QA_ZOTERO_PORT,
);
const qaBackgroundImages = parseQaBackgroundImages(
  process.env.TEXLEAF_VISUAL_QA_BACKGROUND_IMAGES,
  imageFile,
);
const codeExecutable = resolveCodeExecutable();
const latexWorkshopExtension = findLatestLocalLatexWorkshop();
const colorThemeExtension = findLocalColorThemeExtension(qaColorTheme);
let cleanupStarted = false;

for (const directory of [userDataDir, extensionsDir, vscodeDirectory]) {
  fs.mkdirSync(directory, { recursive: true });
}
fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
fs.writeFileSync(
  path.join(userDataDir, "User", "settings.json"),
  `${JSON.stringify({
    "texleaf.aiWriting.enabled": true,
    "texleaf.aiWriting.automaticReview": false,
  }, null, 2)}\n`,
  "utf8",
);

if (latexWorkshopExtension !== undefined) {
  fs.cpSync(
    latexWorkshopExtension,
    path.join(extensionsDir, path.basename(latexWorkshopExtension)),
    { recursive: true },
  );
}
if (
  colorThemeExtension !== undefined &&
  colorThemeExtension !== latexWorkshopExtension
) {
  fs.cpSync(
    colorThemeExtension,
    path.join(extensionsDir, path.basename(colorThemeExtension)),
    { recursive: true },
  );
}

fs.writeFileSync(
  path.join(vscodeDirectory, "settings.json"),
  `${JSON.stringify({
    "window.title": windowTitle,
    "workbench.colorTheme": qaColorTheme,
    "workbench.startupEditor": "none",
    "workbench.editorAssociations": { "*.tex": "texleaf.visualEditor" },
    "texleaf.visualEditor.defaultMode": "visual",
    // Deliberately retain the retired false setting in this isolated profile.
    // The visual editor must ignore it and still render every supported item.
    "texleaf.visualEditor.renderFormulas": false,
    "texleaf.mathPreview.placement": "autoAbove",
    "texleaf.mathPreview.scale": 1.15,
    "texleaf.bibliographyFile": "reference.bib",
    "texleaf.zoteroCitations": true,
    ...(qaZoteroPort === undefined
      ? {}
      : {
          "texleaf.zoteroPort": qaZoteroPort,
          "texleaf.zoteroRequestTimeoutMs": 2_000,
          "texleaf.zoteroCacheSeconds": 0,
        }),
    "latex-workshop.view.pdf.internal.synctex.keybinding": "double-click",
    "editor.fontFamily": "'Cascadia Code', Consolas, 'Courier New', monospace",
    "editor.fontSize": 16,
    "editor.lineHeight": 25,
    "background.enabled": true,
    "background.editor": {
      images: qaBackgroundImages,
      style: {
        "background-position": "100% 100%",
        "background-size": "contain",
        "background-repeat": "no-repeat",
        opacity: 0.2,
      },
      useFront: true,
    },
    "files.autoSave": "off",
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
  }, null, 2)}\n`,
  "utf8",
);

function parseQaBackgroundImages(raw, fallback) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return [fallback];
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((value) => typeof value === "string" && value.trim().length > 0)
    ) {
      return parsed;
    }
  } catch {
    // Automated tests intentionally keep using the local deterministic image.
  }
  return [fallback];
}

function parseOptionalPort(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid TEXLEAF_VISUAL_QA_ZOTERO_PORT: ${raw}`);
  }
  return port;
}

const visualFixture = String.raw`\documentclass{article}
\usepackage{amsmath,amsthm,amssymb,graphicx,booktabs,longtable,tabularx,tikz-cd,ytableau,xcolor,ulem,natbib,cleveref}
\usetikzlibrary{arrows.meta,calc,decorations.pathmorphing,positioning}
\newtheorem{theorem}{Theorem}[section]
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{corollary}[theorem]{Corollary}
\newtheorem{conjecture}[theorem]{Conjecture}
\providecommand{\institute}[1]{}
\providecommand{\email}[1]{}
\title{TeXLeaf Visual Editing Test}
\author{Xuhui Zhang \and Ada Lovelace}
\institute{Sun Yat-sen University \and Analytical Engine Institute}
\email{xuhui@example.edu \and ada@example.org}
\date{August 2026}
\begin{document}
\maketitle

\begin{abstract}
A concise visual abstract with inline mathematics \(x^2+y^2\).
\medskip
\noindent{\bf Keywords}: visual editing, \LaTeX, mathematical writing
\medskip
\noindent{\bf 2020 Mathematics Subject Classification: } 68N20, 68U35.
\end{abstract}

\section{Introduction}\label{sec:introduction}
\subsection{Free energy and \texorpdfstring{\(n\)}{n} point functions}
This paragraph contain the inline identity $e^{i\pi}+1=0$ and a citation \citet{wang2025}.
\definitelyUndefinedTeXLeafCommand

Simple parenthesized probe: \(g\).
Tuple selection probe: \((\Sigma,x_1,\dots,x_n)\).
Soft-wrapped Math Preview probe: this deliberately long logical source line keeps flowing across several visible editor rows so the second-row caret can be measured independently from the first row, even when the editor pane is narrow and the surrounding prose remains editable; the tuple is \((\Sigma,x_1,\dots,x_n)\) and the sentence continues after it.
Complex cursor preview probe: \(\mathcal{F}(x_1,\ldots,x_{12})=\sum_{m=0}^{48}\binom{48}{m}\frac{(-1)^m\Gamma_{m+1}}{(m+1)(m+2)}\exp\!\left(\sum_{k=1}^{16}\frac{t_kz^k}{k}\right)\).

Visual text styles: \textbf{bold}, \emph{italic}, \underline{underlined},
\sout{struck out}, and \textcolor{red}{red text}.

% Completion probes: place the caret after either token and use Ctrl+Space.
\beg
CITE_COMMAND_PROBE
REF_COMPLETION_PROBE
LABEL_COMPLETION_PROBE
BEQ

\begin{definition}[Stable flag]\label{def:stable}
A flag is stable when the following display is well defined:
\begin{equation}\label{eq:flag}
  F^1 \subset F^2 \subset \cdots \subset F^n = \mathbb{C}^n.
\end{equation}
\end{definition}

\begin{theorem}
For every $n\geq 1$, we have
\begin{align}
  \mathcal{R}(t) &= \sum_{\nu=0}^{N} \gamma_{\nu} b_{\nu,N}(t), \label{eq:row-r} \\
  \mathcal{S}(t) &= (N+1)\sum_{\nu=0}^{N}(\gamma_{\nu+1}-\gamma_{\nu})b_{\nu,N}(t). \label{eq:row-s}
\end{align}
\end{theorem}

\begin{proof}[Proof of Theorem \ref{def:stable}]
Compare the two displayed identities and apply induction:
\begin{align*}
  \mathcal{R}(t)-\mathcal{S}(t) &= 0.\qedhere
\end{align*}
\end{proof}

To continue estimating, we use the following proposition.
\begin{proposition}\label{prp:cubic-absorption}
For any partition $\lambda$, the following inequality holds:
\[
  \Delta_2^* \leq \Delta_3^*.
\]
\end{proposition}
To prove this proposition, we need the following lemma.
\begin{lemma}\label{lem:cubic-absorption-K}
\begin{enumerate}[label=(\arabic*)]
\item For any partitions without zero parts and $x,y\geq 2$,
  \[
    K^*_{\lambda,2}(x,y) \leq K^*_{\lambda,3}(x,y).
  \]
\item The nested list keeps the surrounding Lemma border continuous.
\end{enumerate}
\end{lemma}

\begin{conjecture}[Mixed block boundary]
\begin{enumerate}[(1)]
\item A display starts after editable prose, \begin{equation}
  u=v.
\end{equation}The text after the display remains inside the same conjecture frame.
\item The second item completes the boundary regression.
\end{enumerate}
\end{conjecture}

Transparent layout wrappers keep their body at the editor font size:
{\small
\[
  a_1+a_2+\cdots+a_n=b.
\]
}
\begin{subequations}\label{eq:transparent-family}
\begin{align}
  p_1 &= q_1, \label{eq:transparent-one} \\
  p_2 &= q_2. \label{eq:transparent-two}
\end{align}
\end{subequations}

\begin{corollary}\label{cor:visual-editable}
The result remains editable in visual mode.
\end{corollary}

Section \ref{sec:introduction}, definition \ref{def:stable}, and equation \eqref{eq:flag} remain editable references.
Multi-target previews: \cref{eq:flag,eq:long-preview} and \cite{wang2025,lovelace1843}.
Aligned row previews: \eqref{eq:row-r} and \eqref{eq:row-s}.

\subsection{Cases}
\begin{enumerate}
\item The first case is immediate.
\item The second case follows from the theorem.
\end{enumerate}
The piecewise expression is
\[
f(x)=\begin{cases}
  x^2, & x\geq 0, \\
  -x, & x<0.
\end{cases}
\]

\begin{table}[htbp]
\centering
\caption{Explicit values of \(N(N-1)\mathcal{Q}(\mathbf{d})\) in genera \(g(\mathbf{d})=4,5\)}
\label{tab:small-values}
\begin{tabular}[t]{@{}ccc@{}}
\toprule
Partition \(\mathbf{d}\) & Genus \(g(\mathbf{d})\) & \(N(N-1)\mathcal{Q}(\mathbf{d})\) \\
\midrule
$(3)$ & $4$ & $\frac{1}{6}$ \\
$(1,2)$ & $4$ & $0$ \\
\bottomrule
\end{tabular}
\end{table}

\begin{longtable}[c]{@{}lcr@{}}
\caption{A repeated-header long table}\label{tab:long-values} \\
\toprule
Object & Degree & Value \\
\midrule
\endfirsthead
\toprule
Object & Degree & Value \\
\midrule
\endhead
\bottomrule
\endfoot
\bottomrule
\endlastfoot
$A$ & $2$ & $\frac{1}{3}$ \\
$B$ & $3$ & $\frac{2}{5}$ \\
\end{longtable}

\begin{tabular}[t]{@{}lr@{}}
Standalone tabular & Value \\
$A$ & $\frac{5}{8}$ \\
\end{tabular}

\begin{tabular}{ccc}
\hline
列一 & 列二 & 列三 \\
\hline
A & B & C \\
\hline
\end{tabular}

\begin{tabularx}{0.82\linewidth}[b]{@{}lX@{}}
Adaptive tabularx & A flexible-width cell \\
$B$ & $\frac{7}{11}$ \\
\end{tabularx}

Young-tableau local-TeX preview:
\[
\begin{ytableau}
5 & 3 & 1 \\
3 & 1 \\
1
\end{ytableau}
\]

\begin{tikzcd}[row sep=large, column sep=huge]
A && B \\
& P & \\
C && D
\arrow["{f}", bend left=30, from=1-1, to=1-3]
\arrow["{f'}"', dashed, bend right=45, from=1-1, to=1-3]
\arrow["p"', hook, from=1-1, to=3-1]
\arrow["q", two heads, from=1-3, to=3-3]
\arrow["u", dotted, from=2-2, to=1-1]
\arrow["v"', dashed, from=2-2, to=1-3]
\arrow["{\eta}", no head, from=3-1, to=3-3]
\end{tikzcd}

\begin{tikzpicture}[node distance=22mm, every node/.style={draw, rounded corners, inner sep=5pt}]
  \node (x) {$X$};
  \node[right=of x] (y) {$Y$};
  \node[below=of $(x)!0.5!(y)$] (z) {$Z$};
  \draw[-{Stealth[length=3mm]}, very thick, blue] (x) to[bend left=18] node[above,draw=none] {$F$} (y);
  \draw[-{Stealth[length=3mm]}, decorate, decoration={snake,amplitude=1pt,segment length=6pt}] (x) -- (z);
  \draw[dashed, red, -{Latex}] (z) -- node[right,draw=none] {$G$} (y);
\end{tikzpicture}

\begin{figure}[htbp]
\centering
\includegraphics[width=.35\textwidth]{preview.png}
\caption{A local raster-image preview}
\label{fig:preview}
\end{figure}

Toolbar probe: first case

A deliberately long formula for scrolling and exact-caret Math Preview:
\begin{equation}\label{eq:long-preview}
\mathcal{L}(x_1,x_2,\ldots,x_{24})=\sum_{1\leq i_1<i_2<\cdots<i_{12}\leq 24}\frac{\prod_{r=1}^{12}(x_{i_r}+r)^2}{\prod_{1\leq p<q\leq 12}(1+x_{i_q}-x_{i_p})}+\sum_{m=0}^{48}\binom{48}{m}\frac{(-1)^m\gamma_{m+1}}{(m+1)(m+2)}\exp\!\left(\sum_{k=1}^{16}\frac{t_k z^k}{k}\right).
\end{equation}

A deliberately tall formula for vertical Math Preview scrolling:
\begin{align}\label{eq:tall-preview}
A_1(t)&=A_0(t)+c_1t,\\
A_2(t)&=A_1(t)+c_2t^2,\\
A_3(t)&=A_2(t)+c_3t^3,\\
A_4(t)&=A_3(t)+c_4t^4,\\
A_5(t)&=A_4(t)+c_5t^5,\\
A_6(t)&=A_5(t)+c_6t^6,\\
A_7(t)&=A_6(t)+c_7t^7,\\
A_8(t)&=A_7(t)+c_8t^8,\\
A_9(t)&=A_8(t)+c_9t^9,\\
A_{10}(t)&=A_9(t)+c_{10}t^{10},\\
A_{11}(t)&=A_{10}(t)+c_{11}t^{11},\\
A_{12}(t)&=A_{11}(t)+c_{12}t^{12},\\
A_{13}(t)&=A_{12}(t)+c_{13}t^{13},\\
A_{14}(t)&=A_{13}(t)+c_{14}t^{14},\\
A_{15}(t)&=A_{14}(t)+c_{15}t^{15},\\
A_{16}(t)&=A_{15}(t)+c_{16}t^{16},\\
A_{17}(t)&=A_{16}(t)+c_{17}t^{17},\\
A_{18}(t)&=A_{17}(t)+c_{18}t^{18},\\
A_{19}(t)&=A_{18}(t)+c_{19}t^{19},\\
A_{20}(t)&=A_{19}(t)+c_{20}t^{20},\\
A_{21}(t)&=A_{20}(t)+c_{21}t^{21},\\
A_{22}(t)&=A_{21}(t)+c_{22}t^{22},\\
A_{23}(t)&=A_{22}(t)+c_{23}t^{23},\\
A_{24}(t)&=A_{23}(t)+c_{24}t^{24},\\
A_{25}(t)&=A_{24}(t)+c_{25}t^{25},\\
A_{26}(t)&=A_{25}(t)+c_{26}t^{26},\\
A_{27}(t)&=A_{26}(t)+c_{27}t^{27},\\
A_{28}(t)&=A_{27}(t)+c_{28}t^{28},\\
A_{29}(t)&=A_{28}(t)+c_{29}t^{29},\\
A_{30}(t)&=A_{29}(t)+c_{30}t^{30},\\
A_{31}(t)&=A_{30}(t)+c_{31}t^{31},\\
A_{32}(t)&=A_{31}(t)+c_{32}t^{32},\\
A_{33}(t)&=A_{32}(t)+c_{33}t^{33},\\
    A_{34}(t)&=A_{33}(t)+c_{34}t^{34},\\
A_{35}(t)&=A_{34}(t)+c_{35}t^{35},\\
A_{36}(t)&=A_{35}(t)+c_{36}t^{36}.
\end{align}

Undo probe:${" "}

Pairing probe: $x$

Microsoft Pinyin IME regression probes:
\begin{align*}
  \Delta' & =\Delta(1^{n-1};1,g-1-n) \\
  & =\frac{1}{2}\sum_{k=0}^{g-2-n}K_{1^{n-1}}(1+k,g-1-n-k) \\
  & \geq \frac{1}{2}\sum_{r+s=n-1}\sum_{k=0}^{g-2-n}K^{*}_{1^{n-1},2}(1+k;g-1-n-k)C(0,k,1^{r})C(0,g-2-n-k,1^{s}) \\
  & \geq \frac{1}{2}\sum_{r+s=n-1}\sum_{k=0}^{g-2-n}K^{*}_{1^{n-1},2}(1+k;g-1-n-k)\cdot \frac{1}{4}\cdot \frac{9}{32} \\
  & =\frac{9}{128}\Delta_{2}^{\prime*}
\end{align*}

\begin{lemma}\label{lem:ime-fullwidth-semicolon}
Full-width semicolon probe:${" "}
\end{lemma}

\addcontentsline{toc}{section}{References}
\bibliographystyle{plainnat}
\bibliography{reference}
\end{document}
`;
const cursorStressPadding = process.env.TEXLEAF_VISUAL_QA_LONG_DOCUMENT === "1"
  ? Array.from({ length: 800 }, (_, index) => String.raw`
% Long-document cursor-preview stress row ${index + 1}.
Stress paragraph ${index + 1}: \textbf{alpha} and \emph{beta} with inline
mathematics \(x_{${index + 1}}^2+y_{${index + 1}}^2\) and ordinary prose.
`).join("")
  : "";
const qaVisualFixture = cursorStressPadding.length === 0
  ? visualFixture
  : visualFixture.replace(
      String.raw`\end{document}`,
      `${cursorStressPadding}\n${String.raw`\end{document}`}`,
    );
const validPdfFixture = qaVisualFixture
  .replace(String.raw`\definitelyUndefinedTeXLeafCommand`, "")
  .replace(
    String.raw`\beg
CITE_COMMAND_PROBE
REF_COMPLETION_PROBE
LABEL_COMPLETION_PROBE
BEQ`,
    String.raw`% Completion probes are disabled in the compilable PDF fixture.
% \beg
% CITE_COMMAND_PROBE
% REF_COMPLETION_PROBE
% LABEL_COMPLETION_PROBE
% BEQ`,
  );
fs.writeFileSync(
  texFile,
  validPdf ? validPdfFixture : qaVisualFixture,
  "utf8",
);

writeAiIssueFixture(texFile, fs.readFileSync(texFile, "utf8"), "contain", "contains");

function writeAiIssueFixture(fileName, source, original, replacement) {
  const uriText = vscodeFileUri(fileName);
  const start = source.indexOf(original);
  if (start < 0) {
    throw new Error("AI issue fixture source text is missing.");
  }
  const fingerprint = createHash("sha256")
    .update(`${uriText}\0${start}\0${original}`, "utf8")
    .digest("hex");
  const storageDirectory = path.join(
    userDataDir,
    "User",
    "globalStorage",
    "zhangxh-math.texleaf",
    "ai-writing-issues-v1",
  );
  fs.mkdirSync(storageDirectory, { recursive: true });
  const record = {
    schema: 1,
    uri: uriText,
    sourceHash: createHash("sha256").update(source, "utf8").digest("hex"),
    sourceLength: source.length,
    documentVersion: 1,
    savedAt: Date.now(),
    issues: [{
      id: `texleaf-ai-${fingerprint}`,
      fingerprint,
      start,
      end: start + original.length,
      original,
      replacement,
      message: "主谓一致：单数主语需要第三人称单数动词。",
      explanation: "paragraph 是单数主语，此处应使用 contains。",
      category: "grammar",
      severity: 1,
    }],
  };
  const cacheName = `${createHash("sha256").update(uriText, "utf8").digest("hex")}.json`;
  fs.writeFileSync(
    path.join(storageDirectory, cacheName),
    `${JSON.stringify(record)}\n`,
    "utf8",
  );
}

/** Match vscode.Uri.file(...).toString() on Windows, including its canonical
 * lower-case drive and encoded drive colon. Node's pathToFileURL deliberately
 * keeps `C:` instead, which hashes to a different profile-local AI cache key.
 */
function vscodeFileUri(fileName) {
  const uriText = pathToFileURL(path.resolve(fileName)).toString();
  if (process.platform !== "win32") {
    return uriText;
  }
  return uriText.replace(
    /^file:\/\/\/([A-Za-z]):/u,
    (_match, drive) => `file:///${drive.toLowerCase()}%3A`,
  );
}

fs.writeFileSync(
  bibliographyFile,
  String.raw`@article{wang2025,
  author = {Wang, Xuhui and Yang, Chenglang},
  title = {BKP-affine coordinates and emergent geometry},
  journal = {Advances in Mathematics},
  year = {2025}
}
@book{lovelace1843,
  author = {Lovelace, Ada},
  title = {Notes on the Analytical Engine},
  publisher = {Scientific Memoirs},
  year = {1843}
}
@article{noether1918,
  author = {Noether, Emmy},
  title = {Invariant Variation Problems},
  journal = {Nachrichten von der Gesellschaft der Wissenschaften},
  year = {1918}
}
`,
  "utf8",
);

fs.copyFileSync(path.join(extensionDevelopmentPath, "media", "icon.png"), imageFile);

const args = [
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${extensionsDir}`,
  "--disable-workspace-trust",
  "--skip-welcome",
  "--skip-release-notes",
  "--disable-telemetry",
  "--new-window",
  "--wait",
  ...(debugPort === undefined
    ? []
    : [
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${debugPort}`,
      ]),
  ...(process.env.TEXLEAF_INSPECT_EXTENSIONS_PORT === undefined
    ? []
    : [`--inspect-extensions=${process.env.TEXLEAF_INSPECT_EXTENSIONS_PORT}`]),
  `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
  workspaceRoot,
  texFile,
];

const child = spawn(codeExecutable, args, {
  cwd: extensionDevelopmentPath,
  detached: false,
  shell: false,
  stdio: "ignore",
  windowsHide: false,
});

process.stdout.write(`${JSON.stringify({
  title: windowTitle,
  pid: child.pid,
  isolatedRoot,
  texFile,
  bibliographyFile,
  imageFile,
  latexWorkshopExtension,
  qaColorTheme,
  colorThemeExtension,
  codeExecutable,
  debugPort,
  qaZoteroPort,
  note: "Close the isolated VS Code window or press Ctrl+C to clean up.",
}, null, 2)}\n`);

child.once("error", (error) => {
  cleanup();
  throw error;
});
child.once("exit", (code, signal) => {
  cleanup();
  process.exitCode = signal === null ? code ?? 1 : 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (!child.killed) {
      child.kill();
    }
  });
}

function cleanup() {
  if (cleanupStarted) {
    return;
  }
  cleanupStarted = true;
  if (process.env.TEXLEAF_VISUAL_QA_KEEP_TEMP === "1") {
    process.stderr.write(
      `Preserving isolated visual QA root for diagnostics: ${isolatedRoot}\n`,
    );
    return;
  }
  const resolvedTemp = path.resolve(os.tmpdir());
  const resolvedRoot = path.resolve(isolatedRoot);
  if (
    path.dirname(resolvedRoot) !== resolvedTemp ||
    !path.basename(resolvedRoot).startsWith("texleaf-visual-editor-visual-")
  ) {
    throw new Error(`Refusing to remove unexpected QA path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

function findLatestLocalLatexWorkshop() {
  const extensionRoot = path.join(os.homedir(), ".vscode", "extensions");
  if (!fs.existsSync(extensionRoot)) {
    return undefined;
  }
  const candidates = fs.readdirSync(extensionRoot, { withFileTypes: true })
    .filter((entry) =>
      entry.isDirectory() &&
      entry.name.toLowerCase().startsWith("james-yu.latex-workshop-")
    )
    .map((entry) => path.join(extensionRoot, entry.name))
    .sort((left, right) =>
      right.localeCompare(left, "en", { numeric: true, sensitivity: "base" })
    );
  return candidates[0];
}

function findLocalColorThemeExtension(themeName) {
  if (themeName === "Default Dark Modern" || themeName === "Dark Modern") {
    return undefined;
  }
  const extensionRoot = path.join(os.homedir(), ".vscode", "extensions");
  if (!fs.existsSync(extensionRoot)) {
    return undefined;
  }
  const requested = themeName.trim().toLocaleLowerCase("en-US");
  const candidates = fs.readdirSync(extensionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(extensionRoot, entry.name))
    .sort((left, right) =>
      right.localeCompare(left, "en", { numeric: true, sensitivity: "base" })
    );
  for (const candidate of candidates) {
    try {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(candidate, "package.json"), "utf8"),
      );
      const themes = packageJson?.contributes?.themes;
      if (
        Array.isArray(themes) &&
        themes.some((theme) =>
          [theme?.id, theme?.label].some((value) =>
            typeof value === "string" &&
            value.trim().toLocaleLowerCase("en-US") === requested
          )
        )
      ) {
        return candidate;
      }
    } catch {
      // Ignore an unrelated malformed extension manifest in the QA catalog.
    }
  }
  return undefined;
}

function resolveCodeExecutable() {
  const configured = process.env.TEXLEAF_VSCODE_CLI;
  if (configured !== undefined && fs.existsSync(configured)) {
    return path.resolve(configured);
  }
  const located = spawnSync("where.exe", ["code.cmd"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  const command = located.stdout
    .split(/\r?\n/u)
    .find((line) => line.trim().length > 0);
  if (command === undefined) {
    throw new Error("Cannot find VS Code. Set TEXLEAF_VSCODE_CLI to Code.exe.");
  }
  const commandPath = path.resolve(command.trim());
  const executable = /\.(?:cmd|bat)$/iu.test(commandPath)
    ? path.resolve(path.dirname(commandPath), "..", "Code.exe")
    : commandPath;
  if (!fs.existsSync(executable)) {
    throw new Error(`Cannot resolve Code.exe from ${commandPath}.`);
  }
  return executable;
}

function parseArguments(argv) {
  const usage =
    "Usage: node test/run-visual-editor-visual-host.cjs [--debug-port <port>] [--title <window title>] [--valid-pdf <true|false>]";
  let debugPort;
  let windowTitle = "TeXLeaf Visual Editor Visual Test";
  let validPdf = false;
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(usage);
    }
    if (option === "--debug-port" && /^[0-9]+$/u.test(value)) {
      debugPort = Number(value);
    } else if (option === "--title" && value.trim().length > 0 && value.length <= 120) {
      windowTitle = value.trim();
    } else if (option === "--valid-pdf" && /^(?:true|false)$/u.test(value)) {
      validPdf = value === "true";
    } else {
      throw new Error(usage);
    }
  }
  if (
    debugPort !== undefined &&
    (!Number.isSafeInteger(debugPort) || debugPort < 1_024 || debugPort > 65_535)
  ) {
    throw new Error(usage);
  }
  return { debugPort, windowTitle, validPdf };
}
