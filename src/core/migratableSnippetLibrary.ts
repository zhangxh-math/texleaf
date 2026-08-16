import { parse, type ParseError, printParseErrorCode } from 'jsonc-parser';

export type MigratableSnippetLibraryValidation =
  | { readonly ok: true; readonly snippetCount: number }
  | { readonly ok: false; readonly reason: string };

const VALID_OPTIONS = new Set(['t', 'm', 'M', 'n', 'A', 'r', 'v', 'w']);
const VALID_REGEX_FLAGS = new Set(['i', 'm', 's', 'u', 'v']);

/**
 * Strictly validate a legacy publisher's on-disk library before it is copied
 * into the new extension ID's global storage. Unknown metadata is preserved,
 * but definitions which the runtime would have to skip are rejected so a bad
 * old file can never become the new canonical library by accident.
 */
export function validateMigratableSnippetLibraryText(
  text: string,
): MigratableSnippetLibraryValidation {
  const parsedRoot = parseJsonc(text, '$');
  if (!parsedRoot.ok) {
    return parsedRoot;
  }
  const root = parsedRoot.value;
  let snippets: readonly unknown[];
  let variables: unknown;

  if (Array.isArray(root)) {
    snippets = root;
  } else if (isRecord(root)) {
    if (
      root.defaultsRevision !== undefined &&
      (!Number.isInteger(root.defaultsRevision) ||
        (root.defaultsRevision as number) < 0)
    ) {
      return invalid('defaultsRevision 必须是非负整数');
    }
    if (root.version !== undefined && root.version !== 1) {
      return invalid('version 必须为 1');
    }

    variables = root.variables ?? root.snippetVariables;
    if (Array.isArray(root.snippets)) {
      snippets = root.snippets;
    } else if (typeof root.snippets === 'string') {
      const nested = parseJsonc(root.snippets, 'snippets');
      if (!nested.ok) {
        return nested;
      }
      if (!Array.isArray(nested.value)) {
        return invalid('snippets 字符串必须包含 JSONC 数组');
      }
      snippets = nested.value;
    } else {
      return invalid('顶层对象必须包含 snippets 数组');
    }
  } else {
    return invalid('顶层必须是片段数组或包含 snippets 的对象');
  }

  if (variables !== undefined) {
    if (!isRecord(variables)) {
      return invalid('variables 必须是字符串值对象');
    }
    for (const [name, value] of Object.entries(variables)) {
      if (typeof value !== 'string') {
        return invalid(`变量 ${JSON.stringify(name)} 的值必须是字符串`);
      }
    }
  }

  const ids = new Set<string>();
  for (let index = 0; index < snippets.length; index += 1) {
    const definition = snippets[index];
    const reason = validateDefinition(definition, index, ids);
    if (reason !== undefined) {
      return invalid(reason);
    }
  }
  return { ok: true, snippetCount: snippets.length };
}

function validateDefinition(
  value: unknown,
  index: number,
  ids: Set<string>,
): string | undefined {
  const path = `snippets[${index}]`;
  if (!isRecord(value)) {
    return `${path} 必须是对象`;
  }
  if (typeof value.trigger !== 'string' || value.trigger.length === 0) {
    return `${path}.trigger 必须是非空字符串`;
  }
  if (typeof value.replacement !== 'string') {
    return `${path}.replacement 必须是字符串`;
  }

  const options = value.options ?? '';
  if (typeof options !== 'string') {
    return `${path}.options 必须是字符串`;
  }
  const unknownOption = [...options].find((option) => !VALID_OPTIONS.has(option));
  if (unknownOption !== undefined) {
    return `${path}.options 包含未知选项 ${JSON.stringify(unknownOption)}`;
  }
  if (options.includes('r') && options.includes('v')) {
    return `${path}.options 不能同时包含 r 和 v`;
  }

  if (value.id !== undefined) {
    if (
      typeof value.id !== 'string' ||
      value.id.length === 0 ||
      value.id !== value.id.trim()
    ) {
      return `${path}.id 必须是不含首尾空白的非空字符串`;
    }
    if (ids.has(value.id)) {
      return `${path}.id 重复：${value.id}`;
    }
    ids.add(value.id);
  }

  if (
    value.priority !== undefined &&
    (typeof value.priority !== 'number' || !Number.isFinite(value.priority))
  ) {
    return `${path}.priority 必须是有限数字`;
  }
  for (const field of ['description', 'category'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      return `${path}.${field} 必须是字符串`;
    }
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    return `${path}.enabled 必须是布尔值`;
  }
  for (const field of ['syntaxVersion', 'version'] as const) {
    if (value[field] !== undefined && value[field] !== 1 && value[field] !== 2) {
      return `${path}.${field} 必须为 1 或 2`;
    }
  }

  if (value.flags !== undefined && typeof value.flags !== 'string') {
    return `${path}.flags 必须是字符串`;
  }
  const flags = typeof value.flags === 'string' ? value.flags : '';
  if (!options.includes('r') && flags.length > 0) {
    return `${path}.flags 只能用于正则触发器`;
  }
  const seenFlags = new Set<string>();
  for (const flag of flags) {
    if (!VALID_REGEX_FLAGS.has(flag) || seenFlags.has(flag)) {
      return `${path}.flags 包含无效或重复标志 ${JSON.stringify(flag)}`;
    }
    seenFlags.add(flag);
  }
  if (options.includes('r')) {
    try {
      const regex = new RegExp(`(?:${value.trigger})(?![\\s\\S])`, flags);
      if (regex.test('')) {
        return `${path}.trigger 正则不能匹配空字符串`;
      }
    } catch (error) {
      return `${path}.trigger 正则无效：${errorMessage(error)}`;
    }
  }
  return undefined;
}

function parseJsonc(
  text: string,
  path: string,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string } {
  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  const firstError = errors[0];
  if (firstError !== undefined) {
    return invalid(
      `${path} JSONC 解析失败：${printParseErrorCode(firstError.error)} at ${firstError.offset}`,
    );
  }
  return { ok: true, value };
}

function invalid(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
