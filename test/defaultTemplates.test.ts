import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  materializeReplacement,
  parseReplacementTemplate,
  replacementPartsToText,
} from "../src/core";
import { DEFAULT_TEMPLATES } from "../src/defaultTemplates";
import {
  registerSnippetSyncGlobalStateKeys,
  SNIPPET_SYNC_GLOBAL_STATE_KEYS,
  SNIPPET_SYNC_METADATA_KEY,
  SNIPPET_SYNC_STATE_KEY,
} from "../src/snippetSync";
import {
  ARTICLE_TEMPLATE_TRIGGER_MIGRATION_STATE_KEY,
  createManagedTemplateCatalog,
  decodeManagedTemplateCatalog,
  MAX_TEMPLATE_CONTENT_BYTES,
  TEMPLATE_LIBRARY_STATE_KEY,
  toStoredTemplateCatalog,
  type ManagedTemplate,
  type ManagedTemplateCatalog,
} from "../src/templateLibrary";
import {
  migrateLegacyFactoryTemplateTriggers,
  type TemplateTriggerMigrationDependencies,
} from "../src/templateTriggerMigration";

const templateRoot = path.join(process.cwd(), "templates");
const theoremEnvironments = [
  "axiom",
  "definition",
  "lemma",
  "proposition",
  "theorem",
  "corollary",
  "claim",
  "assumption",
  "example",
  "exercise",
  "conjecture",
  "hypothesis",
  "remark",
] as const;
const beamerBuiltinEnvironments = new Set([
  "theorem",
  "corollary",
  "lemma",
  "definition",
  "example",
]);
const beamerCustomTitles: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "beamer-cn.tex": {
    axiom: "公理",
    proposition: "命题",
    claim: "断言",
    assumption: "假定",
    exercise: "练习",
    conjecture: "猜想",
    hypothesis: "假设",
    remark: "注",
  },
  "beamer-en.tex": {
    axiom: "Axiom",
    proposition: "Proposition",
    claim: "Claim",
    assumption: "Assumption",
    exercise: "Exercise",
    conjecture: "Conjecture",
    hypothesis: "Hypothesis",
    remark: "Remark",
  },
};
const factoryTemplateIds = new Set(DEFAULT_TEMPLATES.map(({ id }) => id));

interface MigrationHarnessOptions {
  readonly acknowledged?: boolean;
  readonly acknowledgeError?: Error;
  readonly createError?: Error;
  readonly commitError?: Error;
  readonly latestCatalog?: ManagedTemplateCatalog;
  readonly useNextAsLatestBeforeCommitError?: boolean;
}

function createTemplateCatalogFixture(
  triggerOverrides: Readonly<Record<string, string>>,
  userTemplates: readonly ManagedTemplate[] = [],
  revision = "legacy-revision",
): ManagedTemplateCatalog {
  return createManagedTemplateCatalog(
    [
      ...DEFAULT_TEMPLATES.map((definition) => ({
        id: definition.id,
        name: definition.label,
        trigger: triggerOverrides[definition.id] ?? definition.trigger,
        description: definition.description,
        content: "\\documentclass{article}\n@0",
        isFactory: true,
      })),
      ...userTemplates,
    ],
    revision,
    factoryTemplateIds,
  );
}

function createMigrationHarness(
  initialCatalog: ManagedTemplateCatalog,
  options: MigrationHarnessOptions = {},
): {
  readonly dependencies: TemplateTriggerMigrationDependencies;
  readonly state: {
    acknowledged: boolean;
    acknowledgeCalls: number;
    createCalls: number;
    commitCalls: number;
    latestCatalog: ManagedTemplateCatalog;
    readonly events: string[];
    readonly infos: string[];
    readonly warnings: string[];
  };
} {
  const state = {
    acknowledged: options.acknowledged ?? false,
    acknowledgeCalls: 0,
    createCalls: 0,
    commitCalls: 0,
    latestCatalog: options.latestCatalog ?? initialCatalog,
    events: [] as string[],
    infos: [] as string[],
    warnings: [] as string[],
  };
  return {
    state,
    dependencies: {
      isAcknowledged: () => state.acknowledged,
      acknowledge: async () => {
        state.acknowledgeCalls += 1;
        state.events.push("acknowledge");
        if (options.acknowledgeError !== undefined) {
          throw options.acknowledgeError;
        }
        state.acknowledged = true;
      },
      createCatalog: (templates) => {
        state.createCalls += 1;
        state.events.push("create");
        if (options.createError !== undefined) {
          throw options.createError;
        }
        return createManagedTemplateCatalog(
          templates,
          "migrated-revision",
          factoryTemplateIds,
        );
      },
      commitCatalog: async (next, previous) => {
        state.commitCalls += 1;
        state.events.push("commit");
        assert.equal(previous, initialCatalog);
        if (options.commitError !== undefined) {
          if (options.useNextAsLatestBeforeCommitError === true) {
            state.latestCatalog = next;
          }
          throw options.commitError;
        }
        state.latestCatalog = next;
      },
      readLatestCatalog: () => state.latestCatalog,
      logger: {
        info: (message) => state.infos.push(message),
        warn: (message) => state.warnings.push(message),
      },
    },
  };
}

test("factory templates are independent, unique, and free of personal data", () => {
  assert.deepEqual(
    DEFAULT_TEMPLATES.map(({ trigger }) => trigger).sort(),
    ["article-cn", "article-en", "beamer-cn", "beamer-en"],
  );
  assert.deepEqual(
    DEFAULT_TEMPLATES
      .filter(({ legacyTriggers }) => legacyTriggers !== undefined)
      .map(({ id, legacyTriggers }) => [id, legacyTriggers]),
    [
      ["template.article-cn", ["tmpa-cn"]],
      ["template.article-en", ["tmpa-en"]],
    ],
  );
  assert.equal(
    new Set(DEFAULT_TEMPLATES.map(({ id }) => id)).size,
    DEFAULT_TEMPLATES.length,
  );
  assert.equal(
    new Set(DEFAULT_TEMPLATES.map(({ fileName }) => fileName)).size,
    DEFAULT_TEMPLATES.length,
  );

  const forbidden = [
    /Xuhui Zhang/iu,
    /张旭辉/u,
    /zhangxh\.math@gmail\.com/iu,
    /Jian Zhou/iu,
    /jianzhou@mail\.tsinghua\.edu\.cn/iu,
    /Tsinghua University/iu,
    /清华大学/u,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    /\\documentclass\[[^\]]*draft/iu,
    /\\usepackage\{showkeys\}/u,
    /\\usepackage(?:\[[^\]]*\])?\{subfigure\}/u,
  ];
  for (const definition of DEFAULT_TEMPLATES) {
    const text = readFileSync(
      path.join(templateRoot, definition.fileName),
      "utf8",
    );
    assert.ok(text.length > 100, definition.fileName);
    assert.ok(Buffer.byteLength(text, "utf8") < 512 * 1024);
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, definition.fileName);
    }

    const parts = materializeReplacement(parseReplacementTemplate(text, 2));
    assert.ok(parts.some((part) => part.kind === "tabstop"));
    assert.match(replacementPartsToText(parts), /\\begin\{document\}/u);
    assert.match(replacementPartsToText(parts), /\\end\{document\}/u);
  }
});

test("article templates define every imported theorem-style environment", () => {
  for (const fileName of ["article-cn.tex", "article-en.tex"]) {
    const text = readFileSync(path.join(templateRoot, fileName), "utf8");
    for (const environment of theoremEnvironments) {
      assert.match(
        text,
        new RegExp(`\\\\newtheorem\\{${environment}\\}`, "u"),
        `${fileName}: ${environment}`,
      );
    }
    assert.match(text, /\\bibliographystyle\{alpha\}/u);
    assert.match(text, /\\bibliography\{reference\}/u);
    assert.match(text, /\\usepackage\[[^\]]+\]\{geometry\}/u);
  }
});

test("factory templates never default a BibTeX bibliography to plain", () => {
  for (const definition of DEFAULT_TEMPLATES) {
    const text = readFileSync(
      path.join(templateRoot, definition.fileName),
      "utf8",
    );
    assert.doesNotMatch(text, /\\bibliographystyle\{plain\}/u);
    for (const style of text.matchAll(/\\bibliographystyle\{([^}]+)\}/gu)) {
      assert.equal(style[1], "alpha", definition.fileName);
    }
  }
});

test("beamer templates provide all theorem environments without redefining built-ins", () => {
  for (const fileName of ["beamer-cn.tex", "beamer-en.tex"]) {
    const text = readFileSync(path.join(templateRoot, fileName), "utf8");
    assert.match(text, /\\documentclass(?:\[[^\]]*\])?\{(?:ctex)?beamer\}/u);
    assert.equal(
      text.match(/\\newtheorem\{/gu)?.length ?? 0,
      theoremEnvironments.length - beamerBuiltinEnvironments.size,
      `${fileName}: custom declaration count`,
    );

    for (const environment of theoremEnvironments) {
      const declaration = new RegExp(
        `\\\\newtheorem\\{${environment}\\}(?:\\[theorem\\])?\\{`,
        "u",
      );
      if (beamerBuiltinEnvironments.has(environment)) {
        assert.doesNotMatch(text, declaration, `${fileName}: ${environment}`);
      } else {
        assert.ok(
          text.includes(
            `\\newtheorem{${environment}}[theorem]{${beamerCustomTitles[fileName]?.[environment]}}`,
          ),
          `${fileName}: ${environment}`,
        );
      }
    }
  }
});

test("managed template catalogs validate, round-trip, and derive factory identity", () => {
  const factoryIds = new Set(DEFAULT_TEMPLATES.map(({ id }) => id));
  const templates: ManagedTemplate[] = DEFAULT_TEMPLATES.map((definition) => ({
    id: definition.id,
    name: definition.label,
    trigger: definition.trigger,
    description: definition.description,
    content: readFileSync(path.join(templateRoot, definition.fileName), "utf8"),
    // Stored/Webview input cannot change authoritative factory identity.
    isFactory: false,
  }));
  templates.push({
    id: "template.user.example",
    name: "Custom",
    trigger: "my-template",
    description: "",
    content: "\\documentclass{article}\n@0",
    isFactory: true,
  });

  const catalog = createManagedTemplateCatalog(templates, "revision-1", factoryIds);
  assert.equal(catalog.templates[0]?.isFactory, true);
  assert.equal(catalog.templates.at(-1)?.isFactory, false);
  const decoded = decodeManagedTemplateCatalog(
    toStoredTemplateCatalog(catalog),
    factoryIds,
  );
  assert.equal(decoded.kind, "valid");
  if (decoded.kind === "valid") {
    assert.deepEqual(decoded.catalog, catalog);
  }
});

test("managed template catalogs reject collisions and unsafe payloads", () => {
  const factoryIds = new Set(DEFAULT_TEMPLATES.map(({ id }) => id));
  const base: ManagedTemplate = {
    id: "template.user.one",
    name: "One",
    trigger: "one",
    description: "",
    content: "@0",
    isFactory: false,
  };
  assert.throws(
    () =>
      createManagedTemplateCatalog(
        [base, { ...base, id: "template.user.two" }],
        "revision-1",
        factoryIds,
      ),
    /trigger 重复/u,
  );
  assert.throws(
    () =>
      createManagedTemplateCatalog(
        [
          base,
          {
            ...base,
            id: "template.user.two",
            trigger: "one-longer",
          },
        ],
        "revision-1",
        factoryIds,
      ),
    /前缀冲突/u,
  );
  assert.throws(
    () =>
      createManagedTemplateCatalog(
        [{ ...base, trigger: "contains space" }],
        "revision-1",
        factoryIds,
      ),
    /空白/u,
  );
  assert.throws(
    () =>
      createManagedTemplateCatalog(
        [{ ...base, content: "\0" }],
        "revision-1",
        factoryIds,
      ),
    /NUL/u,
  );
  assert.throws(
    () =>
      createManagedTemplateCatalog(
        [{ ...base, content: "x".repeat(MAX_TEMPLATE_CONTENT_BYTES + 1) }],
        "revision-1",
        factoryIds,
      ),
    /上限/u,
  );
  assert.equal(
    decodeManagedTemplateCatalog(
      { schemaVersion: 1, revision: "revision-1", templates: [null] },
      factoryIds,
    ).kind,
    "invalid",
  );
});

test("legacy factory article triggers migrate once to article-cn/article-en", async () => {
  const catalog = createTemplateCatalogFixture({
    "template.article-cn": "tmpa-cn",
    "template.article-en": "tmpa-en",
  });
  const harness = createMigrationHarness(catalog);

  const migrated = await migrateLegacyFactoryTemplateTriggers(
    catalog,
    DEFAULT_TEMPLATES,
    harness.dependencies,
  );

  assert.deepEqual(
    migrated.templates
      .filter(({ id }) => id.startsWith("template.article-"))
      .map(({ trigger }) => trigger),
    ["article-cn", "article-en"],
  );
  assert.deepEqual(harness.state.events, ["acknowledge", "create", "commit"]);
  assert.equal(harness.state.acknowledged, true);
  assert.equal(harness.state.commitCalls, 1);
  assert.match(harness.state.infos[0] ?? "", /迁移 2 个/u);
});

test("a late Settings Sync catalog uses the one-time migration before runtime apply", async () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "templateManager.ts"),
    "utf8",
  );
  const reloadStart = source.indexOf("private async reloadFromState");
  const reloadBody = source.slice(reloadStart);
  const migration = reloadBody.indexOf(
    "await this.migrateLegacyFactoryTriggers(decoded.catalog)",
  );
  const apply = reloadBody.indexOf("this.applyCatalogIfChanged(catalog)");
  assert.ok(reloadStart >= 0);
  assert.ok(migration >= 0, "late valid catalogs must enter the migration helper");
  assert.ok(apply > migration, "runtime apply must use the helper's safe result");

  const lateCatalog = createTemplateCatalogFixture({
    "template.article-cn": "tmpa-cn",
    "template.article-en": "tmpa-en",
  });
  const harness = createMigrationHarness(lateCatalog);
  const migrated = await migrateLegacyFactoryTemplateTriggers(
    lateCatalog,
    DEFAULT_TEMPLATES,
    harness.dependencies,
  );
  assert.deepEqual(
    migrated.templates
      .filter(({ id }) => id.startsWith("template.article-"))
      .map(({ trigger }) => trigger),
    ["article-cn", "article-en"],
  );
  assert.deepEqual(harness.state.events, ["acknowledge", "create", "commit"]);
});

test("late Settings Sync migration failures retain a safe catalog and stop after acknowledgement", async (t) => {
  const lateCatalog = createTemplateCatalogFixture({
    "template.article-cn": "tmpa-cn",
    "template.article-en": "tmpa-en",
  });

  await t.test("marker write", async () => {
    const harness = createMigrationHarness(lateCatalog, {
      acknowledgeError: new Error("globalState unavailable"),
    });
    const result = await migrateLegacyFactoryTemplateTriggers(
      lateCatalog,
      DEFAULT_TEMPLATES,
      harness.dependencies,
    );
    assert.equal(result, lateCatalog);
    assert.equal(harness.state.createCalls, 0);
    assert.equal(harness.state.commitCalls, 0);
  });

  await t.test("catalog commit", async () => {
    const harness = createMigrationHarness(lateCatalog, {
      commitError: new Error("catalog write failed"),
    });
    const result = await migrateLegacyFactoryTemplateTriggers(
      lateCatalog,
      DEFAULT_TEMPLATES,
      harness.dependencies,
    );
    assert.equal(result, lateCatalog);
    assert.equal(harness.state.acknowledged, true);
    assert.equal(harness.state.commitCalls, 1);

    const secondResult = await migrateLegacyFactoryTemplateTriggers(
      lateCatalog,
      DEFAULT_TEMPLATES,
      harness.dependencies,
    );
    assert.equal(secondResult, lateCatalog);
    assert.equal(harness.state.acknowledgeCalls, 1);
    assert.equal(harness.state.commitCalls, 1);
  });
});

test("trigger migration preserves factory customisations and user templates", async () => {
  const baseCatalog = createTemplateCatalogFixture(
    {
      "template.article-cn": "my-paper-cn",
      "template.article-en": "tmpa-en",
    },
    [
      {
        id: "template.user.legacy-name",
        name: "User legacy name",
        trigger: "tmpa-cn",
        description: "",
        content: "@0",
        isFactory: false,
      },
    ],
  );
  const customName = "My edited English article";
  const customDescription = "Keep this user-authored description verbatim.";
  const customContent = "\\documentclass{article}\n% user edits must survive\n@0";
  const catalog = createManagedTemplateCatalog(
    baseCatalog.templates.map((template) =>
      template.id === "template.article-en"
        ? {
            ...template,
            name: customName,
            description: customDescription,
            content: customContent,
          }
        : template,
    ),
    baseCatalog.revision,
    factoryTemplateIds,
  );
  const harness = createMigrationHarness(catalog);

  const migrated = await migrateLegacyFactoryTemplateTriggers(
    catalog,
    DEFAULT_TEMPLATES,
    harness.dependencies,
  );

  assert.equal(
    migrated.templates.find(({ id }) => id === "template.article-cn")?.trigger,
    "my-paper-cn",
  );
  assert.equal(
    migrated.templates.find(({ id }) => id === "template.article-en")?.trigger,
    "article-en",
  );
  const migratedEnglish = migrated.templates.find(
    ({ id }) => id === "template.article-en",
  );
  assert.equal(migratedEnglish?.name, customName);
  assert.equal(migratedEnglish?.description, customDescription);
  assert.equal(migratedEnglish?.content, customContent);
  assert.equal(
    migrated.templates.find(({ id }) => id === "template.user.legacy-name")
      ?.trigger,
    "tmpa-cn",
  );
});

test("exact and prefix trigger conflicts skip automatic migration", async (t) => {
  for (const conflictTrigger of [
    "article-cn",
    "article",
    "article-cn-extra",
  ]) {
    await t.test(conflictTrigger, async () => {
      const catalog = createTemplateCatalogFixture(
        {
          "template.article-cn": "tmpa-cn",
          "template.article-en": "my-paper-en",
        },
        [
          {
            id: `template.user.conflict.${conflictTrigger.length}`,
            name: "Conflicting user template",
            trigger: conflictTrigger,
            description: "",
            content: "@0",
            isFactory: false,
          },
        ],
      );
      const harness = createMigrationHarness(catalog);

      const result = await migrateLegacyFactoryTemplateTriggers(
        catalog,
        DEFAULT_TEMPLATES,
        harness.dependencies,
      );

      assert.equal(result, catalog);
      assert.equal(harness.state.acknowledged, true);
      assert.equal(harness.state.createCalls, 0);
      assert.equal(harness.state.commitCalls, 0);
      assert.match(harness.state.warnings[0] ?? "", /新 trigger 已被/u);
    });
  }
});

test("an acknowledged migration never rewrites a later legacy trigger choice", async () => {
  const catalog = createTemplateCatalogFixture({
    "template.article-cn": "tmpa-cn",
    "template.article-en": "my-paper-en",
  });
  const harness = createMigrationHarness(catalog, { acknowledged: true });

  const result = await migrateLegacyFactoryTemplateTriggers(
    catalog,
    DEFAULT_TEMPLATES,
    harness.dependencies,
  );

  assert.equal(result, catalog);
  assert.equal(harness.state.acknowledgeCalls, 0);
  assert.equal(harness.state.createCalls, 0);
  assert.equal(harness.state.commitCalls, 0);
});

test("marker update failure prevents a trigger migration commit", async () => {
  const catalog = createTemplateCatalogFixture({
    "template.article-cn": "tmpa-cn",
    "template.article-en": "tmpa-en",
  });
  const harness = createMigrationHarness(catalog, {
    acknowledgeError: new Error("globalState unavailable"),
  });

  const result = await migrateLegacyFactoryTemplateTriggers(
    catalog,
    DEFAULT_TEMPLATES,
    harness.dependencies,
  );

  assert.equal(result, catalog);
  assert.equal(harness.state.acknowledged, false);
  assert.equal(harness.state.createCalls, 0);
  assert.equal(harness.state.commitCalls, 0);
  assert.match(harness.state.warnings[0] ?? "", /保留旧 trigger/u);
});

test("construction, backup, write, and CAS failures retain an old or latest catalog", async (t) => {
  const catalog = createTemplateCatalogFixture({
    "template.article-cn": "tmpa-cn",
    "template.article-en": "tmpa-en",
  });
  const externalCatalog = createTemplateCatalogFixture(
    {
      "template.article-cn": "synced-paper-cn",
      "template.article-en": "synced-paper-en",
    },
    [],
    "external-revision",
  );
  const cases: readonly {
    readonly name: string;
    readonly options: MigrationHarnessOptions;
    readonly expected: "old" | "external" | "next";
  }[] = [
    {
      name: "catalog construction",
      options: { createError: new Error("payload limit") },
      expected: "old",
    },
    {
      name: "verified backup",
      options: { commitError: new Error("backup verification failed") },
      expected: "old",
    },
    {
      name: "catalog write verification",
      options: {
        commitError: new Error("stored catalog failed verification"),
        useNextAsLatestBeforeCommitError: true,
      },
      expected: "next",
    },
    {
      name: "compare-and-swap",
      options: {
        commitError: new Error("catalog revision changed"),
        latestCatalog: externalCatalog,
      },
      expected: "external",
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const harness = createMigrationHarness(catalog, fixture.options);
      const result = await migrateLegacyFactoryTemplateTriggers(
        catalog,
        DEFAULT_TEMPLATES,
        harness.dependencies,
      );

      assert.equal(harness.state.acknowledged, true);
      assert.equal(
        result,
        fixture.expected === "old"
          ? catalog
          : fixture.expected === "external"
            ? externalCatalog
            : harness.state.latestCatalog,
      );
      assert.match(harness.state.warnings[0] ?? "", /自动迁移未提交/u);
    });
  }
});

test("Settings Sync registers the article-trigger migration marker", () => {
  let registered: string[] | undefined;
  registerSnippetSyncGlobalStateKeys({
    setKeysForSync: (keys) => {
      registered = keys;
    },
  });

  assert.deepEqual(registered, [
    SNIPPET_SYNC_STATE_KEY,
    TEMPLATE_LIBRARY_STATE_KEY,
    ARTICLE_TEMPLATE_TRIGGER_MIGRATION_STATE_KEY,
  ]);
  assert.deepEqual(registered, SNIPPET_SYNC_GLOBAL_STATE_KEYS);
  assert.equal(registered?.includes(SNIPPET_SYNC_METADATA_KEY), false);
});
