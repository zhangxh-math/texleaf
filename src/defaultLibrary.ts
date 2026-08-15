import { DEFAULT_SNIPPETS } from "./defaultSnippets";

/**
 * Revision of the factory library layout that is materialized into the user's
 * editable global JSONC file.  This is deliberately independent of the
 * extension version: once a file carries this revision, missing factory items
 * are treated as intentional user deletions and are not silently recreated.
 */
export const FACTORY_DEFAULTS_REVISION = 1;

export const DEFAULT_VARIABLES: Readonly<Record<string, string>> = Object.freeze({
  GREEK:
    "alpha|beta|gamma|Gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|vartheta|Theta|iota|kappa|lambda|Lambda|mu|nu|xi|Xi|omicron|pi|Pi|rho|varrho|sigma|Sigma|tau|upsilon|Upsilon|phi|varphi|Phi|chi|psi|Psi|omega|Omega",
  SYMBOL:
    "parallel|perp|partial|nabla|hbar|ell|infty|oplus|ominus|otimes|oslash|square|star|dagger|vee|wedge|subseteq|subset|supseteq|supset|emptyset|exists|nexists|forall|implies|impliedby|iff|setminus|neg|lor|land|bigcup|bigcap|cdot|times|simeq|approx",
  MORE_SYMBOLS:
    "leq|geq|neq|gg|ll|equiv|sim|propto|rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|to|mapsto|cap|cup|in|sum|prod|exp|ln|log|det|dots|vdots|ddots|pm|mp|int|iint|iiint|oint",
});

export interface FactorySnippetLibrary {
  readonly version: 1;
  readonly defaultsRevision: number;
  readonly variables: Readonly<Record<string, string>>;
  readonly snippets: readonly Readonly<Record<string, unknown>>[];
}

/** Return a fresh, serializable copy so callers can never mutate the source. */
export function createDefaultSnippetLibrary(): FactorySnippetLibrary {
  return {
    version: 1,
    defaultsRevision: FACTORY_DEFAULTS_REVISION,
    variables: { ...DEFAULT_VARIABLES },
    snippets: DEFAULT_SNIPPETS.map((snippet) => ({ ...snippet })),
  };
}

/**
 * The one canonical representation used for first install and Restore
 * Defaults.  The file is JSONC (plain JSON is a valid subset) and therefore
 * remains fully editable with VS Code's JSON language service.
 */
export function serializeDefaultSnippetLibrary(): string {
  return `${JSON.stringify(createDefaultSnippetLibrary(), null, 2)}\n`;
}
