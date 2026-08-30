/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { visualEditorSyntaxTokenFromTextMate } from "../src/visualEditorSyntaxToken";

test("visual syntax tokens keep inherited TextMate spans as explicit marks", () => {
  assert.deepEqual(
    visualEditorSyntaxTokenFromTextMate({
      from: 2,
      to: 7,
      resolvedForeground: "#A1B2C3",
      inheritedForeground: "#a1b2c3",
      fontStyle: 0,
    }),
    { from: 2, to: 7, fontStyle: 0 },
  );
});

test("visual syntax tokens preserve scoped colors and styles", () => {
  assert.deepEqual(
    visualEditorSyntaxTokenFromTextMate({
      from: 0,
      to: 4,
      resolvedForeground: "#ff0000",
      inheritedForeground: "#eeeeee",
      fontStyle: 3,
    }),
    { from: 0, to: 4, foreground: "#ff0000", fontStyle: 3 },
  );
});

test("visual syntax tokens omit empty and unstyled unresolved spans", () => {
  assert.equal(
    visualEditorSyntaxTokenFromTextMate({ from: 4, to: 4, fontStyle: 0 }),
    undefined,
  );
  assert.equal(
    visualEditorSyntaxTokenFromTextMate({ from: 4, to: 8, fontStyle: 0 }),
    undefined,
  );
});
