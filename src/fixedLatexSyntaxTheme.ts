/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import type { VisualEditorSyntaxPalette } from "./visualEditorProtocol";

/**
 * TeXLeaf's self-contained source-highlighting variants.
 *
 * The colors are the contrast-safe Prettylights roles from GitHub Primer's
 * official light/dark design system. The LaTeX mapping is local to TeXLeaf:
 * control words use keyword, commands use entity, environments use entityTag,
 * keys/parameters use variable, and paths/URLs use string.
 * See THIRD_PARTY_NOTICES.md for provenance and license information.
 */
export type FixedLatexSyntaxAppearance = "light" | "dark";

export interface FixedLatexTextMateRule {
  readonly scopes: readonly string[];
  readonly foreground: string;
  readonly fontStyle?: string;
}

export interface FixedLatexSyntaxTheme {
  readonly id: "texleaf-primer-light" | "texleaf-primer-dark";
  readonly appearance: FixedLatexSyntaxAppearance;
  readonly palette: Readonly<Required<VisualEditorSyntaxPalette>>;
  readonly rules: readonly FixedLatexTextMateRule[];
}

const PRIMER_PRETTYLIGHTS_LIGHT: Readonly<Required<VisualEditorSyntaxPalette>> = {
  comment: "#57606a",
  command: "#6639ba",
  keyword: "#cf222e",
  string: "#0a3069",
  atom: "#953800",
  number: "#0550ae",
  variable: "#953800",
  operator: "#0550ae",
  punctuation: "#1f2328",
  meta: "#116329",
  link: "#0a3069",
  heading: "#6639ba",
  invalid: "#82071e",
};

const PRIMER_PRETTYLIGHTS_DARK: Readonly<Required<VisualEditorSyntaxPalette>> = {
  comment: "#8b949e",
  command: "#d2a8ff",
  keyword: "#ff7b72",
  string: "#a5d6ff",
  atom: "#ffa657",
  number: "#79c0ff",
  variable: "#ffa657",
  operator: "#79c0ff",
  punctuation: "#e6edf3",
  meta: "#7ee787",
  link: "#a5d6ff",
  heading: "#d2a8ff",
  invalid: "#f85149",
};

function latexTextMateRules(
  palette: Readonly<Required<VisualEditorSyntaxPalette>>,
): readonly FixedLatexTextMateRule[] {
  return [
    {
      scopes: [
        "comment",
        "punctuation.definition.comment",
      ],
      foreground: palette.comment,
      fontStyle: "italic",
    },
    {
      scopes: [
        "markup.raw",
        "string.quoted",
        "string.other.path.latex",
        "string.other.package.latex",
        "string.other.class.latex",
        "string.other.option.latex",
      ],
      foreground: palette.string,
    },
    {
      scopes: [
        "support.function",
        "entity.name.function",
        "support.function.general.tex",
        "support.function.reference.latex",
      ],
      foreground: palette.command,
    },
    {
      scopes: [
        "keyword.control",
        "keyword.control.environment.latex",
        "keyword.control.preamble.latex",
        "keyword.control.section.latex",
        "keyword.control.metadata.latex",
        "storage.type.function.latex",
      ],
      foreground: palette.keyword,
    },
    {
      scopes: [
        "entity.name.tag.environment.tex",
        "entity.name.type.documentclass.latex",
        "entity.name.type.package.latex",
        "support.class.latex",
      ],
      foreground: palette.meta,
    },
    {
      scopes: [
        "constant.numeric",
      ],
      foreground: palette.number,
    },
    {
      scopes: [
        "variable.parameter",
        "variable.other.math.latex",
        "constant.other.placeholder.latex",
      ],
      foreground: palette.variable,
    },
    {
      scopes: [
        "keyword.operator",
        "punctuation.math.operator.tex",
        "support.function.math-operator.latex",
      ],
      foreground: palette.operator,
    },
    {
      scopes: [
        "punctuation",
      ],
      foreground: palette.punctuation,
    },
    {
      scopes: [
        "constant.other.reference.label.latex",
        "constant.other.reference.bibliography.latex",
        "constant.language.latex",
      ],
      foreground: palette.atom,
    },
    {
      scopes: [
        "constant.other.reference.citation.latex",
        "string.other.link.latex",
      ],
      foreground: palette.link,
    },
    {
      scopes: [
        "markup.underline.link.latex",
        "string.other.url.latex",
      ],
      foreground: palette.link,
      fontStyle: "underline",
    },
    {
      scopes: [
        "entity.name.section.latex",
        "entity.name.title.latex",
        "markup.heading.latex",
      ],
      foreground: palette.heading,
      fontStyle: "bold",
    },
    {
      scopes: [
        "invalid",
      ],
      foreground: palette.invalid,
      fontStyle: "underline",
    },
  ];
}

const FIXED_LATEX_SYNTAX_THEMES: Readonly<
  Record<FixedLatexSyntaxAppearance, FixedLatexSyntaxTheme>
> = {
  light: {
    id: "texleaf-primer-light",
    appearance: "light",
    palette: PRIMER_PRETTYLIGHTS_LIGHT,
    rules: latexTextMateRules(PRIMER_PRETTYLIGHTS_LIGHT),
  },
  dark: {
    id: "texleaf-primer-dark",
    appearance: "dark",
    palette: PRIMER_PRETTYLIGHTS_DARK,
    rules: latexTextMateRules(PRIMER_PRETTYLIGHTS_DARK),
  },
};

export function fixedLatexSyntaxTheme(
  appearance: FixedLatexSyntaxAppearance,
): FixedLatexSyntaxTheme {
  return FIXED_LATEX_SYNTAX_THEMES[appearance];
}
