# TeXLeaf

![TeXLeaf icon](media/icon.png)

TeXLeaf 是一个面向 VS Code 桌面版的 LaTeX 写作扩展，把高频片段、Zotero 引用和活动公式预览整合到同一个插件中。它不依赖 Hyperscopes Booster，不接管 LaTeX 编译，也不会把 VSIX 二进制提交到源码仓库。

当前版本：`0.7.1`。支持 Windows、macOS 和 Linux 上的 VS Code `1.98+`；Zotero 联动需要 Zotero 桌面端允许本机通信，推荐安装 Better BibTeX。

安装方式：从 [GitHub Releases](https://github.com/zhangxh-math/texleaf/releases) 下载 `texleaf-0.7.1.vsix`，在 VS Code 运行“Extensions: Install from VSIX...”。源码仓库只保存可审阅的源文件，VSIX 仅作为 Release 资产发布。

## 片段

TeXLeaf 内置 212 条 LaTeX 片段，支持文本、行内数学、行间数学、词边界、自动展开、正则触发、Visual 选区和 v2 占位符。常用例子包括：

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

Math Preview 使用随扩展离线打包的 MathJax 4 和 New Computer Modern SVG 字体，不依赖 Ultra Math Preview、Hyperscopes Booster、CDN 或外部渲染插件。它只渲染当前活动公式，并按文档版本、公式、主题、缩放和宏配置缓存结果，以控制扩展宿主开销。

- 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 及 equation、align、matrix 等数学环境；
- 跳过注释、verb/verbatim 和不安全的未闭结构；
- 行内公式预览默认位于活动源码行下方，并随光标所在行移动；
- 行间公式预览对齐 opening delimiter；超宽公式保持该对齐，右端可能由编辑器裁切；
- 卡片使用不透明、圆角、主题自适应背景，预览内有独立高亮光标；
- 深色主题使用高对比纯白矢量字形和高精度 SVG 渲染提示；
- 支持 Cursor、Hover 或两者组合，并提供防抖、长度、缩放、缓存和受限宏配置。

VS Code 稳定扩展 API 不提供可安全替换编辑器源码行、又能像 Overleaf/Obsidian 一样点击在渲染结果与 TeX 之间切换的 view-zone/DOM 能力，因此本项目不实现伪装成所见即所得的整篇预览，也不内置 PDF 面板。TeXLeaf 保持源码编辑器可预测，只提供活动公式的轻量预览。

预览设置集中在 `TeXLeaf · 预览`。渲染方式、定位边界、主题和性能说明见 Wiki 的 [Math Preview](https://github.com/zhangxh-math/texleaf/wiki/Math-Preview)；全部三组设置的索引见 [配置参考](https://github.com/zhangxh-math/texleaf/wiki/Configuration)。

---

开发、测试和 Release 流程见 [开发与发布](https://github.com/zhangxh-math/texleaf/wiki/Development-and-Release)；常见问题见 [故障排查](https://github.com/zhangxh-math/texleaf/wiki/Troubleshooting)。项目采用 [MIT License](LICENSE)，MathJax 等第三方组件的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
