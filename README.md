# TeXLeaf

<p align="center">
  <img src="https://raw.githubusercontent.com/zhangxh-math/texleaf/main/media/icon.png" width="112" alt="TeXLeaf 图标">
</p>

<p align="center">
  面向 VS Code 的可视化 LaTeX 写作扩展：原位编辑公式与文档结构，并整合高频片段、Math Preview、项目引用、Zotero 和可选 AI 写作检查。
</p>

<p align="center">
  <strong>TeXLeaf 1.2.1</strong> · VS Code 1.98+ · Windows / macOS / Linux · GPL-3.0-only
</p>

TeXLeaf 始终编辑原来的 `.tex` / `.bib` 文件，不创建中间文档，也不改变 LaTeX 源码格式。可视化模式、同标签页源码模式和 VS Code 原生编辑器共享同一份 `TextDocument`、保存状态与 Undo/Redo 历史。

TeXLeaf 不自带 TeX 编译器。编译、PDF 查看和 SyncTeX 交给 [LaTeX Workshop](https://github.com/James-Yu/LaTeX-Workshop)；TeXLeaf 专注于写作、结构化编辑、公式预览和引用工作流。

当前 **TeXLeaf 是 LaTeX Workshop 桥接版**：它复用 LaTeX Workshop 已加载的运行时模块、编译配方、执行器与公开命令，以及 PDF 查看器、SyncTeX 和编译诊断，不重复实现一套 TeX 编译基础设施。后续还将推出 **TeXLeaf-Z**——不再桥接 LaTeX Workshop、提供集成编译工作流的版本；具体功能范围和发布时间以后续公告为准，敬请期待。

## 后续维护方向

TeXLeaf 的主要功能现已基本完成。后续更新将聚焦于问题修复，以及可视化编辑器对更多 LaTeX 模板和命令的兼容适配。模板适配将优先处理赞助者的需求。

如果在使用中发现 Bug，欢迎通过 [GitHub Issues](https://github.com/zhangxh-math/texleaf/issues) 反馈。

## 功能总览

| 功能 | 能做什么 |
| --- | --- |
| 可视化 LaTeX 编辑器 | 把完整公式、标题、定理、证明、列表、表格、图片、参考文献等显示为可编辑结构；点击任意部件可原位恢复准确源码。 |
| 公式编辑与 Math Preview | 标准模式下，行内、行间及 `equation` / `align` / matrix 等环境由本地 MathJax 4 Worker 渲染；编辑时显示带精确光标的浮动预览，离开后自动恢复排版。 |
| 表格与交换图 | 用结构化表单编辑 table/tabular 的行列、单元格、表题、标签和样式；通过内置中文 quiver 1.7.0 编辑 `tikzcd` 的节点、箭头、标签与样式，再经校验回写。 |
| 片段与模板 | 223 条可编辑 Snippet、四个整篇 article/Beamer 模板、结构化管理器、高级 JSONC、导入/导出和 Settings Sync。 |
| 数学输入辅助 | 自动分式、级联括号放大、Tabout、成对括号、空公式删除、matrix/align 键位、Visual 选区片段和嵌套 tabstop。 |
| 多文件项目与交叉引用 | 从显式 root、magic root、`subfiles` 或唯一包含关系建立保守项目上下文；跨文件补全、预览并跳转 `\ref` / `\eqref` / label。 |
| 文献与 Zotero | 搜索项目 bibliography 和 Zotero/Better BibTeX；插入 citekey，必要时把 BibTeX/BibLaTeX 条目原子写入 `reference.bib`。 |
| AI 写作助手 | 可选的 DeepSeek/OpenAI 正文检查、改写与续写；问题发布到 VS Code 原生 Problems，支持精确跳转、应用、忽略和批量应用。 |
| LaTeX Workshop 桥接 | 从可视化工具栏复用 LaTeX Workshop 的编译、PDF、SyncTeX 与诊断能力；TeXLeaf 不复制一套编译基础设施。 |

## 功能演示

以下 GIF 沿用仓库已有的功能演示，录自隔离的 VS Code Extension Host，按真实鼠标、键盘与滚动过程连续取帧；文档、作者、邮箱及引用均为测试数据。演示展示基本交互，界面细节以安装版本为准。

### 点击公式，原位编辑，再自动排版

点击公式后恢复 LaTeX 源码；输入时浮动 Math Preview 实时更新；光标离开公式范围后重新生成静态公式。

![TeXLeaf 行内公式原位编辑演示](https://raw.githubusercontent.com/zhangxh-math/texleaf/main/media/demo-formula-editing.gif)

### Snippet 自动展开与 Tab 占位符

在数学区域输入 `//` 会连续展开为分式片段；随后用 Tab 在分子、分母和最终位置之间移动，离开源码范围后立即恢复排版。

![TeXLeaf Snippet 自动展开和 Tab 占位符演示](https://raw.githubusercontent.com/zhangxh-math/texleaf/main/media/demo-snippets.gif)

### 定理结构、成对环境边界与多行公式

定理和证明以结构卡片显示；点击“编辑环境”或对应逻辑行会同时显示 `\begin` / `\end`，其中的 `align` 仍可继续原位展开。

![TeXLeaf 定理环境和多行公式编辑演示](https://raw.githubusercontent.com/zhangxh-math/texleaf/main/media/demo-structure-source.gif)

### 表格可视化编辑

打开结构化表格编辑器后，可以修改环境、浮动位置、宽度、对齐、横线样式、caption、label、行列和单元格；“应用”会把当前模型安全序列化回原 `.tex`。演示把 Accuracy 从 `0.97` 连续修改并回写为 `0.99`。

![TeXLeaf 表格可视化编辑连续演示](https://raw.githubusercontent.com/zhangxh-math/texleaf/main/media/demo-table-visualization.gif)

### 交换图交互的历史演示

以下 GIF 记录旧版基础画布把节点 `B` 修改为 `$B_1$` 的交互，**不是新版 quiver 录像**。1.2.1 已统一使用内置中文 quiver，支持更完整的箭头、弯曲、颜色与标签编辑；具体流程见下文。

![TeXLeaf 交换图直接操纵编辑连续演示](https://raw.githubusercontent.com/zhangxh-math/texleaf/main/media/demo-commutative-diagram.gif)

### 文献引用在可视化与源码之间切换

cite 以作者—年份 chip 显示；点击后编辑准确引用命令，光标移出引用范围后 chip 和文献详情生命周期一起恢复。

![TeXLeaf 文献引用编辑演示](https://raw.githubusercontent.com/zhangxh-math/texleaf/main/media/demo-citation-editing.gif)

### 文献详情与多行公式引用预览

悬停 citation 会显示项目文献详情；移开鼠标后卡片立即消失。悬停指向 `align` 中第二个 label 的 `\eqref` 时，预览显示完整多行公式，并只高亮被引用的那一行。

![TeXLeaf 文献与多行公式引用预览演示](https://raw.githubusercontent.com/zhangxh-math/texleaf/main/media/demo-reference-previews.gif)

### AI 问题使用 VS Code 原生 Problems

AI 语言问题与 LaTeX Workshop 编译问题共用 VS Code 原生 Problems，但由各自扩展维护；点击 AI 条目会跳到准确行列并显示应用/忽略操作。

![TeXLeaf AI 原生问题面板演示](https://raw.githubusercontent.com/zhangxh-math/texleaf/main/media/demo-native-problems.gif)

## 快速开始

1. 安装 VS Code `1.98+`。若需要编译与 PDF，再安装 LaTeX Workshop 和本机 TeX 发行版。
2. 从 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=zhangxh-math.texleaf) 安装，或从 [GitHub Releases](https://github.com/zhangxh-math/texleaf/releases) 下载 VSIX 后运行 **Extensions: Install from VSIX...**。
3. 打开一个已保存的 `.tex`。默认进入 TeXLeaf 可视化编辑器；工具栏“源码”在同一标签页显示完整高亮源码，“原生”打开 VS Code 原生文本编辑器。
4. 点击公式、定理、标题、引用、表格或交换图即可编辑对应源码或结构模型；按 `Ctrl+Space` 查询 TeXLeaf、LaTeX Workshop 等 Provider 返回的安全补全。
5. 从工具栏运行编译、PDF 或 SyncTeX。项目引用、Zotero 和 AI 均可按需启用，互不强制依赖。

如果希望 `.tex` 默认使用原生源码编辑器，将 `texleaf.visualEditor.defaultMode` 设为 `source`；需要时运行 **TeXLeaf: 使用可视化编辑器打开**，或使用 **Reopen Editor With...**。

## 标准与增强可视化

工具栏可在标准模式（`basic`，默认）和增强模式（`maximum`）之间切换。标准模式用本地 MathJax 显示常规公式，不启动 TeX；需要本地排版的特殊内容提供黄色模式切换提示。增强模式使用本机 TeX 排版复杂公式、公式内 TikZ、TeX 盒子、Young 图和包含 PDF/位图子图的完整组合 figure，先显示可编辑正文，再逐项补齐图形，并提供进度、取消、失败说明及重试。

增强模式需要可信工作区、本机 TeX 和相应宏包。通常使用 `latex` 与 `dvisvgm`；中文图形需要 `xelatex`、`ctex` 和字体。含外部图片的预览优先用支持 PDF 的 `dvisvgm` 转换，失败后尝试 `pdftocairo`。依赖缺失时保留源码和提示，不自动下载工具。可通过 `texleaf.visualEditor.texBinPath` 指定本机工具目录；完整论文编译仍由 LaTeX Workshop 负责。

图形任务共享并缓存完成结果，切换模式、滚动或普通正文编辑可以复用；图形源码、有效宏、绘图颜色或相关图片内容变化时失效。`texleaf.visualEditor.graphCacheLimitMB` 控制磁盘缓存，默认 128 MiB、范围 16–2048，超限优先清理较久未使用项；可视化菜单可清理缓存，源码与 PDF 不受影响。

增强图形预览默认 **150%**。设置 `texleaf.visualEditor.previewZoomPercent` 可在 **50–400%** 间调整默认值，修改后立即应用；“缩小 / 重置 / 放大”只改变显示，重置返回设置值，新建预览也使用该值，不重新运行 TeX、不改变源码或 PDF。图形卡片、图注、操作按钮和图形引用悬浮使用不透明浅色纸面；保留原图颜色、透明度、位图像素及空实心节点，主题切换无需重新编译。

## 标题、摘要、编号与源码入口

1.2.1 保留 1.2.0 的完整改进：标题、作者、单位居中呈现，摘要独立带框并有源码入口；增强模式可整合可确定的分散文首信息。标题编辑按钮独占上方一行，窄窗不遮挡标题；标题、摘要、空样式命令、计数和布局命令均保留准确的源码入口。连续退格遇到折叠命令、表格或图形时先展开，再逐字删除；显式选中的完整命令仍可删除。

支持安全局部宏、脚注及其悬浮、定理样式、图题、目录、附录，以及章节计数器的字面整数赋值、加法和步进。标题与文献悬浮保留 LaTeX 公式，不解释标题中的 HTML；公式失败时保留红色原始公式，长标题和手写文献保留文字回退。可验证的 LaTeX Workshop 成功编译结果仅在相关源码仍一致时补充编号，过期或来源不明的结果不覆盖当前推断。

可视化属于静态近似。动态宏、精确编号、分页、浮动位置和模板最终排版以 LaTeX Workshop 编译的 PDF 为准。

## Beamer 与输入交互

Beamer 保留帧外框、标题与正文，`columns` / `column` 按正文顺序纵向展开，便于连续编辑。支持局部分组的字号、粗体、斜体、命名颜色，以及可确定的单参数来源说明宏；样式与分栏包装仍可展开源码。普通文本 `\alert` 显示为加粗与可确定的高亮色，独立公式中的 `\alert` 用加粗数学兼容显示。局部作用域与重定义会更新样式，显式换行不再与源码换行叠加成额外空行；真实幻灯片布局仍以 PDF 为准。

Beamer 双向定位复用 LaTeX Workshop 的 SyncTeX 索引与 PDF viewer。普通帧先核验原行的双向记录；无法确认精确位置时，使用本帧结束记录的首个命中，避免跳到上一帧或同帧后续 overlay。显式 fragile/direct 帧，以及可核验的全局 direct 帧，保留准确原行；反向命中普通帧的 `\end{frame}` 时返回帧头，精确正文命中仍保留原位置。可视化位置通过统一 LF 坐标与原 `TextDocument` 的 LF/CRLF 坐标转换，避免 Windows 换行导致偏移累积，不改写文件换行格式。缺少可用 Workshop 运行时组件时沿用原同步路径，不猜测更细的位置。

公式内中文 IME 候选替换、删除与取消后恢复正常输入和退格，即使缺少 composition 结束通知也能由普通按键恢复。展开表格源码及混合文字单元格均支持 Math Preview，位置对齐公式起始处；单元格空格不会误触源码展开。工具栏、右键插入及多行片段自动缩进结果同步写入同一 `TextDocument`，沿用原有保存和撤销历史。

## 内置 quiver 交换图编辑器

点击 **可视化编辑交换图** 打开内置 quiver 1.7.0 中文编辑器。可选择、拖动节点与箭头，编辑标签、弯曲、颜色、端点和箭头样式，也可放大编辑画布。标准与增强模式均使用浅色交换图卡片，外围文档继续跟随 VS Code 主题。

编辑器直接加载当前 `tikzcd`，不设独立导入、宏定义或导出栏。点击 **应用修改** 将结果写回原位置，可一次撤销；未修改就应用或取消均保持原文。源码中的 `texleaf-quiver-v1` 注释保存 quiver 原生状态，仅在对应图形源码未被外部修改时使用；手动改图后重新解析 TikZ。

quiver 无法无损导入所有手写 TikZ 选项。未识别的选项会列出提示；修改后应用需要勾选转换确认。需要保留原样时使用 **编辑 tikzcd 源码**。TikZ 无法准确表达的箭头组合会提示调整，不会静默替换样式。

修改主文档图形时按需补充 `\usepackage{quiver}`，与图形修改共用一次撤销；编辑 `\input` 子文件时需自行在主文档加载宏包。完整文档编译需要本机 quiver 1.7 及 TikZ 依赖；增强预览使用随扩展提供的 `quiver.sty`。界面、KaTeX、字体和图标全部本地加载，宏由 TeX 文档管理，不加载远程宏。

这里实际嵌入了 [q.uiver.app](https://q.uiver.app/) / [varkor/quiver](https://github.com/varkor/quiver) 1.7.0 的代码，上游提交为 `2f289ecbae9b7e5a473e04b924750c538ed5c4cf`，原作者版权为 `Copyright (c) 2018 varkor`，使用 MIT License。TeXLeaf 维护本地汉化与集成补丁，并保留 quiver 和 KaTeX 0.18.1 的原许可证；这是实际代码集成，不只是交互参考。

## 可视化编辑器的关键交互

- 点击完整公式、citation、reference、label、标题或结构卡片，显示其真实 LaTeX 范围；光标离开后重新可视化。
- 鼠标点击被折叠环境的 `\begin{...}` / `\end{...}` 逻辑行，会显示成对环境边界；不会把环境后的下一行错误跳回 `\begin`。
- `↑` / `↓` 按 LaTeX 逻辑行移动，而不是按软换行后的屏幕行移动。到达普通逻辑行只展开该行；到达多行公式时展开整条公式。
- `Tab` 依次处理活动 Snippet tabstop、当前局部 Tabout 和 matrix/align 插列。它不会跳出块级环境；唯一例外是已经完成的行内 `$...$` / `\(...\)`。
- `Enter` 在列表中生成新的 `\item`；对刚生成的空 item 再按一次 Enter 只移除 item 标记并保留环境内的空白行。Enter 不负责跳出环境。
- `Shift+Enter` 是统一的环境跳出手势：跳到最近的安全结束位置，并保持外层缩进；Tab 和 Enter 不替代它。
- 自动分式把 `=`、`<`、`>`、`\le` / `\leq`、`\ge` / `\geq` 等关系运算符视为分子边界，不会把关系符吞入分子。
- 中文 IME composition、候选删除、全角标点和退格都经过范围保护，临时拼音不能删除公式左侧的既有 LaTeX 结构。
- 长文档公式按可视区分批渲染；快速滚动停止后最终视口优先，旧位置不会长期占住渲染队列。

可视化编辑器还支持：导言区折叠与完整源码编辑、标题/作者/日期预览、document-class-aware 章节和定理编号、文本加粗/斜体/下划线/删除线/颜色工具、表格与 `tikzcd` 结构化编辑、安全本地栅格图片及 PDF/SVG 预览、citation/label 补全、跨文件引用返回，以及可视化和源码模式中的主题跟随 LaTeX 高亮。

完整手册见 Wiki 的 [可视化编辑器](https://github.com/zhangxh-math/texleaf/wiki/Visual-Editor)。

## 片段与模板

首次运行会建立当前 VS Code Profile 的 223 条可编辑默认规则。常用示例：

| 输入 | 结果 |
| --- | --- |
| `lm` | `\(...\)` |
| `dm` | `\[...\]` |
| `//`（数学区域） | 带分子/分母 tabstop 的 `\frac{...}{...}` |
| `;a`（数学区域） | `\alpha` |
| `\thm` / `\lem` / `\dfn` | 定理、引理、定义环境 |
| `article-cn` / `article-en` | 中文或英文 article 整篇模板 |
| `beamer-cn` / `beamer-en` | 中文或英文 Beamer 整篇模板 |

运行 **TeXLeaf: 管理 Snippet 与模板** 可搜索、增删、复制、筛选、批量替换、撤销草稿和恢复出厂库；高级用户仍可编辑 JSONC。`Ctrl+Alt+L`（macOS 为 `Cmd+Alt+L`）打开完整片段选择器。

详细说明见 [片段与模板](https://github.com/zhangxh-math/texleaf/wiki/Snippets-and-Templates) 和 [Snippet 格式](https://github.com/zhangxh-math/texleaf/wiki/Snippet-Format)。

## 文献、引用与多文件项目

TeXLeaf 的 citation 搜索会合并当前 bibliography 与 Zotero 本地快照，并按 citekey、标题、作者、年份、DOI、ISBN 排序。接受 Zotero 候选时，TeXLeaf 先导出 BibTeX/BibLaTeX，再通过同一份版本校验的工作区编辑写入 bibliography 并插入 citekey。Zotero 连接固定使用 `127.0.0.1`；推荐 Zotero 8+ 与匹配版本的 Better BibTeX。

项目扫描只跟随工作区内可证明的字面 `\input`、`\include`、`\subfile`、`\import` 和 `\subimport`。遇到动态路径、未知条件、循环、重复执行、缺失文件或重名 label 时会 fail closed，不猜一个目标。公式引用预览可显示整条多行公式，并只高亮当前 label 所在行；引用箭头统一位于文本右侧。

详细说明见 [文献与 Zotero](https://github.com/zhangxh-math/texleaf/wiki/References-and-Zotero) 和 [可视化编辑器：项目与引用](https://github.com/zhangxh-math/texleaf/wiki/Visual-Editor#多文件项目与交叉引用)。

## AI 写作助手

AI 功能默认关闭，需要用户自己的 DeepSeek 或 OpenAI API Key；ChatGPT Plus/Pro 或 Codex 用量不能替代 API 额度。TeXLeaf 支持段落/选区检查、整篇分段检查、改写和续写，并把经过本地校验的问题发布到 VS Code 原生 Problems。编辑器内仍提供范围标记、建议卡、Quick Fix、应用/忽略和重新验证后的批量应用。

发送前会在本地遮罩注释、citation、label、URL、文件路径、代码和未知 TeX 结构；公式替换为不可编辑的等长语义占位符，因此模型知道此处有 inline/display formula，但不会收到公式内容。API Key 只存入当前扩展环境的 SecretStorage；每个规范化 Provider/Base URL 使用独立 Key 与授权记录。

完整的费用、隐私、可发送范围、offset 校验、持久化和故障说明见 [AI 写作助手](https://github.com/zhangxh-math/texleaf/wiki/AI-Writing)。

## Math Preview 与 LaTeX Workshop

原生源码编辑器和可视化编辑器共用 Math Preview：支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 及常见数学环境，提供 Cursor、Hover 或两者组合。`autoAbove`（默认）和 `autoBelow` 会根据可见空间翻转；固定 `above` / `below` 不自动改变方向。连续输入采用 last-known-good 更新，临时无效 TeX 不会让卡片每键闪烁。

TeXLeaf 的兼容桥复用 LaTeX Workshop 已加载的运行时模块、编译配方和执行器；运行时结构不兼容时回退到公开命令及必要的临时原生编辑器上下文。PDF 查看、SyncTeX 和编译诊断继续由 LaTeX Workshop 提供。Problems 中的编译错误由 LaTeX Workshop 发布；TeXLeaf 不复制、不解释也不维护编译诊断队列。关闭 `texleaf.visualEditor.latexWorkshopCompatibility` 后，可随时从“原生”源码编辑器手动运行 LaTeX Workshop。

详见 [Math Preview](https://github.com/zhangxh-math/texleaf/wiki/Math-Preview) 和 [可视化编辑器：编译与 PDF](https://github.com/zhangxh-math/texleaf/wiki/Visual-Editor#编译pdf-与-synctex)。

## 设置与文档

在 VS Code Settings 搜索：

```text
@ext:zhangxh-math.texleaf
```

当前有 61 个用户设置，分为五组：片段 22 项、文献 9 项、AI 写作 14 项、可视化编辑器 9 项、预览 7 项。

- [Wiki 首页](https://github.com/zhangxh-math/texleaf/wiki)
- [可视化编辑器](https://github.com/zhangxh-math/texleaf/wiki/Visual-Editor)
- [片段与模板](https://github.com/zhangxh-math/texleaf/wiki/Snippets-and-Templates)
- [Snippet 格式](https://github.com/zhangxh-math/texleaf/wiki/Snippet-Format)
- [文献与 Zotero](https://github.com/zhangxh-math/texleaf/wiki/References-and-Zotero)
- [AI 写作助手](https://github.com/zhangxh-math/texleaf/wiki/AI-Writing)
- [Math Preview](https://github.com/zhangxh-math/texleaf/wiki/Math-Preview)
- [配置参考](https://github.com/zhangxh-math/texleaf/wiki/Configuration)
- [故障排查](https://github.com/zhangxh-math/texleaf/wiki/Troubleshooting)
- [开发与发布](https://github.com/zhangxh-math/texleaf/wiki/Development-and-Release)

## 安全与边界

- 可视化编辑器基于 VS Code 正式 `CustomTextEditorProvider` 和 CodeMirror 6，不向 Monaco 私有 DOM 注入未公开部件。
- Webview、文档编辑、补全、导航、MathJax Worker 和 AI 操作都有版本、范围、大小及过时代次校验；模型文字不能构造可执行命令。
- 可视化结构和项目上下文是安全静态近似，不执行 class/package 或任意 TeX 宏；最终编号、页码、字体、宏展开和版式以真实 TeX 编译为准。
- Webview 不是原生 Monaco `TextEditor`。复杂 Completion command、`additionalTextEdits`、Snippet transform、第三方 Hover/Code Action/Inline Suggest 和扩展专属键位需点击“原生”。
- 未信任工作区不会联网调用 AI、访问 Zotero、创建 bibliography 或加载项目额外片段文件。

## 开发与验证

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

`verify` 会运行主扩展和 Webview TypeScript 检查、单元测试、生产资源构建，以及扩展 bundle 与 MathJax Worker 冒烟测试。可视化交互另有隔离 Extension Host 与 CDP 回归，包括 IME、环境边界、引用跳转、逻辑行导航和长文档快速滚动。

开发流程与 Release 清单见 [开发与发布](https://github.com/zhangxh-math/texleaf/wiki/Development-and-Release)。

## 支持 TeXLeaf

TeXLeaf 是独立维护的 GPL-3.0-only 开源项目。若它对你有帮助，可以通过微信支付、支付宝或 PayPal 支持我喝杯奶茶；赞助不会影响功能开放、Issue 优先级或发布决定。不方便赞助时，Star、可复现的 Issue、文档改进和推荐项目也同样有帮助。

维护者本人没有编程背景，不能独立编写或人工审查代码，主要负责提出真实 LaTeX 使用需求、决定产品取舍、测试和验收；开发实现、功能请求和 PR 审查只能在个人时间允许时借助 AI 辅助完成。一般优先处理可复现的 Bug，不能承诺新增功能、合并 PR、处理时限、定制开发或私人技术支持。项目以个人身份维护和收款，无法开具发票或提供报销、税务抵扣凭证。

[查看赞助方式与隐私说明](SPONSOR.md)

## 致谢与许可

TeXLeaf 由项目发起人 **zhangxh-math** 与 **OpenAI Codex** 联合开发。片段、预览、可视化编辑和引用体验受到 [Gilles Castel 的 latex-snippets](https://github.com/gillescastel/latex-snippets)、[Obsidian Latex Suite](https://github.com/artisticat1/obsidian-latex-suite)、[Snippetleaf](https://github.com/superle3/snippet-leaf)、[Ultra Math Preview](https://github.com/yfzhao20/vscode-ultra-math-preview)、[Overleaf](https://github.com/overleaf/overleaf)、[CodeMirror 6](https://codemirror.net/)、[LaTeX Workshop](https://github.com/James-Yu/LaTeX-Workshop) 与 [VSCode Zotero](https://github.com/jinvim/vscode-zotero) 等项目启发；这不表示上游项目对 TeXLeaf 的官方认可或功能等价。

交换图编辑器实际嵌入 MIT 许可的 quiver 1.7.0（varkor，2018），并随附 KaTeX 0.18.1；汉化与宿主集成为本地补丁，原版权和许可证保留于发行资源中。

TeXLeaf 项目主体采用 [GNU General Public License v3.0 only](LICENSE)。根据 GPLv3 第 7(b) 节允许的合理署名要求，再分发源码、VSIX 或修改版时必须保留 [NOTICE](NOTICE)，并在随附文档或可访问的 About/Credits/Legal Notices 中注明该软件包含或基于 TeXLeaf、原作者为 zhangxh-math，并保留原项目链接。`NOTICE` 同时提供用户文档输出例外：使用 TeXLeaf 的模板、Snippet、编辑、预览或编译功能不会让论文、幻灯片、bibliography 等用户文档自动受 GPL 或署名要求约束。历史上已经按 MIT License 获得的版本继续适用其随附条款；实际随发行包分发的第三方组件继续保留各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。完整说明见 [许可证、署名与再分发](https://github.com/zhangxh-math/texleaf/wiki/License-and-Attribution) 与 [致谢与联合开发](https://github.com/zhangxh-math/texleaf/wiki/Acknowledgements-and-Development)。

报告问题前请阅读 [SUPPORT.md](SUPPORT.md) 和 [故障排查](https://github.com/zhangxh-math/texleaf/wiki/Troubleshooting)；准备提交代码或文档时请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。
