/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLatexProjectGraph,
  isSafeLatexProjectRelativePath,
  resolveLatexProjectPath,
  scanLatexProjectSource,
} from '../src/core';

test('scans a ThuThesis-style root, document class, setup, and include phases', () => {
  const source = String.raw`% !TEX root = ../thuthesis-example.tex
\documentclass[degree=doctor,language=chinese]{thuthesis}
\thusetup{
  title = {A title containing \texttt{input}, not a project command},
  author = {张三},
}
\input{data/chap01}
\begin{document}
\include{data/chap02}
\end{document}
\subfile{appendix/after}
`;
  const scan = scanLatexProjectSource(source);

  assert.equal(scan.graphIncomplete, false);
  assert.equal(scan.rootDirectives.length, 1);
  assert.equal(scan.rootDirectives[0]?.rawPath, '../thuthesis-example.tex');
  assert.equal(scan.rootDirectives[0]?.normalizedPath, '../thuthesis-example.tex');
  assert.equal(
    source.slice(
      scan.rootDirectives[0]?.pathRange.start,
      scan.rootDirectives[0]?.pathRange.end,
    ),
    '../thuthesis-example.tex',
  );
  assert.equal(scan.documentClass?.name, 'thuthesis');
  assert.equal(scan.documentClass?.options, 'degree=doctor,language=chinese');
  assert.equal(
    source.slice(scan.documentClass?.range.start, scan.documentClass?.range.end),
    String.raw`\documentclass[degree=doctor,language=chinese]{thuthesis}`,
  );
  assert.deepEqual(
    scan.includes.map((include) => [include.kind, include.normalizedPath, include.phase]),
    [
      ['input', 'data/chap01', 'preamble'],
      ['include', 'data/chap02', 'body'],
    ],
  );
  assert.ok(scan.beginDocument !== undefined);
  assert.ok(scan.endDocument !== undefined);
  assert.equal(scan.endInput, undefined);
  for (const include of scan.includes) {
    assert.equal(source.slice(include.range.start, include.range.end).startsWith('\\'), true);
    assert.equal(source.slice(include.pathRange.start, include.pathRange.end), include.rawPath);
  }
});

test('only the magic root comment is interpreted and verbatim content is skipped', () => {
  const source = String.raw`% !TeX root = "main.tex"
% \input{commented}
Text \% is not a comment, and \verb|\input{inline}| is literal.
\begin{verbatim}
\input{verbatim-fake}
\end{verbatim}
\begin{Verbatim}
\include{capital-fake}
\end{Verbatim}
\begin{verbatim*}
\input{starred-fake}
\end{verbatim*}
\begin{Verbatim*}
\include{capital-starred-fake}
\end{Verbatim*}
\begin{lstlisting}
\subfile{listing-fake}
\end{lstlisting}
\begin{minted}{tex}
\import{fake/}{minted-fake}
\end{minted}
\subfile{chapters/real}
`;
  const scan = scanLatexProjectSource(source);

  assert.equal(scan.rootDirectives[0]?.normalizedPath, 'main.tex');
  assert.deepEqual(
    scan.includes.map((include) => [include.kind, include.normalizedPath]),
    [['subfile', 'chapters/real']],
  );
  assert.equal(scan.diagnostics.length, 0);
  assert.equal(scan.graphIncomplete, false);
});

test('project scanning ignores deferred definitions and literal false branches', () => {
  const source = String.raw`\newcommand{\unused}{\input{macro-file}}
\def\plain#1{\include{def-file}}
\newenvironment{wrapped}{\subfile{begin-file}}{\input{end-file}}
\iffalse
\input{dead-file}
\fi
\input{real-file}`;
  const scan = scanLatexProjectSource(source);

  assert.deepEqual(
    scan.includes.map((include) => include.normalizedPath),
    ['real-file'],
  );
  assert.equal(scan.graphIncomplete, false);
});

test('a skipped executable else branch is reported as an incomplete project graph', () => {
  const scan = scanLatexProjectSource(String.raw`\iffalse
\input{dead-file}
\else
\input{live-file}
\fi`);

  assert.equal(scan.includes.length, 0);
  assert.equal(scan.graphIncomplete, true);
  assert.ok(
    scan.diagnostics.some((diagnostic) => diagnostic.code === 'conditional-project-commands'),
  );
});

test('unknown conditional execution is omitted and explicitly incomplete', () => {
  const scan = scanLatexProjectSource(String.raw`\iftrue
\input{conditionally-live}
\fi
\input{unconditional}`);

  assert.deepEqual(
    scan.includes.map((include) => include.normalizedPath),
    ['unconditional'],
  );
  assert.equal(scan.graphIncomplete, true);
  assert.ok(
    scan.diagnostics.some((diagnostic) => diagnostic.code === 'conditional-project-commands'),
  );
});

test('custom conditionals are balanced conservatively without exposing dead includes', () => {
  const scan = scanLatexProjectSource(String.raw`\iffalse
\ifdraft
\input{nested-dead}
\fi
\fi
\input{real}`);

  assert.deepEqual(
    scan.includes.map((include) => include.normalizedPath),
    ['real'],
  );
  assert.equal(scan.graphIncomplete, false);

  const dynamic = scanLatexProjectSource(String.raw`\ifdraft
\input{maybe}
\fi
\input{always}`);
  assert.deepEqual(
    dynamic.includes.map((include) => include.normalizedPath),
    ['always'],
  );
  assert.equal(dynamic.graphIncomplete, true);
});

test('conditionals without project commands do not poison a complete project graph', () => {
  const scan = scanLatexProjectSource(String.raw`\ifx\foo\relax
\def\foo{a}
\else
\def\foo{b}
\fi
\input{chapter}`);

  assert.deepEqual(
    scan.includes.map((include) => include.normalizedPath),
    ['chapter'],
  );
  assert.equal(scan.graphIncomplete, false);
});

test('newif declarations do not masquerade as unterminated conditional branches', () => {
  const scan = scanLatexProjectSource(String.raw`\newif\ifdraft
\drafttrue
\input{chapter}`);

  assert.deepEqual(scan.includes.map((include) => include.normalizedPath), ['chapter']);
  assert.equal(scan.graphIncomplete, false);
  assert.equal(scan.diagnostics.length, 0);
});

test('bounded function-style conditions cannot swallow later unconditional includes', () => {
  const scan = scanLatexProjectSource(String.raw`\ifthenelse{\boolean{draft}}{A}{B}
\input{always}`);

  assert.deepEqual(
    scan.includes.map((include) => include.normalizedPath),
    ['always'],
  );
  assert.equal(scan.graphIncomplete, false);
});

test('function-style conditional project commands are omitted and fail closed', () => {
  const sources = [
    String.raw`\IfFileExists{choice.tex}{\input{a}}{\input{b}}`,
    String.raw`\@ifundefined{feature}{\input{a}}{\input{b}}`,
    String.raw`\IfBooleanTF{\flag}{\input{a}}{\input{b}}`,
  ];
  for (const source of sources) {
    const scan = scanLatexProjectSource(source);
    assert.deepEqual(scan.includes, []);
    assert.equal(scan.graphIncomplete, true);
    assert.equal(
      scan.diagnostics.some((diagnostic) => diagnostic.code === 'conditional-project-commands'),
      true,
    );
  }
});

test('endinput and comment environments keep inert includes out of the graph', () => {
  const source = String.raw`\begin{comment}
\input{commented}
\end{comment}
\begin{filecontents*}{generated.tex}
\input{generated-fake}
\endinput
\end{filecontents*}
\input{live}
\endinput
\input{after-endinput}`;
  const scan = scanLatexProjectSource(source);

  assert.deepEqual(
    scan.includes.map((include) => include.normalizedPath),
    ['live'],
  );
  assert.equal(
    scan.endInput === undefined ? undefined : source.slice(scan.endInput.start, scan.endInput.end),
    String.raw`\endinput`,
  );
  assert.equal(scan.graphIncomplete, false);
});

test('opaque environments use their first exact physical closing marker', () => {
  const source = String.raw`\begin{comment}
prefix \end{comment} \input{ghost-comment}
\end{comment}
\input{live-after-comment}
\begin{verbatim}
\begin{verbatim}
\end{verbatim}
\input{live-after-literal-begin}
\begin{verbatim}
\end {verbatim}
\input{ghost-after-spaced-end}
\end{verbatim}
\input{live-after-exact-end}`;
  const scan = scanLatexProjectSource(source);

  assert.deepEqual(
    scan.includes.map((include) => include.normalizedPath),
    [
      'live-after-comment',
      'live-after-literal-begin',
      'live-after-exact-end',
    ],
  );
  assert.equal(scan.graphIncomplete, false);
});

test('the pure project graph shares document phase across wrapper siblings', () => {
  const graph = buildLatexProjectGraph('main.tex', new Map([
    [
      'main.tex',
      String.raw`\documentclass{article}\input{document}\input{inert-sibling}`,
    ],
    [
      'document.tex',
      String.raw`\begin{document}\section{Only document}\end{document}`,
    ],
    ['inert-sibling.tex', String.raw`\label{must-not-be-reached}`],
  ]));

  assert.deepEqual(graph.files.map((file) => file.path), ['main.tex', 'document.tex']);
  assert.deepEqual(
    graph.edges.map((edge) => [edge.from, edge.to, edge.status]),
    [['main.tex', 'document.tex', 'resolved']],
  );
  assert.equal(graph.graphIncomplete, false);
});

test('the pure project graph executes only a subfiles child body occurrence', () => {
  const graph = buildLatexProjectGraph('main.tex', new Map([
    [
      'main.tex',
      String.raw`\documentclass{article}\begin{document}\subfile{child}\end{document}`,
    ],
    [
      'child.tex',
      String.raw`\documentclass[main.tex]{subfiles}
\input{standalone-preamble-only}
\begin{document}
\input{body-only}
\end{document}`,
    ],
    ['standalone-preamble-only.tex', String.raw`\label{inert-preamble}`],
    ['body-only.tex', String.raw`\label{live-body}`],
  ]));

  assert.deepEqual(
    graph.files.map((file) => file.path),
    ['main.tex', 'child.tex', 'body-only.tex'],
  );
  assert.deepEqual(
    graph.edges.map((edge) => [edge.from, edge.to, edge.status]),
    [
      ['main.tex', 'child.tex', 'resolved'],
      ['child.tex', 'body-only.tex', 'resolved'],
    ],
  );
  assert.equal(graph.graphIncomplete, false);
});

test('the pure project graph distinguishes subfile and ordinary input occurrences', () => {
  const graph = buildLatexProjectGraph('main.tex', new Map([
    [
      'main.tex',
      String.raw`\documentclass{article}\begin{document}\subfile{child}\input{child}\end{document}`,
    ],
    [
      'child.tex',
      String.raw`\documentclass[main.tex]{subfiles}
\input{standalone-preamble}
\begin{document}
\input{body}
\end{document}`,
    ],
    ['standalone-preamble.tex', 'setup'],
    ['body.tex', 'body'],
  ]));

  assert.deepEqual(
    graph.files.map((file) => file.path),
    ['main.tex', 'child.tex', 'body.tex', 'standalone-preamble.tex'],
  );
  assert.deepEqual(
    graph.edges.map((edge) => [edge.from, edge.to, edge.status]),
    [
      ['main.tex', 'child.tex', 'resolved'],
      ['child.tex', 'body.tex', 'resolved'],
      ['main.tex', 'child.tex', 'resolved'],
      ['child.tex', 'standalone-preamble.tex', 'resolved'],
      ['child.tex', 'body.tex', 'resolved'],
    ],
  );
  assert.equal(graph.graphIncomplete, false);
});

test('the executable project graph ignores includes after end document', () => {
  const graph = buildLatexProjectGraph('main.tex', new Map([
    ['main.tex', String.raw`\documentclass{article}
\begin{document}\input{live}\end{document}
\input{ghost}`],
    ['live.tex', 'live'],
    ['ghost.tex', 'after document'],
  ]));

  assert.deepEqual(graph.files.map((file) => file.path), ['main.tex', 'live.tex']);
  assert.deepEqual(graph.edges.map((edge) => edge.to), ['live.tex']);
  assert.equal(graph.graphIncomplete, false);
});

test('end document terminates scanning before inert tail commands can poison authority', () => {
  const tails = [
    String.raw`\ifdraft\input{ghost}\fi`,
    String.raw`\input{\dynamic}`,
    String.raw`\newcommand{\broken}{`,
  ];
  for (const tail of tails) {
    const source = String.raw`\documentclass{article}
\begin{document}\input{live}\end{document}
${tail}`;
    const scan = scanLatexProjectSource(source);
    assert.deepEqual(scan.includes.map((include) => include.normalizedPath), ['live']);
    assert.equal(scan.graphIncomplete, false);
    assert.equal(scan.diagnostics.length, 0);
  }
});

test('a label under an unknown conditional makes project authority incomplete', () => {
  const scan = scanLatexProjectSource(String.raw`\documentclass{article}
\begin{document}
\ifdraft\label{maybe}\fi
\end{document}`);

  assert.equal(scan.graphIncomplete, true);
  assert.equal(
    scan.diagnostics.some((diagnostic) => diagnostic.code === 'conditional-project-commands'),
    true,
  );
});

test('an endinput under an unknown conditional makes later execution uncertain', () => {
  const scan = scanLatexProjectSource(String.raw`\ifdraft\endinput\fi
\input{live}`);

  assert.deepEqual(scan.includes.map((include) => include.normalizedPath), ['live']);
  assert.equal(scan.graphIncomplete, true);
  assert.equal(
    scan.diagnostics.some((diagnostic) => diagnostic.code === 'conditional-project-commands'),
    true,
  );

  const knownDead = scanLatexProjectSource(String.raw`\iffalse\endinput\fi
\input{live}`);
  assert.deepEqual(knownDead.includes.map((include) => include.normalizedPath), ['live']);
  assert.equal(knownDead.graphIncomplete, false);
});

test('records import paths, UTF-16 offsets, and resolves only within the project root', () => {
  const source = '😀 前缀\n\\import{sections/}{part-a}\n\\subimport{../shared/}{defs.tex}\n';
  const scan = scanLatexProjectSource(source);

  assert.deepEqual(
    scan.includes.map((include) => ({
      kind: include.kind,
      rawPath: include.rawPath,
      normalizedPath: include.normalizedPath,
      directory: include.directoryRawPath,
    })),
    [
      {
        kind: 'import',
        rawPath: 'sections/part-a',
        normalizedPath: 'sections/part-a',
        directory: 'sections/',
      },
      {
        kind: 'subimport',
        rawPath: '../shared/defs.tex',
        normalizedPath: '../shared/defs.tex',
        directory: '../shared/',
      },
    ],
  );
  assert.equal(scan.includes[0]?.range.start, source.indexOf('\\import'));
  assert.equal(
    source.slice(scan.includes[0]?.pathRange.start, scan.includes[0]?.pathRange.end),
    'part-a',
  );
  assert.deepEqual(
    resolveLatexProjectPath('chapters/chapter.tex', '../main'),
    { ok: true, path: 'main.tex' },
  );
  assert.deepEqual(
    resolveLatexProjectPath('main.tex', '../outside'),
    { ok: false, reason: 'workspace-escape' },
  );
  assert.equal(isSafeLatexProjectRelativePath('data/chap01.tex'), true);
  assert.equal(isSafeLatexProjectRelativePath('../outside.tex'), false);
  assert.equal(isSafeLatexProjectRelativePath('https://example.test/a.tex'), false);
  assert.equal(isSafeLatexProjectRelativePath('C:/paper/main.tex'), false);
});

test('rejects dynamic, absolute, URI, NUL, and lexically escaping include paths', () => {
  const source = [
    String.raw`\input{\jobname}`,
    String.raw`\include{/absolute/chapter}`,
    String.raw`\subfile{https://example.test/chapter.tex}`,
    `\\input{bad\0name}`,
    String.raw`\import{../../private/}{secret}`,
  ].join('\n');
  const scan = scanLatexProjectSource(source);

  assert.equal(scan.includes.length, 5);
  assert.deepEqual(
    scan.includes.slice(0, 4).map((include) => include.normalizedPath),
    [undefined, undefined, undefined, undefined],
  );
  assert.equal(scan.includes[4]?.normalizedPath, '../../private/secret');
  assert.equal(scan.graphIncomplete, true);
  assert.ok(scan.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-include-path'));
  assert.deepEqual(
    resolveLatexProjectPath('chapters/one.tex', '../../private/secret'),
    { ok: false, reason: 'workspace-escape' },
  );
});

test('builds an import graph and reports a bounded include cycle', () => {
  const sources = new Map<string, string>([
    ['main.tex', String.raw`\input{data/chap01}`],
    ['data/chap01.tex', String.raw`\import{sections/}{part}`],
    ['sections/part.tex', String.raw`\subimport{../data/}{chap01}`],
  ]);
  const graph = buildLatexProjectGraph('main.tex', sources);

  assert.deepEqual(graph.files.map((file) => file.path), [
    'main.tex',
    'data/chap01.tex',
    'sections/part.tex',
  ]);
  assert.deepEqual(graph.edges.map((edge) => [edge.from, edge.to, edge.status]), [
    ['main.tex', 'data/chap01.tex', 'resolved'],
    ['data/chap01.tex', 'sections/part.tex', 'resolved'],
    ['sections/part.tex', 'data/chap01.tex', 'resolved'],
    ['data/chap01.tex', 'sections/part.tex', 'resolved'],
    ['sections/part.tex', 'data/chap01.tex', 'cycle'],
  ]);
  assert.equal(graph.cycles.length, 1);
  assert.equal(graph.cycles[0]?.at(0), 'data/chap01.tex');
  assert.equal(graph.cycles[0]?.at(-1), 'data/chap01.tex');
  assert.equal(graph.graphIncomplete, true);
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === 'include-cycle'));
});

test('ordinary nested input keeps the semantic root working directory', () => {
  const graph = buildLatexProjectGraph('main.tex', new Map([
    ['main.tex', String.raw`\input{chapters/a}`],
    ['chapters/a.tex', String.raw`\input{shared}`],
    ['shared.tex', String.raw`\label{root-shared}`],
    ['chapters/shared.tex', String.raw`\label{wrong-containing-shared}`],
  ]));

  assert.deepEqual(graph.files.map((file) => file.path), [
    'main.tex',
    'chapters/a.tex',
    'shared.tex',
  ]);
  assert.deepEqual(graph.edges.map((edge) => [edge.from, edge.to]), [
    ['main.tex', 'chapters/a.tex'],
    ['chapters/a.tex', 'shared.tex'],
  ]);
  assert.equal(graph.graphIncomplete, false);
});

test('import and subimport carry ordered input search state per occurrence', () => {
  const graph = buildLatexProjectGraph('main.tex', new Map([
    ['main.tex', String.raw`\import{parts/}{a}`],
    ['parts/a.tex', String.raw`\input{shared}\subimport{sub/}{b}\import{other/}{c}`],
    ['shared.tex', 'root fallback'],
    ['parts/shared.tex', 'import-local'],
    ['parts/sub/b.tex', String.raw`\input{shared}`],
    ['parts/sub/shared.tex', 'nested import-local'],
    ['other/c.tex', 'root import'],
    ['parts/other/c.tex', 'wrong nested import'],
  ]));

  assert.deepEqual(graph.edges.map((edge) => [edge.from, edge.to]), [
    ['main.tex', 'parts/a.tex'],
    ['parts/a.tex', 'parts/shared.tex'],
    ['parts/a.tex', 'parts/sub/b.tex'],
    ['parts/sub/b.tex', 'parts/sub/shared.tex'],
    ['parts/a.tex', 'other/c.tex'],
  ]);
  assert.equal(graph.graphIncomplete, false);
});

test('ordered input search never skips an unsafe earlier import base', () => {
  const graph = buildLatexProjectGraph('project/main.tex', new Map([
    [
      'project/main.tex',
      String.raw`\documentclass{article}\import{../}{project/driver}`,
    ],
    ['project/driver.tex', String.raw`\input{../target}`],
    ['target.tex', 'wrong in-workspace fallback'],
  ]));

  assert.equal(graph.graphIncomplete, true);
  assert.equal(graph.files.some((file) => file.path === 'target.tex'), false);
  assert.equal(
    graph.edges.some((edge) =>
      edge.from === 'project/driver.tex' && edge.status === 'invalid'
    ),
    true,
  );
});

test('marks missing files and all configured limits without unbounded diagnostics', () => {
  const invalidSource = Array.from(
    { length: 12 },
    (_, index) => `\\input{\\dynamic${index}}`,
  ).join('\n');
  const scan = scanLatexProjectSource(invalidSource, {
    maxIncludes: 4,
    maxDiagnostics: 3,
  });
  assert.equal(scan.includes.length, 4);
  assert.equal(scan.diagnostics.length, 3);
  assert.equal(scan.diagnostics.at(-1)?.code, 'diagnostic-limit');
  assert.equal(scan.graphIncomplete, true);

  const graph = buildLatexProjectGraph(
    'main.tex',
    new Map([['main.tex', String.raw`\input{missing/chapter}`]]),
  );
  assert.equal(graph.edges[0]?.status, 'missing');
  assert.equal(graph.edges[0]?.to, 'missing/chapter.tex');
  assert.equal(graph.graphIncomplete, true);
  assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.code === 'missing-include-file'));
});
