# TeXLeaf

![TeXLeaf icon](media/icon.png)

TeXLeaf 是一个面向 VS Code 桌面版的 LaTeX 写作扩展，把高频片段、Zotero 引用和活动公式预览整合到同一个插件中。它不接管 LaTeX 编译，也不会把 VSIX 二进制提交到源码仓库；功能构思与交互设计受到下文所列开源项目的启发。

当前版本：`0.7.2`。支持 Windows、macOS 和 Linux 上的 VS Code `1.98+`；Zotero 联动需要 Zotero 桌面端允许本机通信，推荐安装 Better BibTeX。

安装方式：优先从 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=zhangxh-math.texleaf) 安装；Marketplace 首次发布完成前，也可以从 [GitHub Releases](https://github.com/zhangxh-math/texleaf/releases) 下载 `texleaf-0.7.2.vsix`，在 VS Code 运行“Extensions: Install from VSIX...”。源码仓库只保存可审阅的源文件，VSIX 仅作为 Release 资产发布。

从旧身份 `local-lab.texleaf` 升级时，先在旧版中保存所有修改；如果改过模板，还应逐项保留模板名称、trigger、说明和正文。安装新版后，它会在旧版仍启用时暂停激活：此时先**禁用但不要卸载**旧版，再执行“Developer: Reload Window”。新版会在新主文件不存在、旧 JSONC 有效且磁盘内容没有变化时尽力逐字节复制旧 Snippet，并保留旧文件；确认新库无误、按需重建自定义模板后再卸载旧版。未修改的四个工厂模板会由新版自动创建。

## 片段

TeXLeaf 首次创建全局用户片段库时写入 212 条可编辑的 LaTeX 默认规则，并提供一键备份与恢复默认；运行时不再区分隐藏的内置片段和用户片段。规则支持文本、行内数学、行间数学、词边界、自动展开、正则触发、Visual 选区和 v2 占位符。常用例子包括：

- `lm` → `\(...\)`，`dm` → `\[...\]`；
- `\thm`、`\lem`、`\dfn`、`\cor` 等 13 个定理类环境自动展开；
- 分式、上下标、括号放大、矩阵、希腊字母、物理与量子力学片段；
- 矩阵和 align 环境中的 Tab 插列、Enter 换行、Shift+Enter 跳出；
- `\label{...}`、`\tag{...}` 和 `\tag*{...}` 内自动抑制数学片段，避免标签文本被意外展开；
- 可换行数学环境中对安全的 `\left...\right...` 结构执行智能跨行 Enter。

运行 `TeXLeaf: 管理 Snippet 与模板` 可打开结构化管理器。Snippet 页提供搜索、分类/状态筛选、添加、复制、删除、启用/禁用，以及 trigger、replacement、options、说明、分类、优先级、正则 flags 和占位符版本编辑；查找替换支持字段范围、大小写、正则、变更预览和草稿撤销。高级用户仍可显式打开 JSONC，但日常使用无需接触外部配置文件。

四个长模板保存在当前 VS Code Profile 的插件内部模板库中，不作为运行时外部文件：

| Trigger | 模板 |
| --- | --- |
| `tmpa-cn` | 中文 article |
| `tmpa-en` | 英文 article |
| `beamer-cn` | 中文 Beamer |
| `beamer-en` | 英文 Beamer |

在已保存且内容为空白的 `.tex` 文档中输入完整 trigger 即可自动展开。模板页可以修改名称、trigger、说明和完整 TeX 正文，也可以添加、复制、删除和恢复模板；保存后立即生效。出厂 article 模板使用 `reference.bib`，默认 BibTeX 样式为 `alpha`，并已移除姓名、邮箱、学校和导师等个人信息。

片段设置集中在 VS Code Settings 的 `TeXLeaf · 片段`，包括总开关、自动片段、补全、项目片段文件、数学快捷键和高级匹配参数。详细格式、迁移与安全边界见 Wiki 的 [片段与模板](https://github.com/zhangxh-math/texleaf/wiki/Snippets-and-Templates) 和 [Snippet 格式](https://github.com/zhangxh-math/texleaf/wiki/Snippet-Format)。

## 文献

当光标位于 `\cite{...}`（以及配置的其他引用命令）参数中时，TeXLeaf 使用 VS Code 原生 Suggest 展示参考文献：

- 第一组来自项目 `reference.bib` 中已有的条目；
- 第二组来自 Zotero/Better BibTeX 中尚未写入该 `.bib` 的条目；
- 输入题目、作者、年份或 citation key 的任意部分均可筛选；
- 支持一个 `\cite{...}` 中连续加入多个、逗号分隔的 key；
- 接受已有条目时只插入 key；接受 Zotero 条目时先导出 BibTeX/BibLaTeX，再以同一个 `WorkspaceEdit` 写入 bibliography 并插入 key；
- bibliography 文件名和导出格式均可配置，默认分别是 `reference.bib` 和 BibTeX。

TeXLeaf 自己的 Suggest 条目在左侧只显示标题和来源，避免 citation key 挤占宽度；右侧详情按字段显示完整标题、作者、期刊/出版物、年份、`Citation key`、来源与导入状态。LaTeX/TeX 文档默认关闭 VS Code 的普通文档单词建议。VS Code 不允许一个 Completion Provider 删除另一个扩展的候选，因此 LaTeX Workshop 若同时提供 citation completion，仍由它自己的设置控制。

Zotero 连接固定使用 `127.0.0.1`，不会访问远程 Zotero 账户。优先调用 Better BibTeX JSON-RPC 获取稳定 citekey 和 BibTeX/BibLaTeX；不可用时回退 Zotero 官方 Local API。请在 Zotero 中启用“允许本机其他应用与 Zotero 通信”。Zotero 8+ 与当前 Better BibTeX 是推荐组合；使用旧版 Zotero 时请同时核对对应 BBT 版本。

文献设置集中在 `TeXLeaf · 文献`，涵盖功能开关、自动弹出、bibliography 路径、引用命令、Zotero 端口/文库、超时/缓存和 BibTeX/BibLaTeX 格式。完整流程与故障排查见 Wiki 的 [文献与 Zotero](https://github.com/zhangxh-math/texleaf/wiki/References-and-Zotero)。

## 预览

Math Preview 的产品方向受到 Ultra Math Preview 与 hscopes-booster 启发。TeXLeaf 当前使用随扩展提供的 MathJax 4 和 New Computer Modern SVG 字体渲染活动公式，并按文档版本、公式、主题、缩放和宏配置缓存结果，以控制扩展宿主开销。

- 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 及 equation、align、matrix 等数学环境；
- 跳过注释、verb/verbatim 和不安全的未闭结构；
- 行内公式预览默认位于活动源码行下方，并随光标所在行移动；
- 行间公式预览对齐 opening delimiter；超宽公式保持该对齐，右端可能由编辑器裁切；
- 卡片使用不透明、圆角、主题自适应背景，预览内有独立高亮光标；
- 深色主题使用高对比纯白矢量字形和高精度 SVG 渲染提示；
- 支持 Cursor、Hover 或两者组合，并提供防抖、长度、缩放、缓存和受限宏配置。

VS Code 稳定扩展 API 不提供可安全替换编辑器源码行、又能点击在渲染结果与 TeX 之间切换的公开 view-zone/DOM 能力。TeXLeaf 因此专注于保持源码编辑器可预测的活动公式轻量预览，不提供整篇所见即所得替换或内置 PDF 面板。

预览设置集中在 `TeXLeaf · 预览`。渲染方式、定位边界、主题和性能说明见 Wiki 的 [Math Preview](https://github.com/zhangxh-math/texleaf/wiki/Math-Preview)；全部三组设置的索引见 [配置参考](https://github.com/zhangxh-math/texleaf/wiki/Configuration)。

## 致谢与联合开发

TeXLeaf 由项目发起人 **zhangxh-math** 与 **OpenAI Codex** 联合开发。zhangxh-math 在开始本项目时并不懂如何编写 VS Code 插件，主要负责提出真实的 LaTeX 写作需求、选择功能方向、决定优先级、持续安装测试并反馈验收；Codex 协助完成资料研究、架构设计、代码实现、自动化测试、文档编写与问题定位。最终产品取舍、发布决定和仓库维护仍由项目维护者负责。

片段系统与高速 LaTeX 输入体验感谢以下项目带来的灵感：

- [latex-snippets](https://github.com/gillescastel/latex-snippets)：Gilles Castel 基于 Vim、UltiSnips 与 VimTeX 展示的高效 LaTeX 输入工作流；
- [Obsidian Latex Suite](https://github.com/artisticat1/obsidian-latex-suite)：可编辑片段格式、上下文触发、自动分式、矩阵、Visual 与 Tabout 等交互；
- [Snippetleaf](https://github.com/superle3/snippet-leaf)：把片段体验适配到另一种编辑器宿主的实践，以及格式与占位符兼容思路；
- [VSCode-LaTeX-Inkscape](https://github.com/sleepymalc/VSCode-LaTeX-Inkscape)：把高速 LaTeX/片段工作流带入 VS Code 的实践。

Math Preview 感谢：

- [Ultra Math Preview for VS Code](https://github.com/yfzhao20/vscode-ultra-math-preview)：实时公式预览的产品构思与使用体验；
- [hscopes-booster（HyperScopes Booster）](https://github.com/yfzhao20/hscopes-booster)：面向 VS Code 扩展的 token 与 TextMate scope 查询思路。

Zotero 与参考文献工作流感谢：

- [Overleaf](https://github.com/overleaf/overleaf)：开源协作式 LaTeX 项目编辑体验；
- [VSCode Zotero](https://github.com/jinvim/vscode-zotero)：从本地 Zotero 选择文献并把 Bib(La)TeX 条目写入项目 bibliography 的工作流。

这里的“感谢、启发与参考”描述的是对公开产品设计、交互和工作流的学习，不表示这些上游项目对 TeXLeaf 的官方认可、隶属关系或功能等价。更完整的逐项说明、联合开发过程与来源边界见 Wiki 的 [致谢与联合开发](https://github.com/zhangxh-math/texleaf/wiki/Acknowledgements-and-Development)；实际随发行包分发的第三方组件及许可证以 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 为准。

---

开发、测试和 Release 流程见 [开发与发布](https://github.com/zhangxh-math/texleaf/wiki/Development-and-Release)；使用问题见 [支持说明](SUPPORT.md) 与 [故障排查](https://github.com/zhangxh-math/texleaf/wiki/Troubleshooting)。项目采用 [MIT License](LICENSE)，MathJax 等第三方组件的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
