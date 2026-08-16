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
  createManagedTemplateCatalog,
  decodeManagedTemplateCatalog,
  MAX_TEMPLATE_CONTENT_BYTES,
  toStoredTemplateCatalog,
  type ManagedTemplate,
} from "../src/templateLibrary";

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

test("factory templates are independent, unique, and free of personal data", () => {
  assert.deepEqual(
    DEFAULT_TEMPLATES.map(({ trigger }) => trigger).sort(),
    ["beamer-cn", "beamer-en", "tmpa-cn", "tmpa-en"],
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
