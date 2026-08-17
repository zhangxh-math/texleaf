import type { TemplateDefinition } from "./defaultTemplates";
import type {
  ManagedTemplate,
  ManagedTemplateCatalog,
} from "./templateLibrary";

export interface TemplateTriggerMigrationLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface TemplateTriggerMigrationDependencies {
  readonly isAcknowledged: () => boolean;
  readonly acknowledge: () => PromiseLike<void>;
  readonly createCatalog: (
    templates: readonly ManagedTemplate[],
  ) => ManagedTemplateCatalog;
  readonly commitCatalog: (
    next: ManagedTemplateCatalog,
    previous: ManagedTemplateCatalog,
  ) => PromiseLike<void>;
  readonly readLatestCatalog: () => ManagedTemplateCatalog | undefined;
  readonly logger: TemplateTriggerMigrationLogger;
}

/**
 * Rename legacy factory-template triggers exactly once for a synced profile.
 *
 * The acknowledgement deliberately precedes the catalog write. If backup,
 * compare-and-swap, or persistence later fails, a subsequent activation must
 * not repeatedly rewrite a trigger that the user may have chosen meanwhile.
 */
export async function migrateLegacyFactoryTemplateTriggers(
  catalog: ManagedTemplateCatalog,
  factoryDefinitions: readonly TemplateDefinition[],
  dependencies: TemplateTriggerMigrationDependencies,
): Promise<ManagedTemplateCatalog> {
  if (dependencies.isAcknowledged()) {
    return catalog;
  }

  const factories = new Map(
    factoryDefinitions.map((definition) => [definition.id, definition]),
  );
  const usedTriggers = new Set(catalog.templates.map(({ trigger }) => trigger));
  let migratedCount = 0;
  const templates = catalog.templates.map((template) => {
    const factory = template.isFactory ? factories.get(template.id) : undefined;
    if (
      factory === undefined ||
      factory.legacyTriggers?.includes(template.trigger) !== true
    ) {
      return template;
    }

    const conflicts = catalog.templates.some(
      (other) =>
        other.id !== template.id &&
        (factory.trigger.startsWith(other.trigger) ||
          other.trigger.startsWith(factory.trigger)),
    );
    if (
      conflicts ||
      (usedTriggers.has(factory.trigger) && factory.trigger !== template.trigger)
    ) {
      dependencies.logger.warn(
        `默认模板 trigger “${template.trigger}” 未迁移为“${factory.trigger}”：新 trigger 已被其他模板使用。`,
      );
      return template;
    }

    usedTriggers.delete(template.trigger);
    usedTriggers.add(factory.trigger);
    migratedCount += 1;
    return { ...template, trigger: factory.trigger };
  });

  if (migratedCount === 0) {
    try {
      await dependencies.acknowledge();
    } catch (error) {
      dependencies.logger.warn(
        `无法记录 article 模板 trigger 迁移状态；本次保留现有目录：${errorMessage(error)}`,
      );
    }
    return catalog;
  }

  try {
    await dependencies.acknowledge();
  } catch (error) {
    dependencies.logger.warn(
      `无法记录 article 模板 trigger 的一次性迁移状态；为避免反复覆盖，本次保留旧 trigger：${errorMessage(error)}`,
    );
    return catalog;
  }

  try {
    // Construction can fail at the strict payload boundary because the new
    // names are longer. It belongs to the same best-effort transaction as the
    // verified backup and compare-and-swap commit.
    const migrated = dependencies.createCatalog(templates);
    await dependencies.commitCatalog(migrated, catalog);
    dependencies.logger.info(
      `已一次性迁移 ${migratedCount} 个旧出厂 article 模板 trigger。`,
    );
    return migrated;
  } catch (error) {
    dependencies.logger.warn(
      `article 模板 trigger 自动迁移未提交；继续使用现有模板目录：${errorMessage(error)}`,
    );
    return dependencies.readLatestCatalog() ?? catalog;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
