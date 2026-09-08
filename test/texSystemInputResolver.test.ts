import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { TexSystemInputResolver, type TexSystemInputCommandOptions } from '../src/texSystemInputResolver';

test('system input lookup validates roots, deduplicates calls and refreshes after invalidation', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'texleaf-system-input-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const library = path.join(base, 'texmf-dist');
  const project = path.join(base, 'project');
  await mkdir(library); await mkdir(project);
  const file = path.join(library, 'xy.tex');
  await writeFile(file, 'library');
  const calls: { args: readonly string[]; options: TexSystemInputCommandOptions }[] = [];
  const resolver = new TexSystemInputResolver({
    environment: { PATH: '/original/bin' }, platformDirectories: ['/platform/bin'],
    run: async (args, options) => {
      calls.push({ args, options });
      return args.includes('--var-value=TEXMFDIST') ? `${library}\n`
        : args.includes('--var-value=TEXMFLOCAL') ? '' : `${file}\n`;
    },
  });
  t.after(() => resolver.dispose());
  const request = { projectDirectory: project, binPath: path.join(base, 'configured bin') };
  assert.deepEqual(await Promise.all([
    resolver.isSystemInput('xy', request), resolver.isSystemInput('xy', request),
  ]), [true, true]);
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.options.cwd, project);
  assert.ok(calls[0]!.options.env.PATH?.startsWith(request.binPath + path.delimiter));
  assert.ok(calls[0]!.options.timeout > 0 && calls[0]!.options.timeout <= 2_000);
  assert.ok(calls[0]!.options.maxBuffer <= 16_384);
  const lookup = calls.find(call => call.args.includes('xy'))!;
  assert.ok(lookup.args.includes('--no-mktex=tex'));
  resolver.invalidate();
  assert.equal(await resolver.isSystemInput('xy', request), true);
  assert.equal(calls.length, 6);
  assert.equal(await resolver.isSystemInput('xy', { ...request, binPath: '/changed/bin' }), true);
  assert.equal(calls.length, 9);
});

test('system input lookup rejects project files, prefix impostors and symlink escapes', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'texleaf-system-boundary-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const library = path.join(base, 'texmf');
  const impostor = path.join(base, 'texmf-extra');
  const project = path.join(base, 'project');
  for (const directory of [library, impostor, project]) await mkdir(directory);
  const outside = path.join(impostor, 'xy.tex');
  const local = path.join(project, 'xy.tex');
  const link = path.join(library, 'xy.tex');
  await writeFile(outside, 'outside'); await writeFile(local, 'project');
  await symlink(outside, link);
  for (const output of [outside, local, link, 'xy.tex', `${outside}\n${local}`]) {
    const resolver = new TexSystemInputResolver({ platformDirectories: [], run: async args =>
      args.includes('--var-value=TEXMFDIST') ? library
        : args.includes('--var-value=TEXMFLOCAL') ? '' : output,
    });
    assert.equal(await resolver.isSystemInput('xy', { projectDirectory: project }), false, output);
    resolver.dispose();
  }
  const resolver = new TexSystemInputResolver({ platformDirectories: [], run: async args =>
    args.includes('--var-value=TEXMFDIST') ? project
      : args.includes('--var-value=TEXMFLOCAL') ? '' : local,
  });
  assert.equal(await resolver.isSystemInput('xy', { projectDirectory: project }), false);
  resolver.dispose();
});

test('unsafe names and unavailable or timed out lookup tools never establish a library', async () => {
  let calls = 0;
  const resolver = new TexSystemInputResolver({ platformDirectories: [], run: async () => {
    calls += 1; throw new Error('spawn ENOENT or timeout');
  } });
  try {
    for (const name of ['../xy', '/xy', '--help', 'foo/bar', String.raw`\macro`, 'x\ny', 'x.sty']) {
      assert.equal(await resolver.isSystemInput(name, { projectDirectory: tmpdir() }), false);
    }
    assert.equal(calls, 0);
    assert.equal(await resolver.isSystemInput('xy', { projectDirectory: tmpdir() }), false);
    const afterFailure = calls;
    assert.ok(afterFailure > 0);
    assert.equal(await resolver.isSystemInput('xy', { projectDirectory: tmpdir() }), false);
    assert.equal(calls, afterFailure);
  } finally { resolver.dispose(); }
});
