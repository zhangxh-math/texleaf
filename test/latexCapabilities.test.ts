/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveLatexPackagePreviewMacros,
  resolveLatexPreviewCapability,
} from '../src/core/latexCapabilities';

test('ThuThesis capability inherits Chinese chapter semantics and safe math aliases', () => {
  const capability = resolveLatexPreviewCapability('thuthesis', 'degree=master');
  assert.equal(capability.documentLanguage, 'zh');
  assert.equal(capability.numberingRootLevel, 'chapter');
  assert.equal(capability.mathMacros.symup, String.raw`\mathrm{#1}`);
  assert.equal(capability.mathMacros.dif, String.raw`\mathop{}\!\mathrm{d}`);
  assert.equal(Object.getPrototypeOf(capability.mathMacros), null);
  assert.equal(Object.isFrozen(capability.mathMacros), true);
});

test('ThuThesis English option and generic class hierarchy remain declarative', () => {
  assert.equal(
    resolveLatexPreviewCapability('thuthesis', 'degree=doctor, language = english')
      .documentLanguage,
    'en',
  );
  assert.equal(resolveLatexPreviewCapability('report').numberingRootLevel, 'chapter');
  assert.equal(resolveLatexPreviewCapability('article').numberingRootLevel, 'section');
  assert.deepEqual(Object.keys(resolveLatexPreviewCapability('article').mathMacros), []);
});

test('literal braket package declarations provide safe project preview macros', () => {
  const macros = resolveLatexPackagePreviewMacros(String.raw`
% \usepackage{braket}
\newcommand{\fake}{\usepackage{braket}}
\usepackage[one,two]{amsmath, braket}
`);

  assert.deepEqual(Object.keys(macros).sort(), [
    'Bra',
    'Braket',
    'Ket',
    'Set',
    'bra',
    'braket',
    'ket',
    'set',
  ]);
  assert.equal(macros.ket, String.raw`\mathinner{\lvert{#1}\rangle}`);
  assert.equal(macros.Braket, String.raw`\left\langle#1\right\rangle`);
});

test('commented or replacement-body package text does not grant capabilities', () => {
  const macros = resolveLatexPackagePreviewMacros(String.raw`
% \usepackage{braket}
\newcommand{\fake}{\RequirePackage{braket}}
\usepackage{amsmath}
`);

  assert.deepEqual(Object.keys(macros), []);
});
