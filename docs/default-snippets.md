# TeXLeaf 默认片段速查

这是一份 212 条工厂默认规则的入门速查，不是机器生成的完整清单。要查看、搜索或修改当前实际规则，请运行 `TeXLeaf: 管理 Snippet 与模板`；快速插入可用 `TeXLeaf: 搜索并插入片段` 或侧栏。高级 JSONC 后端仍保存完整库，但不是日常管理入口。

## 数学分隔符

| Trigger | Replacement | 选项 | 行为 |
| --- | --- | --- | --- |
| `lm` | `\(@0\)` | `tA` | 在文本模式快速进入行内数学，光标停在内部。 |
| `dm` | `\[` 换行 `@0` 换行 `\]` | `tAw` | 在文本模式创建块级数学；`w` 避免在单词内部误触发，多行内容会继承当前缩进。 |

从自动触发、手动触发或补全列表插入 `dm` 时，VS Code 都会按插入位置调整续行缩进，不再把内部行和结尾 `\]` 强制放到第 0 列。

## 独立文档模板

四个长模板不计入上面的 212 条 Snippet 规则，而是保存在 Profile 的插件内部模板库：

| Trigger | 模板 |
| --- | --- |
| `tmpa-cn` | 中文 `ctexart` 论文 |
| `tmpa-en` | 英文 `article` 论文 |
| `beamer-cn` | 中文 `ctexbeamer` 演示文稿 |
| `beamer-en` | 英文 `beamer` 演示文稿 |

它们只在已保存、除空白与完整 trigger 外没有其他内容的 `.tex` 文档中自动展开，并替换整份文档。`texleaf.autoSnippets` 关闭时不会自动展开；此时可在完整 trigger 后按 `Tab`。自动路径偶发未命中、原生 Suggest 已经打开时，精确 `Tab` 兜底仍优先选择 TeXLeaf 模板。按 `Ctrl+Shift+P` 运行 `TeXLeaf: 管理 TeX 模板` 可修改 trigger 和正文，或添加、复制、删除和恢复模板；保存后后续展开立即使用新内容。

## 高频数学结构

| Trigger | Replacement | 选项 | 行为 |
| --- | --- | --- | --- |
| `sr` | `^{2}` | `mA` | 添加平方。 |
| `sq` | `\sqrt{ @0 }@1` | `mA` | 输入根式内容，再跳到根式之后。 |
| `//` | `\frac{@0}{@1}@2` | `mA` | 依次填写分子、分母，再离开分式。 |

自动分数是另一项独立功能：启用 `texleaf.autoFraction` 后，在数学区域输入单个 `/` 时，TeXLeaf 先保留斜杠；输入首个有效分母字符后，才把左侧局部表达式取为分子。例如 `1/` 会保持原样，接着输入 `2` 才得到 `\frac{1}{2}`。自动片段的匹配顺序更靠前，因此输入第二个 `/` 仍会触发明确的 `//` 片段，不会被自动分数截断。若不希望自动分析，关闭该设置即可继续单独使用 `//`。

默认库还包含常见的上下标、向量/重音、关系符、集合符号、求和、极限、导数与积分结构。可用名称会在片段搜索与补全列表中显示。

## 希腊字母

常用前缀是分号：

| Trigger | Replacement | Trigger | Replacement |
| --- | --- | --- | --- |
| `;a` | `\alpha` | `;b` | `\beta` |
| `;g` | `\gamma` | `;G` | `\Gamma` |
| `;d` | `\delta` | `;D` | `\Delta` |
| `;e` | `\epsilon` | `:e` | `\varepsilon` |
| `;t` | `\theta` | `:t` | `\vartheta` |
| `;l` | `\lambda` | `;s` | `\sigma` |
| `;o` | `\omega` | `ome` | `\omega` |

大写与变体通常使用大写 trigger 或冒号前缀。输入前可通过片段搜索确认，避免和正文单词发生冲突。

## 正则片段

默认正则规则可以识别一部分高频模式，例如单字母后跟一位数字：

```text
x2  →  x_{2}
```

对应的 v2 replacement 思路是 `@[0]_{@[1]}`：`@[0]` 取第一个捕获组 `x`，`@[1]` 取第二个捕获组 `2`。它们与光标 tabstop `@0`、`@1` 不同。

## 字母重音与后缀

单个英文字母后接重音名称会在数学模式自动包裹前面的字母：

| 输入 | 展开 |
| --- | --- |
| `Qhat` | `\hat{Q}` |
| `qhat` | `\hat{q}` |
| `hat` | `\hat{…}`，光标进入参数 |
| `Qbar` | `\bar{Q}` |
| `Qdot` | `\dot{Q}` |
| `Qddot` | `\ddot{Q}` |
| `Qtilde` | `\tilde{Q}` |
| `Qund` | `\underline{Q}` |
| `Qvec` | `\vec{Q}` |

这些都是数学模式规则；字母后缀带 `A` 会自动展开。同名字面模板仍然可用，例如 `hat` 创建 `\hat{…}`，`dot` 创建 `\dot{…}`。规则优先级已经区分字母后缀、`ddot` 与字面模板，输入 `Qhat`、`Qdot` 或 `Qddot` 时不会再被末尾的普通 `hat`、`dot` 规则抢先。希腊字母/符号命令也支持带空格的后缀形式，例如 `\alpha hat` 展开为 `\hat{\alpha}`。

## Visual 选择区片段

先选择数学源码，再运行 `TeXLeaf: 用片段包裹所选内容`。默认库提供这些常用操作：

| Trigger | 包裹结构 |
| --- | --- |
| `U` | `\underbrace` |
| `O` | `\overbrace` |
| `B` | `\underset` |
| `C` | `\cancel` |
| `K` | `\cancelto` |
| `S` | `\sqrt` |

Visual 片段使用 `@{VISUAL}` 引用选择内容，并仍可加入 `@0` 等 tabstop。它们不会调用函数 replacement。

## 环境与矩阵

写入全局文件的默认库覆盖常见的 matrix、pmatrix、bmatrix、cases、align 等结构。进入 `texleaf.matrixEnvironments` 列出的环境后：

- `Tab` 在活动 tabstop 处理完成后插入下一列的 ` & `；
- `Enter` 在块级 matrix/align 中插入 `\\` 和换行，并保持当前缩进；行内矩阵使用不换行的 ` \\ `；
- `Shift+Enter` 跳出当前环境。

`Enter` 与 `Shift+Enter` 可以在刚由片段创建、仍处于 snippet 模式的 align/matrix 环境中工作；`Tab` 会先遵守活动 tabstop，结束 snippet 导航后再执行矩阵列操作。当前版本还会接住 LaTeX Workshop 转发的普通 Enter，使其在 Align 中仍按 TeXLeaf 行操作处理。

从用户提供的 HSnips 文件中只加入了定理类环境这一组。为避免与正文单词和原生单词补全竞争，13 个 trigger 都显式带一个反斜杠；它们是文本模式、词边界、自动展开（`tAw`），完整输入后立即创建环境：

| Trigger | Environment | Trigger | Environment |
| --- | --- | --- | --- |
| `\axm` | `axiom` | `\dfn` | `definition` |
| `\lem` | `lemma` | `\prp` | `proposition` |
| `\thm` | `theorem` | `\cor` | `corollary` |
| `\clm` | `claim` | `\asm` | `assumption` |
| `\exm` | `example` | `\exr` | `exercise` |
| `\cnj` | `conjecture` | `\hyp` | `hypothesis` |
| `\rmk` | `remark` |  |  |

原生 Suggest 中，当前输入与 TeXLeaf trigger 精确相同时，该片段会优先显示并预选；因此 `\thm`、`\lem`、`\dfn`、`\cor` 等的精确候选会指向上表对应的完整环境，普通非精确候选仍使用 VS Code 的原生排序。自动展开、精确 Suggest 和 `Tab` 兜底使用同一条规则；模板、定理片段或 `dm` 若偶尔没有在键入后自动展开，直接按 `Tab` 也会走精确 TeXLeaf 片段，而不是接受一个相近的普通单词。

在数学环境中的 `\label{...}`、`\tag{...}` 与 `\tag*{...}` 参数里，所有自动与手动数学片段都会暂时停用。因此 `\label{;a}` 会保持字面值；参数闭合后，外层 equation/align 中的 `;a` 仍可正常展开。

## 触发未发生时

依次确认：

1. 当前编辑器已经保存为 `.tex` 或 `.bib`，`texleaf.enabled` 已开启，且当前 language ID 在 `texleaf.languageIds` 中。
2. 编辑器右下角语言模式是 LaTeX 或 TeX，而不是 Plain Text。
3. `t`、`m`、`M` 或 `n` 与当前文本/数学上下文一致；`Qhat` 等字母重音需要数学模式。
4. `texleaf.autoSnippets` 未关闭；若片段没有 `A`，请使用 `texleaf.manualTrigger` 配置的按键。
5. 自动分数或矩阵问题还要确认 `texleaf.autoFraction`、`texleaf.matrixShortcuts` 已开启；升级扩展不会覆盖已有用户设置。
6. 当前环境不在 `texleaf.excludedEnvironments` 中。
7. 全局文件或显式项目附加文件中没有更高优先级的同 trigger 规则。
8. “问题”面板中没有片段校验错误。
9. 若刚修改设置或安装 VSIX，执行一次 `Developer: Reload Window`。

如果误删或大范围改坏了默认规则，可运行 `TeXLeaf: 恢复默认片段`。确认后扩展会先把现有全局文件备份到当前环境的 `globalStorageUri/backups`，再恢复当前版本的完整默认库；未保存内容或并发磁盘变化不会被静默覆盖。
