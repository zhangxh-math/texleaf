/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { isLatexOpaqueEnvironmentEndAt, scanLatexRegions, type LatexEnvironmentAlias } from "./latexScanner";
import { isMathPreviewMacroName, MATH_PREVIEW_MAX_MACRO_COUNT, MATH_PREVIEW_MAX_MACRO_SERIALIZED_LENGTH } from "../mathPreviewProtocol";
export { MATH_PREVIEW_MAX_MACRO_COUNT, MATH_PREVIEW_MAX_MACRO_SERIALIZED_LENGTH } from "../mathPreviewProtocol";
import type { LatexMathRegion, OffsetRange } from "./types";

export type MathPreviewSyntax =
  | "dollar-inline"
  | "dollar-display"
  | "paren-inline"
  | "bracket-display"
  | "environment";

export interface MathPreviewFormula {
  readonly syntax: MathPreviewSyntax;
  readonly mode: "inline" | "block";
  readonly outerRange: OffsetRange;
  readonly bodyRange: OffsetRange;
  readonly environmentName?: string;
  readonly closed: boolean;
  /** Index into snapshot.macroEnvironments for position-sensitive body fragments. */
  readonly macroEnvironmentIndex?: number;
}

export interface MathPreviewMacro {
  readonly name: string;
  readonly replacement: string;
  readonly argumentCount: number;
  readonly optionalDefault?: string;
}

/** A deeply immutable, renderer-safe macro table and its canonical cache key. */
export interface MathPreviewMacroEnvironment {
  readonly macros: Readonly<Record<string, MathPreviewMacro>>;
  readonly macroFingerprint: string;
}

export interface UnorderedMathPreviewPreambleMacroResolution {
  /** Safe union of definitions whose meaning does not depend on file order. */
  readonly environment: MathPreviewMacroEnvironment;
  /** Same-name definitions that disagreed across supplemental files. */
  readonly conflictingMacroNames: readonly string[];
  /** Definitions discarded because they depend on a conflicting definition. */
  readonly dependentMacroNames: readonly string[];
  /** True when input or renderer bounds required dropping otherwise safe clues. */
  readonly incomplete: boolean;
}

export interface MathPreviewMacroEnvironmentTransition {
  /** UTF-16 source offset at which this environment becomes active. */
  readonly offset: number;
  /** Index into snapshot.macroEnvironments. */
  readonly macroEnvironmentIndex: number;
}

export type MathPreviewFragmentKind = "standalone" | "body" | "preamble";

export interface MathPreviewSnapshot {
  readonly formulas: readonly MathPreviewFormula[];
  readonly macros: Readonly<Record<string, MathPreviewMacro>>;
  /** Stable, collision-free cache material for the resolved macro table. */
  readonly macroFingerprint: string;
  /** Bounded environments referenced by body-fragment formulas. */
  readonly macroEnvironments?: readonly MathPreviewMacroEnvironment[];
  /** Source-ordered macro states used by structure and virtual-input previews. */
  readonly macroEnvironmentTransitions?: readonly MathPreviewMacroEnvironmentTransition[];
}

export interface MathPreviewRenderInput {
  readonly tex: string;
  readonly display: boolean;
  readonly macros: Readonly<Record<string, MathPreviewMacro>>;
  readonly macroFingerprint: string;
}

export interface MathPreviewScanOptions {
  readonly maxSourceLength?: number;
  readonly configuredMacros?: Readonly<Record<string, string>>;
  /** Defaults to standalone so all existing callers retain their old behavior. */
  readonly fragmentKind?: MathPreviewFragmentKind;
  /** Project/root context, merged after configured macros and before local macros. */
  readonly inheritedMacroEnvironment?: MathPreviewMacroEnvironment;
}

const DEFAULT_MAX_SOURCE_LENGTH = 8_192;
export const MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH = 2_048;
const MATH_PREVIEW_MAX_MACRO_CONTROL_SEQUENCE_COUNT = 256;

/**
 * Normalize user-configured macros before they enter a document snapshot.
 * The serialized-size check mirrors the worker's final request boundary so a
 * settings value accepted here cannot make every preview request invalid.
 */
export function sanitizeMathPreviewConfiguredMacros(
  value: unknown,
): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return freezeNullPrototypeRecord<string>();
  }

  const source = value as Readonly<Record<string, unknown>>;
  const result: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  const resolved: Record<string, MathPreviewMacro> = Object.create(null) as Record<
    string,
    MathPreviewMacro
  >;
  for (const name of Object.keys(source).sort()) {
    const normalizedName = normalizeMacroName(name);
    const replacement = source[name];
    if (
      normalizedName === undefined ||
      typeof replacement !== "string" ||
      replacement.length > MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH ||
      (!Object.hasOwn(resolved, normalizedName) &&
        Object.keys(resolved).length >= MATH_PREVIEW_MAX_MACRO_COUNT)
    ) {
      continue;
    }
    if (
      !trySetResolvedMacro(resolved, {
        name: normalizedName,
        replacement,
        argumentCount: inferArgumentCount(replacement),
      })
    ) {
      continue;
    }
    result[normalizedName] = replacement;
  }
  return Object.freeze(result);
}

/**
 * Copy an arbitrary macro table across the project/document boundary. The
 * supplied records are never retained, the map has no prototype, and the
 * fingerprint is always recomputed from the bounded canonical copy.
 */
export function createMathPreviewMacroEnvironment(
  macros: Readonly<Record<string, MathPreviewMacro>>,
): MathPreviewMacroEnvironment {
  const resolved = createMutableMacroTable();
  if (typeof macros === "object" && macros !== null && !Array.isArray(macros)) {
    const source = macros as Readonly<Record<string, unknown>>;
    for (const rawName of Object.keys(source).sort()) {
      const macro = sanitizeMathPreviewMacro(rawName, source[rawName]);
      if (macro !== undefined) {
        trySetResolvedMacro(resolved, macro);
      }
    }
  }
  return createMacroEnvironment(resolved);
}

/**
 * Resolve manually declared preamble files without inventing a TeX load order.
 * A name is retained only when every declaration of that name has the exact
 * same renderer-safe meaning. Definitions depending on an order-conflicted
 * name are removed transitively as well.
 */
export function resolveUnorderedMathPreviewPreambleMacros(
  sources: readonly string[],
): UnorderedMathPreviewPreambleMacroResolution {
  const maximumSources = 256;
  const maximumSourceLength = 1_000_000;
  const maximumTotalLength = 8_000_000;
  if (
    !Array.isArray(sources) ||
    sources.length > maximumSources ||
    sources.some((source) =>
      typeof source !== "string" || source.length > maximumSourceLength
    ) ||
    sources.reduce((total, source) => total + source.length, 0) > maximumTotalLength
  ) {
    return Object.freeze({
      environment: createMathPreviewMacroEnvironment({}),
      conflictingMacroNames: Object.freeze([]),
      dependentMacroNames: Object.freeze([]),
      incomplete: true,
    });
  }

  const definitions = new Map<
    string,
    { readonly fingerprint: string; readonly macro: MathPreviewMacro }
  >();
  const conflicts = new Set<string>();
  for (const source of sources) {
    const snapshot = scanMathPreviewDocument(source, {
      fragmentKind: "preamble",
      maxSourceLength: 32_768,
    });
    for (const name of Object.keys(snapshot.macros)) {
      const macro = snapshot.macros[name];
      if (macro === undefined || conflicts.has(name)) {
        continue;
      }
      const fingerprint = mathPreviewMacroDefinitionFingerprint(macro);
      const previous = definitions.get(name);
      if (previous === undefined) {
        definitions.set(name, { fingerprint, macro });
      } else if (previous.fingerprint !== fingerprint) {
        definitions.delete(name);
        conflicts.add(name);
      }
    }
  }

  const excluded = new Set(conflicts);
  const dependents = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, definition] of definitions) {
      if (excluded.has(name)) {
        continue;
      }
      const referenced = mathPreviewMacroControlSequenceNames(definition.macro);
      if ([...referenced].some((dependency) => excluded.has(dependency))) {
        excluded.add(name);
        dependents.add(name);
        changed = true;
      }
    }
  }

  const safe = createMutableMacroTable();
  for (const name of [...definitions.keys()].sort()) {
    if (!excluded.has(name)) {
      const macro = definitions.get(name)?.macro;
      if (macro !== undefined) {
        safe[name] = macro;
      }
    }
  }
  const environment = createMathPreviewMacroEnvironment(safe);
  const retainedNames = new Set(Object.keys(environment.macros));
  const expectedNames = Object.keys(safe);
  return Object.freeze({
    environment,
    conflictingMacroNames: Object.freeze([...conflicts].sort()),
    dependentMacroNames: Object.freeze([...dependents].sort()),
    incomplete: retainedNames.size !== expectedNames.length ||
      expectedNames.some((name) => !retainedNames.has(name)),
  });
}

/**
 * Build the preview index for one immutable document snapshot.
 *
 * The existing TeXLeaf scanner remains the single source of truth for math
 * syntax, comments and verbatim regions. This layer only removes nested
 * duplicate regions and resolves the small, renderer-safe macro model.
 *
 * - standalone preserves the historic full-document/body-range behavior;
 * - body scans the entire fragment and assigns source-ordered macro contexts;
 * - preamble extracts macros from the entire fragment and emits no formulas.
 *
 * Macro precedence is configured < inherited/project < local. A local
 * providecommand is the sole exception: it never replaces an existing name.
 */
export function scanMathPreviewDocument(
  text: string,
  options: MathPreviewScanOptions = {},
): MathPreviewSnapshot {
  const maxSourceLength = clampInteger(
    options.maxSourceLength ?? DEFAULT_MAX_SOURCE_LENGTH,
    256,
    32_768,
  );
  const fragmentKind = normalizeMathPreviewFragmentKind(options.fragmentKind);
  const configured = sanitizeMathPreviewConfiguredMacros(options.configuredMacros ?? {});
  const inherited = normalizeInheritedMacroEnvironment(options.inheritedMacroEnvironment);
  const document = collectDocumentMacros(
    text, fragmentKind !== "standalone", seedMathPreviewMacros(configured, inherited),
  );
  const bodyFragmentHasExplicitDocument = fragmentKind === "body" &&
    document.bodyRange.start > 0;
  const normalizedFormulas = fragmentKind === "preamble"
    ? []
    : normalizeMathRegions(text, scanLatexRegions(text, document.environmentAliases,
        [...document.definitionRanges, ...document.inactiveRanges].sort((a, b) => a.start - b.start),
      )).filter(
        (formula) =>
          ((fragmentKind === "body" && !bodyFragmentHasExplicitDocument) ||
            (formula.outerRange.start >= document.bodyRange.start &&
              formula.outerRange.end <= document.bodyRange.end)) &&
          !isInsideMacroDefinition(
            formula,
            document.definitionRanges,
            fragmentKind,
          ) &&
          !isInsideInactiveMathPreviewRange(formula, document.inactiveRanges) &&
          formula.bodyRange.end - formula.bodyRange.start <= maxSourceLength,
      );

  if (fragmentKind === "body") {
    return createBodyFragmentSnapshot(
      normalizedFormulas,
      configured,
      inherited,
      document.macros,
    );
  }

  if (fragmentKind === "standalone") {
    const preambleMacros = document.macros.filter(
      (macro) => macro.sourceRange.end <= document.bodyRange.start,
    );
    const bodyMacros = document.macros.filter(
      (macro) =>
        macro.sourceRange.end > document.bodyRange.start &&
        macro.sourceRange.start < document.bodyRange.end,
    );
    const preambleEnvironment = createMathPreviewMacroEnvironment(
      resolveMathPreviewMacros(configured, inherited, preambleMacros),
    );
    return createBodyFragmentSnapshot(
      normalizedFormulas,
      {},
      preambleEnvironment,
      bodyMacros,
    );
  }

  const macros = resolveMathPreviewMacros(configured, inherited, document.macros);
  return Object.freeze({
    formulas: Object.freeze([...normalizedFormulas]),
    macros,
    macroFingerprint: macroFingerprint(macros),
  });
}

/** Convert scanner regions to non-overlapping, outermost preview formulas. */
export function normalizeMathRegions(
  text: string,
  regions: readonly LatexMathRegion[],
): readonly MathPreviewFormula[] {
  const sorted = [...regions].sort(
    (left, right) =>
      left.outerStart - right.outerStart || right.outerEnd - left.outerEnd,
  );
  const result: MathPreviewFormula[] = [];

  for (const region of sorted) {
    const bounded = boundRegion(region, text);
    if (bounded.bodyRange.start >= bounded.bodyRange.end) {
      continue;
    }

    const enclosing = result[result.length - 1];
    if (
      enclosing !== undefined &&
      enclosing.outerRange.start <= bounded.outerRange.start &&
      enclosing.outerRange.end >= bounded.outerRange.end
    ) {
      continue;
    }
    result.push(bounded);
  }
  return result;
}

/** Find the top-level formula containing a UTF-16 document offset. */
export function findMathPreviewFormulaAt(
  snapshot: MathPreviewSnapshot,
  offset: number,
): MathPreviewFormula | undefined {
  let low = 0;
  let high = snapshot.formulas.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const formula = snapshot.formulas[middle];
    if (formula === undefined) {
      return undefined;
    }
    if (offset < formula.outerRange.start) {
      high = middle - 1;
      continue;
    }
    if (offset > formula.outerRange.end) {
      low = middle + 1;
      continue;
    }
    return formula;
  }
  return undefined;
}

/** Resolve the renderer-safe macro state active at one UTF-16 source offset. */
export function mathPreviewMacroEnvironmentAtOffset(
  snapshot: MathPreviewSnapshot,
  requestedOffset: number,
): MathPreviewMacroEnvironment {
  const transitions = snapshot.macroEnvironmentTransitions;
  const environments = snapshot.macroEnvironments;
  if (transitions !== undefined && transitions.length > 0 && environments !== undefined) {
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.trunc(requestedOffset))
      : 0;
    let low = 0;
    let high = transitions.length - 1;
    let selected = transitions[0]?.macroEnvironmentIndex;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const transition = transitions[middle];
      if (transition === undefined) {
        break;
      }
      if (transition.offset <= offset) {
        selected = transition.macroEnvironmentIndex;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (selected !== undefined) {
      const environment = environments[selected];
      if (environment !== undefined) {
        return environment;
      }
    }
  }
  return {
    macros: snapshot.macros,
    macroFingerprint: snapshot.macroFingerprint,
  };
}

/**
 * Create MathJax input for a formula. Closed environments retain their
 * wrapper so alignment markers and row separators keep their meaning.
 * Unclosed formulas are provisionally closed at the current cursor.
 */
export function createMathPreviewRenderInput(
  text: string,
  formula: MathPreviewFormula,
  snapshot: MathPreviewMacroSnapshot,
  cursorOffset = formula.bodyRange.end,
): MathPreviewRenderInput | undefined {
  const body = prepareMathPreviewBody(text, formula, cursorOffset);
  if (body === undefined) {
    return undefined;
  }
  const macroEnvironment = macroEnvironmentForFormula(formula, snapshot);

  return {
    tex: wrapMathPreviewBody(body.tex, formula.environmentName),
    display: formula.mode === "block",
    macros: macroEnvironment.macros,
    macroFingerprint: macroEnvironment.macroFingerprint,
  };
}

/**
 * Create the cursor-decoration variant of a formula without letting the
 * marker split a TeX control sequence or occupy an argument slot.  Ambiguous
 * source positions are snapped to a nearby proven boundary; if the input or
 * marker is invalid the caller can safely fall back to the plain render.
 */
export function createMathPreviewCursorRenderInput(
  text: string,
  formula: MathPreviewFormula,
  snapshot: MathPreviewMacroSnapshot,
  cursorOffset: number,
  markerTex: string,
): MathPreviewRenderInput | undefined {
  if (
    markerTex.length === 0 ||
    markerTex.length > 256 ||
    /[\0\r\n]/u.test(markerTex)
  ) {
    return undefined;
  }
  const body = prepareMathPreviewBody(text, formula, cursorOffset);
  if (body === undefined) {
    return undefined;
  }
  const macroEnvironment = macroEnvironmentForFormula(formula, snapshot);
  const requestedOffset = clampInteger(
    cursorOffset - body.sourceStart,
    0,
    body.tex.length,
  );
  const insertionOffset = findSafeMathPreviewCursorOffset(
    body.tex,
    requestedOffset,
    macroEnvironment.macros,
  );
  if (insertionOffset === undefined) {
    return undefined;
  }
  const markedBody =
    body.tex.slice(0, insertionOffset) +
    markerTex +
    body.tex.slice(insertionOffset);
  return {
    tex: wrapMathPreviewBody(markedBody, formula.environmentName),
    display: formula.mode === "block",
    macros: macroEnvironment.macros,
    macroFingerprint: macroEnvironment.macroFingerprint,
  };
}

type MathPreviewMacroSnapshot = Pick<
  MathPreviewSnapshot,
  "macros" | "macroFingerprint" | "macroEnvironments"
>;

function macroEnvironmentForFormula(
  formula: MathPreviewFormula,
  snapshot: MathPreviewMacroSnapshot,
): MathPreviewMacroEnvironment {
  const index = formula.macroEnvironmentIndex;
  if (index !== undefined && Number.isSafeInteger(index) && index >= 0) {
    const environment = snapshot.macroEnvironments?.[index];
    if (environment !== undefined) {
      return environment;
    }
  }
  return {
    macros: snapshot.macros,
    macroFingerprint: snapshot.macroFingerprint,
  };
}

interface PreparedMathPreviewBody {
  readonly tex: string;
  /** Absolute document offset corresponding to tex offset zero. */
  readonly sourceStart: number;
}

function prepareMathPreviewBody(
  text: string,
  formula: MathPreviewFormula,
  cursorOffset: number,
): PreparedMathPreviewBody | undefined {
  const bodyEnd = formula.closed
    ? formula.bodyRange.end
    : Math.max(
        formula.bodyRange.start,
        Math.min(cursorOffset, formula.bodyRange.end),
      );
  const rawBody = text.slice(formula.bodyRange.start, bodyEnd);
  const tex = rawBody.trim();
  if (tex.length === 0) {
    return undefined;
  }
  const leadingWhitespace = rawBody.length - rawBody.trimStart().length;
  return {
    tex,
    sourceStart: formula.bodyRange.start + leadingWhitespace,
  };
}

function wrapMathPreviewBody(
  body: string,
  environmentName: string | undefined,
): string {
  return environmentName === undefined
    ? body
    : `\\begin{${environmentName}}${body}\n\\end{${environmentName}}`;
}

interface ProtectedCursorSpan {
  /** A boundary strictly between start/end is unsafe; the endpoints are safe. */
  readonly start: number;
  readonly end: number;
}

interface CursorPlannerBudget {
  remaining: number;
  exhausted: boolean;
}

interface ControlSequence {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly word: boolean;
}

interface ParsedGroup {
  readonly open: number;
  readonly close: number;
  readonly end: number;
}

interface CommandArgumentSpec {
  readonly required: number;
  readonly optionalFirst?: boolean;
  readonly allowStar?: boolean;
  /** Keep the visual caret outside an argument consumed only as metadata. */
  readonly opaqueBracedContent?: boolean;
}

const COMMAND_ARGUMENT_SPECS: Readonly<Record<string, CommandArgumentSpec>> = {
  frac: { required: 2 },
  dfrac: { required: 2 },
  tfrac: { required: 2 },
  binom: { required: 2 },
  dbinom: { required: 2 },
  tbinom: { required: 2 },
  cfrac: { required: 2, optionalFirst: true },
  sqrt: { required: 1, optionalFirst: true },
  overset: { required: 2 },
  underset: { required: 2 },
  stackrel: { required: 2 },
  xrightarrow: { required: 1, optionalFirst: true },
  xleftarrow: { required: 1, optionalFirst: true },
  text: { required: 1 },
  textrm: { required: 1 },
  textsf: { required: 1 },
  texttt: { required: 1 },
  textnormal: { required: 1 },
  textbf: { required: 1 },
  textmd: { required: 1 },
  textit: { required: 1 },
  textsl: { required: 1 },
  textsc: { required: 1 },
  emph: { required: 1 },
  hbox: { required: 1 },
  mbox: { required: 1 },
  mathrm: { required: 1 },
  mathbf: { required: 1 },
  mathit: { required: 1 },
  mathsf: { required: 1 },
  mathtt: { required: 1 },
  mathbb: { required: 1 },
  mathcal: { required: 1 },
  mathscr: { required: 1 },
  mathfrak: { required: 1 },
  boldsymbol: { required: 1 },
  operatorname: { required: 1, allowStar: true },
  overline: { required: 1 },
  underline: { required: 1 },
  overbrace: { required: 1 },
  underbrace: { required: 1 },
  widehat: { required: 1 },
  widetilde: { required: 1 },
  hat: { required: 1 },
  check: { required: 1 },
  breve: { required: 1 },
  acute: { required: 1 },
  grave: { required: 1 },
  tilde: { required: 1 },
  bar: { required: 1 },
  vec: { required: 1 },
  dot: { required: 1 },
  ddot: { required: 1 },
  dddot: { required: 1 },
  ddddot: { required: 1 },
  cancel: { required: 1 },
  bcancel: { required: 1 },
  xcancel: { required: 1 },
  color: { required: 1, optionalFirst: true },
  textcolor: { required: 2, optionalFirst: true },
  bbox: { required: 1, optionalFirst: true },
  substack: { required: 1 },
  genfrac: { required: 6 },
  label: { required: 1, opaqueBracedContent: true },
};

// These standard TeX atoms never scan a following argument. Keeping the list
// explicit lets every other unknown control word fail closed: local \def
// macros and package commands may consume an unbraced next token even when
// MathJax can render the resulting (wrong) expression without an error.
const NO_ARGUMENT_COMMANDS = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta",
  "eta", "theta", "vartheta", "iota", "kappa", "varkappa", "lambda",
  "mu", "nu", "xi", "omicron", "pi", "varpi", "rho", "varrho",
  "sigma", "varsigma", "tau", "upsilon", "phi", "varphi", "chi",
  "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi",
  "Sigma", "Upsilon", "Phi", "Psi", "Omega",
  "sum", "prod", "coprod", "int", "iint", "iiint", "iiiint", "oint",
  "oiint", "oiiint", "bigcap", "bigcup", "bigsqcup", "bigvee", "bigwedge",
  "bigodot", "bigotimes", "bigoplus", "biguplus",
  "pm", "mp", "times", "div", "cdot", "ast", "star", "circ", "bullet",
  "oplus", "ominus", "otimes", "oslash", "odot", "dagger", "ddagger",
  "cap", "cup", "uplus", "sqcap", "sqcup", "vee", "wedge", "setminus",
  "wr", "diamond", "triangleleft", "triangleright", "lhd", "rhd", "unlhd",
  "unrhd", "amalg",
  "le", "leq", "leqslant", "ge", "geq", "geqslant", "neq", "equiv",
  "ll", "gg", "doteq", "prec", "succ", "preceq", "succeq", "sim",
  "simeq", "approx", "cong", "propto", "parallel", "nparallel", "perp",
  "mid", "nmid", "asymp", "bowtie", "subset", "supset", "subseteq",
  "supseteq", "sqsubset", "sqsupset", "sqsubseteq", "sqsupseteq", "in",
  "ni", "notin", "vdash", "dashv", "models", "smile", "frown",
  "leftarrow", "rightarrow", "leftrightarrow", "Leftarrow", "Rightarrow",
  "Leftrightarrow", "longleftarrow", "longrightarrow", "longleftrightarrow",
  "Longleftarrow", "Longrightarrow", "Longleftrightarrow", "mapsto",
  "longmapsto", "hookleftarrow", "hookrightarrow", "uparrow", "downarrow",
  "updownarrow", "Uparrow", "Downarrow", "Updownarrow", "nearrow",
  "searrow", "swarrow", "nwarrow",
  "langle", "rangle", "lceil", "rceil", "lfloor", "rfloor", "lvert",
  "rvert", "lVert", "rVert", "vert", "Vert", "backslash",
  "infty", "partial", "nabla", "ell", "hbar", "imath", "jmath", "Re",
  "Im", "aleph", "beth", "gimel", "daleth", "wp", "emptyset",
  "varnothing", "angle", "surd", "top", "bot", "forall", "exists",
  "nexists", "neg", "prime", "backprime", "flat", "natural", "sharp",
  "clubsuit", "diamondsuit", "heartsuit", "spadesuit",
  "ldots", "cdots", "vdots", "ddots", "dots", "dotsb", "dotsc", "dotsi",
  "dotsm", "dotso", "quad", "qquad", "enspace", "enskip", "thinspace",
  "medspace", "thickspace", "negthinspace", "negmedspace", "negthickspace",
  "notag", "nonumber",
  "arccos", "arcsin", "arctan", "arg", "cos", "cosh", "cot", "coth",
  "csc", "deg", "det", "dim", "exp", "gcd", "hom", "inf", "ker",
  "lg", "lim", "liminf", "limsup", "ln", "log", "max", "min", "Pr",
  "sec", "sin", "sinh", "sup", "tan", "tanh",
]);

const BACKWARD_MODIFIER_COMMANDS = new Set([
  "limits",
  "nolimits",
  "displaylimits",
]);

/**
 * Plan an insertion boundary for the visual caret.  This is deliberately a
 * conservative lexer, not a second TeX parser: it protects syntax-bearing
 * spans and only inserts at boundaries known not to steal a command argument.
 */
export function findSafeMathPreviewCursorOffset(
  tex: string,
  requestedOffset: number,
  macros: Readonly<Record<string, MathPreviewMacro>> = {},
): number | undefined {
  if (!Number.isFinite(requestedOffset)) {
    return undefined;
  }
  const requested = clampInteger(requestedOffset, 0, tex.length);
  // A malformed or adversarial nest of unknown macros must not make the
  // extension host perform quadratic work. Ordinary expressions consume
  // roughly one pass; the multiplier leaves ample room for nested arguments.
  const budget: CursorPlannerBudget = {
    remaining: Math.max(8_192, tex.length * 24),
    exhausted: false,
  };
  const spans = collectProtectedCursorSpans(tex, macros, budget);
  if (spans === undefined) {
    return undefined;
  }
  if (isSafeCursorBoundary(requested, spans)) {
    return requested;
  }

  const candidates = new Set<number>([0, tex.length]);
  for (const span of spans) {
    if (span.start >= 0 && span.start <= tex.length) {
      candidates.add(span.start);
    }
    if (span.end >= 0 && span.end <= tex.length) {
      candidates.add(span.end);
    }
  }
  return [...candidates]
    .filter((candidate) => isSafeCursorBoundary(candidate, spans))
    .sort(
      (left, right) =>
        Math.abs(left - requested) - Math.abs(right - requested) ||
        // On a tie prefer the following atom/argument, matching editor caret
        // movement while keeping the source formula syntactically intact.
        right - left,
    )[0];
}

function collectProtectedCursorSpans(
  tex: string,
  macros: Readonly<Record<string, MathPreviewMacro>>,
  budget: CursorPlannerBudget,
): readonly ProtectedCursorSpan[] | undefined {
  const spans: ProtectedCursorSpan[] = [];
  for (let index = 0; index < tex.length; index += 1) {
    const code = tex.charCodeAt(index);
    if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < tex.length &&
      tex.charCodeAt(index + 1) >= 0xdc00 &&
      tex.charCodeAt(index + 1) <= 0xdfff
    ) {
      protectCursorSpan(spans, index, index + 2);
      index += 1;
      continue;
    }
    if (tex[index] === "%") {
      const newline = tex.indexOf("\n", index + 1);
      const end = newline < 0 ? tex.length + 1 : newline + 1;
      protectCursorSpan(spans, index, end);
      index = newline < 0 ? tex.length : newline;
      continue;
    }
    if (tex[index] === "^" || tex[index] === "_") {
      protectScriptArgument(tex, index, spans, budget);
      if (budget.exhausted) {
        return undefined;
      }
      continue;
    }
    if (tex[index] !== "\\") {
      continue;
    }

    const control = readCursorControlSequence(tex, index);
    protectCursorSpan(spans, control.start, control.end);
    index = Math.max(index, control.end - 1);

    if (!control.word && control.name === "\\") {
      protectRowBreak(tex, control, spans, budget);
      if (budget.exhausted) {
        return undefined;
      }
      continue;
    }
    if (!control.word) {
      continue;
    }
    if (control.name === "verb") {
      protectVerb(tex, control, spans);
      continue;
    }
    if (control.name === "begin" || control.name === "end") {
      protectEnvironmentHeader(tex, control, spans, budget);
      if (budget.exhausted) {
        return undefined;
      }
      continue;
    }
    if (
      control.name === "left" ||
      control.name === "right" ||
      control.name === "middle"
    ) {
      protectDelimiterCommand(tex, control, spans);
      continue;
    }

    if (BACKWARD_MODIFIER_COMMANDS.has(control.name)) {
      protectCursorSpan(
        spans,
        previousMathAtomStart(tex, control.start, budget),
        control.end,
      );
      if (budget.exhausted) {
        return undefined;
      }
      continue;
    }

    const macro = macros[control.name];
    const configuredSpec = macro === undefined
      ? undefined
      : {
          required:
            macro.argumentCount - (macro.optionalDefault === undefined ? 0 : 1),
          ...(macro.optionalDefault === undefined
            ? {}
            : { optionalFirst: true }),
        };
    const spec = configuredSpec ?? COMMAND_ARGUMENT_SPECS[control.name];
    if (spec !== undefined) {
      protectCommandArguments(tex, control, spec, spans, budget);
    } else if (!NO_ARGUMENT_COMMANDS.has(control.name)) {
      protectUnknownCommand(tex, control, spans, budget);
    }
    if (budget.exhausted) {
      return undefined;
    }
  }
  return spans;
}

function protectScriptArgument(
  tex: string,
  operator: number,
  spans: ProtectedCursorSpan[],
  budget: CursorPlannerBudget,
): void {
  const start = previousMathAtomStart(tex, operator, budget);
  if (budget.exhausted) {
    return;
  }
  const argumentStart = skipTeXWhitespaceAndComments(tex, operator + 1);
  if (argumentStart >= tex.length) {
    protectCursorSpan(spans, start, tex.length + 1);
    return;
  }
  const group = tex[argumentStart] === "{"
    ? parseBalancedGroup(tex, argumentStart, "{", "}", budget)
    : undefined;
  if (group !== undefined) {
    protectCursorSpan(spans, start, group.open + 1);
    return;
  }
  const argumentEnd = readAtomicArgumentEnd(tex, argumentStart);
  protectCursorSpan(
    spans,
    start,
    argumentEnd > argumentStart ? argumentEnd : tex.length + 1,
  );
}

function protectRowBreak(
  tex: string,
  control: ControlSequence,
  spans: ProtectedCursorSpan[],
  budget: CursorPlannerBudget,
): void {
  const optionalStart = skipTeXWhitespaceAndComments(tex, control.end);
  if (tex[optionalStart] !== "[") {
    return;
  }
  const group = parseBalancedGroup(tex, optionalStart, "[", "]", budget);
  protectCursorSpan(
    spans,
    control.start,
    group?.end ?? tex.length + 1,
  );
}

function protectVerb(
  tex: string,
  control: ControlSequence,
  spans: ProtectedCursorSpan[],
): void {
  let cursor = control.end;
  if (tex[cursor] === "*") {
    cursor += 1;
  }
  const delimiter = tex[cursor];
  if (delimiter === undefined || /\s/u.test(delimiter)) {
    protectCursorSpan(spans, control.start, Math.min(tex.length + 1, cursor + 1));
    return;
  }
  const closing = tex.indexOf(delimiter, cursor + 1);
  protectCursorSpan(
    spans,
    control.start,
    closing < 0 ? tex.length + 1 : closing + 1,
  );
}

function protectEnvironmentHeader(
  tex: string,
  control: ControlSequence,
  spans: ProtectedCursorSpan[],
  budget: CursorPlannerBudget,
): void {
  const groupStart = skipTeXWhitespaceAndComments(tex, control.end);
  const group = tex[groupStart] === "{"
    ? parseBalancedGroup(tex, groupStart, "{", "}", budget)
    : undefined;
  protectCursorSpan(
    spans,
    control.start,
    group?.end ?? Math.min(tex.length + 1, groupStart + 1),
  );
}

function protectDelimiterCommand(
  tex: string,
  control: ControlSequence,
  spans: ProtectedCursorSpan[],
): void {
  const delimiterStart = skipTeXWhitespaceAndComments(tex, control.end);
  if (delimiterStart >= tex.length) {
    protectCursorSpan(spans, control.start, tex.length + 1);
    return;
  }
  const delimiterEnd = tex[delimiterStart] === "\\"
    ? readCursorControlSequence(tex, delimiterStart).end
    : delimiterStart + 1;
  protectCursorSpan(spans, control.start, delimiterEnd);
}

function protectCommandArguments(
  tex: string,
  control: ControlSequence,
  spec: CommandArgumentSpec,
  spans: ProtectedCursorSpan[],
  budget: CursorPlannerBudget,
): void {
  let cursor = control.end;
  let previousSafe = control.start;
  if (spec.allowStar === true) {
    cursor = skipTeXWhitespaceAndComments(tex, cursor);
    if (tex[cursor] === "*") {
      cursor += 1;
    }
  }
  if (spec.optionalFirst === true) {
    const optionalStart = skipTeXWhitespaceAndComments(tex, cursor);
    if (tex[optionalStart] === "[") {
      const optional = parseBalancedGroup(
        tex,
        optionalStart,
        "[",
        "]",
        budget,
      );
      if (optional === undefined) {
        protectCursorSpan(spans, previousSafe, tex.length + 1);
        return;
      }
      protectCursorSpan(spans, previousSafe, optional.open + 1);
      previousSafe = optional.close;
      cursor = optional.end;
    }
  }

  for (let argument = 0; argument < spec.required; argument += 1) {
    const argumentStart = skipTeXWhitespaceAndComments(tex, cursor);
    if (argumentStart >= tex.length) {
      protectCursorSpan(spans, previousSafe, tex.length + 1);
      return;
    }
    if (tex[argumentStart] === "{") {
      const group = parseBalancedGroup(
        tex,
        argumentStart,
        "{",
        "}",
        budget,
      );
      if (group === undefined) {
        protectCursorSpan(spans, previousSafe, tex.length + 1);
        return;
      }
      if (spec.opaqueBracedContent === true) {
        protectCursorSpan(spans, previousSafe, group.end);
        previousSafe = group.end;
      } else {
        protectCursorSpan(spans, previousSafe, group.open + 1);
        previousSafe = group.close;
      }
      cursor = group.end;
      continue;
    }

    const argumentEnd = readAtomicArgumentEnd(tex, argumentStart);
    if (argumentEnd <= argumentStart) {
      protectCursorSpan(spans, previousSafe, tex.length + 1);
      return;
    }
    protectCursorSpan(spans, previousSafe, argumentEnd);
    cursor = argumentEnd;
    // An unbraced TeX argument has no safe interior boundary. Keep the safe
    // endpoint before the invocation until every required atom is consumed.
  }
}

function protectUnknownCommand(
  tex: string,
  control: ControlSequence,
  spans: ProtectedCursorSpan[],
  budget: CursorPlannerBudget,
): void {
  let cursor = control.end;
  let previousSafe = control.start;
  // TeX macros can declare at most nine parameters. Inspect all nine slots so
  // a final unbraced argument cannot consume the visual caret.
  for (let count = 0; count < 9; count += 1) {
    const groupStart = skipTeXWhitespaceAndComments(tex, cursor);
    const open = tex[groupStart];
    if (open !== "{" && open !== "[") {
      const argumentEnd = readAtomicArgumentEnd(tex, groupStart);
      protectCursorSpan(
        spans,
        previousSafe,
        argumentEnd > groupStart ? argumentEnd : tex.length + 1,
      );
      return;
    }
    const group = parseBalancedGroup(
      tex,
      groupStart,
      open,
      open === "{" ? "}" : "]",
      budget,
    );
    if (group === undefined) {
      protectCursorSpan(spans, previousSafe, tex.length + 1);
      return;
    }
    protectCursorSpan(spans, previousSafe, group.open + 1);
    previousSafe = group.close;
    cursor = group.end;
  }
}

function previousMathAtomStart(
  tex: string,
  offset: number,
  budget: CursorPlannerBudget,
): number {
  let searchOffset = offset;
  while (true) {
    let cursor = searchOffset;
    while (cursor > 0 && /\s/u.test(tex[cursor - 1] ?? "")) {
      if (!consumeCursorPlannerBudget(budget)) {
        return 0;
      }
      cursor -= 1;
    }
    if (cursor <= 0) {
      return 0;
    }

    const previous = cursor - 1;
    if (!consumeCursorPlannerBudget(budget)) {
      return 0;
    }
    if (tex[previous] === "}" || tex[previous] === "]") {
      return previous;
    }
    if (tex[previous] === "^" || tex[previous] === "_") {
      searchOffset = previous;
      continue;
    }
    if (tex[previous] === "\\") {
      return previous;
    }

    let start = previous;
    while (start > 0 && /[A-Za-z@]/u.test(tex[start] ?? "")) {
      if (!consumeCursorPlannerBudget(budget)) {
        return 0;
      }
      start -= 1;
    }
    if (tex[start] === "\\" && start < previous) {
      return start;
    }
    if (
      start > 0 &&
      (tex[start - 1] === "^" || tex[start - 1] === "_")
    ) {
      searchOffset = start - 1;
      continue;
    }
    return previous;
  }
}

function consumeCursorPlannerBudget(budget: CursorPlannerBudget): boolean {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    budget.exhausted = true;
    return false;
  }
  return true;
}

function readCursorControlSequence(tex: string, start: number): ControlSequence {
  let end = start + 1;
  if (/[A-Za-z@]/u.test(tex[end] ?? "")) {
    end += 1;
    while (/[A-Za-z@]/u.test(tex[end] ?? "")) {
      end += 1;
    }
    return {
      start,
      end,
      name: tex.slice(start + 1, end),
      word: true,
    };
  }
  end = Math.min(tex.length, end + 1);
  return {
    start,
    end,
    name: tex.slice(start + 1, end),
    word: false,
  };
}

function readAtomicArgumentEnd(tex: string, start: number): number {
  if (start >= tex.length) {
    return start;
  }
  if (tex[start] === "\\") {
    return readCursorControlSequence(tex, start).end;
  }
  const code = tex.charCodeAt(start);
  if (
    code >= 0xd800 &&
    code <= 0xdbff &&
    start + 1 < tex.length &&
    tex.charCodeAt(start + 1) >= 0xdc00 &&
    tex.charCodeAt(start + 1) <= 0xdfff
  ) {
    return start + 2;
  }
  return start + 1;
}

function skipTeXWhitespaceAndComments(tex: string, start: number): number {
  let cursor = start;
  while (cursor < tex.length) {
    if (/\s/u.test(tex[cursor] ?? "")) {
      cursor += 1;
      continue;
    }
    if (tex[cursor] !== "%") {
      break;
    }
    const newline = tex.indexOf("\n", cursor + 1);
    if (newline < 0) {
      return tex.length;
    }
    cursor = newline + 1;
  }
  return cursor;
}

function parseBalancedGroup(
  tex: string,
  start: number,
  open: "{" | "[",
  close: "}" | "]",
  budget: CursorPlannerBudget,
): ParsedGroup | undefined {
  if (tex[start] !== open) {
    return undefined;
  }
  let depth = 1;
  for (let cursor = start + 1; cursor < tex.length; cursor += 1) {
    if (!consumeCursorPlannerBudget(budget)) {
      return undefined;
    }
    if (tex[cursor] === "\\") {
      cursor = Math.max(cursor, readCursorControlSequence(tex, cursor).end - 1);
      continue;
    }
    if (tex[cursor] === "%") {
      const newline = tex.indexOf("\n", cursor + 1);
      if (newline < 0) {
        return undefined;
      }
      cursor = newline;
      continue;
    }
    if (tex[cursor] === open) {
      depth += 1;
    } else if (tex[cursor] === close) {
      depth -= 1;
      if (depth === 0) {
        return { open: start, close: cursor, end: cursor + 1 };
      }
    }
  }
  return undefined;
}

function protectCursorSpan(
  spans: ProtectedCursorSpan[],
  start: number,
  end: number,
): void {
  if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start) {
    spans.push({ start, end });
  }
}

function isSafeCursorBoundary(
  offset: number,
  spans: readonly ProtectedCursorSpan[],
): boolean {
  return !spans.some((span) => span.start < offset && offset < span.end);
}

/** Convert macro records to MathJax configmacros values. */
export function toMathJaxMacroOptions(
  macros: Readonly<Record<string, MathPreviewMacro>>,
): Readonly<
  Record<
    string,
    string | readonly [string, number] | readonly [string, number, string]
  >
> {
  const result: Record<
    string,
    string | readonly [string, number, string] | readonly [string, number]
  > = {};
  for (const name of Object.keys(macros).sort()) {
    const macro = macros[name];
    if (macro === undefined) {
      continue;
    }
    if (macro.argumentCount === 0) {
      result[name] = macro.replacement;
    } else if (macro.optionalDefault !== undefined) {
      result[name] = [
        macro.replacement,
        macro.argumentCount,
        macro.optionalDefault,
      ];
    } else {
      result[name] = [macro.replacement, macro.argumentCount];
    }
  }
  return result;
}

function boundRegion(region: LatexMathRegion, text: string): MathPreviewFormula {
  const textLength = text.length;
  const outerStart = clampInteger(region.outerStart, 0, textLength);
  const outerEnd = clampInteger(region.outerEnd, outerStart, textLength);
  const bodyStart = clampInteger(region.innerStart, outerStart, outerEnd);
  const bodyEnd = clampInteger(region.innerEnd, bodyStart, outerEnd);
  return {
    syntax:
      region.environmentName !== undefined
        ? "environment"
        : mathDelimiterSyntax(text, region),
    mode: region.mode,
    outerRange: { start: outerStart, end: outerEnd },
    bodyRange: { start: bodyStart, end: bodyEnd },
    ...(region.environmentName === undefined
      ? {}
      : { environmentName: region.environmentName }),
    closed: region.closed,
  };
}

function mathDelimiterSyntax(
  text: string,
  region: LatexMathRegion,
): Exclude<MathPreviewSyntax, "environment"> {
  // `innerStart - outerStart` uniquely identifies the four delimiter forms
  // emitted by scanLatexRegions: 1=$, 2=$$/\(/\[. Mode disambiguates $$.
  if (region.innerStart - region.outerStart === 1) {
    return "dollar-inline";
  }
  if (region.mode === "inline") {
    return "paren-inline";
  }
  // Distinguish $$ from \[ using the opening syntax. The scanner owns all
  // escaping/comment rules, so this bounded source read is safe.
  return text.startsWith("$$", region.outerStart)
    ? "dollar-display"
    : "bracket-display";
}

interface ParsedMacro extends MathPreviewMacro {
  readonly kind: "newcommand" | "renewcommand" | "providecommand" | "operator" | "def";
  readonly sourceRange: OffsetRange;
}

interface DocumentMacroScan {
  readonly environmentAliases: ReadonlyMap<number, LatexEnvironmentAlias>;
  readonly macros: readonly ParsedMacro[];
  readonly definitionRanges: readonly OffsetRange[];
  readonly inactiveRanges: readonly OffsetRange[];
  readonly bodyRange: OffsetRange;
}

function resolveMathPreviewMacros(
  configured: Readonly<Record<string, string>>,
  inherited: MathPreviewMacroEnvironment,
  documentMacros: readonly ParsedMacro[],
): Readonly<Record<string, MathPreviewMacro>> {
  const resolved = seedMathPreviewMacros(configured, inherited);

  for (const macro of documentMacros) {
    applyLocalMacro(resolved, macro);
  }

  return freezeMacroTable(resolved);
}

function createBodyFragmentSnapshot(
  sourceFormulas: readonly MathPreviewFormula[],
  configured: Readonly<Record<string, string>>,
  inherited: MathPreviewMacroEnvironment,
  localMacros: readonly ParsedMacro[],
): MathPreviewSnapshot {
  const resolved = seedMathPreviewMacros(configured, inherited);
  const environments: MathPreviewMacroEnvironment[] = [];
  const transitions: MathPreviewMacroEnvironmentTransition[] = [];
  const environmentIndices = new Map<string, number>();
  const formulas: MathPreviewFormula[] = [];
  let localIndex = 0;
  let environmentDirty = true;
  let currentEnvironmentIndex: number | undefined;

  const resolveEnvironmentIndex = (): number => {
    if (!environmentDirty && currentEnvironmentIndex !== undefined) {
      return currentEnvironmentIndex;
    }
    const environment = createMacroEnvironment(resolved);
    const existing = environmentIndices.get(environment.macroFingerprint);
    if (existing !== undefined) {
      currentEnvironmentIndex = existing;
    } else {
      currentEnvironmentIndex = environments.length;
      environments.push(environment);
      environmentIndices.set(
        environment.macroFingerprint,
        currentEnvironmentIndex,
      );
    }
    environmentDirty = false;
    return currentEnvironmentIndex;
  };

  const recordTransition = (offset: number): void => {
    const macroEnvironmentIndex = resolveEnvironmentIndex();
    const previous = transitions.at(-1);
    if (previous?.offset === offset) {
      transitions[transitions.length - 1] = Object.freeze({
        offset,
        macroEnvironmentIndex,
      });
      return;
    }
    if (previous?.macroEnvironmentIndex !== macroEnvironmentIndex) {
      transitions.push(Object.freeze({ offset, macroEnvironmentIndex }));
    }
  };

  transitions.push(Object.freeze({
    offset: 0,
    macroEnvironmentIndex: resolveEnvironmentIndex(),
  }));

  for (const formula of sourceFormulas) {
    while (
      localIndex < localMacros.length &&
      localMacros[localIndex]!.sourceRange.end <= formula.outerRange.start
    ) {
      const macro = localMacros[localIndex]!;
      const changed = applyLocalMacro(resolved, macro);
      environmentDirty = changed || environmentDirty;
      localIndex += 1;
      if (changed) {
        recordTransition(macro.sourceRange.end);
      }
    }
    formulas.push(
      Object.freeze({
        ...formula,
        macroEnvironmentIndex: resolveEnvironmentIndex(),
      }),
    );
  }

  while (localIndex < localMacros.length) {
    const macro = localMacros[localIndex]!;
    const changed = applyLocalMacro(resolved, macro);
    environmentDirty = changed || environmentDirty;
    localIndex += 1;
    if (changed) {
      recordTransition(macro.sourceRange.end);
    }
  }
  const finalEnvironment = environments[resolveEnvironmentIndex()];
  if (finalEnvironment === undefined) {
    throw new Error("Math Preview macro environment invariant violated.");
  }

  return Object.freeze({
    formulas: Object.freeze(formulas),
    macros: finalEnvironment.macros,
    macroFingerprint: finalEnvironment.macroFingerprint,
    macroEnvironments: Object.freeze(environments),
    macroEnvironmentTransitions: Object.freeze(transitions),
  });
}

function seedMathPreviewMacros(
  configured: Readonly<Record<string, string>>,
  inherited: MathPreviewMacroEnvironment,
): Record<string, MathPreviewMacro> {
  const resolved = createMutableMacroTable();

  for (const name of Object.keys(configured).sort()) {
    const normalizedName = normalizeMacroName(name);
    const replacement = configured[name];
    if (
      normalizedName === undefined ||
      typeof replacement !== "string" ||
      replacement.length > MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH
    ) {
      continue;
    }
    trySetResolvedMacro(resolved, {
      name: normalizedName,
      replacement,
      argumentCount: inferArgumentCount(replacement),
    });
  }

  for (const name of Object.keys(inherited.macros).sort()) {
    const macro = inherited.macros[name];
    if (macro === undefined) {
      continue;
    }
    trySetResolvedMacro(resolved, {
      name: macro.name,
      replacement: macro.replacement,
      argumentCount: macro.argumentCount,
      ...(macro.optionalDefault === undefined
        ? {}
        : { optionalDefault: macro.optionalDefault }),
    });
  }

  return resolved;
}

function applyLocalMacro(
  resolved: Record<string, MathPreviewMacro>,
  macro: ParsedMacro,
): boolean {
  if (
    macro.kind === "providecommand" &&
    Object.hasOwn(resolved, macro.name)
  ) {
    return false;
  }
  return trySetResolvedMacro(resolved, {
    name: macro.name,
    replacement: macro.replacement,
    argumentCount: macro.argumentCount,
    ...(macro.optionalDefault === undefined
      ? {}
      : { optionalDefault: macro.optionalDefault }),
  });
}

function trySetResolvedMacro(
  resolved: Record<string, MathPreviewMacro>,
  macro: MathPreviewMacro,
): boolean {
  const hadPrevious = Object.hasOwn(resolved, macro.name);
  if (!hadPrevious && Object.keys(resolved).length >= MATH_PREVIEW_MAX_MACRO_COUNT) {
    return false;
  }
  const previous = resolved[macro.name];
  resolved[macro.name] = freezeMathPreviewMacro(macro);
  if (
    JSON.stringify(toMathJaxMacroOptions(resolved)).length <=
    MATH_PREVIEW_MAX_MACRO_SERIALIZED_LENGTH
  ) {
    return true;
  }
  if (hadPrevious && previous !== undefined) {
    resolved[macro.name] = previous;
  } else {
    delete resolved[macro.name];
  }
  return false;
}

function createMutableMacroTable(): Record<string, MathPreviewMacro> {
  return Object.create(null) as Record<string, MathPreviewMacro>;
}

function freezeNullPrototypeRecord<T>(
  source?: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
  const result = Object.create(null) as Record<string, T>;
  if (source !== undefined) {
    for (const name of Object.keys(source).sort()) {
      const value = source[name];
      if (value !== undefined) {
        result[name] = value;
      }
    }
  }
  return Object.freeze(result);
}

function freezeMathPreviewMacro(macro: MathPreviewMacro): MathPreviewMacro {
  return Object.freeze({
    name: macro.name,
    replacement: macro.replacement,
    argumentCount: macro.argumentCount,
    ...(macro.optionalDefault === undefined
      ? {}
      : { optionalDefault: macro.optionalDefault }),
  });
}

function freezeMacroTable(
  macros: Readonly<Record<string, MathPreviewMacro>>,
): Readonly<Record<string, MathPreviewMacro>> {
  return freezeNullPrototypeRecord(macros);
}

function createMacroEnvironment(
  macros: Readonly<Record<string, MathPreviewMacro>>,
): MathPreviewMacroEnvironment {
  const frozenMacros = freezeMacroTable(macros);
  return Object.freeze({
    macros: frozenMacros,
    macroFingerprint: macroFingerprint(frozenMacros),
  });
}

function normalizeInheritedMacroEnvironment(
  environment: MathPreviewMacroEnvironment | undefined,
): MathPreviewMacroEnvironment {
  if (
    typeof environment !== "object" ||
    environment === null ||
    typeof environment.macros !== "object" ||
    environment.macros === null ||
    Array.isArray(environment.macros)
  ) {
    return createMacroEnvironment(createMutableMacroTable());
  }
  // Treat the canonical macro records as truth. A stale or forged caller
  // fingerprint must never make a different render context share a cache key.
  return createMathPreviewMacroEnvironment(environment.macros);
}

function sanitizeMathPreviewMacro(
  rawName: string,
  value: unknown,
): MathPreviewMacro | undefined {
  const name = normalizeMacroName(rawName);
  if (name === undefined || typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Partial<MathPreviewMacro>;
  if (
    typeof candidate.name !== "string" ||
    normalizeMacroName(candidate.name) !== name ||
    typeof candidate.replacement !== "string" ||
    candidate.replacement.length > MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH ||
    !isSafeStaticMacroReplacement(candidate.replacement) ||
    !Number.isInteger(candidate.argumentCount) ||
    candidate.argumentCount === undefined ||
    candidate.argumentCount < 0 ||
    candidate.argumentCount > 9 ||
    (candidate.optionalDefault !== undefined &&
      (typeof candidate.optionalDefault !== "string" ||
        candidate.optionalDefault.length > MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH ||
        !isSafeStaticMacroReplacement(candidate.optionalDefault)))
  ) {
    return undefined;
  }
  const argumentCount = Math.max(
    candidate.argumentCount,
    inferArgumentCount(candidate.replacement),
    candidate.optionalDefault === undefined ? 0 : 1,
  );
  return {
    name,
    replacement: candidate.replacement,
    argumentCount,
    ...(candidate.optionalDefault === undefined
      ? {}
      : { optionalDefault: candidate.optionalDefault }),
  };
}

function macroFingerprint(
  macros: Readonly<Record<string, MathPreviewMacro>>,
): string {
  return JSON.stringify(
    Object.keys(macros)
      .sort()
      .map((name) => {
        const macro = macros[name];
        return macro === undefined
          ? undefined
          : [name, macro.replacement, macro.argumentCount, macro.optionalDefault ?? null];
      })
      .filter((entry) => entry !== undefined),
  );
}

function mathPreviewMacroDefinitionFingerprint(macro: MathPreviewMacro): string {
  return JSON.stringify([
    macro.name,
    macro.replacement,
    macro.argumentCount,
    macro.optionalDefault ?? null,
  ]);
}

function mathPreviewMacroControlSequenceNames(
  macro: MathPreviewMacro,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const source of [macro.replacement, macro.optionalDefault ?? ""]) {
    let index = 0;
    while (index < source.length) {
      if (source[index] !== "\\") {
        index += 1;
        continue;
      }
      const control = readControlSequence(source, index);
      if (control.name.length > 0) {
        names.add(control.name);
      }
      index = Math.max(index + 1, control.end);
    }
  }
  return names;
}

function normalizeMathPreviewFragmentKind(
  value: MathPreviewFragmentKind | undefined,
): MathPreviewFragmentKind {
  return value === "body" || value === "preamble" ? value : "standalone";
}

function isInsideMacroDefinition(
  formula: MathPreviewFormula,
  definitionRanges: readonly OffsetRange[],
  fragmentKind: MathPreviewFragmentKind,
): boolean {
  return fragmentKind !== "preamble" && definitionRanges.some(
    (range) =>
      formula.outerRange.start >= range.start &&
      formula.outerRange.end <= range.end,
  );
}

function isInsideInactiveMathPreviewRange(
  formula: MathPreviewFormula,
  inactiveRanges: readonly OffsetRange[],
): boolean {
  return inactiveRanges.some(
    (range) =>
      formula.outerRange.start >= range.start &&
      formula.outerRange.end <= range.end,
  );
}

function collectDocumentMacros(
  text: string,
  collectAllMacros: boolean,
  resolved: Record<string, MathPreviewMacro>,
): DocumentMacroScan {
  const result: ParsedMacro[] = [];
  const environmentAliases = new Map<number, LatexEnvironmentAlias>();
  const fontCommands = new Map<string, string>();
  const fontFamilies = new Map<string, string>([["0", "mathrm"], ["1", "mathit"]]);
  const definitionRanges: OffsetRange[] = [];
  const inactiveRanges: OffsetRange[] = [];
  let index = 0;
  let groupDepth = 0;
  const environmentStack: string[] = [];
  const aliasShadows = new Map<string, { groupDepth: number; environmentDepth: number }>();
  const restoreAliasShadows = (): void => {
    for (const [name, scope] of aliasShadows) {
      if (scope.groupDepth > groupDepth || scope.environmentDepth > environmentStack.length) {
        aliasShadows.delete(name);
      }
    }
  };
  let environmentScopeUncertain = false;
  let inComment = false;
  let verbatimDelimiter: string | undefined;
  let verbatimEnvironment: string | undefined;
  let documentBodyStart: number | undefined;
  let documentBodyEnd = text.length;

  while (index < text.length) {
    const character = text[index];
    if (verbatimEnvironment !== undefined) {
      const closing = `\\end{${verbatimEnvironment}}`;
      if (isLatexOpaqueEnvironmentEndAt(text, index, verbatimEnvironment)) {
        verbatimEnvironment = undefined;
        index += closing.length;
      } else {
        index += 1;
      }
      continue;
    }
    if (verbatimDelimiter !== undefined) {
      if (
        character === verbatimDelimiter ||
        character === "\n" ||
        character === "\r"
      ) {
        verbatimDelimiter = undefined;
      }
      index += 1;
      continue;
    }
    if (inComment) {
      if (character === "\n" || character === "\r") {
        inComment = false;
      }
      index += 1;
      continue;
    }
    if (character === "%") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character !== "\\") {
      if (character === "{") {
        groupDepth += 1;
      } else if (character === "}") {
        groupDepth = Math.max(0, groupDepth - 1);
        restoreAliasShadows();
      }
      index += 1;
      continue;
    }

    const command = readControlSequence(text, index);
    if (command.name === "begingroup") {
      groupDepth += 1;
      index = command.end;
      continue;
    }
    if (command.name === "endgroup") {
      groupDepth = Math.max(0, groupDepth - 1);
      restoreAliasShadows();
      index = command.end;
      continue;
    }
    if (command.name === "newif") {
      index = skipMathPreviewNewIfDeclaration(text, command.end) ?? command.end;
      continue;
    }
    const functionalConditionalArguments = mathPreviewFunctionalConditionalArgumentCount(
      command.name,
    );
    if (functionalConditionalArguments !== undefined) {
      const end = skipMathPreviewFunctionalConditional(
        text,
        command.end,
        functionalConditionalArguments,
      ) ?? text.length;
      inactiveRanges.push(Object.freeze({ start: index, end }));
      index = end;
      continue;
    }
    if (isMathPreviewConditionalControl(command.name)) {
      const end = skipLiteralFalseMathPreviewConditional(text, command.end);
      inactiveRanges.push(Object.freeze({ start: index, end }));
      index = end;
      continue;
    }
    if (command.name === "verb") {
      let delimiterOffset = command.end;
      if (text[delimiterOffset] === "*") {
        delimiterOffset += 1;
      }
      const delimiter = text[delimiterOffset];
      if (delimiter !== undefined && delimiter !== "\n" && delimiter !== "\r") {
        verbatimDelimiter = delimiter;
        index = delimiterOffset + 1;
      } else {
        index = command.end;
      }
      continue;
    }
    const aliasMacro = aliasShadows.has(command.name) ? undefined : resolved[command.name];
    const alias = aliasMacro?.argumentCount === 0
      ? /^\s*\\(begin|end)\s*\{([A-Za-z]+\*?)\}\s*$/u.exec(aliasMacro.replacement)
      : null;
    const environmentCommand = alias?.[1] ?? command.name;
    if (alias !== null && alias?.[2] !== undefined) {
      environmentAliases.set(index, { command: alias[1] as "begin" | "end", name: alias[2] });
    }
    if (environmentCommand === "begin" || environmentCommand === "end") {
      const environment = alias?.[2] === undefined
        ? readRequiredGroup(text, command.end)
        : { value: alias[2], end: command.end };
      if (environment !== undefined) {
        const name = environment.value.trim();
        if (environmentCommand === "begin" && name === "document") {
          documentBodyStart ??= environment.end;
          index = environment.end;
          continue;
        }
        if (
          environmentCommand === "end" &&
          name === "document" &&
          documentBodyStart !== undefined
        ) {
          documentBodyEnd = index;
          if (!collectAllMacros) {
            break;
          }
          index = environment.end;
          continue;
        }
        const normalizedEnvironment = name.endsWith("*") ? name.slice(0, -1) : name;
        if (
          environmentCommand === "begin" &&
          [
            "verbatim",
            "Verbatim",
            "lstlisting",
            "minted",
            "comment",
            "filecontents",
          ].includes(
            normalizedEnvironment,
          )
        ) {
          verbatimEnvironment = name;
          index = environment.end;
          continue;
        }
        if (environmentCommand === "begin") {
          environmentStack.push(name);
        } else if (environmentStack.at(-1) === name) {
          environmentStack.pop();
          restoreAliasShadows();
        } else {
          // LaTeX environments form groups. A malformed/mismatched stack makes
          // later scope unknowable, so never promote subsequent definitions to
          // document scope.
          environmentScopeUncertain = true;
        }
        index = environment.end;
        continue;
      }
    }

    if (groupDepth === 0 && environmentStack.length === 0 && !environmentScopeUncertain) {
      recordLegacyMathFont(text, command.name, command.end, fontCommands, fontFamilies);
    }
    const parsed = parseMacroDefinition(text, index, command.name, command.end, fontFamilies);
    if (parsed !== undefined) {
      const declaredName = parsed.macro?.name ?? parsed.declaredName;
      if (declaredName !== undefined && (groupDepth > 0 || environmentStack.length > 0) &&
          Object.hasOwn(resolved, declaredName) && command.name !== "providecommand" &&
          !aliasShadows.has(declaredName)) {
        // Local definitions are not promoted to the document macro table, but
        // their inherited aliases must stay inactive until this scope closes.
        aliasShadows.set(declaredName, { groupDepth, environmentDepth: environmentStack.length });
      }
      if (
        parsed.macro !== undefined &&
        groupDepth === 0 &&
        environmentStack.length === 0 &&
        !environmentScopeUncertain &&
        result.length < 4_096
      ) {
        result.push(Object.freeze(parsed.macro));
        applyLocalMacro(resolved, parsed.macro);
      }
      // Exclusion ranges are source structure, not renderer payload. Even a
      // definition beyond the macro budget must never become visible math.
      definitionRanges.push(Object.freeze({ start: index, end: parsed.end }));
      index = parsed.end;
    } else {
      index = Math.max(index + 1, command.end);
    }
  }
  return Object.freeze({
    macros: Object.freeze(result),
    environmentAliases,
    definitionRanges: Object.freeze(definitionRanges),
    inactiveRanges: Object.freeze(inactiveRanges),
    bodyRange: Object.freeze({
      start: documentBodyStart ?? 0,
      end: documentBodyStart === undefined ? text.length : documentBodyEnd,
    }),
  });
}

const MATH_PREVIEW_CONDITIONAL_PRIMITIVES = new Set([
  "if", "ifcat", "ifx", "ifnum", "ifdim", "ifodd", "ifvmode",
  "ifhmode", "ifmmode", "ifinner", "ifvoid", "ifhbox", "ifvbox",
  "ifeof", "iftrue", "iffalse", "ifcase", "ifdefined", "ifcsname",
  "ifincsname", "ifprimitive",
]);

function isMathPreviewConditionalControl(name: string): boolean {
  return name !== "iff" && (
    MATH_PREVIEW_CONDITIONAL_PRIMITIVES.has(name) || /^if[A-Za-z@]+$/u.test(name)
  );
}

function skipMathPreviewNewIfDeclaration(
  text: string,
  requestedOffset: number,
): number | undefined {
  const targetStart = skipTeXWhitespaceAndComments(text, requestedOffset);
  if (text[targetStart] !== "\\") {
    return undefined;
  }
  const target = readControlSequence(text, targetStart);
  return /^if[A-Za-z@]+$/u.test(target.name) ? target.end : undefined;
}

function mathPreviewFunctionalConditionalArgumentCount(name: string): number | undefined {
  if (
    name === "ifthenelse" ||
    name === "IfFileExists" ||
    name === "InputIfFileExists"
  ) {
    return 3;
  }
  if (/^If[A-Za-z@]*TF$/u.test(name)) {
    return 3;
  }
  if (/^If[A-Za-z@]*[TF]$/u.test(name)) {
    return 2;
  }
  if (/^@if(?:package|class)later$/u.test(name)) {
    return 4;
  }
  return /^@if[A-Za-z@]+$/u.test(name) ? 3 : undefined;
}

function skipMathPreviewFunctionalConditional(
  text: string,
  requestedOffset: number,
  argumentCount: number,
): number | undefined {
  let cursor = requestedOffset;
  for (let argumentIndex = 0; argumentIndex < argumentCount; argumentIndex += 1) {
    const argument = readRequiredGroup(text, cursor);
    if (argument === undefined) {
      return undefined;
    }
    cursor = argument.end;
  }
  return cursor;
}

function skipLiteralFalseMathPreviewConditional(
  text: string,
  requestedStart: number,
): number {
  let depth = 1;
  let index = requestedStart;
  while (index < text.length) {
    if (text[index] === "%") {
      const newline = text.indexOf("\n", index + 1);
      index = newline < 0 ? text.length : newline + 1;
      continue;
    }
    if (text[index] !== "\\") {
      index += 1;
      continue;
    }
    const control = readControlSequence(text, index);
    if (control.name === "verb") {
      let delimiterOffset = control.end;
      if (text[delimiterOffset] === "*") {
        delimiterOffset += 1;
      }
      const delimiter = text[delimiterOffset];
      if (delimiter === undefined || delimiter === "\n" || delimiter === "\r") {
        index = control.end;
      } else {
        const closing = text.indexOf(delimiter, delimiterOffset + 1);
        const newline = text.indexOf("\n", delimiterOffset + 1);
        index = closing >= 0 && (newline < 0 || closing < newline)
          ? closing + 1
          : newline < 0
            ? text.length
            : newline + 1;
      }
      continue;
    }
    if (control.name === "newif") {
      index = skipMathPreviewNewIfDeclaration(text, control.end) ?? control.end;
      continue;
    }
    const functionalConditionalArguments = mathPreviewFunctionalConditionalArgumentCount(
      control.name,
    );
    if (functionalConditionalArguments !== undefined) {
      index = skipMathPreviewFunctionalConditional(
        text,
        control.end,
        functionalConditionalArguments,
      ) ?? text.length;
      continue;
    }
    if (isMathPreviewConditionalControl(control.name)) {
      depth += 1;
    } else if (control.name === "fi") {
      depth -= 1;
      if (depth === 0) {
        return control.end;
      }
    }
    index = Math.max(index + 1, control.end);
  }
  return text.length;
}

const UNSAFE_STATIC_MACRO_COMMANDS: readonly string[] = Object.freeze([
  "else",
  "fi",
  "or",
  "unless",
  "@ifnextchar",
  "@ifstar",
  "@ifundefined",
  "csname",
  "endcsname",
  "expandafter",
  "noexpand",
  "unexpanded",
  "expanded",
  "input",
  "include",
  "includeonly",
  "InputIfFileExists",
  "IfFileExists",
  "openin",
  "closein",
  "read",
  "readline",
  "openout",
  "closeout",
  "write",
  "immediate",
  "special",
  "directlua",
  "usepackage",
  "RequirePackage",
  "documentclass",
  "def",
  "gdef",
  "edef",
  "xdef",
  "let",
  "futurelet",
  "newif",
  "newcommand",
  "renewcommand",
  "providecommand",
  "DeclareRobustCommand",
  "DeclareMathOperator",
  "NewDocumentCommand",
  "RenewDocumentCommand",
  "ProvideDocumentCommand",
  "DeclareDocumentCommand",
  "newenvironment",
  "renewenvironment",
  "NewDocumentEnvironment",
  "RenewDocumentEnvironment",
  "ProvideDocumentEnvironment",
  "@namedef",
  "@nameuse",
  "chardef",
  "mathchardef",
  "countdef",
  "dimendef",
  "skipdef",
  "muskipdef",
  "toksdef",
  "catcode",
  "mathcode",
  "lccode",
  "uccode",
  "sfcode",
  "delcode",
  "global",
  "globaldefs",
  "fam",
  "font",
  "textfont",
  "scriptfont",
  "scriptscriptfont",
  "newfam",
  "advance",
  "multiply",
  "divide",
  "setbox",
  // LaTeX box-register helpers are stateful even when they appear inside a
  // seemingly declarative \newcommand/\renewcommand replacement. MathJax
  // cannot reproduce their register allocation/copy semantics. Accepting
  // such a definition would also shadow renderer-native fallbacks (notably a
  // project's \llangle/\rrangle definitions built with \savebox), causing
  // every otherwise valid formula that uses the command to fail as a whole.
  "savebox",
  "sbox",
  "usebox",
  "copy",
  "box",
  "wd",
  "ht",
  "dp",
  "setlength",
  "addtolength",
]);

/**
 * This is deliberately a conservative translation boundary, not a TeX
 * evaluator. Conditional, indirect, I/O, and definition/assignment commands
 * are left to a class/package capability fallback instead of being flattened
 * into a misleading MathJax macro.
 */
function isSafeStaticMacroReplacement(replacement: string): boolean {
  let index = 0;
  let commandCount = 0;
  while (index < replacement.length) {
    if (replacement[index] !== "\\") {
      index += 1;
      continue;
    }
    const command = readControlSequence(replacement, index);
    if (command.name.length === 0) {
      return false;
    }
    commandCount += 1;
    if (
      commandCount > MATH_PREVIEW_MAX_MACRO_CONTROL_SEQUENCE_COUNT ||
      /^(?:if|If)[A-Za-z@]*$/u.test(command.name) ||
      UNSAFE_STATIC_MACRO_COMMANDS.includes(command.name)
    ) {
      return false;
    }
    index = Math.max(index + 1, command.end);
  }
  return true;
}

// Read only literal, top-level font assignments. Names are document-defined;
// the finite mapping describes established TeX font families, not paper macros.
function recordLegacyMathFont(
  text: string,
  command: string,
  from: number,
  fonts: Map<string, string>,
  families: Map<string, string>,
): void {
  if (command !== "font" && command !== "textfont") {
    return;
  }
  const tail = text.slice(from, from + 256);
  if (command === "font") {
    const declaration = /^\s*\\([A-Za-z@]+)\s*=?\s*([A-Za-z]+)\d+\b/u.exec(tail);
    if (declaration?.[1] === undefined || declaration[2] === undefined) {
      return;
    }
    const variants: Readonly<Record<string, string>> = {
      cmr: "mathrm", cmmi: "mathit", cmmib: "boldsymbol", cmbx: "mathbf",
      cmss: "mathsf", msbm: "mathbb", eusm: "mathscr", eufm: "mathfrak",
    };
    const variant = variants[declaration[2]];
    if (variant === undefined) {
      fonts.delete(declaration[1]);
    } else {
      fonts.set(declaration[1], variant);
    }
    return;
  }
  const assignment = /^\s*\\([A-Za-z@]+)\s*=?\s*\\([A-Za-z@]+)/u.exec(tail);
  if (assignment?.[1] !== undefined && assignment[2] !== undefined) {
    const variant = fonts.get(assignment[2]);
    if (variant === undefined) {
      families.delete(assignment[1]);
    } else {
      families.set(assignment[1], variant);
    }
  }
}

function translateLegacyMathFont(
  replacement: string,
  families: ReadonlyMap<string, string>,
): string {
  const selection = /^\s*\{\s*\\fam\s*(?:\\([A-Za-z@]+)|([01]))\s*\\relax\s*#1\s*\}\s*$/u.exec(replacement);
  const family = selection?.[1] ?? selection?.[2];
  const variant = family === undefined ? undefined : families.get(family);
  return variant === undefined ? replacement : `\\${variant}{#1}`;
}

// Standard OT1/OML slots, as declared by LaTeX's fontmath.ltx. Emit the
// character itself so a later redefinition of e.g. \xi cannot change its meaning.
function legacyMathCharacter(code: number): string | undefined {
  if (!Number.isInteger(code) || code < 0 || code > 0x7fff) {
    return undefined;
  }
  const family = (code >> 8) & 0xf;
  const slot = code & 0xff;
  const upper = "ΓΔΘΛΞΠΣΥΦΨΩ";
  const lower = "αβγδϵζηθικλμνξπρστυϕχψωεϑϖϱςφ";
  let glyph = family === 0 || family === 1
    ? upper[slot] ?? (family === 1 ? lower[slot - 11] : undefined)
    : undefined;
  if (glyph === undefined && (family === 0 || family === 1) &&
      /[A-Za-z0-9]/u.test(String.fromCharCode(slot))) {
    glyph = family === 0 ? `\\mathrm{${String.fromCharCode(slot)}}` : String.fromCharCode(slot);
  }
  if (glyph === undefined) {
    return undefined;
  }
  const atom = ["mathord", "mathop", "mathbin", "mathrel", "mathopen", "mathclose", "mathpunct"][code >> 12];
  return atom === undefined ? glyph : `\\${atom}{${glyph}}`;
}

function parseMacroDefinition(
  text: string,
  start: number,
  command: string,
  commandEnd: number,
  fontFamilies: ReadonlyMap<string, string>,
): { readonly macro?: ParsedMacro; readonly declaredName?: string; readonly end: number } | undefined {
  if (command === "newcolumntype") {
    const name = readRequiredGroup(text, commandEnd);
    if (name === undefined) return undefined;
    const count = readOptionalGroup(text, name.end);
    const body = readRequiredGroup(text, count?.end ?? name.end);
    return body === undefined ? undefined : { end: body.end };
  }
  if (command === "newenvironment" || command === "renewenvironment") {
    let cursor = skipTeXWhitespaceAndComments(text, commandEnd);
    if (text[cursor] === "*") cursor += 1;
    const name = readRequiredGroup(text, cursor);
    if (name === undefined) return undefined;
    cursor = name.end;
    for (let optional = 0; optional < 2; optional += 1) {
      cursor = readOptionalGroup(text, cursor)?.end ?? cursor;
    }
    const opening = readRequiredGroup(text, cursor);
    const closing = opening === undefined ? undefined : readRequiredGroup(text, opening.end);
    return closing === undefined ? undefined : { end: closing.end };
  }
  if (command === "mathchardef") {
    const target = readControlSequence(text, skipTeXWhitespaceAndComments(text, commandEnd));
    const name = normalizeMacroName(target.name);
    const number = /^\s*=?\s*(?:"([0-9a-f]+)|'([0-7]+)|([0-9]+))/iu.exec(text.slice(target.end));
    if (number === null) {
      return undefined;
    }
    const end = target.end + number[0].length;
    const code = Number.parseInt(number[1] ?? number[2] ?? number[3]!, number[1] !== undefined ? 16 : number[2] !== undefined ? 8 : 10);
    const replacement = legacyMathCharacter(code);
    return name === undefined || replacement === undefined
      ? { end, ...(name === undefined ? {} : { declaredName: name }) } : {
      macro: { kind: "def", name, replacement, argumentCount: 0,
        sourceRange: Object.freeze({ start, end }) }, end,
    };
  }
  if (["def", "gdef", "edef", "xdef"].includes(command)) {
    const nameStart = skipTeXWhitespaceAndComments(text, commandEnd);
    const target = readControlSequence(text, nameStart);
    const name = normalizeMacroName(target.name);
    const open = text.indexOf("{", target.end);
    if (open < 0) {
      return undefined;
    }
    const group = readBalancedGroup(text, open, "{", "}");
    if (group === undefined) {
      return undefined;
    }
    const parameters = text.slice(target.end, open).trim();
    const argumentCount = parameters.length / 2;
    const expected = Array.from({ length: Math.min(9, Math.ceil(argumentCount)) }, (_, i) => `#${i + 1}`).join("");
    const replacement = translateLegacyMathFont(group.value, fontFamilies);
    if (name === undefined || command !== "def" || parameters !== expected || argumentCount > 9 ||
        replacement.length > MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH ||
        !isSafeStaticMacroReplacement(replacement)) {
      return { end: group.end, ...(name === undefined ? {} : { declaredName: name }) };
    }
    return {
      macro: { kind: "def", name, replacement, argumentCount,
        sourceRange: Object.freeze({ start, end: group.end }) },
      end: group.end,
    };
  }
  if (
    command !== "newcommand" &&
    command !== "renewcommand" &&
    command !== "providecommand" &&
    command !== "DeclareMathOperator"
  ) {
    return undefined;
  }

  let cursor = skipHorizontalWhitespace(text, commandEnd);
  let starred = false;
  if (text[cursor] === "*") {
    starred = true;
    cursor = skipHorizontalWhitespace(text, cursor + 1);
  }

  const nameGroup = readRequiredGroup(text, cursor);
  let rawName: string;
  if (nameGroup !== undefined) {
    rawName = nameGroup.value.trim();
    cursor = nameGroup.end;
  } else {
    const control = readControlSequence(text, cursor);
    if (text[cursor] !== "\\" || control.name.length === 0) {
      return undefined;
    }
    rawName = `\\${control.name}`;
    cursor = control.end;
  }
  const name = normalizeMacroName(rawName);
  if (name === undefined) {
    return undefined;
  }

  if (command === "DeclareMathOperator") {
    const operator = readRequiredGroup(text, cursor);
    if (operator === undefined) {
      return undefined;
    }
    if (
      operator.value.length > MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH ||
      !isSafeStaticMacroReplacement(operator.value)
    ) {
      return { end: operator.end, declaredName: name };
    }
    return {
      macro: {
        kind: "operator",
        name,
        replacement: `\\operatorname${starred ? "*" : ""}{${operator.value}}`,
        argumentCount: 0,
        sourceRange: Object.freeze({ start, end: operator.end }),
      },
      end: operator.end,
    };
  }

  const countGroup = readOptionalGroup(text, cursor);
  let argumentCount = 0;
  if (countGroup !== undefined) {
    const parsedCount = Number.parseInt(countGroup.value.trim(), 10);
    if (!Number.isInteger(parsedCount) || parsedCount < 0 || parsedCount > 9) {
      return undefined;
    }
    argumentCount = parsedCount;
    cursor = countGroup.end;
  }
  const defaultGroup = readOptionalGroup(text, cursor);
  let optionalDefault: string | undefined;
  let safeOptionalDefault = true;
  if (defaultGroup !== undefined) {
    safeOptionalDefault =
      defaultGroup.value.length <= MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH &&
      isSafeStaticMacroReplacement(defaultGroup.value);
    optionalDefault = defaultGroup.value;
    cursor = defaultGroup.end;
    argumentCount = Math.max(1, argumentCount);
  }
  const replacement = readRequiredGroup(text, cursor);
  if (replacement === undefined) {
    return undefined;
  }
  if (
    replacement.value.length > MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH ||
    !safeOptionalDefault ||
    !isSafeStaticMacroReplacement(replacement.value)
  ) {
    return { end: replacement.end, declaredName: name };
  }
  argumentCount = Math.max(argumentCount, inferArgumentCount(replacement.value));
  return {
    macro: {
      kind: command,
      name,
      replacement: replacement.value,
      argumentCount,
      ...(optionalDefault === undefined ? {} : { optionalDefault }),
      sourceRange: Object.freeze({ start, end: replacement.end }),
    },
    end: replacement.end,
  };
}

function readControlSequence(
  text: string,
  slashOffset: number,
): { readonly name: string; readonly end: number } {
  if (text[slashOffset] !== "\\") {
    return { name: "", end: slashOffset };
  }
  const first = text[slashOffset + 1];
  if (first === undefined) {
    return { name: "", end: slashOffset + 1 };
  }
  if (!/[A-Za-z@]/u.test(first)) {
    return { name: first, end: slashOffset + 2 };
  }
  let end = slashOffset + 2;
  while (end < text.length && /[A-Za-z@]/u.test(text[end]!)) {
    end += 1;
  }
  return { name: text.slice(slashOffset + 1, end), end };
}

function readRequiredGroup(
  text: string,
  from: number,
): { readonly value: string; readonly end: number } | undefined {
  const open = skipTeXWhitespaceAndComments(text, from);
  return readBalancedGroup(text, open, "{", "}");
}

function readOptionalGroup(
  text: string,
  from: number,
): { readonly value: string; readonly end: number } | undefined {
  const open = skipTeXWhitespaceAndComments(text, from);
  return readBalancedGroup(text, open, "[", "]");
}

function readBalancedGroup(
  text: string,
  open: number,
  opening: "{" | "[",
  closing: "}" | "]",
): { readonly value: string; readonly end: number } | undefined {
  if (text[open] !== opening) {
    return undefined;
  }
  let depth = 1;
  let index = open + 1;
  let segmentStart = index;
  let value = "";
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (character === "%") {
      value += text.slice(segmentStart, index);
      const newline = text.indexOf("\n", index + 1);
      index = newline < 0 ? text.length : newline + 1;
      segmentStart = index;
      continue;
    }
    if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return { value: value + text.slice(segmentStart, index), end: index + 1 };
      }
    }
    index += 1;
  }
  return undefined;
}

function normalizeMacroName(name: string): string | undefined {
  const normalized = name.trim().replace(/^\\(?=.)/u, "");
  return isMathPreviewMacroName(normalized) ? normalized : undefined;
}

function inferArgumentCount(replacement: string): number {
  let maximum = 0;
  for (const match of replacement.matchAll(/#([1-9])/gu)) {
    maximum = Math.max(maximum, Number.parseInt(match[1] ?? "0", 10));
  }
  return maximum;
}

function skipHorizontalWhitespace(text: string, from: number): number {
  let index = from;
  while (index < text.length && /[ \t\r\n]/u.test(text[index]!)) {
    index += 1;
  }
  return index;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
