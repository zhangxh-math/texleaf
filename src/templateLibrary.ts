export const TEMPLATE_LIBRARY_STATE_KEY = "texleaf.templateLibrary.v1";
/**
 * One-time, synchronisable acknowledgement for the 1.0 article trigger rename.
 * Keeping this outside the catalog preserves schema-v1 compatibility with old
 * TeXLeaf versions while ensuring a user who later chooses a legacy trigger is
 * not repeatedly migrated on every activation.
 */
export const ARTICLE_TEMPLATE_TRIGGER_MIGRATION_STATE_KEY =
  "texleaf.templateTriggerMigration.articleNames.v1";

export const TEMPLATE_LIBRARY_SCHEMA_VERSION = 1;
export const MAX_MANAGED_TEMPLATES = 128;
export const MAX_TEMPLATE_NAME_LENGTH = 128;
export const MAX_TEMPLATE_TRIGGER_LENGTH = 80;
export const MAX_TEMPLATE_DESCRIPTION_LENGTH = 2_048;
export const MAX_TEMPLATE_CONTENT_BYTES = 192 * 1024;
export const MAX_TEMPLATE_LIBRARY_BYTES = 256 * 1024;

const REVISION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface ManagedTemplate {
  readonly id: string;
  readonly name: string;
  readonly trigger: string;
  readonly description: string;
  readonly content: string;
  readonly isFactory: boolean;
}

export interface ManagedTemplateCatalog {
  readonly revision: string;
  readonly templates: readonly ManagedTemplate[];
}

export interface ManagedTemplateInput {
  readonly name: string;
  readonly trigger: string;
  readonly description?: string;
  readonly content: string;
}

export type DecodedTemplateCatalog =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly reason: string }
  | { readonly kind: "valid"; readonly catalog: ManagedTemplateCatalog };

interface StoredTemplateCatalog {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly templates: readonly ManagedTemplate[];
}

/**
 * Validate and defensively clone a catalog before it reaches globalState or
 * the expansion runtime. The supplied factory IDs are authoritative: a
 * Webview or synchronised value cannot grant factory status to an arbitrary
 * custom record.
 */
export function createManagedTemplateCatalog(
  templates: readonly ManagedTemplate[],
  revision: string,
  factoryIds: ReadonlySet<string>,
): ManagedTemplateCatalog {
  if (!REVISION_PATTERN.test(revision)) {
    throw new Error("模板目录的 revision 无效；请重新加载后再试。");
  }
  if (!Array.isArray(templates)) {
    throw new Error("模板目录必须是数组。");
  }
  if (templates.length > MAX_MANAGED_TEMPLATES) {
    throw new Error(`模板数量不能超过 ${MAX_MANAGED_TEMPLATES} 个。`);
  }

  const ids = new Set<string>();
  const triggers = new Set<string>();
  const normalized = templates.map((template, index) => {
    const value = normalizeManagedTemplate(template, factoryIds, index);
    if (ids.has(value.id)) {
      throw new Error(`模板 ID 重复：${value.id}。`);
    }
    if (triggers.has(value.trigger)) {
      throw new Error(`模板 trigger 重复：${value.trigger}。`);
    }
    ids.add(value.id);
    triggers.add(value.trigger);
    return Object.freeze(value);
  });
  const orderedTriggers = [...triggers].sort(
    (left, right) => left.length - right.length,
  );
  for (let index = 0; index < orderedTriggers.length; index += 1) {
    const shorter = orderedTriggers[index]!;
    for (let candidate = index + 1; candidate < orderedTriggers.length; candidate += 1) {
      const longer = orderedTriggers[candidate]!;
      if (longer.startsWith(shorter)) {
        throw new Error(
          `模板 trigger 前缀冲突：${JSON.stringify(shorter)} 会在 ${JSON.stringify(longer)} 输入完成前提前展开。`,
        );
      }
    }
  }

  const catalog = Object.freeze({
    revision,
    templates: Object.freeze(normalized),
  });
  assertCatalogPayloadSize(catalog);
  return catalog;
}

export function decodeManagedTemplateCatalog(
  value: unknown,
  factoryIds: ReadonlySet<string>,
): DecodedTemplateCatalog {
  if (value === undefined) {
    return { kind: "none" };
  }
  if (!isRecord(value) || value.schemaVersion !== TEMPLATE_LIBRARY_SCHEMA_VERSION) {
    return { kind: "invalid", reason: "模板目录的版本或结构无效" };
  }
  if (typeof value.revision !== "string" || !Array.isArray(value.templates)) {
    return { kind: "invalid", reason: "模板目录缺少 revision 或 templates 数组" };
  }
  try {
    const templates = value.templates.map((candidate, index) => {
      if (!isRecord(candidate)) {
        throw new Error(`第 ${index + 1} 个模板不是对象。`);
      }
      return {
        id: candidate.id,
        name: candidate.name,
        trigger: candidate.trigger,
        description: candidate.description,
        content: candidate.content,
        isFactory: candidate.isFactory,
      } as unknown as ManagedTemplate;
    });
    return {
      kind: "valid",
      catalog: createManagedTemplateCatalog(
        templates,
        value.revision,
        factoryIds,
      ),
    };
  } catch (error) {
    return {
      kind: "invalid",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function toStoredTemplateCatalog(
  catalog: ManagedTemplateCatalog,
): Readonly<StoredTemplateCatalog> {
  return {
    schemaVersion: TEMPLATE_LIBRARY_SCHEMA_VERSION,
    revision: catalog.revision,
    templates: catalog.templates.map((template) => ({ ...template })),
  };
}

export function templateCatalogByteLength(
  catalog: ManagedTemplateCatalog,
): number {
  return new TextEncoder().encode(
    JSON.stringify(toStoredTemplateCatalog(catalog)),
  ).byteLength;
}

function normalizeManagedTemplate(
  candidate: ManagedTemplate,
  factoryIds: ReadonlySet<string>,
  index: number,
): ManagedTemplate {
  const prefix = `第 ${index + 1} 个模板`;
  if (typeof candidate.id !== "string" || !ID_PATTERN.test(candidate.id)) {
    throw new Error(`${prefix}的 ID 无效。`);
  }
  const name = normalizeShortText(candidate.name, "名称", prefix, {
    maximumLength: MAX_TEMPLATE_NAME_LENGTH,
    allowEmpty: false,
  });
  const trigger = normalizeTrigger(candidate.trigger, prefix);
  const description = normalizeShortText(
    candidate.description,
    "说明",
    prefix,
    {
      maximumLength: MAX_TEMPLATE_DESCRIPTION_LENGTH,
      allowEmpty: true,
    },
  );
  if (typeof candidate.content !== "string") {
    throw new Error(`${prefix}的内容必须是字符串。`);
  }
  if (candidate.content.includes("\0")) {
    throw new Error(`${prefix}的内容不能包含 NUL 字符。`);
  }
  const contentBytes = new TextEncoder().encode(candidate.content).byteLength;
  if (contentBytes > MAX_TEMPLATE_CONTENT_BYTES) {
    throw new Error(
      `${prefix}的内容超过 ${Math.floor(MAX_TEMPLATE_CONTENT_BYTES / 1024)} KiB 上限。`,
    );
  }

  return {
    id: candidate.id,
    name,
    trigger,
    description,
    content: candidate.content,
    isFactory: factoryIds.has(candidate.id),
  };
}

function normalizeTrigger(value: unknown, prefix: string): string {
  if (typeof value !== "string") {
    throw new Error(`${prefix}的 trigger 必须是字符串。`);
  }
  if (value.length === 0 || value.length > MAX_TEMPLATE_TRIGGER_LENGTH) {
    throw new Error(
      `${prefix}的 trigger 长度必须为 1–${MAX_TEMPLATE_TRIGGER_LENGTH} 个字符。`,
    );
  }
  if (/\s|[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${prefix}的 trigger 不能包含空白或控制字符。`);
  }
  return value;
}

function normalizeShortText(
  value: unknown,
  label: string,
  prefix: string,
  options: { readonly maximumLength: number; readonly allowEmpty: boolean },
): string {
  if (typeof value !== "string") {
    throw new Error(`${prefix}的${label}必须是字符串。`);
  }
  const normalized = value.trim();
  if (!options.allowEmpty && normalized.length === 0) {
    throw new Error(`${prefix}的${label}不能为空。`);
  }
  if (normalized.length > options.maximumLength) {
    throw new Error(
      `${prefix}的${label}不能超过 ${options.maximumLength} 个字符。`,
    );
  }
  if (normalized.includes("\0")) {
    throw new Error(`${prefix}的${label}不能包含 NUL 字符。`);
  }
  return normalized;
}

function assertCatalogPayloadSize(catalog: ManagedTemplateCatalog): void {
  const bytes = templateCatalogByteLength(catalog);
  if (bytes > MAX_TEMPLATE_LIBRARY_BYTES) {
    throw new Error(
      `模板目录序列化后超过 ${Math.floor(MAX_TEMPLATE_LIBRARY_BYTES / 1024)} KiB 上限，无法安全保存或同步。`,
    );
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
