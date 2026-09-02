/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from 'node:assert/strict';
import { posix as path } from 'node:path';
import test from 'node:test';
import type * as VsCode from 'vscode';

class FakeUri {
  public constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query = '',
    public readonly fragment = '',
  ) {}

  public static parse(value: string): FakeUri {
    const match = /^([A-Za-z][A-Za-z0-9+.-]*):(?:\/\/([^/]*))?(\/.*)$/u.exec(value);
    if (match === null) {
      throw new Error(`Invalid fake URI: ${value}`);
    }
    return new FakeUri(match[1]!, match[2] ?? '', path.normalize(match[3]!));
  }

  public static joinPath(base: FakeUri, ...segments: string[]): FakeUri {
    return new FakeUri(
      base.scheme,
      base.authority,
      path.normalize(path.join(base.path, ...segments)),
    );
  }

  public get fsPath(): string {
    return this.path;
  }

  public with(change: {
    readonly scheme?: string;
    readonly authority?: string;
    readonly path?: string;
    readonly query?: string;
    readonly fragment?: string;
  }): FakeUri {
    return new FakeUri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  public toString(_skipEncoding?: boolean): string {
    const authority = this.authority.length > 0 ? `//${this.authority}` : '';
    const query = this.query.length > 0 ? `?${this.query}` : '';
    const fragment = this.fragment.length > 0 ? `#${this.fragment}` : '';
    return `${this.scheme}:${authority}${this.path}${query}${fragment}`;
  }
}

class FakeRelativePattern {
  public constructor(
    public readonly base: unknown,
    public readonly pattern: string,
  ) {}
}

class FakeFileSystemError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

class FakeEventEmitter<T> {
  private readonly listeners = new Set<(event: T) => unknown>();

  public readonly event = (
    listener: (event: T) => unknown,
    thisArgs?: unknown,
  ): VsCode.Disposable => {
    const bound = thisArgs === undefined ? listener : listener.bind(thisArgs);
    this.listeners.add(bound);
    return {
      dispose: () => this.listeners.delete(bound),
    };
  };

  public fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public dispose(): void {
    this.listeners.clear();
  }
}

const workspaceRoot = FakeUri.parse('memfs:/workspace');
const workspaceFolder = {
  uri: workspaceRoot,
  name: 'workspace',
  index: 0,
};
const files = new Map<string, string>();
const openDocuments: VsCode.TextDocument[] = [];
let configuredRoot: string | undefined;
let delayedRead: {
  readonly uri: string;
  claimed: boolean;
  readonly started: Promise<void>;
  readonly markStarted: () => void;
  readonly released: Promise<void>;
  readonly release: () => void;
} | undefined;

const fakeWorkspace = {
  get textDocuments(): readonly VsCode.TextDocument[] {
    return openDocuments;
  },
  fs: {
    readFile: async (uri: FakeUri): Promise<Uint8Array> => {
      const source = files.get(uri.toString());
      if (source === undefined) {
        throw new FakeFileSystemError(`Missing ${uri.toString()}`, 'FileNotFound');
      }
      const pending = delayedRead;
      if (
        pending !== undefined &&
        pending.uri === uri.toString() &&
        !pending.claimed
      ) {
        pending.claimed = true;
        pending.markStarted();
        await pending.released;
      }
      return new TextEncoder().encode(source);
    },
  },
  findFiles: async (): Promise<FakeUri[]> => [...files.keys()]
    .filter((key) => key.toLowerCase().endsWith('.tex'))
    .map((key) => FakeUri.parse(key)),
  getWorkspaceFolder: (uri: FakeUri): typeof workspaceFolder | undefined =>
    uri.scheme === workspaceRoot.scheme &&
      (uri.path === workspaceRoot.path || uri.path.startsWith(`${workspaceRoot.path}/`))
      ? workspaceFolder
      : undefined,
  getConfiguration: (_section: string, _resource: FakeUri) => ({
    get: <T>(_key: string): T | undefined => configuredRoot as T | undefined,
  }),
};

const vscodeMock = {
  Uri: FakeUri,
  RelativePattern: FakeRelativePattern,
  FileSystemError: FakeFileSystemError,
  EventEmitter: FakeEventEmitter,
  workspace: fakeWorkspace,
};

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;
const nodeModule = require('node:module') as {
  _load: NodeModuleLoader;
};
const originalLoad = nodeModule._load;
nodeModule._load = function loadWithVsCodeMock(
  request: string,
  parent: unknown,
  isMain: boolean,
): unknown {
  return request === 'vscode'
    ? vscodeMock
    : originalLoad.call(this, request, parent, isMain);
};

let contextModule: typeof import('../src/latexProjectContext');
try {
  contextModule = require('../src/latexProjectContext') as typeof contextModule;
} finally {
  nodeModule._load = originalLoad;
}
const { LatexProjectContextService } = contextModule;

function resetWorkspace(): void {
  files.clear();
  openDocuments.length = 0;
  configuredRoot = undefined;
  delayedRead = undefined;
}

function addFile(relativePath: string, source: string): FakeUri {
  const uri = FakeUri.joinPath(workspaceRoot, ...relativePath.split('/'));
  files.set(uri.toString(), source);
  return uri;
}

function openDocument(
  relativePath: string,
  source: string,
  version = 1,
  isDirty = true,
): VsCode.TextDocument {
  const uri = FakeUri.joinPath(workspaceRoot, ...relativePath.split('/'));
  const document = {
    uri,
    version,
    isDirty,
    getText: () => source,
  } as unknown as VsCode.TextDocument;
  openDocuments.push(document);
  return document;
}

function delayNextRead(uri: FakeUri): {
  readonly started: Promise<void>;
  readonly release: () => void;
} {
  let markStarted = (): void => {};
  let release = (): void => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  delayedRead = {
    uri: uri.toString(),
    claimed: false,
    started,
    markStarted,
    released,
    release,
  };
  return { started, release };
}

function projectFile(
  context: Awaited<ReturnType<InstanceType<typeof LatexProjectContextService>['getContext']>>,
  relativePath: string,
) {
  const expected = FakeUri.joinPath(workspaceRoot, ...relativePath.split('/')).toString();
  return context.files.find((file) => file.uri.toString() === expected);
}

function uniquelyExecutableLabel(
  context: Awaited<ReturnType<InstanceType<typeof LatexProjectContextService>['getContext']>>,
  key: string,
): boolean {
  const targets = context.labelsByKey.get(key) ?? [];
  return targets.length === 1 && targets[0]?.occurrenceCount === 1;
}

test('configured root keeps a malformed child root hint from disabling unique project labels', async () => {
  resetWorkspace();
  configuredRoot = 'thesis.tex';
  addFile(
    'thesis.tex',
    String.raw`\documentclass{book}
\begin{document}
\input{data/chapter}
\end{document}`,
  );
  const chapter = addFile(
    'data/chapter.tex',
    String.raw`% !TeX root = ../thesis.tex}
\begin{equation}\label{QM}x=1\end{equation}
See \ref{QM}.`,
  );
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(chapter as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'configured');
    assert.equal(context.graphIncomplete, false);
    assert.equal(uniquelyExecutableLabel(context, 'QM'), true);
    assert.equal(
      context.diagnostics.some((diagnostic) =>
        diagnostic.code === 'source:invalid-root-path'
      ),
      true,
    );
  } finally {
    service.dispose();
  }
});

test('configured root outranks magic root and a local document class', async () => {
  resetWorkspace();
  configuredRoot = 'configured.tex';
  const configured = addFile(
    'configured.tex',
    String.raw`\documentclass{report}
\begin{document}
\input{chapter}
\end{document}`,
  );
  addFile('magic.tex', String.raw`\documentclass{article}\begin{document}\end{document}`);
  const chapter = addFile(
    'chapter.tex',
    String.raw`% !TeX root = magic.tex
\documentclass{book}
\label{chapter-label}`,
  );
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(chapter as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'configured');
    assert.equal(context.rootUri?.toString(), configured.toString());
    assert.equal(context.documentClass, 'report');
    assert.equal(context.numberingRoot, 'chapter');
  } finally {
    service.dispose();
  }
});

test('an unrelated requested buffer stays visible but cannot pollute configured-root labels', async () => {
  resetWorkspace();
  configuredRoot = 'main.tex';
  addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}\label{project-label}\end{document}`,
  );
  const orphan = addFile('notes/orphan.tex', String.raw`\label{orphan-label}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(orphan as unknown as VsCode.Uri);
    assert.equal(projectFile(context, 'notes/orphan.tex')?.reachableFromRoot, false);
    assert.equal(context.labelsByKey.has('project-label'), true);
    assert.equal(context.labelsByKey.has('orphan-label'), false);
    assert.equal(
      context.diagnostics.some((diagnostic) =>
        diagnostic.code === 'requested-file-not-reachable'
      ),
      true,
    );
  } finally {
    service.dispose();
  }
});

test('magic root outranks self root, while an unannotated document class selects self', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{report}\begin{document}\end{document}`,
  );
  const child = addFile(
    'chapters/child.tex',
    String.raw`% !TeX root = ../main.tex
\documentclass{subfiles}\begin{document}\end{document}`,
  );
  const standalone = addFile(
    'standalone.tex',
    String.raw`\documentclass{article}\begin{document}\end{document}`,
  );
  const service = new LatexProjectContextService();
  try {
    const magicContext = await service.getContext(child as unknown as VsCode.Uri);
    assert.equal(magicContext.rootResolution, 'magic');
    assert.equal(magicContext.rootUri?.toString(), main.toString());

    const selfContext = await service.getContext(standalone as unknown as VsCode.Uri);
    assert.equal(selfContext.rootResolution, 'self');
    assert.equal(selfContext.rootUri?.toString(), standalone.toString());
  } finally {
    service.dispose();
  }
});

test('the subfiles document class resolves its literal main project before self', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}\subfile{parts/child}\end{document}`,
  );
  const child = addFile(
    'parts/child.tex',
    String.raw`\documentclass[../main.tex]{subfiles}\begin{document}\label{child-label}$x$\end{document}`,
  );
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(child as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'subfiles');
    assert.equal(context.rootUri?.toString(), main.toString());
    assert.equal(context.requestedRole, 'standalone');
    assert.equal(context.labelsByKey.get('child-label')?.[0]?.uri.toString(), child.toString());
  } finally {
    service.dispose();
  }
});

test('reverse root discovery canonicalizes nested subfiles fragments to the declared main', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}\subfile{parts/child}\end{document}`,
  );
  addFile(
    'parts/child.tex',
    String.raw`\documentclass[../main.tex]{subfiles}\begin{document}\input{fragment}\end{document}`,
  );
  const fragment = addFile('parts/fragment.tex', String.raw`\label{nested-fragment}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(fragment as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'reverse-include');
    assert.equal(context.rootUri?.toString(), main.toString());
    assert.equal(context.labelsByKey.has('nested-fragment'), true);
  } finally {
    service.dispose();
  }
});

test('a subfiles body occurrence skips the child standalone preamble', async () => {
  resetWorkspace();
  addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}\subfile{parts/child}\end{document}`,
  );
  addFile(
    'parts/child.tex',
    String.raw`\documentclass[../main.tex]{subfiles}
\input{child-only-setup}
\begin{document}
\input{fragment}
\end{document}`,
  );
  addFile('parts/child-only-setup.tex', String.raw`\label{inert-child-preamble}`);
  const fragment = addFile('parts/fragment.tex', String.raw`\label{live-child-body}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(fragment as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'reverse-include');
    assert.equal(context.graphIncomplete, false);
    assert.equal(context.labelsByKey.has('live-child-body'), true);
    assert.equal(context.labelsByKey.has('inert-child-preamble'), false);
    assert.equal(projectFile(context, 'parts/child-only-setup.tex'), undefined);
    assert.equal(
      projectFile(context, 'parts/child.tex')?.includes.some((edge) =>
        edge.status === 'ignored-standalone-preamble'
      ),
      true,
    );
  } finally {
    service.dispose();
  }
});

test('subfile and ordinary input keep distinct execution modes for one child', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}\subfile{parts/child}\input{parts/child}\end{document}`,
  );
  addFile(
    'parts/child.tex',
    String.raw`\documentclass[../main.tex]{subfiles}
\input{child-only-setup}
\begin{document}
\input{fragment}
\end{document}`,
  );
  addFile('child-only-setup.tex', 'ordinary-input setup');
  addFile('fragment.tex', 'ordinary-input body');
  addFile('parts/fragment.tex', 'subfile body');
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(main as unknown as VsCode.Uri);
    // Both execution modes must be represented instead of silently merged.
    assert.equal(context.graphIncomplete, false);
    assert.notEqual(projectFile(context, 'child-only-setup.tex'), undefined);
    assert.notEqual(projectFile(context, 'fragment.tex'), undefined);
    assert.notEqual(projectFile(context, 'parts/fragment.tex'), undefined);
    assert.equal(projectFile(context, 'parts/child.tex')?.occurrenceCount, 2);
  } finally {
    service.dispose();
  }
});

test('an invalid subfiles declaration cannot become a reverse root', async () => {
  resetWorkspace();
  addFile(
    'parts/child.tex',
    String.raw`\documentclass[../missing-main.tex]{subfiles}\begin{document}\input{fragment}\end{document}`,
  );
  const fragment = addFile('parts/fragment.tex', String.raw`\label{nested-fragment}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(fragment as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'unresolved');
    assert.equal(context.rootUri, undefined);
    assert.equal(context.graphIncomplete, true);
  } finally {
    service.dispose();
  }
});

test('unique reverse include discovers the root and dirty TextDocument content wins', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{article}
\begin{document}
\input{chapters/a}
\end{document}`,
  );
  addFile('chapters/a.tex', String.raw`\label{disk-label}`);
  const dirty = openDocument('chapters/a.tex', String.raw`\label{dirty-label}`, 7, true);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(dirty);
    assert.equal(context.rootResolution, 'reverse-include');
    assert.equal(context.rootUri?.toString(), main.toString());
    assert.equal(context.requestedRole, 'body');
    assert.equal(projectFile(context, 'chapters/a.tex')?.dirty, true);
    assert.equal(projectFile(context, 'chapters/a.tex')?.documentVersion, 7);
    assert.equal(context.labelsByKey.has('dirty-label'), true);
    assert.equal(context.labelsByKey.has('disk-label'), false);
  } finally {
    service.dispose();
  }
});

test('reverse root discovery replays nested ordinary input from each candidate root cwd', async () => {
  resetWorkspace();
  const main = addFile(
    'project/main.tex',
    String.raw`\documentclass{article}
\begin{document}\input{chapters/a}\end{document}`,
  );
  addFile('project/chapters/a.tex', String.raw`\input{shared}`);
  const shared = addFile('project/shared.tex', String.raw`\label{root-cwd-shared}`);
  addFile(
    'project/chapters/shared.tex',
    String.raw`\label{wrong-containing-shared}`,
  );
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(shared as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'reverse-include');
    assert.equal(context.rootUri?.toString(), main.toString());
    assert.equal(context.labelsByKey.has('root-cwd-shared'), true);
    assert.equal(context.labelsByKey.has('wrong-containing-shared'), false);
    assert.equal(projectFile(context, 'project/chapters/shared.tex'), undefined);
  } finally {
    service.dispose();
  }
});

test('reverse root discovery keeps the same physical include occurrence-specific', async () => {
  resetWorkspace();
  const mainA = addFile(
    'a/main.tex',
    String.raw`\documentclass{article}\begin{document}\input{../shared/bridge}\end{document}`,
  );
  addFile(
    'b/main.tex',
    String.raw`\documentclass{report}\begin{document}\input{../shared/bridge}\end{document}`,
  );
  addFile('shared/bridge.tex', String.raw`\input{common}`);
  const commonA = addFile('a/common.tex', String.raw`\label{a-common}`);
  addFile('b/common.tex', String.raw`\label{b-common}`);
  addFile('shared/common.tex', String.raw`\label{wrong-containing-common}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(commonA as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'reverse-include');
    assert.equal(context.rootUri?.toString(), mainA.toString());
    assert.equal(context.labelsByKey.has('a-common'), true);
    assert.equal(context.labelsByKey.has('b-common'), false);
    assert.equal(context.labelsByKey.has('wrong-containing-common'), false);
  } finally {
    service.dispose();
  }
});

test('reverse root discovery carries import and subimport search bases', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}\import{chapters/}{a}\end{document}`,
  );
  addFile('chapters/a.tex', String.raw`\subimport{sections/}{b}`);
  addFile('chapters/sections/b.tex', String.raw`\input{local}`);
  const local = addFile(
    'chapters/sections/local.tex',
    String.raw`\label{deep-import-local}`,
  );
  addFile('chapters/local.tex', String.raw`\label{parent-import-local}`);
  addFile('local.tex', String.raw`\label{root-import-local}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(local as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'reverse-include');
    assert.equal(context.rootUri?.toString(), main.toString());
    assert.equal(context.labelsByKey.has('deep-import-local'), true);
    assert.equal(context.labelsByKey.has('parent-import-local'), false);
    assert.equal(context.labelsByKey.has('root-import-local'), false);
  } finally {
    service.dispose();
  }
});

test('reverse root discovery does not claim uniqueness across an incomplete candidate', async () => {
  resetWorkspace();
  addFile(
    'main-a.tex',
    String.raw`\documentclass{article}\begin{document}\input{target}\end{document}`,
  );
  addFile(
    'main-b.tex',
    String.raw`\documentclass{report}\begin{document}\input{../outside}\end{document}`,
  );
  const target = addFile('target.tex', String.raw`\label{target}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(target as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'unresolved');
    assert.equal(context.rootUri, undefined);
    assert.equal(
      context.diagnostics.some((diagnostic) =>
        diagnostic.code === 'root-search-incomplete'
      ),
      true,
    );
  } finally {
    service.dispose();
  }
});

test('reverse root discovery rejects a target reached only through incomplete execution', async () => {
  resetWorkspace();
  addFile(
    'main.tex',
    String.raw`\documentclass{article}
\begin{document}
\ifdraft\endinput\fi
\input{target}
\end{document}`,
  );
  const target = addFile('target.tex', String.raw`\label{target}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(target as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'unresolved');
    assert.equal(context.rootUri, undefined);
    assert.equal(context.graphIncomplete, true);
    assert.equal(
      context.diagnostics.some((diagnostic) => diagnostic.code === 'root-search-incomplete'),
      true,
    );
  } finally {
    service.dispose();
  }
});

test('reverse root discovery ignores wrapper siblings after an included document terminates', async () => {
  resetWorkspace();
  addFile(
    'main.tex',
    String.raw`\documentclass{article}
\input{document}
\input{target}`,
  );
  addFile(
    'document.tex',
    String.raw`\begin{document}\section{Only document}\end{document}`,
  );
  const target = addFile('target.tex', String.raw`\label{inert-target}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(target as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'standalone');
    assert.equal(context.rootUri?.toString(), target.toString());
    assert.equal(context.graphIncomplete, false);
    assert.equal(projectFile(context, 'main.tex'), undefined);
  } finally {
    service.dispose();
  }
});

test('unrelated incomplete non-root files do not veto reverse root discovery', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}\input{chapter}\end{document}`,
  );
  const chapter = addFile('chapter.tex', String.raw`\label{chapter}`);
  addFile(
    'fixtures/unrelated.tex',
    String.raw`\ifdraft\input{unknown-fixture}\fi`,
  );
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(chapter as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'reverse-include');
    assert.equal(context.rootUri?.toString(), main.toString());
  } finally {
    service.dispose();
  }
});

test('ambiguous reverse includes never guess between two document roots', async () => {
  resetWorkspace();
  addFile(
    'main-a.tex',
    String.raw`\documentclass{article}\begin{document}\input{shared}\end{document}`,
  );
  addFile(
    'main-b.tex',
    String.raw`\documentclass{report}\begin{document}\input{shared}\end{document}`,
  );
  const shared = addFile('shared.tex', String.raw`\section{Shared}\label{shared}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(shared as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'ambiguous');
    assert.equal(context.rootUri, undefined);
    assert.equal(context.requestedRole, 'body');
    assert.equal(
      context.diagnostics.filter((diagnostic) =>
        diagnostic.code === 'ambiguous-root-candidate'
      ).length,
      2,
    );
  } finally {
    service.dispose();
  }
});

test('ThuThesis setup is expanded in preamble order and chapter files are body fragments', async () => {
  resetWorkspace();
  const main = addFile(
    'thuthesis-example.tex',
    String.raw`\documentclass[degree=master]{thuthesis}
\input{thusetup}
\begin{document}
\input{data/chap01}
\end{document}`,
  );
  addFile(
    'thusetup.tex',
    String.raw`\newcommand{\institution}{清华大学}
\thusetup{title={项目上下文测试}}`,
  );
  const chapter = addFile('data/chap01.tex', String.raw`\chapter{第一章}\label{chap:first}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(chapter as unknown as VsCode.Uri);
    assert.equal(context.rootUri?.toString(), main.toString());
    assert.equal(context.rootLanguage, 'zh');
    assert.equal(context.numberingRoot, 'chapter');
    assert.equal(projectFile(context, 'thuthesis-example.tex')?.role, 'standalone');
    assert.equal(projectFile(context, 'thusetup.tex')?.role, 'preamble');
    assert.equal(projectFile(context, 'data/chap01.tex')?.role, 'body');
    assert.ok(context.preambleSource.indexOf(String.raw`\documentclass`) >= 0);
    assert.ok(context.preambleSource.indexOf(String.raw`\newcommand{\institution}`) >
      context.preambleSource.indexOf(String.raw`\documentclass`));
    assert.equal(context.preambleSource.includes(String.raw`\begin{document}`), false);
    assert.equal(context.preambleSource.includes(String.raw`\chapter{第一章}`), false);
  } finally {
    service.dispose();
  }
});

test('only executable document-body labels enter the project index', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{article}
\label{preamble-label}
\begin{document}
\label{root-body-label}
\input{chapter}
\end{document}
\label{after-document-label}`,
  );
  const chapter = addFile('chapter.tex', String.raw`\label{chapter-body-label}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(chapter as unknown as VsCode.Uri);
    assert.equal(context.rootUri?.toString(), main.toString());
    assert.equal(context.labelsByKey.has('root-body-label'), true);
    assert.equal(context.labelsByKey.has('chapter-body-label'), true);
    assert.equal(context.labelsByKey.has('preamble-label'), false);
    assert.equal(context.labelsByKey.has('after-document-label'), false);
  } finally {
    service.dispose();
  }
});

test('endinput bounds expanded preambles and authoritative body labels', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{article}
\input{setup}
\begin{document}\input{chapter}\end{document}`,
  );
  addFile(
    'setup.tex',
    String.raw`\newcommand{\beforeendinput}{available}
\endinput
\newcommand{\afterendinput}{inert}`,
  );
  const chapter = addFile(
    'chapter.tex',
    String.raw`\label{live-label}
\endinput
\label{inert-label}`,
  );
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(chapter as unknown as VsCode.Uri);
    assert.equal(context.rootUri?.toString(), main.toString());
    assert.equal(context.graphIncomplete, false);
    assert.equal(context.preambleSource.includes(String.raw`\beforeendinput`), true);
    assert.equal(context.preambleSource.includes(String.raw`\afterendinput`), false);
    assert.equal(context.labelsByKey.has('live-label'), true);
    assert.equal(context.labelsByKey.has('inert-label'), false);
  } finally {
    service.dispose();
  }
});

test('an explicitly selected wrapper root can source its document preamble', async () => {
  resetWorkspace();
  configuredRoot = 'wrapper.tex';
  addFile('wrapper.tex', String.raw`\input{document}
\newcommand{\afterdocument}{wrong}
\input{after-document}`);
  const document = addFile(
    'document.tex',
    String.raw`\documentclass{book}
\newcommand{\wrappermacro}{loaded}
\begin{document}
\chapter{Body}
\end{document}`,
  );
  addFile('after-document.tex', String.raw`\newcommand{\ghostmacro}{wrong}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(document as unknown as VsCode.Uri);
    assert.equal(context.rootResolution, 'configured');
    assert.equal(context.documentClass, 'book');
    assert.equal(context.numberingRoot, 'chapter');
    assert.equal(context.preambleSource.includes(String.raw`\documentclass{book}`), true);
    assert.equal(context.preambleSource.includes(String.raw`\newcommand{\wrappermacro}`), true);
    assert.equal(context.preambleSource.includes(String.raw`\afterdocument`), false);
    assert.equal(context.preambleSource.includes(String.raw`\ghostmacro`), false);
    assert.equal(context.preambleSource.includes(String.raw`\begin{document}`), false);
    assert.equal(projectFile(context, 'after-document.tex'), undefined);
  } finally {
    service.dispose();
  }
});

test('a complete document included by a configured wrapper exposes its body and labels', async () => {
  resetWorkspace();
  configuredRoot = 'wrapper.tex';
  addFile('wrapper.tex', String.raw`\input{document}`);
  const document = addFile(
    'document.tex',
    String.raw`\documentclass{report}\begin{document}\chapter{One}\label{wrapped-label}\end{document}`,
  );
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(document as unknown as VsCode.Uri);
    assert.equal(context.requestedRole, 'standalone');
    assert.deepEqual(
      context.files.find((file) => file.uri.toString() === document.toString())?.roles,
      ['standalone', 'preamble'],
    );
    assert.equal(context.labelsByKey.has('wrapped-label'), true);
  } finally {
    service.dispose();
  }
});

test('duplicate definitions and transitively repeated execution both fail closed', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{article}
\begin{document}
\input{a}
\input{a}
\input{other}
\end{document}`,
  );
  addFile(
    'a.tex',
    String.raw`\label{repeated-direct}\input{nested}\label{duplicate-key}`,
  );
  addFile('nested.tex', String.raw`\label{repeated-transitive}`);
  addFile('other.tex', String.raw`\label{duplicate-key}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(main as unknown as VsCode.Uri);
    assert.equal(context.labelsByKey.get('duplicate-key')?.length, 2);
    assert.equal(context.labelsByKey.get('repeated-direct')?.[0]?.occurrenceCount, 2);
    assert.equal(context.labelsByKey.get('repeated-transitive')?.[0]?.occurrenceCount, 2);
    assert.equal(uniquelyExecutableLabel(context, 'duplicate-key'), false);
    assert.equal(uniquelyExecutableLabel(context, 'repeated-direct'), false);
    assert.equal(uniquelyExecutableLabel(context, 'repeated-transitive'), false);
  } finally {
    service.dispose();
  }
});

test('unsafe, missing, dynamic, and cyclic includes are bounded diagnostics', async () => {
  resetWorkspace();
  const root = addFile(
    'main.tex',
    String.raw`\documentclass{article}
\input{../outside}
\input{missing}
\input{\dynamicName}
\input{cycle}
\begin{document}\end{document}`,
  );
  addFile('cycle.tex', String.raw`\input{main}`);
  addFile('../outside.tex', String.raw`\label{must-not-enter-project}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(root as unknown as VsCode.Uri);
    const codes = new Set(context.diagnostics.map((diagnostic) => diagnostic.code));
    assert.equal(context.graphIncomplete, true);
    assert.equal(codes.has('outside-workspace'), true);
    assert.equal(codes.has('missing-include'), true);
    assert.equal(codes.has('dynamic-include'), true);
    assert.equal(codes.has('include-cycle'), true);
    assert.equal(context.labelsByKey.has('must-not-enter-project'), false);
    assert.equal(context.preambleSource.includes(String.raw`\input{missing}`), true);
    assert.equal(context.preambleSource.includes(String.raw`\input{\dynamicName}`), true);
  } finally {
    service.dispose();
  }
});

test('known roots keep ordinary nested input at the root working directory', async () => {
  resetWorkspace();
  configuredRoot = 'main.tex';
  addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}\input{chapters/a}\end{document}`,
  );
  const chapter = addFile('chapters/a.tex', String.raw`\input{shared}`);
  addFile('shared.tex', String.raw`\label{root-shared}`);
  addFile('chapters/shared.tex', String.raw`\label{wrong-containing-shared}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(chapter as unknown as VsCode.Uri);
    assert.equal(context.labelsByKey.has('root-shared'), true);
    assert.equal(context.labelsByKey.has('wrong-containing-shared'), false);
    assert.equal(projectFile(context, 'shared.tex')?.role, 'body');
    assert.equal(projectFile(context, 'chapters/shared.tex'), undefined);
  } finally {
    service.dispose();
  }
});

test('import path state is occurrence-specific and ordinary input follows its ordered bases', async () => {
  resetWorkspace();
  configuredRoot = 'main.tex';
  addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}
\import{one/}{../common/driver}
\import{two/}{../common/driver}
\end{document}`,
  );
  const driver = addFile('common/driver.tex', String.raw`\label{driver}\input{local}`);
  addFile('one/local.tex', String.raw`\label{one-local}`);
  addFile('two/local.tex', String.raw`\label{two-local}`);
  addFile('local.tex', String.raw`\label{wrong-root-fallback}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(driver as unknown as VsCode.Uri);
    assert.equal(projectFile(context, 'common/driver.tex')?.occurrenceCount, 2);
    assert.equal(context.labelsByKey.has('one-local'), true);
    assert.equal(context.labelsByKey.has('two-local'), true);
    assert.equal(context.labelsByKey.has('wrong-root-fallback'), false);
    assert.equal(context.labelsByKey.get('driver')?.[0]?.occurrenceCount, 2);
  } finally {
    service.dispose();
  }
});

test('context input search fails closed before an unsafe earlier import base', async () => {
  resetWorkspace();
  configuredRoot = 'project/main.tex';
  addFile(
    'project/main.tex',
    String.raw`\documentclass{article}\import{../}{project/driver}`,
  );
  addFile('project/driver.tex', String.raw`\input{../target}`);
  const target = addFile('target.tex', String.raw`\label{wrong-fallback}`);
  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(target as unknown as VsCode.Uri);
    assert.equal(context.graphIncomplete, true);
    assert.equal(context.labelsByKey.has('wrong-fallback'), false);
    assert.equal(
      context.files.some((file) =>
        file.uri.toString() === target.toString() && file.reachableFromRoot
      ),
      false,
    );
  } finally {
    service.dispose();
  }
});

test('cache invalidation advances the shared revision and rejects an escaping configured root', async () => {
  resetWorkspace();
  const root = addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}\end{document}`,
  );
  const service = new LatexProjectContextService();
  try {
    const first = await service.getContext(root as unknown as VsCode.Uri);
    const cached = await service.getContext(root as unknown as VsCode.Uri);
    assert.strictEqual(cached, first);

    let invalidatedRevision = 0;
    const subscription = service.onDidInvalidate((event) => {
      invalidatedRevision = event.revision;
    });
    service.invalidate(root as unknown as VsCode.Uri);
    const rebuilt = await service.getContext(root as unknown as VsCode.Uri);
    assert.ok(rebuilt.revision > first.revision);
    assert.equal(rebuilt.revision, invalidatedRevision);
    assert.equal(rebuilt.contextId, first.contextId);
    subscription.dispose();
  } finally {
    service.dispose();
  }

  configuredRoot = '../outside.tex';
  const invalidService = new LatexProjectContextService();
  try {
    const invalid = await invalidService.getContext(root as unknown as VsCode.Uri);
    assert.equal(invalid.rootResolution, 'invalid-configured');
    assert.equal(invalid.rootUri, undefined);
    assert.equal(invalid.graphIncomplete, true);
    assert.equal(
      invalid.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-configured-root'),
      true,
    );
  } finally {
    invalidService.dispose();
  }
});

test('different requested files under one root share context identity and generation', async () => {
  resetWorkspace();
  addFile(
    'main.tex',
    String.raw`\documentclass{article}\begin{document}\input{a}\input{b}\end{document}`,
  );
  const a = addFile('a.tex', String.raw`\section{A}\label{a}`);
  const b = addFile('b.tex', String.raw`\section{B}\label{b}`);
  const service = new LatexProjectContextService();
  try {
    const contextA = await service.getContext(a as unknown as VsCode.Uri);
    const contextB = await service.getContext(b as unknown as VsCode.Uri);
    assert.equal(contextA.contextId, contextB.contextId);
    assert.equal(contextA.revision, contextB.revision);
    assert.equal(contextA.labelsByKey.has('a'), true);
    assert.equal(contextA.labelsByKey.has('b'), true);
    assert.equal(contextB.labelsByKey.has('a'), true);
    assert.equal(contextB.labelsByKey.has('b'), true);
  } finally {
    service.dispose();
  }
});

test('a stale in-flight read cannot overwrite the next generation source cache', async () => {
  resetWorkspace();
  const main = addFile(
    'main.tex',
    String.raw`\documentclass{article}
\begin{document}\label{old-root-label}\input{chapter}\end{document}`,
  );
  const chapter = addFile('chapter.tex', String.raw`\section{Chapter}\label{chapter}`);
  const delayed = delayNextRead(main);
  const service = new LatexProjectContextService();
  try {
    const staleRequest = service.getContext(main as unknown as VsCode.Uri);
    await delayed.started;

    files.set(
      main.toString(),
      String.raw`\documentclass{article}
\begin{document}\label{new-root-label}\input{chapter}\end{document}`,
    );
    service.invalidate(main as unknown as VsCode.Uri);
    const current = await service.getContext(main as unknown as VsCode.Uri);
    assert.equal(current.labelsByKey.has('new-root-label'), true);
    assert.equal(current.labelsByKey.has('old-root-label'), false);

    delayed.release();
    const redirectedStaleRequest = await staleRequest;
    assert.strictEqual(redirectedStaleRequest, current);

    // This cache miss builds another document context in the same generation.
    // If the stale read were allowed to refill sourceCache, reverse discovery
    // and the project label index here would observe old-root-label.
    const fromChapter = await service.getContext(chapter as unknown as VsCode.Uri);
    assert.equal(fromChapter.revision, current.revision);
    assert.equal(fromChapter.labelsByKey.has('new-root-label'), true);
    assert.equal(fromChapter.labelsByKey.has('old-root-label'), false);
  } finally {
    delayed.release();
    service.dispose();
  }
});

test('CRLF project buffers use stable LF visual ranges without changing project semantics', async () => {
  resetWorkspace();
  configuredRoot = 'main.tex';
  const rootSource = [
    String.raw`\documentclass{article}`,
    String.raw`\begin{document}`,
    String.raw`\input{chapter}`,
    String.raw`\end{document}`,
    '',
  ].join('\r\n');
  const chapterSource = [
    String.raw`\section{Windows}`,
    String.raw`\begin{align}`,
    String.raw`x&=1 \label{crlf-line} \\`,
    String.raw`y&=2`,
    String.raw`\end{align}`,
    '',
  ].join('\r\n');
  const root = addFile('main.tex', rootSource);
  const chapter = addFile('chapter.tex', chapterSource);
  openDocument('main.tex', rootSource, 2, true);
  openDocument('chapter.tex', chapterSource, 3, true);

  const service = new LatexProjectContextService();
  try {
    const context = await service.getContext(chapter as unknown as VsCode.Uri);
    const rootFile = projectFile(context, 'main.tex');
    const chapterFile = projectFile(context, 'chapter.tex');
    assert.ok(rootFile);
    assert.ok(chapterFile);
    assert.equal(rootFile.sourceKind, 'open-document');
    assert.equal(chapterFile.sourceKind, 'open-document');
    assert.equal(rootFile.text.includes('\r'), false);
    assert.equal(chapterFile.text.includes('\r'), false);
    assert.equal(rootFile.text, rootSource.replaceAll('\r\n', '\n'));
    assert.equal(chapterFile.text, chapterSource.replaceAll('\r\n', '\n'));

    const include = rootFile.sourceScan.includes[0];
    assert.ok(include);
    assert.equal(
      rootFile.text.slice(include.range.start, include.range.end),
      String.raw`\input{chapter}`,
    );
    const target = context.labelsByKey.get('crlf-line')?.[0];
    assert.ok(target);
    assert.equal(target.uri.toString(), chapter.toString());
    assert.equal(chapterFile.text.slice(target.from, target.to), String.raw`\label{crlf-line}`);
    assert.equal(chapterFile.text.slice(target.keyFrom, target.keyTo), 'crlf-line');
    assert.equal(context.rootUri?.toString(), root.toString());
    assert.equal(context.graphIncomplete, false);
  } finally {
    service.dispose();
  }
});
