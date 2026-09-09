/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { parentPort, workerData } from "node:worker_threads";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/cjs/svg.js";
import { mathjax } from "@mathjax/src/cjs/mathjax.js";
import { liteAdaptor } from "@mathjax/src/cjs/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/cjs/handlers/html.js";
import { TeX } from "@mathjax/src/cjs/input/tex.js";
import "@mathjax/src/cjs/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/cjs/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/cjs/input/tex/braket/BraketConfiguration.js";
import { CommandMap } from "@mathjax/src/cjs/input/tex/TokenMap.js";
import { Configuration } from "@mathjax/src/cjs/input/tex/Configuration.js";
import TexParser from "@mathjax/src/cjs/input/tex/TexParser.js";
import type { ParseMethod } from "@mathjax/src/cjs/input/tex/Types.js";
import { ParseUtil } from "@mathjax/src/cjs/input/tex/ParseUtil.js";
import "@mathjax/src/cjs/input/tex/color/ColorConfiguration.js";
import "@mathjax/src/cjs/input/tex/configmacros/ConfigMacrosConfiguration.js";
import "@mathjax/src/cjs/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/cjs/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/cjs/input/tex/textcomp/TextcompConfiguration.js";
import "@mathjax/src/cjs/input/tex/textmacros/TextMacrosConfiguration.js";
import { SVG } from "@mathjax/src/cjs/output/svg.js";
import { isMathPreviewMacroName, MATH_PREVIEW_MAX_MACRO_COUNT, MATH_PREVIEW_MAX_MACRO_SERIALIZED_LENGTH } from "./mathPreviewProtocol";
import type {
  MathPreviewCursorGeometry,
  MathPreviewWorkerRequest,
  MathPreviewWorkerResponse,
} from "./mathPreviewProtocol";

const HARD_MAX_SOURCE_LENGTH = 32_768;
const HARD_MAX_MACRO_COUNT = MATH_PREVIEW_MAX_MACRO_COUNT;
const HARD_MAX_MACRO_TEXT = MATH_PREVIEW_MAX_MACRO_SERIALIZED_LENGTH;
const HARD_MAX_SVG_LENGTH = 4_000_000;
const DEFAULT_ENGINE_CACHE_LIMIT = 12;
const configuredEngineCacheLimit = typeof workerData === "object" &&
    workerData !== null &&
    Number.isSafeInteger((workerData as { readonly engineCacheLimit?: unknown }).engineCacheLimit)
  ? Number((workerData as { readonly engineCacheLimit: number }).engineCacheLimit)
  : DEFAULT_ENGINE_CACHE_LIMIT;
const ENGINE_CACHE_LIMIT = Math.max(1, Math.min(16, configuredEngineCacheLimit));

type DynamicFontLoader = () => Promise<unknown>;

// NewCM keeps uncommon glyph tables in dynamically loaded modules.  Keep every
// import specifier static so esbuild can include the modules in the single-file
// worker bundle instead of leaving a runtime dependency on node_modules.
const dynamicFontLoaders = {
  accents: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/accents.js"),
  "accents-b-i": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/accents-b-i.js"),
  arabic: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/arabic.js"),
  arrows: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/arrows.js"),
  braille: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/braille.js"),
  "braille-d": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/braille-d.js"),
  calligraphic: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/calligraphic.js"),
  cherokee: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/cherokee.js"),
  cyrillic: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/cyrillic.js"),
  "cyrillic-ss": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/cyrillic-ss.js"),
  devanagari: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/devanagari.js"),
  "double-struck": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/double-struck.js"),
  fraktur: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/fraktur.js"),
  greek: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/greek.js"),
  "greek-ss": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/greek-ss.js"),
  hebrew: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/hebrew.js"),
  latin: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/latin.js"),
  "latin-b": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/latin-b.js"),
  "latin-bi": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/latin-bi.js"),
  "latin-i": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/latin-i.js"),
  marrows: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/marrows.js"),
  math: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/math.js"),
  monospace: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/monospace.js"),
  "monospace-ex": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/monospace-ex.js"),
  "monospace-l": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/monospace-l.js"),
  mshapes: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/mshapes.js"),
  phonetics: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/phonetics.js"),
  "phonetics-ss": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/phonetics-ss.js"),
  PUA: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/PUA.js"),
  "sans-serif": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/sans-serif.js"),
  "sans-serif-b": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/sans-serif-b.js"),
  "sans-serif-bi": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/sans-serif-bi.js"),
  "sans-serif-ex": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/sans-serif-ex.js"),
  "sans-serif-i": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/sans-serif-i.js"),
  "sans-serif-r": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/sans-serif-r.js"),
  script: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/script.js"),
  shapes: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/shapes.js"),
  symbols: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/symbols.js"),
  "symbols-b-i": () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/symbols-b-i.js"),
  variants: () => import("@mathjax/mathjax-newcm-font/cjs/svg/dynamic/variants.js"),
} satisfies Readonly<Record<string, DynamicFontLoader>>;

mathjax.asyncLoad = (requestedPath: string): Promise<unknown> => {
  const normalizedPath = requestedPath.replaceAll("\\", "/");
  const fileName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
  const moduleName = fileName.replace(/\.js$/iu, "");
  const loader = (dynamicFontLoaders as Readonly<Record<string, DynamicFontLoader>>)[
    moduleName
  ];
  if (loader === undefined) {
    return Promise.reject(
      new Error(`Unsupported MathJax dynamic module: ${requestedPath}`),
    );
  }
  return loader();
};
mathjax.asyncIsSynchronous = false;

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

type RenderDocument = ReturnType<typeof mathjax.document>;

interface Engine {
  readonly document: RenderDocument;
}

// Creating TeX, SVG and MathDocument instances is substantially more expensive
// than converting one incremental preview. Keep a small per-worker LRU keyed by
// the effective macro environment, then reset the TeX input state before each
// use so formula-local definitions, tags and labels never leak between requests.
const engineCache = new Map<string, Engine>();

// A preview is intentionally detached from the document-wide equation
// counter/reference graph.  MathJax's AMS label handler can retry or reject a
// standalone align conversion when more than one row carries a \label, even
// though labels have no visible output.  Reserve the standard command as a
// one-argument no-op inside this isolated renderer so labels never suppress an
// otherwise valid preview.  Put it after request macros: document/configured
// macros must not turn metadata into visible or stateful preview content.
const PREVIEW_FALLBACK_MACROS = {
  // NewCM has no small-caps text variant; preserve the literal text and spacing.
  textsc: [String.raw`\text{#1}`, 1] as const,
  // The bundled font has double-struck glyphs, but no dsfont/bbm variants.
  mathds: [String.raw`\mathbb{#1}`, 1] as const,
  mathbbmss: [String.raw`\mathbb{#1}`, 1] as const,
  bm: [String.raw`\boldsymbol{#1}`, 1] as const,
  // Beamer emphasis has no slide palette in a detached formula preview.
  alert: [String.raw`\boldsymbol{#1}`, 1] as const,
  dag: String.raw`\dagger`,
  slash: "/",
  o: "ø",
  O: "Ø",
  intertext: [String.raw`\text{#1}\\`, 1] as const,
  llangle: String.raw`\langle\!\langle`,
  rrangle: String.raw`\rangle\!\rangle`,
};

const PREVIEW_INTERNAL_MACROS = {
  label: ["", 1] as const,
  // amsthm places the end-of-proof mark at the surrounding proof level.
  // A detached formula preview has no proof list to mutate, so retaining the
  // command only makes an otherwise valid align/align* fail in MathJax.
  qedhere: "",
};

// Keep layout translations in the isolated MathJax parser, never rewrite source
// text: editor ranges and cursor planning must continue to use original offsets.
new CommandMap("texleaf-preview-layout", {
  ref: previewReferenceLabel,
  eqref: [previewReferenceLabel, true],
  vspace(parser: TexParser, command: Parameters<ParseMethod>[1]): void {
    const name = String(command);
    parser.GetStar();
    parser.GetArgument(name); // Page-level vertical glue has no detached-card counterpart.
  },
  scalebox(parser: TexParser, command: Parameters<ParseMethod>[1]): void {
    const name = String(command);
    const horizontal = Number(parser.GetArgument(name));
    const vertical = Number(parser.GetBrackets(name, String(horizontal)));
    // ponytail: uniform scaling only; add affine SVG transforms for reflected or anisotropic boxes.
    if (!Number.isFinite(horizontal) || horizontal <= 0 || horizontal > 20 || vertical !== horizontal) {
      throw new Error("Preview supports uniform positive scalebox factors up to 20.");
    }
    const content = ParseUtil.internalMath(parser, parser.GetArgument(name));
    parser.Push(parser.create("node", "mstyle", content, { mathsize: `${horizontal * 100}%` }));
  },
  tensor(parser: TexParser, command: Parameters<ParseMethod>[1]): void {
    const name = String(command);
    const compact = parser.GetStar();
    const before = parser.GetBrackets(name, "");
    const base = parser.GetArgument(name);
    const after = parser.GetArgument(name);
    const [preUpper, preLower] = tensorScripts(parser, name, before, compact);
    const [upper, lower] = tensorScripts(parser, name, after, compact);
    const nucleus = before.length === 0 ? `{${base}}`
      : String.raw`\prescript{${preUpper}}{${preLower}}{${base}}`;
    const tex = `${nucleus}^{${upper}}_{${lower}}`;
    if (tex.length > HARD_MAX_SOURCE_LENGTH) {
      throw new Error("Expanded tensor indices exceed the preview limit.");
    }
    parser.Push(new TexParser(tex, parser.stack.env, parser.configuration).mml());
  },
});
Configuration.create("texleaf-preview-layout", {
  handler: { macro: ["texleaf-preview-layout"] },
  priority: 4, // Before native AMS refs (5), after configured macros (3).
});
new CommandMap("texleaf-preview-text-labels", {
  ref: previewReferenceLabel,
  eqref: [previewReferenceLabel, true],
  boldmath(parser: TexParser): void { parser.stack.env.boldsymbol = true; },
  unboldmath(parser: TexParser): void { parser.stack.env.boldsymbol = false; },
});
Configuration.create("texleaf-preview-text-labels", {
  parser: "text",
  handler: { macro: ["texleaf-preview-text-labels"] },
  priority: 0, // Before text-base refs (1); use the same literal-label policy.
});

function previewReferenceLabel(
  parser: TexParser,
  command: Parameters<ParseMethod>[1],
  parenthesized = false,
): void {
  parser.GetStar();
  const label = parser.GetArgument(String(command));
  // A detached card has no authoritative document-wide numbering. Preserve
  // the source key as literal text, including underscores and control symbols.
  const text = parenthesized ? `([${label}])` : `[${label}]`;
  parser.Push(parser.create("token", "mtext", {}, text));
}

function tensorScripts(parser: TexParser, name: string, source: string, compact: boolean): readonly [string, string] {
  const savedSource = parser.string;
  const savedIndex = parser.i;
  let upper = "";
  let lower = "";
  try {
    parser.string = source;
    parser.i = 0;
    while (parser.GetNext() !== "") {
      const side = parser.GetNext();
      // ponytail: tensor* alignment markers need measured script-column widths.
      if (side !== "^" && side !== "_") {
        throw new Error("Tensor indices must be superscript or subscript arguments.");
      }
      parser.i += 1;
      const index = `{${parser.GetArgument(name)}}`;
      const spacer = compact ? "" : String.raw`\hphantom{${index}}`;
      upper += side === "^" ? index : spacer;
      lower += side === "_" ? index : spacer;
    }
  } finally {
    parser.string = savedSource;
    parser.i = savedIndex;
  }
  return [upper, lower];
}

let renderQueue: Promise<void> = Promise.resolve();

parentPort?.on("message", (value: unknown) => {
  const run = async (): Promise<void> => {
    const response = await renderMessage(value);
    parentPort?.postMessage(response);
  };
  // MathJax documents keep mutable conversion state, so requests sharing an
  // engine are deliberately serialized inside the worker.
  renderQueue = renderQueue.then(run, run);
});

async function renderMessage(value: unknown): Promise<MathPreviewWorkerResponse> {
  const request = parseRequest(value);
  if (request === undefined) {
    return { type: "error", id: requestId(value), message: "Invalid render request." };
  }

  try {
    const engine = acquireEngine(request);
    const container = await engine.document.convertPromise(request.tex, {
      display: request.display,
      em: 16,
      ex: 8,
      containerWidth: 1_280,
    });
    const svgNode = adaptor.tags(container, "svg")[0];
    if (svgNode === undefined) {
      throw new Error("MathJax did not return an SVG node.");
    }
    const cursor = request.cursorMarkerColor === undefined
      ? undefined
      : tagAndMeasureCursor(svgNode, request.cursorMarkerColor);
    pruneMathJaxSourceMetadata(svgNode);
    const source = adaptor.serializeXML(svgNode);
    if (source.length > HARD_MAX_SVG_LENGTH) {
      throw new Error("MathJax SVG exceeded the safe output limit.");
    }
    const rendered = sanitizeSvg(source, request.foreground, request.scale);
    return {
      type: "result",
      id: request.id,
      svg: rendered.svg,
      widthEm: rendered.widthEm,
      heightEm: rendered.heightEm,
      ...(cursor === undefined ? {} : { cursor }),
    };
  } catch (error: unknown) {
    return {
      type: "error",
      id: request.id,
      message: normalizeError(error),
    };
  }
}

/**
 * MathJax annotates nearly every generated group with the original TeX and an
 * internal MathML node name. The cursor geometry walker has already consumed
 * data-latex at this point. Keep only the three table node names used by the
 * Webview's aligned-row sizing and remove the rest before cloning/caching the
 * SVG; real papers save roughly a third of their preview payload this way.
 */
function pruneMathJaxSourceMetadata(svg: SvgNode): void {
  for (const group of adaptor.tags(svg, "g")) {
    adaptor.removeAttribute(group, "data-latex");
    const mathNode = stringAttribute(group, "data-mml-node");
    if (
      mathNode !== "mtable" &&
      mathNode !== "mtr" &&
      mathNode !== "mlabeledtr"
    ) {
      adaptor.removeAttribute(group, "data-mml-node");
    }
  }
}

function acquireEngine(request: MathPreviewWorkerRequest): Engine {
  if (requestMayMutateEngine(request.tex)) {
    // TeX definition commands mutate the parser's macro map beyond the normal
    // per-conversion reset. Render these uncommon formulas in an isolated
    // engine so a local \def can never change a later preview.
    return createEngine(request.macros);
  }
  const key = engineCacheKey(request);
  const cached = engineCache.get(key);
  if (cached !== undefined) {
    engineCache.delete(key);
    engineCache.set(key, cached);
    cached.document.reset({ inputJax: [0] });
    return cached;
  }
  const engine = createEngine(request.macros);
  engineCache.set(key, engine);
  while (engineCache.size > ENGINE_CACHE_LIMIT) {
    const oldestKey = engineCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) {
      break;
    }
    engineCache.delete(oldestKey);
  }
  return engine;
}

function requestMayMutateEngine(tex: string): boolean {
  return /\\(?:def|edef|gdef|xdef|let|futurelet|global|globaldefs|newcommand|renewcommand|providecommand|newenvironment|renewenvironment|newtheorem|DeclareMathOperator|DeclarePairedDelimiter(?:X|XPP)?|definecolor|colorlet)\*?\b/u.test(
    tex,
  );
}

function engineCacheKey(request: MathPreviewWorkerRequest): string {
  // Include the serialized macro payload as a collision guard even though the
  // host fingerprint is already deterministic for normal requests.
  return `${request.macroFingerprint}\u0000${JSON.stringify(request.macros)}`;
}

function createEngine(macros: MathPreviewWorkerRequest["macros"]): Engine {
  const previewMacros = { ...macros };
  // Source wrappers cannot supply authoritative cross-formula numbers either.
  delete previewMacros.ref;
  delete previewMacros.eqref;
  const input = new TeX({
    packages: [
      "base",
      "ams",
      "boldsymbol",
      "braket",
      "texleaf-preview-layout",
      "color",
      "configmacros",
      "mathtools",
      "newcommand",
      "textcomp",
      "textmacros",
    ],
    textmacros: { packages: ["text-base", "textcomp", "texleaf-preview-text-labels"] },
    environments: Object.fromEntries(
      ["tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"]
        .map((size) => [size, [`{\\${size}`, "}"]]),
    ),
    macros: {
      ...PREVIEW_FALLBACK_MACROS,
      ...previewMacros,
      ...PREVIEW_INTERNAL_MACROS,
    },
    maxBuffer: 32_768,
    maxMacros: 1_000,
    formatError: (_jax: unknown, error: Error): never => {
      throw error;
    },
  });
  const output = new SVG({
    fontCache: "local",
    fontData: MathJaxNewcmFont,
    useXlink: false,
    linebreaks: { inline: false },
  });
  const engine = {
    document: mathjax.document("", { InputJax: input, OutputJax: output }),
  };
  return engine;
}

function parseRequest(value: unknown): MathPreviewWorkerRequest | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Partial<MathPreviewWorkerRequest>;
  if (
    candidate.type !== "render" ||
    !Number.isSafeInteger(candidate.id) ||
    typeof candidate.tex !== "string" ||
    candidate.tex.length === 0 ||
    candidate.tex.length > HARD_MAX_SOURCE_LENGTH ||
    typeof candidate.display !== "boolean" ||
    typeof candidate.macroFingerprint !== "string" ||
    candidate.macroFingerprint.length > HARD_MAX_MACRO_TEXT * 2 ||
    typeof candidate.foreground !== "string" ||
    typeof candidate.scale !== "number" ||
    !Number.isFinite(candidate.scale) ||
    candidate.scale < 0.5 ||
    candidate.scale > 3 ||
    (candidate.cursorMarkerColor !== undefined &&
      (typeof candidate.cursorMarkerColor !== "string" ||
        !/^#[0-9A-Fa-f]{6}$/u.test(candidate.cursorMarkerColor))) ||
    typeof candidate.macros !== "object" ||
    candidate.macros === null ||
    Array.isArray(candidate.macros)
  ) {
    return undefined;
  }
  const macros = candidate.macros as Readonly<Record<string, unknown>>;
  const names = Object.keys(macros);
  if (
    names.length > HARD_MAX_MACRO_COUNT ||
    JSON.stringify(macros).length > HARD_MAX_MACRO_TEXT ||
    names.some(
      (name) => !isMathPreviewMacroName(name) || !isMacroOption(macros[name]),
    )
  ) {
    return undefined;
  }
  return candidate as MathPreviewWorkerRequest;
}

type SvgNode = ReturnType<typeof adaptor.tags>[number];

interface SvgMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

const IDENTITY_SVG_MATRIX: SvgMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

/**
 * Locate the deliberately unique coloured rule inserted by the cursor
 * planner. MathJax already knows the exact layout, including nested fractions,
 * scripts and aligned rows; walking its emitted SVG transforms lets both the
 * native and Webview previews follow that real geometry without estimating a
 * glyph position from source-character ratios.
 */
function tagAndMeasureCursor(
  svg: SvgNode,
  markerColor: string,
): MathPreviewCursorGeometry | undefined {
  const normalizedColor = markerColor.toUpperCase();
  for (const rect of adaptor.tags(svg, "rect")) {
    if (
      stringAttribute(rect, "fill").toUpperCase() !== normalizedColor ||
      stringAttribute(rect, "data-bgcolor") !== "true" ||
      !cursorRuleAncestorMatches(rect, svg, normalizedColor)
    ) {
      continue;
    }
    const x = finiteAttribute(rect, "x", 0);
    const y = finiteAttribute(rect, "y", 0);
    const width = finiteAttribute(rect, "width", Number.NaN);
    const height = finiteAttribute(rect, "height", Number.NaN);
    if (!(width > 0) || !(height > 0)) {
      continue;
    }
    adaptor.setAttribute(rect, "data-texleaf-preview-caret", "true");
    const matrix = transformToRoot(rect, svg);
    const points = [
      transformPoint(matrix, x, y),
      transformPoint(matrix, x + width, y),
      transformPoint(matrix, x, y + height),
      transformPoint(matrix, x + width, y + height),
    ];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    if (![left, right, top, bottom].every(Number.isFinite)) {
      return undefined;
    }
    return {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }
  return undefined;
}

function cursorRuleAncestorMatches(
  node: SvgNode,
  svg: SvgNode,
  normalizedColor: string,
): boolean {
  let current: SvgNode | undefined = node;
  while (current !== undefined) {
    const latex = stringAttribute(current, "data-latex");
    if (
      latex.includes(String.raw`\rule[-0.2em]{0.09em}{1.2em}`) &&
      latex.toUpperCase().includes(normalizedColor)
    ) {
      return true;
    }
    if (current === svg) {
      break;
    }
    current = adaptor.parent(current);
  }
  return false;
}

function transformToRoot(node: SvgNode, svg: SvgNode): SvgMatrix {
  let result = IDENTITY_SVG_MATRIX;
  let current: SvgNode | undefined = node;
  while (current !== undefined && current !== svg) {
    result = multiplySvgMatrices(
      parseSvgTransform(stringAttribute(current, "transform")),
      result,
    );
    current = adaptor.parent(current);
  }
  return result;
}

function parseSvgTransform(value: string): SvgMatrix {
  let result = IDENTITY_SVG_MATRIX;
  for (const match of value.matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/gu)) {
    const name = (match[1] ?? "").toLowerCase();
    const values = (match[2] ?? "")
      .trim()
      .split(/[\s,]+/u)
      .filter((part) => part.length > 0)
      .map((part) => Number.parseFloat(part));
    if (values.some((part) => !Number.isFinite(part))) {
      continue;
    }
    const operation = svgTransformOperation(name, values);
    if (operation !== undefined) {
      // SVG transform lists use the written order, represented by
      // post-multiplying each local operation.
      result = multiplySvgMatrices(result, operation);
    }
  }
  return result;
}

function svgTransformOperation(
  name: string,
  values: readonly number[],
): SvgMatrix | undefined {
  if (name === "matrix" && values.length >= 6) {
    return {
      a: values[0]!,
      b: values[1]!,
      c: values[2]!,
      d: values[3]!,
      e: values[4]!,
      f: values[5]!,
    };
  }
  if (name === "translate" && values.length >= 1) {
    return {
      ...IDENTITY_SVG_MATRIX,
      e: values[0]!,
      f: values[1] ?? 0,
    };
  }
  if (name === "scale" && values.length >= 1) {
    return {
      ...IDENTITY_SVG_MATRIX,
      a: values[0]!,
      d: values[1] ?? values[0]!,
    };
  }
  if (name === "rotate" && values.length >= 1) {
    const radians = (values[0]! * Math.PI) / 180;
    const rotation: SvgMatrix = {
      a: Math.cos(radians),
      b: Math.sin(radians),
      c: -Math.sin(radians),
      d: Math.cos(radians),
      e: 0,
      f: 0,
    };
    if (values.length < 3) {
      return rotation;
    }
    const cx = values[1]!;
    const cy = values[2]!;
    return multiplySvgMatrices(
      multiplySvgMatrices(
        { ...IDENTITY_SVG_MATRIX, e: cx, f: cy },
        rotation,
      ),
      { ...IDENTITY_SVG_MATRIX, e: -cx, f: -cy },
    );
  }
  if (name === "skewx" && values.length >= 1) {
    return {
      ...IDENTITY_SVG_MATRIX,
      c: Math.tan((values[0]! * Math.PI) / 180),
    };
  }
  if (name === "skewy" && values.length >= 1) {
    return {
      ...IDENTITY_SVG_MATRIX,
      b: Math.tan((values[0]! * Math.PI) / 180),
    };
  }
  return undefined;
}

function multiplySvgMatrices(left: SvgMatrix, right: SvgMatrix): SvgMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function transformPoint(
  matrix: SvgMatrix,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function stringAttribute(node: SvgNode, name: string): string {
  const value: unknown = adaptor.getAttribute(node, name);
  return typeof value === "string" ? value : "";
}

function finiteAttribute(
  node: SvgNode,
  name: string,
  fallback: number,
): number {
  const value = Number.parseFloat(stringAttribute(node, name));
  return Number.isFinite(value) ? value : fallback;
}

function isMacroOption(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length <= 2_048;
  }
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
    return false;
  }
  return (
    typeof value[0] === "string" &&
    value[0].length <= 2_048 &&
    Number.isInteger(value[1]) &&
    value[1] >= 0 &&
    value[1] <= 9 &&
    (value.length === 2 ||
      (typeof value[2] === "string" && value[2].length <= 2_048))
  );
}

function requestId(value: unknown): number {
  if (typeof value !== "object" || value === null) {
    return -1;
  }
  const id = (value as { readonly id?: unknown }).id;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : -1;
}

function sanitizeSvg(
  source: string,
  requestedForeground: string,
  requestedScale: number,
): { readonly svg: string; readonly widthEm: number; readonly heightEm: number } {
  if (!/^<svg\b/iu.test(source) || !/<\/svg>$/iu.test(source)) {
    throw new Error("MathJax returned malformed SVG.");
  }
  if (
    /<(?:script|foreignObject|iframe|object|embed)\b/iu.test(source) ||
    /\son[a-z]+\s*=/iu.test(source) ||
    /(?:javascript:|data:text\/html|url\s*\()/iu.test(source) ||
    /\b(?:xlink:)?href\s*=\s*["'](?!#)/iu.test(source)
  ) {
    throw new Error("MathJax returned unsafe SVG content.");
  }

  const foreground = /^#[0-9A-Fa-f]{6}$/u.test(requestedForeground)
    ? requestedForeground.toLowerCase()
    : "#202020";
  const scale = Math.max(0.5, Math.min(3, requestedScale));
  const widthEx = readExDimension(source, "width") ?? 8;
  const heightEx = readExDimension(source, "height") ?? 3;
  const widthEm = Math.max(0.5, (widthEx / 2) * scale);
  const heightEm = Math.max(0.5, (heightEx / 2) * scale);

  let svg = source.replaceAll("currentColor", foreground);
  svg = replaceExDimension(svg, "width", widthEx * scale);
  svg = replaceExDimension(svg, "height", heightEx * scale);
  svg = svg.replace(
    /^<svg\b/iu,
    '<svg aria-label="Math preview" shape-rendering="geometricPrecision" ' +
      'text-rendering="geometricPrecision" color-rendering="optimizeQuality"',
  );
  return { svg, widthEm, heightEm };
}

function readExDimension(source: string, attribute: "width" | "height"): number | undefined {
  const match = new RegExp(`\\b${attribute}="([0-9]+(?:\\.[0-9]+)?)ex"`, "iu").exec(source);
  const value = match?.[1] === undefined ? Number.NaN : Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function replaceExDimension(
  source: string,
  attribute: "width" | "height",
  value: number,
): string {
  return source.replace(
    new RegExp(`\\b${attribute}="[0-9]+(?:\\.[0-9]+)?ex"`, "iu"),
    `${attribute}="${roundDimension(value)}ex"`,
  );
}

function roundDimension(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}

function normalizeError(error: unknown): string {
  const structuredMessage =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { readonly message?: unknown }).message === "string"
      ? (error as { readonly message: string }).message
      : undefined;
  const message = error instanceof Error
    ? error.message
    : structuredMessage ?? String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 300) || "MathJax render failed.";
}
