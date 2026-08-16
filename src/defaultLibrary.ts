import { DEFAULT_SNIPPETS } from "./defaultSnippets";

/**
 * Revision of the factory library layout that is materialized into the user's
 * editable global JSONC file.  This is deliberately independent of the
 * extension version: once a file carries this revision, missing factory items
 * are treated as intentional user deletions and are not silently recreated.
 */
export const FACTORY_DEFAULTS_REVISION = 3;

/** Stable identities of the theorem-style defaults introduced in revision 2. */
export const THEOREM_ENVIRONMENT_FACTORY_SNIPPET_IDS = Object.freeze([
  "environment.axiom",
  "environment.definition",
  "environment.lemma",
  "environment.proposition",
  "environment.theorem",
  "environment.corollary",
  "environment.claim",
  "environment.assumption",
  "environment.example",
  "environment.exercise",
  "environment.conjecture",
  "environment.hypothesis",
  "environment.remark",
] as const);

const THEOREM_ENVIRONMENT_FACTORY_SNIPPET_ID_SET = new Set<string>(
  THEOREM_ENVIRONMENT_FACTORY_SNIPPET_IDS,
);

const REVISION_TWO_THEOREM_TRIGGERS: Readonly<Record<string, string>> =
  Object.freeze({
    "environment.axiom": "axm",
    "environment.definition": "def",
    "environment.lemma": "lem",
    "environment.proposition": "prp",
    "environment.theorem": "thm",
    "environment.corollary": "cor",
    "environment.claim": "clm",
    "environment.assumption": "asm",
    "environment.example": "exm",
    "environment.exercise": "exr",
    "environment.conjecture": "cnj",
    "environment.hypothesis": "hyp",
    "environment.remark": "rmk",
  });

/**
 * Upgrade one untouched revision-2 theorem record to its revision-3 automatic
 * command trigger. The exact-key comparison is intentional: an extra field,
 * including `enabled`, means the user owns that record and it must be left
 * byte-for-byte unchanged by the repository migration.
 */
export function upgradeRevisionTwoTheoremFactorySnippet(
  candidate: unknown,
  library: readonly unknown[] = [candidate],
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(candidate) || typeof candidate.id !== "string") {
    return undefined;
  }
  if (!THEOREM_ENVIRONMENT_FACTORY_SNIPPET_ID_SET.has(candidate.id)) {
    return undefined;
  }

  const currentFactoryRecord = DEFAULT_SNIPPETS.find(
    (snippet) => snippet.id === candidate.id,
  );
  if (
    currentFactoryRecord === undefined ||
    !currentFactoryRecord.trigger.startsWith("\\") ||
    currentFactoryRecord.options !== "tAw"
  ) {
    return undefined;
  }

  const revisionTwoFactoryRecord: Readonly<Record<string, unknown>> = {
    ...currentFactoryRecord,
    trigger: REVISION_TWO_THEOREM_TRIGGERS[candidate.id],
    options: "tw",
  };
  if (!recordsAreExactlyEqual(candidate, revisionTwoFactoryRecord)) {
    return undefined;
  }
  if (
    library.some(
      (other) =>
        isRecord(other) &&
        other.id !== candidate.id &&
        rawSnippetTriggerOccupiesLiteral(other, currentFactoryRecord.trigger),
    )
  ) {
    return undefined;
  }
  return { ...currentFactoryRecord };
}

function rawSnippetTriggerOccupiesLiteral(
  snippet: Readonly<Record<string, unknown>>,
  target: string,
): boolean {
  if (typeof snippet.trigger === "string") {
    if (typeof snippet.options !== "string" || !snippet.options.includes("r")) {
      return snippet.trigger === target;
    }
    return regexSourceMatchesLiteral(snippet.trigger, "", target);
  }
  if (!isRecord(snippet.trigger) || typeof snippet.trigger.source !== "string") {
    return false;
  }
  const flags =
    typeof snippet.trigger.flags === "string" ? snippet.trigger.flags : "";
  return regexSourceMatchesLiteral(snippet.trigger.source, flags, target);
}

function regexSourceMatchesLiteral(
  source: string,
  flags: string,
  target: string,
): boolean {
  try {
    const safeFlags = [...flags]
      .filter((flag) => flag !== "g" && flag !== "y")
      .join("");
    return new RegExp(`^(?:${source})$`, safeFlags).test(target);
  } catch {
    return false;
  }
}

function recordsAreExactlyEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]),
    )
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
