import {
  ParsedSnippetOptions,
  RegexTriggerDescriptor,
  SnippetDefinitionInput,
  SnippetFileInput,
  SnippetSyntaxVersion,
  ValidatedSnippetDefinition,
  ValidatedSnippetFile,
  ValidationIssue,
  ValidationResult,
} from './types';

const VALID_OPTIONS = new Set(['t', 'm', 'M', 'n', 'A', 'r', 'v', 'w']);
const VALID_REGEX_FLAGS = new Set(['i', 'm', 's', 'u', 'v']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(
  issues: ValidationIssue[],
  path: string,
  code: ValidationIssue['code'],
  message: string,
): void {
  issues.push({ path, code, message });
}

export function parseSnippetOptions(raw = ''): ParsedSnippetOptions {
  const chars = new Set(raw);
  return {
    raw,
    automatic: chars.has('A'),
    regex: chars.has('r'),
    visual: chars.has('v'),
    wordBoundary: chars.has('w'),
    textMode: chars.has('t'),
    anyMathMode: chars.has('m'),
    blockMathMode: chars.has('M'),
    inlineMathMode: chars.has('n'),
  };
}

function validateOptions(raw: unknown, path: string, issues: ValidationIssue[]): ParsedSnippetOptions {
  if (raw === undefined) {
    return parseSnippetOptions('');
  }
  if (typeof raw !== 'string') {
    issue(issues, path, 'invalid-type', 'options must be a string');
    return parseSnippetOptions('');
  }
  for (const option of raw) {
    if (!VALID_OPTIONS.has(option)) {
      issue(issues, path, 'invalid-option', `unsupported snippet option: ${option}`);
    }
  }
  const parsed = parseSnippetOptions(raw);
  if (parsed.regex && parsed.visual) {
    issue(issues, path, 'conflicting-options', 'regex and visual options are mutually exclusive');
  }
  return parsed;
}

function normalizeRegexFlags(raw: unknown, path: string, issues: ValidationIssue[]): string {
  if (raw === undefined) {
    return '';
  }
  if (typeof raw !== 'string') {
    issue(issues, path, 'invalid-type', 'regex flags must be a string');
    return '';
  }
  const seen = new Set<string>();
  let flags = '';
  for (const flag of raw) {
    if (!VALID_REGEX_FLAGS.has(flag)) {
      issue(issues, path, 'invalid-regex-flag', `unsupported regex flag: ${flag}`);
      continue;
    }
    if (seen.has(flag)) {
      issue(issues, path, 'invalid-regex-flag', `duplicate regex flag: ${flag}`);
      continue;
    }
    seen.add(flag);
    flags += flag;
  }
  return flags;
}

function validateRegex(
  source: string,
  flags: string,
  path: string,
  issues: ValidationIssue[],
): boolean {
  try {
    const regex = new RegExp(`(?:${source})(?![\\s\\S])`, flags);
    // Empty matches create recursive auto-expansion and ambiguous manual matches.
    if (regex.test('')) {
      issue(issues, path, 'empty-regex-match', 'regex triggers must not match an empty string');
      return false;
    }
    return true;
  } catch (error) {
    issue(
      issues,
      path,
      'invalid-regex',
      `invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function validateTrigger(
  raw: unknown,
  flagsField: unknown,
  options: ParsedSnippetOptions,
  path: string,
  issues: ValidationIssue[],
): string | RegexTriggerDescriptor | undefined {
  if (typeof raw === 'string') {
    if (raw.length === 0) {
      issue(issues, path, 'empty-trigger', 'trigger must not be empty');
      return undefined;
    }
    if (!options.regex) {
      if (flagsField !== undefined) {
        issue(issues, `${path.replace(/\.trigger$/, '')}.flags`, 'invalid-regex-flag', 'flags require a regex trigger');
      }
      return raw;
    }
    const flags = normalizeRegexFlags(flagsField, `${path.replace(/\.trigger$/, '')}.flags`, issues);
    return validateRegex(raw, flags, path, issues)
      ? { kind: 'regex', source: raw, flags }
      : undefined;
  }

  if (raw instanceof RegExp) {
    const flags = normalizeRegexFlags(raw.flags, `${path}.flags`, issues);
    return validateRegex(raw.source, flags, path, issues)
      ? { kind: 'regex', source: raw.source, flags }
      : undefined;
  }

  if (isRecord(raw) && raw.kind === 'regex') {
    if (typeof raw.source !== 'string' || raw.source.length === 0) {
      issue(issues, `${path}.source`, 'empty-trigger', 'regex source must be a non-empty string');
      return undefined;
    }
    const flags = normalizeRegexFlags(raw.flags ?? flagsField, `${path}.flags`, issues);
    return validateRegex(raw.source, flags, path, issues)
      ? { kind: 'regex', source: raw.source, flags }
      : undefined;
  }

  issue(issues, path, 'invalid-type', 'trigger must be a string, RegExp, or regex descriptor');
  return undefined;
}

function validateDefinition(
  raw: unknown,
  index: number,
  sourceId: string,
  issues: ValidationIssue[],
): ValidatedSnippetDefinition | undefined {
  const path = `snippets[${index}]`;
  if (!isRecord(raw)) {
    issue(issues, path, 'invalid-type', 'snippet must be an object');
    return undefined;
  }

  if (!Object.prototype.hasOwnProperty.call(raw, 'trigger')) {
    issue(issues, `${path}.trigger`, 'missing-property', 'trigger is required');
  }
  if (!Object.prototype.hasOwnProperty.call(raw, 'replacement')) {
    issue(issues, `${path}.replacement`, 'missing-property', 'replacement is required');
  }

  const options = validateOptions(raw.options, `${path}.options`, issues);
  const trigger = validateTrigger(raw.trigger, raw.flags, options, `${path}.trigger`, issues);

  if (typeof raw.replacement === 'function') {
    issue(
      issues,
      `${path}.replacement`,
      'unsupported-function',
      'function replacements are intentionally unsupported because they execute arbitrary code',
    );
  } else if (typeof raw.replacement !== 'string') {
    issue(issues, `${path}.replacement`, 'invalid-type', 'replacement must be a string');
  }

  const priority = raw.priority === undefined ? 0 : raw.priority;
  if (typeof priority !== 'number' || !Number.isFinite(priority)) {
    issue(issues, `${path}.priority`, 'invalid-type', 'priority must be a finite number');
  }

  const version = raw.version === undefined ? 2 : raw.version;
  if (version !== 1 && version !== 2) {
    issue(issues, `${path}.version`, 'invalid-type', 'version must be 1 or 2');
  }

  if (raw.description !== undefined && typeof raw.description !== 'string') {
    issue(issues, `${path}.description`, 'invalid-type', 'description must be a string');
  }
  if (raw.id !== undefined && (typeof raw.id !== 'string' || raw.id.length === 0)) {
    issue(issues, `${path}.id`, 'invalid-type', 'id must be a non-empty string');
  }
  if (raw.disabled !== undefined && typeof raw.disabled !== 'boolean') {
    issue(issues, `${path}.disabled`, 'invalid-type', 'disabled must be a boolean');
  }

  if (
    trigger === undefined ||
    typeof raw.replacement !== 'string' ||
    typeof priority !== 'number' ||
    !Number.isFinite(priority) ||
    (version !== 1 && version !== 2)
  ) {
    return undefined;
  }

  // RegExp values imply the r option. A descriptor remains regex even when the
  // legacy options string omitted r.
  const normalizedOptions =
    typeof trigger === 'object' && !options.regex
      ? { ...options, raw: `${options.raw}r`, regex: true }
      : options;

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `${sourceId}:${index}`,
    trigger,
    replacement: raw.replacement,
    options: normalizedOptions,
    priority,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    version: version as SnippetSyntaxVersion,
    disabled: raw.disabled === true,
    order: index,
  };
}

export interface ValidateSnippetFileOptions {
  readonly sourceId?: string;
}

/**
 * Validate either the native object shape or a legacy top-level snippet array.
 * Invalid entries are omitted from value.snippets and reported in issues.
 */
export function validateSnippetFile(
  input: unknown,
  options: ValidateSnippetFileOptions = {},
): ValidationResult<ValidatedSnippetFile> {
  const issues: ValidationIssue[] = [];
  const sourceId = options.sourceId ?? 'snippet';

  let rawSnippets: readonly unknown[] = [];
  let rawVariables: unknown = undefined;
  let schemaVersion: unknown = 1;

  if (Array.isArray(input)) {
    rawSnippets = input;
  } else if (isRecord(input)) {
    schemaVersion = input.schemaVersion ?? 1;
    rawVariables = input.variables;
    if (Array.isArray(input.snippets)) {
      rawSnippets = input.snippets;
    } else {
      issue(issues, 'snippets', 'missing-property', 'snippets must be an array');
    }
  } else {
    issue(issues, '$', 'invalid-type', 'snippet file must be an object or an array');
  }

  if (schemaVersion !== 1) {
    issue(issues, 'schemaVersion', 'invalid-schema-version', 'only schemaVersion 1 is supported');
  }

  const variables: Record<string, string> = {};
  if (rawVariables !== undefined) {
    if (!isRecord(rawVariables)) {
      issue(issues, 'variables', 'invalid-type', 'variables must be an object of strings');
    } else {
      for (const [name, value] of Object.entries(rawVariables)) {
        if (typeof value !== 'string') {
          issue(issues, `variables.${name}`, 'invalid-type', 'snippet variable values must be strings');
        } else {
          variables[name] = value;
        }
      }
    }
  }

  const snippets: ValidatedSnippetDefinition[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < rawSnippets.length; index += 1) {
    const definition = validateDefinition(rawSnippets[index], index, sourceId, issues);
    if (definition === undefined) {
      continue;
    }
    if (ids.has(definition.id)) {
      issue(issues, `snippets[${index}].id`, 'duplicate-id', `duplicate snippet id: ${definition.id}`);
      continue;
    }
    ids.add(definition.id);
    snippets.push(definition);
  }

  return {
    ok: issues.length === 0,
    value: {
      schemaVersion: 1,
      variables,
      snippets,
    },
    issues,
  };
}

/** A typed convenience for callers that already have the input interface. */
export function validateTypedSnippetFile(
  input: SnippetFileInput | readonly SnippetDefinitionInput[],
  options?: ValidateSnippetFileOptions,
): ValidationResult<ValidatedSnippetFile> {
  return validateSnippetFile(input, options);
}
