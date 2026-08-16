# TeXLeaf 片段格式

TeXLeaf 的日常入口是 `TeXLeaf: 管理 Snippet 与模板`：它提供结构化搜索、筛选、增删改、trigger 编辑和批量查找替换，不要求用户定位或手写配置文件。扩展内部仍使用一份完整 JSONC 主库，以保留可靠的迁移、导入导出、原字节备份和 Settings Sync 兼容性；首次创建时包含全部 212 条默认规则和 `GREEK`、`SYMBOL`、`MORE_SYMBOLS` 三个变量。只有高级修复或审阅时才需要运行 `TeXLeaf: 打开高级 Snippet JSONC`：

```text
<VS Code 用户数据>/globalStorage/local-lab.texleaf/texleaf-snippets.jsonc
```

这份内部后端在同一个 VS Code Profile 和扩展宿主的所有工作区中共享。不要手工猜测 Profile、Insiders、Remote 或便携版的存储路径；结构化管理器会选择正确的内部库，保存后立即刷新运行时。

长篇 article/Beamer 模板不在这份 JSONC 中，而是保存在当前 Profile 的 TeXLeaf 插件内部模板库。运行 `TeXLeaf: 管理 TeX 模板` 可直接编辑名称、trigger、说明和正文，或添加、复制、删除及恢复模板。首次升级会一次性迁移旧版 `globalStorageUri/templates/*.tex` 中的用户内容，之后运行时不再依赖那些文件。模板只在单光标、已保存的空白 `.tex` 文档中，完整输入 trigger 后自动展开；关闭 `texleaf.autoSnippets` 时可在完整 trigger 后按 `Tab` 展开。模板使用下文相同的 v2 `@` 占位符语法；需要字面量 `@` 时写成 `@@`。

`texleaf.snippetFiles` 默认为空。如果确实需要项目专属规则，可以在该设置中明确添加额外文件；相对路径按对应工作区文件夹解析，多根工作区会各自加载。它不会改变全局主文件的位置。

旧版本留在项目 `.vscode/texleaf-snippets.jsonc` 中的文件不会被自动读取、复制或删除。需要迁移时，从 Command Palette 运行 `TeXLeaf: 导入片段` 并明确选择旧文件一次即可。未信任工作区会忽略项目级 `texleaf.snippetFiles`；用户全局文件仍可正常使用。

从 0.2.x 升级时，TeXLeaf 会对缺少当前 `defaultsRevision` 的有效全局文件执行一次追加式迁移：保留现有片段和变量，读取一次已移除设置 `texleaf.customSnippets` 的旧用户全局值，再补齐尚不存在的默认定义。对象式且 `snippets` 为数组的 JSONC 会尽量保留注释、未知顶层字段、原顺序和未改动条目的格式；顶层数组或旧字符串格式需要规范化并重新序列化。现有内容优先，工作区级旧设置不会被提升。实际改写之前会创建逐字节备份，因此规范化前的原始内容仍可恢复；标记迁移完成后，用户主动删除的默认项不会在后续启动时重新出现。

工厂迁移 revision 2 会追加缺失的定理类环境，并把仍与旧出厂记录完全一致的 `mode.inline` 触发词从 `mk` 窄迁移为 `lm`。revision 3 只把仍与 revision 2 出厂记录完全一致的 13 个定理片段，从裸 trigger 的手动规则窄迁移为带反斜杠的自动规则，例如 `thm` 变为 `\thm`、`def` 变为 `\dfn`，选项 `tw` 变为 `tAw`。只要记录已被禁用、改名、改写 replacement/选项/说明或分类，就视为用户自定义并保持不动；文件已经标记 revision 3 后，用户删除的默认规则也不会在重启时复活。默认规则总数仍为 212。

默认使用 `\dfn` 自动展开 `definition` 环境。所有自动规则仍保留精确 `Tab` 兜底，Suggest 打开时也优先执行与当前输入完全一致的 TeXLeaf trigger。

## 安全模型

片段文件是 JSONC，而不是 JavaScript 或 TypeScript 模块。TeXLeaf 只读取可验证的数据，不使用 `eval`、`Function`、动态 `import` 或脚本沙箱。

因此：

- 推荐的顶层是包含 `snippets` 的片段库对象；为了兼容简单配置，也接受顶层数组。
- 每个片段必须是普通 JSON 对象。
- `trigger` 必须是字符串；正则也写成字符串，并添加 `r` 选项。
- `replacement` 必须是字符串。
- 允许 `//`、`/* … */` 注释和尾随逗号。
- 不允许 `/pattern/` 形式的 RegExp literal。
- 不允许箭头函数、普通函数、变量引用、模板字符串、导入或其他可执行表达式。
- 单个无效条目会被忽略并报告诊断，不应阻止其他有效片段加载。

这意味着从网络复制片段时仍应先审阅其展开文本，但片段文件本身不能借由 replacement 执行任意 JavaScript。

## 推荐的片段库结构

下面是全局主库的简化对象结构；真实首次文件还包含其余默认变量和 212 条规则。项目附加文件可以省略 `defaultsRevision`，但全局主库应保留它。

```jsonc
{
  "version": 1,
  "defaultsRevision": 3,
  "variables": {
    "GREEK": "alpha|beta|gamma|delta",
  },
  "snippets": [
    {
      "id": "greek-name",
      "trigger": "(${GREEK})",
      "replacement": "\\@[0]",
      "options": "rmA",
      "flags": "u",
      "priority": 0,
      "description": "展开希腊字母名称",
      "category": "Greek",
      "enabled": true,
      "syntaxVersion": 2,
    },
  ],
}
```

- 固定的全局主文件，以及沿用 `.vscode/texleaf-snippets.json` 或 `.vscode/texleaf-snippets.jsonc` 约定名称的附加文件，会自动关联扩展提供的 JSON Schema，因此不需要写一个可能失效的本地 `$schema` 路径。`texleaf.snippetFiles` 若指向其他自定义文件名，TeXLeaf 仍会安全加载，但 VS Code 不会自动关联这份 Schema。
- 顶层 `version` 是片段库文件格式版本，当前为 `1`。
- 顶层 `defaultsRevision` 是 TeXLeaf 工厂库迁移版本。默认文件和 0.2.x 迁移会维护它；不要为了找回单条规则而手工降低该值，应使用 `TeXLeaf: 恢复默认片段` 或从备份导入。
- `variables` 是可选的字符串映射，可在 trigger 中写 `${NAME}` 复用正则片段。
- `snippets` 是片段数组。

导入文件或 `texleaf.snippetFiles` 项目附加文件只需要少量片段时，也可以使用兼容的数组简写。长期维护的全局主库应保留对象格式，因为数组无法携带 `defaultsRevision` 和顶层变量：

```jsonc
[
  { "trigger": ";R", "replacement": "\\mathbb{R}", "options": "mA" },
]
```

字段说明：

| 字段 | 类型 | 必需 | 含义 |
| --- | --- | --- | --- |
| `trigger` | string | 是 | 普通触发词，或在 `r` 选项下作为正则模式 |
| `replacement` | string | 是 | 插入文本，可包含 tabstop、捕获组或 Visual 占位符 |
| `options` | string | 否 | 由 `t/m/M/n/A/r/v/w` 组成的行为标志，默认空字符串 |
| `priority` | number | 否 | 冲突时优先级；数值更大者优先，默认 `0` |
| `description` | string | 否 | 搜索、补全和诊断中展示的人类可读说明 |
| `flags` | string | 否 | 正则标志，仅允许 `i/m/s/u/v`，不接受有状态的 `g`/`y` |
| `id` | string | 否 | 稳定标识，便于管理和导入导出 |
| `category` | string | 否 | 在片段库视图与搜索中使用的分类 |
| `enabled` | boolean | 否 | 是否加载该片段，默认 `true` |
| `syntaxVersion` | `1 \| 2` | 否 | replacement 占位符语法版本，默认 `2` |

未知字段不会获得执行能力。未知选项、类型错误、非法正则或互相冲突的选项会产生诊断，并使对应条目被跳过。

## 选项

### 模式选项

- `t`：仅在数学区域之外触发。
- `m`：在任意数学区域触发；语义上相当于同时允许 `M` 与 `n`。
- `M`：仅在块级数学区域触发，例如 `$$ … $$` 或 `\[ … \]`。
- `n`：仅在行内数学区域触发，例如 `$ … $` 或 `\( … \)`。

没有写模式选项时，片段可在任何模式触发。不要在同一片段上混用互相矛盾的模式限制。

### 行为选项

- `A`：Auto。触发文本一满足条件就立即展开。省略 `A` 时，使用 `texleaf.manualTrigger` 配置的按键确认，默认是 `Tab`，也可改为空格。
- `r`：Regex。把 `trigger` 当作正则模式，而不是字面字符串。
- `v`：Visual。只对非空选择生效，用于包裹或改写已选文本。
- `w`：Word boundary。要求触发词两侧满足词边界，避免在较长标识符内部误触发。

`r` 和 `v` 表达的是不同的输入模型，不应在同一片段中组合。自动片段应尽量选择不易误触的 trigger；较宽泛的规则建议省略 `A`，由 `Tab` 确认。

## Tabstop：`@0`

replacement 中的 `@0`、`@1`、`@2` 等是展开后的光标停靠点：

```jsonc
{
  "trigger": "//",
  "replacement": "\\frac{@0}{@1}@2",
  "options": "mA",
}
```

展开后，光标首先选中 `@0` 所在位置；按 `Tab` 依次前往 `@1`、`@2`。TeXLeaf 会把这些标记转换为 VS Code 原生 snippet tabstop，标记本身不会插入文档。

如果需要默认占位文本，可以使用：

```jsonc
{
  "trigger": "dint",
  "replacement": "\\int_{@{0:0}}^{@{1:\\infty}} @2 \\, d@{3:x}",
  "options": "m",
}
```

`@{0:0}` 表示第 0 个停靠点，初始文本为 `0`。若确实需要插入字面量 `@`，使用 `@@`，避免它被解释为 TeXLeaf 占位符。

### v1/v2 迁移

新片段应使用 `syntaxVersion: 2`。为导入 snippet-leaf/旧格式数据，TeXLeaf 也支持 v1 占位符：

| 含义 | v1 | v2（推荐） |
| --- | --- | --- |
| 第一个 tabstop | `$0` | `@0` |
| 第一个正则捕获组 | `[[0]]` | `@[0]` |
| Visual 选择内容 | `${VISUAL}` | `@{VISUAL}` |

片段对象中的字段名是 `syntaxVersion`。导入器会识别上游常见的 `version` 字段并转换，但保存到 TeXLeaf 片段库时应使用 `syntaxVersion`，不要把它与顶层片段库 `version: 1` 混淆。

## 正则捕获：`@[0]`

带 `r` 的 trigger 是字符串形式的正则表达式。replacement 中：

- `@[0]` 引用第一个括号捕获组。
- `@[1]` 引用第二个括号捕获组。
- `@[name]` 引用正则中的命名捕获组 `(?<name>…)`。
- 捕获序号从零开始，`@[0]` 不表示整个匹配。

```jsonc
{
  "trigger": "([A-Za-z])(\\d)",
  "replacement": "@[0]_{@[1]}",
  "options": "rmA",
  "description": "单字母数字下标",
}
```

在数学模式输入 `x2` 时，第一个捕获组是 `x`，第二个是 `2`，结果为 `x_{2}`。已有捕获组本次没有内容时使用空字符串；索引超出正则实际捕获组数量时，占位符会保留为字面文本，便于发现配置错误。无论哪种情况，它都不会被当作可执行表达式。

正则应匹配紧邻光标之前的文本。TeXLeaf 最多检查 `texleaf.maxRegexScanLength` 指定的字符数。请避免灾难性回溯模式，例如层层嵌套、可匹配同一输入的贪婪量词。

JSONC 字符串会先处理一次反斜杠转义，所以正则中的 `\d` 必须写作 `"\\d"`；若要匹配 LaTeX 源码里的一个字面反斜杠，通常需要在 JSONC 中写四个反斜杠。

## Visual 片段

Visual 片段只处理非空选择。replacement 使用 `@{VISUAL}` 表示被选中的原文：

```jsonc
{
  "trigger": "U",
  "replacement": "\\underbrace{@{VISUAL}}_{@0}",
  "options": "mv",
  "description": "用下花括号包裹选择",
}
```

选中文字后运行 `TeXLeaf: 用片段包裹所选内容`，再选择对应片段。Visual replacement 仍然只能是字符串；TeXLeaf 不支持以 `(selection) => …` 形式编写函数。

## 完整示例

```jsonc
{
  "version": 1,
  "defaultsRevision": 3,
  "variables": {},
  "snippets": [
    {
      "trigger": ";R",
      "replacement": "\\mathbb{R}",
      "options": "mA",
      "description": "实数集",
    },
    {
      "trigger": "norm",
      "replacement": "\\left\\lVert @0 \\right\\rVert@1",
      "options": "m",
      "priority": 5,
    },
    {
      "trigger": "([A-Za-z])(\\d)",
      "replacement": "@[0]_{@[1]}",
      "options": "rmA",
      "syntaxVersion": 2,
    },
    {
      "trigger": "U",
      "replacement": "\\underbrace{@{VISUAL}}_{@0}",
      "options": "mv",
    },
  ],
}
```

保存全局文件后 watcher 会自动重新加载；`TeXLeaf: 重载片段` 是显式刷新和排错手段，不是每次保存的必需步骤。通过内置管理器保存时也会立即重新加载；有效内容还会更新 VS Code Settings Sync 的 `globalState` 镜像。Settings Sync 必须由用户主动启用；只有有效、已保存且序列化 envelope 不超过 256 KiB 的内容才会上传。同步冲突不会静默覆盖本地未保存或已并发变化的文件，替换前备份也只保存在当前环境。若片段没有生效，请依次检查：当前编辑器是否已经保存为 `.tex` 或 `.bib`、当前语言是否在 `texleaf.languageIds` 中、扩展是否启用、数学上下文是否符合模式选项、当前环境是否被排除，以及“问题”面板中是否出现片段诊断。
