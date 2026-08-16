import { parentPort } from "node:worker_threads";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/cjs/svg.js";
import { mathjax } from "@mathjax/src/cjs/mathjax.js";
import { liteAdaptor } from "@mathjax/src/cjs/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/cjs/handlers/html.js";
import { TeX } from "@mathjax/src/cjs/input/tex.js";
import "@mathjax/src/cjs/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/cjs/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/cjs/input/tex/color/ColorConfiguration.js";
import "@mathjax/src/cjs/input/tex/configmacros/ConfigMacrosConfiguration.js";
import "@mathjax/src/cjs/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/cjs/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/cjs/input/tex/noundefined/NoUndefinedConfiguration.js";
import { SVG } from "@mathjax/src/cjs/output/svg.js";
import type {
  MathPreviewWorkerRequest,
  MathPreviewWorkerResponse,
} from "./mathPreviewProtocol";

const HARD_MAX_SOURCE_LENGTH = 32_768;
const HARD_MAX_MACRO_COUNT = 128;
const HARD_MAX_MACRO_TEXT = 16_384;
const HARD_MAX_SVG_LENGTH = 4_000_000;

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
    const engine = createEngine(request.macros);
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
    };
  } catch (error: unknown) {
    return {
      type: "error",
      id: request.id,
      message: normalizeError(error),
    };
  }
}

function createEngine(macros: MathPreviewWorkerRequest["macros"]): Engine {
  const input = new TeX({
    packages: [
      "base",
      "ams",
      "boldsymbol",
      "color",
      "configmacros",
      "mathtools",
      "newcommand",
      "noundefined",
    ],
    macros,
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
      (name) => !/^[A-Za-z@]+$/u.test(name) || !isMacroOption(macros[name]),
    )
  ) {
    return undefined;
  }
  return candidate as MathPreviewWorkerRequest;
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
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 300) || "MathJax render failed.";
}
