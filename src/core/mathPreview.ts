import { scanLatexRegions } from "./latexScanner";
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
}

export interface MathPreviewMacro {
  readonly name: string;
  readonly replacement: string;
  readonly argumentCount: number;
  readonly optionalDefault?: string;
}

export interface MathPreviewSnapshot {
  readonly formulas: readonly MathPreviewFormula[];
  readonly macros: Readonly<Record<string, MathPreviewMacro>>;
  /** Stable, collision-free cache material for the resolved macro table. */
  readonly macroFingerprint: string;
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
}

const DEFAULT_MAX_SOURCE_LENGTH = 8_192;
export const MATH_PREVIEW_MAX_MACRO_COUNT = 128;
export const MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH = 2_048;
export const MATH_PREVIEW_MAX_MACRO_SERIALIZED_LENGTH = 16_384;

/**
 * Normalize user-configured macros before they enter a document snapshot.
 * The serialized-size check mirrors the worker's final request boundary so a
 * settings value accepted here cannot make every preview request invalid.
 */
export function sanitizeMathPreviewConfiguredMacros(
  value: unknown,
): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
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
  return result;
}

/**
 * Build the preview index for one immutable document snapshot.
 *
 * The existing TeXLeaf scanner remains the single source of truth for math
 * syntax, comments and verbatim regions. This layer only removes nested
 * duplicate regions and resolves the small, renderer-safe macro model.
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
  const document = collectDocumentMacros(text);
  const formulas = normalizeMathRegions(text, scanLatexRegions(text)).filter(
    (formula) =>
      formula.outerRange.start >= document.bodyRange.start &&
      formula.outerRange.end <= document.bodyRange.end &&
      formula.bodyRange.end - formula.bodyRange.start <= maxSourceLength,
  );
  const macros = resolveMathPreviewMacros(
    sanitizeMathPreviewConfiguredMacros(options.configuredMacros ?? {}),
    document.macros,
  );

  return {
    formulas,
    macros,
    macroFingerprint: macroFingerprint(macros),
  };
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

/**
 * Create MathJax input for a formula. Closed environments retain their
 * wrapper so alignment markers and row separators keep their meaning.
 * Unclosed formulas are provisionally closed at the current cursor.
 */
export function createMathPreviewRenderInput(
  text: string,
  formula: MathPreviewFormula,
  snapshot: Pick<MathPreviewSnapshot, "macros" | "macroFingerprint">,
  cursorOffset = formula.bodyRange.end,
): MathPreviewRenderInput | undefined {
  const body = prepareMathPreviewBody(text, formula, cursorOffset);
  if (body === undefined) {
    return undefined;
  }

  return {
    tex: wrapMathPreviewBody(body.tex, formula.environmentName),
    display: formula.mode === "block",
    macros: snapshot.macros,
    macroFingerprint: snapshot.macroFingerprint,
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
  snapshot: Pick<MathPreviewSnapshot, "macros" | "macroFingerprint">,
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
  const requestedOffset = clampInteger(
    cursorOffset - body.sourceStart,
    0,
    body.tex.length,
  );
  const insertionOffset = findSafeMathPreviewCursorOffset(
    body.tex,
    requestedOffset,
    snapshot.macros,
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
    : `\\begin{${environmentName}}${body}\\end{${environmentName}}`;
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
      protectCursorSpan(spans, previousSafe, group.open + 1);
      previousSafe = group.close;
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
  readonly kind: "newcommand" | "renewcommand" | "providecommand" | "operator";
}

interface DocumentMacroScan {
  readonly macros: readonly ParsedMacro[];
  readonly bodyRange: OffsetRange;
}

function resolveMathPreviewMacros(
  configured: Readonly<Record<string, string>>,
  documentMacros: readonly ParsedMacro[],
): Readonly<Record<string, MathPreviewMacro>> {
  const resolved: Record<string, MathPreviewMacro> = Object.create(null) as Record<
    string,
    MathPreviewMacro
  >;

  for (const name of Object.keys(configured).sort()) {
    if (Object.keys(resolved).length >= MATH_PREVIEW_MAX_MACRO_COUNT) {
      break;
    }
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

  for (const macro of documentMacros) {
    if (
      macro.kind === "providecommand" &&
      Object.hasOwn(resolved, macro.name)
    ) {
      continue;
    }
    if (
      resolved[macro.name] === undefined &&
      Object.keys(resolved).length >= MATH_PREVIEW_MAX_MACRO_COUNT
    ) {
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

function trySetResolvedMacro(
  resolved: Record<string, MathPreviewMacro>,
  macro: MathPreviewMacro,
): boolean {
  const hadPrevious = Object.hasOwn(resolved, macro.name);
  const previous = resolved[macro.name];
  resolved[macro.name] = macro;
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

function macroFingerprint(macros: Readonly<Record<string, MathPreviewMacro>>): string {
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

function collectDocumentMacros(text: string): DocumentMacroScan {
  const result: ParsedMacro[] = [];
  let index = 0;
  let inComment = false;
  let verbatimDelimiter: string | undefined;
  let verbatimEnvironment: string | undefined;
  let documentBodyStart: number | undefined;
  let documentBodyEnd = text.length;

  while (index < text.length) {
    const character = text[index];
    if (verbatimEnvironment !== undefined) {
      const closing = `\\end{${verbatimEnvironment}}`;
      if (text.startsWith(closing, index)) {
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
      index += 1;
      continue;
    }

    const command = readControlSequence(text, index);
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
    if (command.name === "begin" || command.name === "end") {
      const environment = readRequiredGroup(text, command.end);
      if (environment !== undefined) {
        const name = environment.value.trim();
        if (command.name === "begin" && name === "document") {
          documentBodyStart ??= environment.end;
          index = environment.end;
          continue;
        }
        if (
          command.name === "end" &&
          name === "document" &&
          documentBodyStart !== undefined
        ) {
          documentBodyEnd = index;
          break;
        }
        const normalizedEnvironment = name.endsWith("*") ? name.slice(0, -1) : name;
        if (
          command.name === "begin" &&
          ["verbatim", "Verbatim", "lstlisting", "minted"].includes(
            normalizedEnvironment,
          )
        ) {
          verbatimEnvironment = name;
        }
        index = environment.end;
        continue;
      }
    }

    const parsed = parseMacroDefinition(text, index, command.name, command.end);
    if (parsed !== undefined) {
      if (
        documentBodyStart === undefined &&
        result.length < MATH_PREVIEW_MAX_MACRO_COUNT
      ) {
        result.push(parsed.macro);
      }
      index = parsed.end;
    } else {
      index = Math.max(index + 1, command.end);
    }
  }
  return {
    macros: result,
    bodyRange: {
      start: documentBodyStart ?? 0,
      end: documentBodyStart === undefined ? text.length : documentBodyEnd,
    },
  };
}

function parseMacroDefinition(
  text: string,
  start: number,
  command: string,
  commandEnd: number,
): { readonly macro: ParsedMacro; readonly end: number } | undefined {
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
    if (
      operator === undefined ||
      operator.value.length > MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH
    ) {
      return undefined;
    }
    return {
      macro: {
        kind: "operator",
        name,
        replacement: `\\operatorname${starred ? "*" : ""}{${operator.value}}`,
        argumentCount: 0,
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
  if (defaultGroup !== undefined) {
    optionalDefault = defaultGroup.value;
    cursor = defaultGroup.end;
    argumentCount = Math.max(1, argumentCount);
  }
  const replacement = readRequiredGroup(text, cursor);
  if (
    replacement === undefined ||
    replacement.value.length > MATH_PREVIEW_MAX_MACRO_REPLACEMENT_LENGTH
  ) {
    return undefined;
  }
  argumentCount = Math.max(argumentCount, inferArgumentCount(replacement.value));
  return {
    macro: {
      kind: command,
      name,
      replacement: replacement.value,
      argumentCount,
      ...(optionalDefault === undefined ? {} : { optionalDefault }),
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
  const open = skipHorizontalWhitespace(text, from);
  return readBalancedGroup(text, open, "{", "}");
}

function readOptionalGroup(
  text: string,
  from: number,
): { readonly value: string; readonly end: number } | undefined {
  const open = skipHorizontalWhitespace(text, from);
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
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return { value: text.slice(open + 1, index), end: index + 1 };
      }
    }
    index += 1;
  }
  return undefined;
}

function normalizeMacroName(name: string): string | undefined {
  const normalized = name.trim().replace(/^\\+/u, "");
  return /^[A-Za-z@]+$/u.test(normalized) ? normalized : undefined;
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
