export interface TemplateDefinition {
  readonly id: string;
  readonly trigger: string;
  readonly fileName: string;
  readonly label: string;
  readonly description: string;
}

export const DEFAULT_TEMPLATES: readonly TemplateDefinition[] = Object.freeze([
  {
    id: "template.article-cn",
    trigger: "tmpa-cn",
    fileName: "article-cn.tex",
    label: "中文论文模板",
    description: "ctexart 中文论文起始模板",
  },
  {
    id: "template.article-en",
    trigger: "tmpa-en",
    fileName: "article-en.tex",
    label: "English article template",
    description: "Clean article starting point",
  },
  {
    id: "template.beamer-cn",
    trigger: "beamer-cn",
    fileName: "beamer-cn.tex",
    label: "中文 Beamer 模板",
    description: "ctexbeamer 中文演示文稿起始模板",
  },
  {
    id: "template.beamer-en",
    trigger: "beamer-en",
    fileName: "beamer-en.tex",
    label: "English Beamer template",
    description: "Clean Beamer presentation starting point",
  },
]);
