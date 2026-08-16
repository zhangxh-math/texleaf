# TeXLeaf 配置参考

在 VS Code 设置中搜索 `@ext:local-lab.texleaf` 即可修改配置。设置页按 **TeXLeaf · 编辑与片段**、**TeXLeaf · Zotero 与参考文献**、**TeXLeaf · 高级**、**TeXLeaf · Math Preview** 分成四个原生分类；工作区级设置适合团队统一使用，用户级设置适合个人习惯。

## 设置项

| 设置 | 作用 |
| --- | --- |
| `texleaf.enabled` | 总开关。也可通过 `TeXLeaf: 切换启用状态` 持久切换；有工作区时保存到工作区设置，否则保存到用户设置。 |
| `texleaf.autoSnippets` | 是否处理带 `A` 选项的自动展开片段。 |
| `texleaf.manualTrigger` | 非自动片段的确认键，可选 `tab` 或 `space`。 |
| `texleaf.autoFraction` | 是否把光标前适合的表达式转换为 `\frac{…}{…}`。 |
| `texleaf.autoFractionCommand` | 自动分数所用的 LaTeX 命令，例如 `\frac`、`\dfrac`。 |
| `texleaf.autoEnlargeBrackets` | 插入分数、积分、求和等结构时，是否辅助加入 `\left`/`\right`。 |
| `texleaf.autoEnlargeTriggers` | 触发自动括号放大的 LaTeX 命令列表。 |
| `texleaf.visualSnippets` | 是否启用选择区包裹片段。 |
| `texleaf.matrixShortcuts` | 是否在配置的矩阵类环境中启用单元格、换行等快捷操作。 |
| `texleaf.tabout` | 是否允许 `Tab` 跳到下一个 tabstop、右括号或数学分隔符之外。 |
| `texleaf.skipPairedClosingCharacters` | 输入已有的 `)`、`]`、`}` 时只越过字符，避免重复闭合。 |
| `texleaf.autoDeleteMathDelimiters` | 在空数学分隔符中按退格时删除整对分隔符。 |
| `texleaf.colorizeBrackets` | 按嵌套深度为数学区域中的配对括号着色。 |
| `texleaf.highlightActiveBracketPair` | 突出显示光标附近或包围光标的括号对。 |
| `texleaf.enableCompletions` | 是否把可用片段提供给 VS Code 补全列表。 |
| `texleaf.zoteroCitations` | 是否启用项目 bibliography 与 Zotero 联动的原生引用补全；未信任工作区中始终停用。 |
| `texleaf.autoShowCitationPicker` | 光标进入配置的 citation 命令大括号时是否自动打开 VS Code 原生 Suggest；关闭后可使用手动命令。 |
| `texleaf.bibliographyFile` | 可自定义的 bibliography 工作区相对 `.bib` 路径，默认 `reference.bib`；拒绝绝对路径、URI 和 `..`。 |
| `texleaf.bibliographyFormat` | Zotero 新条目的导入格式，可选 `bibtex` 或 `biblatex`，默认 `bibtex`；不重新格式化已有条目。 |
| `texleaf.citationCommands` | 可触发引用补全的 LaTeX 命令名列表，默认含 `cite`、`citep`、`citet`、`autocite`、`parencite`、`textcite` 等。 |
| `texleaf.zoteroPort` | Zotero/Better BibTeX 本机端口，默认 `23119`；连接主机固定为 `127.0.0.1`。 |
| `texleaf.zoteroLibrary` | Zotero 库名称或内部数字 ID，默认 `My Library`；可指定群组库。 |
| `texleaf.zoteroRequestTimeoutMs` | Zotero 本机请求超时，默认 10000 毫秒。 |
| `texleaf.zoteroCacheSeconds` | Zotero 条目列表的内存缓存时间，默认 30 秒。 |
| `texleaf.mathPreview.enabled` | 内置数学公式预览总开关，默认开启。 |
| `texleaf.mathPreview.presentation` | 显示方式：光标公式旁的 `cursor`（默认）、原生 `hover`，或 `both`；默认值可避免与其他 LaTeX 扩展重复显示 Hover。 |
| `texleaf.mathPreview.placement` | `cursor` 浮动卡片的位置：`auto`（默认）、`above` 或 `below`；自动模式以下方为首选，下方空间不足时切换到上方，上下都不足时仍使用上方并优先保住预览底部与公式末尾代码。 |
| `texleaf.mathPreview.debounceMs` | 停止输入/移动光标后延迟多少毫秒更新预览，默认 120；大文档自动至少使用 300。 |
| `texleaf.mathPreview.scale` | 公式 SVG 的显示缩放，默认 1，范围 0.5–3。 |
| `texleaf.mathPreview.maxSourceLength` | 单条公式送入后台渲染器的最大 UTF-16 字符数，默认 8192，范围 256–32768。 |
| `texleaf.mathPreview.macros` | 可选的 MathJax 宏对象，键不带反斜杠；文档前言中的受支持宏定义覆盖同名设置。 |
| `texleaf.snippetFiles` | 可选的项目专属附加 JSONC 文件；默认是空数组，相对路径按工作区文件夹解析。全局主文件不需要在这里配置；未信任工作区会忽略项目级值。 |
| `texleaf.excludedEnvironments` | 禁止自动处理的 LaTeX 环境，例如 verbatim、代码或抄录环境。 |
| `texleaf.matrixEnvironments` | 被视为矩阵/对齐区域的环境名称列表。 |
| `texleaf.autoFractionBreakingCharacters` | 自动分数向左取分子时的停止字符集合。 |
| `texleaf.maxRegexScanLength` | 正则片段向光标前方扫描的最大字符数。 |
| `texleaf.wordDelimiters` | 带 `w` 选项的片段认可的词边界字符。 |
| `texleaf.languageIds` | 在 `.tex`/`.bib` 文件范围内允许 TeXLeaf 激活编辑功能的 VS Code language ID 列表；默认包含 `latex`、`tex`、`bibtex`。 |

具体默认值与类型以当前版本在 VS Code 设置页中的声明为准；升级后，设置页会展示最新默认值。

## 命令

| 显示名称 | 命令 ID | 用途 |
| --- | --- | --- |
| `TeXLeaf: 管理 Snippet 与模板` | `texleaf.openSnippetEditor` | 打开结构化管理器，搜索、增删改、批量替换并安全保存当前 Profile 的 Snippet 与模板。 |
| `TeXLeaf: 管理 TeX 模板` | `texleaf.openTemplateFile` | 打开同一个管理器并直接切到模板页，可修改 trigger 与完整正文。 |
| `TeXLeaf: 打开高级 Snippet JSONC` | `texleaf.openSnippetFile` | 仅在高级修复、原始审阅或原生 JSONC 工具需要时打开内部后端。 |
| `TeXLeaf: 恢复默认片段` | `texleaf.restoreDefaultSnippets` | 确认并备份现有文件后，用当前版本的完整 212 条默认规则恢复全局库。 |
| `TeXLeaf: 重载片段` | `texleaf.reloadSnippets` | 重新读取全局库与当前项目明确配置的附加文件，并刷新诊断。 |
| `TeXLeaf: 搜索并插入片段` | `texleaf.pickSnippet` | 从可用片段中搜索并插入。 |
| `TeXLeaf: 切换启用状态` | `texleaf.toggle` | 启用或停用 TeXLeaf，并保存到工作区设置（无工作区时保存到用户设置）。 |
| `TeXLeaf: 导入片段` | `texleaf.importSnippets` | 从安全的 JSON/JSONC 文件导入片段。 |
| `TeXLeaf: 导出片段` | `texleaf.exportSnippets` | 将当前全局片段库导出为可审阅的数据文件；不会混入项目附加规则。 |
| `TeXLeaf: 用片段包裹所选内容` | `texleaf.wrapSelection` | 选择 Visual 片段并包裹当前选择。 |
| `TeXLeaf: 显示参考文献补全` | `texleaf.pickCitation` | 在当前 citation 的逗号分段中打开 VS Code 原生 Suggest。 |
| `TeXLeaf: 刷新 Zotero 参考文献缓存` | `texleaf.refreshZotero` | 丢弃内存缓存，并在当前 citation 中重新读取 Zotero。 |
| `TeXLeaf: 切换 Math Preview` | `texleaf.toggleMathPreview` | 切换当前资源范围的 Math Preview 总开关。 |
| `TeXLeaf: 刷新 Math Preview` | `texleaf.refreshMathPreview` | 清除扫描、SVG 和错误缓存，重新渲染当前公式。 |
| `TeXLeaf: 关闭当前 Math Preview` | `texleaf.dismissMathPreview` | 只隐藏当前 decoration；移动光标或继续编辑后可再次出现。 |

## Zotero 引用配置与行为

Zotero 引用补全使用 Zotero 桌面端本机接口，并优先利用兼容版本的 Better BibTeX。建议安装 Better BibTeX，以获得稳定 citation key 和 Better BibTeX/Better BibLaTeX 导出；若对应 JSON-RPC 路由或方法不存在，TeXLeaf 会自动回退到 Zotero 官方 Local API。两种路径都要求在 Zotero 中开启“允许本机其他应用与 Zotero 通信”。`texleaf.zoteroLibrary` 可以匹配库名，也可以直接写内部数字 ID；搜索与单条导出始终使用同一个 library ID，避免群组库条目在 My Library 中查找失败。

Better BibTeX 路径使用其返回的权威 `citekey`；官方 Local API 回退则从 Zotero 的单条导出中取得 key。TeXLeaf 不会在 VS Code 端按作者、年份或标题重新计算 key，也不会调用会改变 key 的 regenerate API。`bibtex` 与 `biblatex` 会在当前连接路径中选择对应导出格式；已有 `.bib` 条目原样保留，不会因切换设置而重新格式化。

去重先比较精确 citation key，再比较规范化 DOI 与 ISBN，最后在字段完整时比较规范化标题、第一作者和年份。若同一 Zotero 文献已经以另一个 key 存在于 bibliography，补全只保留 `.bib` 中的现有项；提交期间才发生的同类导入也会复用最新 `.bib` key，而不是追加重复条目。

### 原生补全与连续添加

自动弹出只发生在以下条件全部满足时：

- 当前 workspace 已信任；
- `texleaf.enabled` 与 `texleaf.zoteroCitations` 为 true；
- 当前文件已经保存为 `.tex`，且 language ID 在 `texleaf.languageIds` 中；
- 只有一个空选择/光标；
- 光标位于 `texleaf.citationCommands` 中某个命令的必选大括号内，并且不在注释、verb/verbatim 或配置排除的环境中。

定位器支持 citation 前的一个或多个可选参数、跨行 key 列表、尚未输入闭合大括号的编辑中状态，以及光标位于已有 key 中间的情况。接受补全后只替换当前逗号分段。例如 `\cite{keepA, query, keepB}` 不会覆盖 `keepA` 与 `keepB`。

补全使用 VS Code 原生 Suggest：左侧结构化 `label` 只显示标题与紧凑来源，不显示 citation key，给标题保留尽可能多的宽度；右侧详情分别显示标题、作者、期刊/出版物、年份、来源/导入状态和 citation key。插件可按标题、作者、年份与 citation key 过滤，因此 key 虽不占用左侧空间，仍可直接搜索。bibliography 已有项以更高排序权重列在前面，左侧来源是当前 `.bib` 文件名；Zotero 新项随后显示为 `Zotero`，右侧标明未导入及目标文件。原生 API 不插入不可选的分隔标题。当前逗号分段就是筛选前缀。每次接受一篇后输入逗号会再次触发补全，因此同一个 `\cite{}` 可以连续加入多篇；查询被退格清空后，后续输入也会重新触发。也可按 `Ctrl+Space` 或运行手动命令重新打开。

### bibliography 路径

`texleaf.bibliographyFile` 是可自定义的项目内相对路径，默认 `reference.bib`。若它只是文件名，TeXLeaf 会从当前 TeX 文件目录逐级向上查找，但不会越过当前 workspace folder；未找到时使用 workspace folder 根目录。若设置含子目录，例如 `bib/sources.bib`，则固定按 workspace folder 根目录解析。无 workspace folder 的本地 `.tex` 文件使用其所在目录。多根工作区不会跨根寻找同名文件。

`texleaf.bibliographyFormat` 决定从 Zotero 导入新条目时使用 `bibtex` 还是 `biblatex`，默认 `bibtex`。已有 bibliography 内容保持原样。0.4.0 中显式配置过的旧名称 `texleaf.zoteroExportFormat` 仍会作为兼容回退读取，但不再显示在设置 UI；只要显式设置新名称，新值就优先。

不存在的 bibliography 只会在实际选择 Zotero 新条目后创建，父目录由 VS Code Workspace FS 创建。读取优先使用已经打开的 `TextDocument`，所以尚未保存的 BibTeX 修改参与分组与重复 key 检查；不会直接用 Node 文件 API 覆盖编辑器模型。

### 提交、保存与冲突

接受一个 Zotero 补全后先完成单条导出，再进入串行提交。提交阶段重新读取 bibliography，并要求当前 TeX 文档和 citation 上下文仍有效。导出必须可解析为恰好一个、key 与选择项一致的条目；失败时会取消本次操作。

需要追加的 BibTeX 与当前 citation 分段使用同一个 `WorkspaceEdit`；目标 bibliography 不存在时，文件创建也包含在这次编辑中。因此 VS Code 文本模型不会出现“key 已插入但条目未追加”或相反的半完成状态。换行沿用现有 CRLF/LF，原文件内容不重排。原本干净或新建的 bibliography 在成功后自动保存；原本 dirty 的 bibliography 保持 dirty，避免顺带保存用户的其他未提交编辑。

若提交前发现 Zotero key 已由其他操作加入，会复用已有条目而不重复追加；若 `reference.bib` 本身存在未闭合条目或重复 key、导出 key 不安全、或同名 key 的元数据明显冲突，则阻止自动写入并要求用户先修复冲突。

### 错误与环境限制

连接拒绝通常表示 Zotero 未运行，HTTP 403 表示 Zotero 未允许本机应用通信；Better BibTeX 路由或方法不存在时会尝试官方 Local API，而不是立即失败。JSON-RPC 即使 HTTP 为 200 也可能携带 `error`，TeXLeaf 会按错误响应处理。自动加载失败会写入 `TeXLeaf` 输出通道并短暂冷却后允许重试；手动运行刷新命令会立即重试，并用错误提示说明超时、无效 JSON、库名不存在、空 citekey 或 exporter 错误。bibliography 已有候选始终可继续使用。

扩展清单优先选择本地 UI extension host，目的是让 Remote SSH、WSL 与 Dev Container 文档也能访问桌面 `127.0.0.1`，文件编辑仍通过 VS Code URI API 发到对应 workspace。如果 TeXLeaf 实际只安装在远端，localhost 就是远端机器；应把扩展安装到本地端，或自行建立受控的端口转发。VS Code Web 没有此 Node 桌面工作流。未信任 workspace 不连接 Zotero、不创建 bibliography，也不应用引用写入。

## Math Preview 配置与行为

`cursor`/`both` 模式的预览卡片在安全 SVG 内绘制圆角背景、边框与内边距。卡片底色在深浅主题中均为 100% 不透明，并位于源代码文字之上。公式光标显示为与公式前景明显区分的窄竖线：深色主题为高亮青色，浅色主题为鲜明洋红色。深色公式使用纯白矢量路径、深色实底和 SVG `geometricPrecision` 渲染提示；没有用会同时破坏分数线、根号和定界符的全局描边。光标位于 TeX 语法结构内部时会吸附到最近的安全排版边界；若标记版本不能渲染，则自动显示不带标记的原公式。

Math Preview 只对已保存的 `.tex` 文件和 `latex`/`tex` language ID 生效。它复用 TeXLeaf 的 LaTeX 扫描状态机识别 `$…$`、`$$…$$`、`\(…\)`、`\[…\]` 和常见数学环境，并跳过注释、`\verb` 以及排除环境。嵌套的 `align`/`cases`/matrix 等区域只生成一个最外层预览，避免重复装饰；尚未输入闭合分隔符时，可以按光标位置生成临时闭合的编辑中预览。

默认 `cursor` 模式只渲染主光标所在的一个公式。行内公式的 `auto` 卡片固定在活动源码行下方：光标仍在公式起始行时对齐 `$` 或 `\(` 的反斜杠；进入后续源码行时改为对齐该行首个非空白字符，保留缩进但不跟随光标横坐标。行间公式对齐 `$$`、`\[` 或 `\begin{…}` 的真实起始定界符列，并补偿跨行缩进和 Tab 差异。VS Code 公共扩展 API 不公开编辑器内容区的实时像素宽度，所以超宽卡片的右端可能被编辑器裁切；插件不会用窗口宽度猜测代替编辑器宽度。浮动卡片不参与源代码行宽和自动换行计算，因此在公式后继续输入不会被卡片推挤、折行或叠到一起。

`texleaf.mathPreview.placement` 可固定为 `above`/`below`。默认 `auto` 对行内公式稳定使用下方，避免移动光标时上下跳动；对行间公式先尝试下方，下方可见空间不足才切换到上方。如果超高行间公式在上下两侧都没有足够空间，`auto` 仍选择上方，并用公式末尾附近作为垂直参照，使预览公式的底部与公式代码的最后几行尽量同时留在视口内。此时预览顶部被裁掉属于预期行为。正常高公式不会压缩到旧的 8em 上限；仅当宽度超过 40em 时等比缩放，并保留 256em 的异常几何安全上限。

VS Code 稳定扩展 API 没有可供此功能使用的公开 view-zone 或任意浮层定位接口。为实现上述布局，`cursor` 模式使用一小段固定、内部生成且不接受用户内容的 Monaco decoration CSS 兼容层；它只负责定位，卡片内容和底色仍由经过清理的 SVG 提供。兼容层不能为预览保留真正的编辑器行高，因此公式上下均无空白行时，卡片可能暂时遮住相邻行；超高预览也可能从顶部超出视口，`auto` 会有意保留其底部。若未来 VS Code、主题或平台不接受该定位方式，可把 `texleaf.mathPreview.presentation` 设为 `hover`，改用完全基于公开 HoverProvider 的预览；`both` 同时启用两者。如果 LaTeX Workshop 也生成数学 Hover，建议保留默认 `cursor`，避免同一位置显示两份内容。按 `Esc` 只关闭当前预览，不改变持久设置。

TeXLeaf 使用离线打包的 MathJax SVG 渲染器和 New Computer Modern 字体。MathJax 在首次需要公式时才在独立 Node Worker 中载入，主扩展线程不执行排版。扫描结果按 `TextDocument.version` 缓存，重复公式复用有上限的 SVG 缓存，异步结果带代次校验，过时渲染不会覆盖新内容。渲染有 5 秒超时、长度上限、宏数量/展开上限和短暂错误冷却；SVG 会拒绝脚本、事件属性、外部链接、`foreignObject` 等活动内容。

文档前言中支持 `newcommand`、`renewcommand`、`providecommand` 和 `DeclareMathOperator`（含星号变体）；不扫描 `\input`/`\include` 中的外部宏，也不尝试执行任意 TeX 包加载。渲染器只加载显式允许的 MathJax package，不启用 `require`、`autoload`、HTML/TeXHTML 或运行时 `setoptions`。

本功能不依赖 Ultra Math Preview、Hyperscopes Booster、TextMate grammar 重解析或 Oniguruma WASM。TeXLeaf 只借鉴“光标驱动公式预览”这一产品思路，区域扫描、宏处理、布局规划、缓存、Worker、SVG 清理和测试均为本项目的独立实现；没有复制 Ultra 或 Booster 的源码、正则、CSS 或资源。

VS Code 没有允许单个扩展控制 Electron GPU 的公开 API，而且 MathJax TeX 解析/SVG 排版主要消耗 CPU，所以没有提供名不副实的硬件加速开关。需要降低开销时，优先提高 `debounceMs`、降低 `maxSourceLength`，或关闭 `mathPreview.enabled`；后台 Worker 与缓存始终启用，不需要额外配置。

## 内置 Snippet 与模板管理

`TeXLeaf: 管理 Snippet 与模板` 打开结构化面板，不显示或要求用户处理存储路径。Snippet 页支持 trigger/replacement/options/priority/category/description/flags/占位符版本/启用状态编辑，模板页支持名称、trigger、说明和完整 TeX 正文编辑；两页都有搜索、添加、复制、删除、恢复默认，以及带字段范围、大小写、正则、预览和撤销的批量查找替换。保存前后使用 revision 校验，检测到另一个窗口、Settings Sync 或高级编辑器的变化时拒绝覆盖。

在 Windows Stable 中，其典型位置是 `%APPDATA%\Code\User\globalStorage\local-lab.texleaf\texleaf-snippets.jsonc`。实际路径由当前 VS Code Profile 与运行环境决定；命令入口会始终使用正确 URI。该文件不属于任何项目，切换工作区无需复制。不同 VS Code Profile 或不同 Remote 主机拥有各自的全局存储。

首次创建时，文件直接包含当前版本的 212 条默认规则、`GREEK`、`SYMBOL`、`MORE_SYMBOLS` 三个变量，以及 `defaultsRevision` 迁移标记。运行时只有这份全局文件和用户显式配置的项目附加文件，不再有隐藏的 `builtin` 或 `settings` 片段源。用户可以在全局文件中直接修改、禁用或删除默认规则；`defaultsRevision` 已完成后，启动时不会把用户删除的规则重新补回。

article/Beamer 长模板保存在当前 Profile 的插件内部、可同步模板库中，不混入主 JSONC。首次升级会一次性迁移旧 `globalStorageUri/templates/*.tex` 的自定义内容，之后运行时不再依赖这些外部副本。模板只会在已保存、除空白与完整 trigger 外没有其他内容的 `.tex` 文档中，由单光标输入完整 trigger 后自动展开；展开会替换整份空白文档。`texleaf.autoSnippets` 是模板自动展开总开关；关闭时可在完整 trigger 后按 `Tab`。模板正文使用 v2 的 `@0`、`@1`、`@{1:默认文本}` 占位符，字面量 `@` 写成 `@@`。

无论从全局文件、导入文件还是项目附加文件加载，`replacement` 都必须是字符串。函数、RegExp literal、导入语句或其他 JavaScript 表达式不会执行。

`texleaf.snippetFiles` 只用于显式添加项目专属文件，默认不会读取 `.vscode/texleaf-snippets.jsonc`。旧版留下的工作区文件不会被读取、复制或删除；若要把其中的内容迁入全局库，请运行 `TeXLeaf: 导入片段` 并明确选择该文件。

在未信任工作区中，VS Code 会限制 `texleaf.snippetFiles`，防止项目在未经同意时注入自动片段。用户级全局 JSONC 主文件仍然可用。

### 0.2.x 一次性迁移

0.3.0 首次看到没有当前 `defaultsRevision` 的有效全局文件时，会执行一次追加式迁移。原文件中的片段和变量优先；随后加入旧版用户级 `texleaf.customSnippets` 中尚不存在的有效纯数据条目，最后补齐缺失的工厂默认规则和三个默认变量。对象式且 `snippets` 为数组的 JSONC 会尽量保留注释、未知顶层字段、原顺序与未修改条目的格式；顶层数组或旧字符串格式需要规范化，因此会重新序列化，但迁移前的原始字节仍保存在备份中。

`texleaf.customSnippets` 已从 0.3.0 设置清单中移除，也不再参与运行时匹配。迁移代码只读取旧设置的用户全局值一次，不读取或提升工作区级旧值。若旧设置无效，只跳过相关定义并报告问题。迁移需要改写文件时会先在 `globalStorageUri/backups` 中创建逐字节备份；全局文件本身无效或在迁移期间发生变化时不会覆盖。

revision 2 会追加缺失的定理类片段；只有仍与 revision 1 出厂记录完全一致的 `mode.inline` 才会从 `mk` 改为 `lm`。revision 3 只迁移仍与 revision 2 出厂记录完全一致的 13 个定理条目：裸 trigger 改为带反斜杠并加入自动选项，例如 `thm`/`tw` 变为 `\thm`/`tAw`，definition 的 `def` 则变为 `\dfn`。已禁用或改写的同 ID 记录视为用户自定义并保留；一旦文件标记 revision 3，之后主动删除的默认规则也不会复活。默认库仍是 212 条。

### 恢复默认与本地备份

`TeXLeaf: 恢复默认片段` 可从 Command Palette、片段侧栏标题和内置管理器运行。它是完整替换而不是合并：确认后使用当前版本的 212 条默认规则与三个变量替换全局文件。高级 JSONC 编辑器或管理器有未保存内容时会被拒绝；确认期间磁盘哈希变化时会取消；写入前先创建并校验原文件的逐字节备份，再通过临时文件替换并重新加载验证。

备份位于当前环境的 `globalStorageUri/backups`，不会纳入 Settings Sync。恢复成功通知可以直接打开备份；若要撤回，可审阅后运行 `TeXLeaf: 导入片段`。

### Settings Sync 镜像

可编辑的唯一真源仍是当前 VS Code Profile/扩展宿主下的 `globalStorageUri/texleaf-snippets.jsonc`。这个文件不会被 Settings Sync 原生上传；TeXLeaf 把有效、已保存的完整 JSONC 内容封装到一个私有 `globalState` envelope，并通过 `globalState.setKeysForSync(...)` 注册。片段库不会写入公开 `settings.json`，同步镜像也不是额外的运行时片段来源。

用户必须在 VS Code 中主动开启 Settings Sync，并在同步内容中包含 Extensions。关闭同步时，本地文件和所有编辑功能仍正常工作。手工安装的 VSIX 不会因为片段镜像而自动出现在另一台机器；每个设备仍需安装标识为 `local-lab.texleaf` 的相同或兼容版本。

同步 envelope 的 **JSON 序列化结果上限为 256 KiB**，不是单纯源文件的字节数。超过上限时本机文件和当前片段继续可用，但新内容不上传。JSONC 无效、缺少有效 `snippets` 结构、高级 JSONC 编辑器 dirty，或管理器存在未保存内容时，上传与下载 reconciliation 都会延后，并保留上一次有效云端镜像。

同步使用 local、remote、base 三方内容哈希：

| 状态 | 行为 |
| --- | --- |
| local、remote 与共同 base 一致 | 只更新/确认共同基线，不改文件 |
| 只有 local 相对 base 变化 | 上传新的有效本地 envelope |
| 只有 remote 相对 base 变化 | 通过 repository CAS 复核磁盘，创建原字节备份后应用远端内容 |
| local 与 remote 都相对 base 变化 | 提示用户选择，不静默采用最后写入者 |
| 首次没有 base，且两边是不同的非默认库 | 视为冲突并提示选择 |
| 新设备只有精确工厂默认文件，而 remote 已有同步库 | 可安全恢复远端库；替换前仍创建本地备份 |

同步 envelope 还记录 lineage。即使两台机器的内容都源自同一个父版本，只要各自修改后形成兄弟分支，也会按并发冲突处理，而不是根据到达顺序静默覆盖。

VS Code 没有公开的 `globalState` 同步变更事件。TeXLeaf 会在窗口重新获得焦点、repository 重新加载、原生编辑器保存/关闭，以及约 15 秒轮询时检查；因此 TeXLeaf 自身的本地发现通常不必等待超过下一轮检查，但 VS Code 云端传播耗时另计，这不是实时共同编辑。若首次启动时既没有本地共同基线也尚未收到云端 envelope，TeXLeaf 会跨短会话保留起始时间并提供约 30 秒水合宽限，避免过早把新设备工厂文件上传成云端真源。

应用远端内容前会再次验证片段结构、检查 dirty 状态并比较本地基线哈希；比较期间文件发生变化会取消本次应用。同步替换的原字节备份只保存在接收端当前环境的 `globalStorageUri/backups`，不会上传。

`globalState` 和 `globalStorageUri` 都按 VS Code Profile 隔离。Stable/Insiders、本地窗口以及 SSH、WSL、Dev Container 等 Remote 扩展宿主可能各有扩展安装、全局文件和同步副本；同步是在这些副本之间汇合内容，不是让它们共用一个磁盘路径。

### 来源优先级

TeXLeaf 的来源顺序是：

1. `texleaf.snippetFiles` 明确指定的项目附加文件；
2. 用户级全局 JSONC 主文件。

因此，在匹配条件、trigger 长度和 `priority` 相同的情况下，显式项目附加文件优先于全局文件。若规则声明了不同的数字 `priority`，较高的 `priority` 会先参与选择。变量先读取全局文件，再由当前文档所属工作区的显式附加文件覆盖同名值。工作区外文档只使用全局库。

## 功能说明

### 文件作用域

自动/手动片段、补全、选择区包裹、侧栏直接插入、自动分数、括号辅助以及矩阵快捷键只在已经保存为 `.tex` 或 `.bib` 的文件中运行，后缀判断不区分大小写。Untitled、无后缀文件、`.md`、`.tex.md` 与 `.bib.json` 都不会触发 TeXLeaf。这个后缀门槛是固定的；`texleaf.languageIds` 只能在允许的两个后缀内进一步收窄，不能把 TeXLeaf 扩展到其他文件类型。

Snippet 配置命令和侧栏仍然可以在任意编辑器上下文中打开，因此无需先切换到 TeX 文件或打开任何工作区，就能维护全局主文件。

### 自动分数

在数学区域输入 `/` 时，TeXLeaf 先保留可见的斜杠并记录左侧候选分子；首个有效分母字符到来时才完成转换。例如输入 `1/2` 的过程是先显示 `1/`，输入 `2` 后再得到 `\frac{1}{2}`，光标留在分母中。扫描受括号配对和 `texleaf.autoFractionBreakingCharacters` 限制，不会尝试理解完整 TeX 宏展开。

自动片段匹配先于待处理的自动分数，所以输入第二个 `/` 时，默认 `//` 显式片段仍可展开为空分子、空分母的结构。若规则不适合当前写作习惯，可关闭 `texleaf.autoFraction`，继续单独使用 `//`。

### 自动放大括号

当插入内容使当前括号需要适应较高的数学结构时，TeXLeaf 可以使用 `\left` 与 `\right`。此功能是文本层面的保守改写，不调用 TeX 引擎；复杂宏或不平衡括号可能不会处理。

### Matrix 快捷键

矩阵快捷键只在 `texleaf.matrixEnvironments` 列出的 matrix、align 等环境中工作：`Tab` 在活动 snippet tabstop 处理完成后插入下一列的 ` & `；`Enter` 在块级环境插入 `\\`、换行并保留当前缩进，在行内矩阵中插入带空格的 `\\`；`Shift+Enter` 跳到当前数学环境之后。若某个自定义环境行为异常，将其移出列表即可。

同一个 `texleaf.matrixShortcuts` 开关也控制安全的 left/right 跨行 Enter：在 equation、align、aligned、gather、multline、flalign、split 等可换行数学环境中，光标位于唯一、顶层匹配的 `\left…\right…` 内时，Enter 会在上一行插入 `\right.\\`，并在保持缩进的下一行插入 `\left.`。遇到跨光标嵌套 pair、花括号参数、命令 token、`&`、已有行终止、comment/verb 或嵌套环境时不会猜测，直接回到原来的矩阵或普通 Enter。

### Tabout

Tabout 优先遵守活动 snippet 的 tabstop；没有可前往的 tabstop 时，再尝试越过临近的右括号或数学分隔符。原生 Suggest 会把与当前输入精确相同的 TeXLeaf trigger 优先显示并预选，例如 `\thm`、`\lem`、`\dfn`、`\cor`；普通非精确候选仍遵循 VS Code 的原生排序。模板、定理环境或 `dm` 的自动展开偶发未触发时，直接按 `Tab` 会精确展开 TeXLeaf 片段，不会接受一个相近的普通单词；这个 exact 路径在 Suggest 已打开时仍优先。若 `Tab` 已被其他扩展接管，可通过键盘快捷方式页面检查 `texleaf` 命令的 when 条件与冲突来源。

### 数学上下文

TeXLeaf 识别常见的 `$ … $`、`\( … \)`、`$$ … $$`、`\[ … \]` 与配置允许的环境。该判断面向低延迟输入，不等价于完整 TeX 解析：注释、转义、嵌套宏和不完整源码都可能影响结果。把 `verbatim`、`lstlisting`、`minted` 等不应展开的区域加入 `texleaf.excludedEnvironments`。

`\label{...}`、`\tag{...}` 与 `\tag*{...}` 的参数会被识别为片段抑制区，即使它们位于 equation/align 内、跨行或含嵌套花括号，数学 trigger 也不会展开；闭合最外层参数后立即恢复外层数学上下文。

### 整篇所见即所得边界

TeXLeaf 不把普通 VS Code 文本编辑器改造成 Overleaf/Obsidian 式整篇所见即所得界面。VS Code 的稳定扩展 API 无法在原文本范围里提供可点击、可交互、能自动重排编辑器行高的任意 MathJax 替换部件；Decoration 也没有可靠的点击回调。按照产品约束，本版没有加入 PDF Webview 或自定义编辑器来冒充这个功能，只保留不修改文档内容、字符偏移、光标或选择范围的当前公式浮动预览。

## 与其他扩展共存

TeXLeaf 可以和 LaTeX Workshop 等编译、预览或语言服务扩展同时使用。如果相同按键或补全触发重复：

1. 先确认 `texleaf.autoFraction`、`texleaf.matrixShortcuts` 等目标功能没有被用户或工作区设置关闭；升级不会重置这些覆盖值。
2. 在键盘快捷方式页面搜索 `texleaf` 与冲突按键；需要精确定位时运行 `Developer: Toggle Keyboard Shortcuts Troubleshooting`。
3. 关闭 `texleaf.enableCompletions`，判断是否为补全提供器重复。
4. 临时关闭 `texleaf.matrixShortcuts` 或 `texleaf.tabout`，缩小按键冲突范围。
5. 确认文件已经保存为 `.tex` 或 `.bib`，再用 `texleaf.languageIds` 在这两个后缀内限定适用语言。
