# TeXLeaf 配置参考

在 VS Code 设置中搜索 `@ext:zhangxh-math.texleaf` 即可修改配置。0.8.9 的 52 个用户可见设置按 **TeXLeaf · 片段**（22 项）、**TeXLeaf · 文献**（9 项）、**TeXLeaf · AI 写作**（14 项）、**TeXLeaf · 预览**（7 项）分成四个原生分类。全部 AI 写作设置都是 application 级，只能由用户/Profile 设置控制；真正联网前仍要求受信任工作区、针对实际接收地址的明确同意，以及 SecretStorage 中该目标专用的 API Key。

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
| `texleaf.aiWriting.enabled` | AI 写作助手总开关，默认 `false`；关闭时不向任何 AI 服务发出请求。 |
| `texleaf.aiWriting.automaticReview` | 总开关打开后，停止键入时是否自动局部检查本次改动的正文句子。 |
| `texleaf.aiWriting.inlineCompletions` | 总开关打开后，是否请求词语和句子行内补全。 |
| `texleaf.aiWriting.provider` | 当前 AI 服务商，可选 `deepseek`（默认）或 `openai`；切换服务商或任一 Base URL 后，需要使用该规范化目标自己的 consent 和 API Key。 |
| `texleaf.aiWriting.deepseekModel` | DeepSeek Chat Completions 模型，默认低延迟 `deepseek-v4-flash`，可选质量优先的 `deepseek-v4-pro`。 |
| `texleaf.aiWriting.deepseekBaseUrl` | DeepSeek Chat Completions Base URL，默认 `https://api.deepseek.com`；TeXLeaf 只请求 `{Base URL}/chat/completions`。远程地址必须为 HTTPS，HTTP 只允许回环主机。 |
| `texleaf.aiWriting.openaiModel` | OpenAI Responses 模型 ID，默认 `gpt-5.6-luna`；自定义 Responses 服务可填写其安全模型 ID。 |
| `texleaf.aiWriting.openaiBaseUrl` | OpenAI Responses Base URL，默认 `https://api.openai.com/v1`；TeXLeaf 只请求 `{Base URL}/responses`。远程地址必须为 HTTPS，HTTP 只允许回环主机。 |
| `texleaf.aiWriting.language` | 检查语言：自动识别、英语论文或中文学术写作。 |
| `texleaf.aiWriting.style` | 写作风格：学术、通用或简洁。 |
| `texleaf.aiWriting.reviewDelayMs` | 自动检查防抖，默认 900 毫秒，可设置为 500–10000 毫秒。 |
| `texleaf.aiWriting.completionDelayMs` | 自动行内补全发出请求前的额外等待，默认 500 毫秒。 |
| `texleaf.aiWriting.maxParagraphLength` | 单个自动检查句子或手动正文段最多发送的 UTF-16 字符数，默认 6000；设置名为兼容旧配置而保留。 |
| `texleaf.aiWriting.maxDocumentLength` | 手动整篇检查单次最多发送的正文 UTF-16 字符数，默认 30000。 |
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
| `TeXLeaf: 切换 AI 写作助手` | `texleaf.aiWriting.toggle` | 显示首次联网与计费确认，并持久启用或关闭总开关。 |
| `TeXLeaf: 设置当前 AI 服务商 API Key` | `texleaf.aiWriting.setApiKey` | 使用密码输入框，把当前 Provider/规范化 Base URL 的 Key 保存到本扩展环境的 SecretStorage。 |
| `TeXLeaf: 清除当前 AI 服务商 API Key` | `texleaf.aiWriting.clearApiKey` | 只删除当前 Provider/地址的 Key，并取消请求、清除 AI 问题。 |
| `TeXLeaf: AI 检查当前段落或选区` | `texleaf.aiWriting.reviewParagraph` | 手动检查当前纯正文选区；没有选区时检查当前段落。 |
| `TeXLeaf: AI 检查当前文档` | `texleaf.aiWriting.reviewDocument` | 分段检查当前已命名的 `.tex` 编辑器正文，受发送长度上限约束。 |
| `TeXLeaf: 显示 AI 写作问题列表` | `texleaf.aiWriting.showIssues` | 打开 TeXLeaf 活动栏中的“AI 写作问题”视图，集中查看当前文档的检查状态与建议。 |
| `TeXLeaf: 应用当前全部 AI 建议` | `texleaf.aiWriting.applyAll` | 确认并重新校验后，一次应用当前文档中全部仍然安全有效的建议。 |
| `TeXLeaf: AI 改写选区或当前句` | `texleaf.aiWriting.rewriteSelection` | 改写连续纯正文；遇到受保护的 TeX 标记时拒绝整段替换。 |
| `TeXLeaf: 触发 AI 行内补全` | `texleaf.aiWriting.triggerCompletion` | 调用 VS Code 原生 Inline Suggest，按当前光标正文请求续写。 |
| `TeXLeaf: 清除 AI 写作问题` | `texleaf.aiWriting.clearDiagnostics` | 清空当前保存的 AI 问题标记和本机恢复快照，不修改正文；命令 ID 为兼容旧版保持不变。 |

表中列出的是正常需要从 Command Palette 运行的功能命令。`texleaf.handleTab`、`texleaf.matrixEnter`、`texleaf.handleSpace`、`texleaf.deleteEmptyMathDelimiters` 等编辑器动作由 when context 和键位调用；`texleaf.aiIssues.reveal`、`texleaf.aiIssues.apply`、`texleaf.aiIssues.ignore` 仅供受控问题树、Hover 与 Quick Fix 入口使用，并在 Command Palette 中隐藏，不应作为外部自动化 API。

## AI 写作配置与行为

### 开启、密钥与计费

AI 写作是显式选择加入的联网功能。默认 `texleaf.aiWriting.enabled=false`，因此安装或升级后不会自动发送论文。首次从命令切换为开启时，TeXLeaf 会用模态提示说明将发送什么、服务由谁提供以及 API 另行计费；只有确认后才记录本地 consent。仅在设置页把布尔值改为 `true` 但没有确认 consent 时，也不会静默联网。

`texleaf.aiWriting.provider` 默认是 `deepseek`。DeepSeek 模型由 `texleaf.aiWriting.deepseekModel` 选择，Base URL 由 `texleaf.aiWriting.deepseekBaseUrl` 设置且默认为 `https://api.deepseek.com`；TeXLeaf 只向 `{规范化 Base URL}/chat/completions` 发出 Chat Completions + JSON Output 请求。接口与 JSON 输出行为见 DeepSeek 官方 [Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion) 和 [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)。`openai` 使用独立的 Responses 协议，默认模型是 [`gpt-5.6-luna`](https://developers.openai.com/api/docs/models/gpt-5.6-luna)，默认 Base URL 是 `https://api.openai.com/v1`。TeXLeaf 只会向 `{规范化 Base URL}/responses` 发出请求，并使用 Responses 的 `text.format` JSON Schema Structured Outputs；不会把 OpenAI 请求降级到 `/chat/completions`，也不会把 DeepSeek 请求改发 `/responses`。协议细节见 OpenAI 官方 [Responses 指南](https://developers.openai.com/api/docs/guides/migrate-to-responses) 与 [Structured Outputs 指南](https://developers.openai.com/api/docs/guides/structured-outputs)。

DeepSeek 与 OpenAI 自定义 Base URL 都禁止用户名、密码、查询参数、fragment、主机名尾随点，以及路径已经以各自 endpoint（`/chat/completions` 或 `/responses`）结尾的地址。远程主机必须使用 HTTPS；HTTP 只允许 `localhost`、`127.0.0.1` 与 `[::1]` 回环服务；请求不会跟随 HTTP 重定向，也不会跨协议回退。主机、端口或路径变化后，TeXLeaf 会把规范化结果视为新的正文接收者。每一个规范化 DeepSeek/OpenAI Base URL 都有独立的 SecretStorage Key 和本地 consent；默认 `https://api.deepseek.com` 继续兼容此前版本的 `v1` DeepSeek Key/consent，但任意自定义 DeepSeek 地址绝不会复用它。OpenAI 官方地址、各自定义地址和两个 Provider 之间同样互相隔离。

API Key 通过 `ExtensionContext.secrets` 加密保存，Key 内容和正文都不会写入输出日志、普通设置、项目文件、Git、`globalState` 或 TeXLeaf 的 Snippet Sync envelope。SecretStorage 不跟随 Settings Sync 跨设备同步；Stable/Insiders、不同 Profile、本地/Remote extension host 也可能各有独立 secrets，因此需要逐环境设置。全部 14 个 `texleaf.aiWriting.*` 普通设置都使用 `application` scope，可以作为用户/Profile 配置随 VS Code Settings Sync 同步；工作区、文件夹和 `.vscode/settings.json` 不能开启 AI、重定向 Base URL、切换 Provider/模型或修改防抖和长度上限。运行时还只读取全局值作为纵深防护。新环境在重新确认当前目标并设置对应 Key 前仍不会联网；每目标 consent 也不随普通设置同步。

ChatGPT Plus/Pro、Codex 使用额度与 OpenAI API 是彼此独立的产品和计费体系；ChatGPT 订阅不能作为 TeXLeaf 的 API 登录凭据，也不能支付 DeepSeek 或自定义服务费用。OpenAI Responses 请求包含 `store:false`；这表示 TeXLeaf 请求服务不要存储 Response，但第三方代理是否遵守、保留正文或把正文用于其他目的，仍由该服务的隐私政策与实现决定。涉及未公开论文、保密审稿或敏感研究数据时，应在启用前确认有权把文字发送给当前 consent 中显示的目标。

### Grammarly 风格检查

自动模式在停止键入后优先检查本次改动的正文句子；没有改动句子待处理时，纯光标导航才会选择光标附近句子。返回问题由编辑器装饰线标出；TeXLeaf 专用 Hover 提供分类、解释、替换预览和“应用这条建议”链接，活动栏问题树保留真实严重性，Hover 链接与灯泡 Quick Fix 都在应用前重新验证文档版本、问题身份、范围、exact `original` 和可编辑正文。Hover 只信任 TeXLeaf 白名单中的内部应用命令，模型文字不能构造或执行命令。AI 问题不发布为 VS Code 原生 Diagnostic，也不会出现在 Problems，从而避免重复 Hover 与 Error/Warning accessibility signal；TeXLeaf 本身不包含或播放音频。本次会话可以忽略单条建议；手动清除问题不会修改文件。显式检查多段选区或整篇文档会按正文段顺序运行，并在达到 `maxDocumentLength`、单段长度或单次 32 个正文段时停止并提示，而不是偷偷发送超出范围的内容；这一独立段数上限可防止大量极短正文段产生无界的付费请求。响应顶层不是合法的受限 `issues` 数组时整批失败；数组中只有个别条目无效时则逐条丢弃，独立且不重叠的有效条目仍可进入装饰线、Hover 与问题树。

问题类别包括拼写、语法、标点、清晰度、措辞与风格。模型建议不是编译器或人工编辑结论，技术术语、专名和领域惯例可能被误报；应用前仍需作者审阅。网络、超时、余额、限流、无效 JSON 或服务端错误不会自动修改正文；批量检查中此前已经成功的句子/正文段仍保留在问题列表，后续失败不会回滚这些结果。

### 活动栏问题列表与批量应用

TeXLeaf 活动栏中的“AI 写作问题”视图只展示当前活动 `.tex` 文档。它会显示检查中、已调度、AI 未启用、没有可审阅问题，以及“多少个改动句子等待局部复检；其他问题仍保留”等状态；每条建议包含行号、类别、真实严重性、`原文 → 替换` 与解释。点击建议会把对应范围滚动到可见区域，并叠加主题自适应背景与轮廓；其他问题仍保留下划线。这个选中高亮不移动编辑器主光标、不夺走问题列表焦点，也不发布 Diagnostic 或触发对应音效。安全平移时它按稳定 issue lineage 跟随当前问题；应用、忽略、清除、失效或关闭 AI 后自动清除。单条建议可从上下文菜单应用或在本次会话忽略。状态栏中的 TeXLeaf AI 项和命令 `texleaf.aiWriting.showIssues` 都可以打开该视图。

点击问题树中的条目只滚动到对应范围，不移动主光标或夺走列表焦点。装饰线不带内置消息或严重性，专用 Hover 是唯一的详细悬停卡片；因此不会与 VS Code 原生诊断 Hover 重复。0.8.9 起可以直接点击 Hover 中的“应用这条建议”；该链接与 Quick Fix 使用同一安全应用路径，问题内容和应用前严格校验不受入口差异影响。

Windows 的微软拼音在中文模式下会把 `Ctrl+.` 用于切换中英文标点，按键可能不会到达 VS Code；这不是 TeXLeaf 没有生成 Quick Fix。可以按 `Shift` 切到英文输入模式后再按 `Ctrl+.`，或通过 `F1` / Command Palette、右键菜单运行“快速修复...”、点击灯泡或使用 Hover 的“应用这条建议”。TeXLeaf 不新增或接管其他系统级快捷键。

视图工具栏与命令 `texleaf.aiWriting.applyAll` 可以应用当前全部建议。TeXLeaf 会先显示模态确认，再重新核对文档版本、每一条范围与原文以及建议之间是否重叠；校验失败时整批不修改，避免把已经过期的建议应用到新正文。单条 Quick Fix 或整批 WorkspaceEdit 成功后，对应问题会立即从当前状态和持久缓存中消费，不依赖另一个异步文档变更回调代为清理。模型提供的文字只作为不受信任文本显示，不会作为可执行 Markdown 命令运行。

增量算法已经证明未受影响、仅因前方编辑而平移的问题会保留稳定的 lineage ID；它们的文档版本、范围、UTF-16 offset 与安全 fingerprint 仍按当前正文更新。这样已经渲染的问题树节点或 Quick Fix 不会仅因绝对位置改变而失效，应用时仍必须通过当前范围、exact `original` 与 editable prose 校验。真正过期的旧节点会让 TeXLeaf 刷新问题列表，并只在状态栏短暂提示“问题列表已更新；旧建议已失效”，不再弹出误导性的“文档已变化”通知，也不会播放音效。

“应用全部”在确认前捕获当前安全问题的稳定 ID；确认后从最新状态逐条重新解析这些 ID，再复核文档版本、范围、原文和重叠。内部创建了内容等价的新状态对象不会单独导致失败；任一捕获问题已移除、失效或无法唯一解析，或者文档版本、范围、原文或重叠校验不再成立时仍整批停止，不进行部分修改。确认后才出现的其他问题不属于这一批。

如果提示“42 条可审阅，另安全忽略 20 条”，含义是模型候选中有 42 条完成了精确、无歧义的本地映射，另有 20 条因完全重复、范围重叠、字段无效、找不到原文或无法唯一定位而 fail closed 丢弃。这个计数不是 API Key、余额、认证或网络错误；被忽略的候选和仅显示在列表中的建议都不会自动修改原文。视图会用不含论文内容的拒绝摘要显示安全忽略数量。

### 自动检查调度

`texleaf.aiWriting.reviewDelayMs` 默认 900 毫秒，允许范围为 500–10000 毫秒。连续键入会重置防抖并取消旧请求；本次编辑涉及的句子进入局部复检队列，尚未处理的编辑目标始终优先于纯光标导航，所以写完一句后立即按 Enter、输入空行或点击别处不会漏掉刚编辑的句子。中文 `。！？` 即使句间没有空格也能分句，句末中英文引号和括号归入前句。每批自动调度最多处理 8 个改动句子；同一文档版本、同一句子和相同 Provider、模型、语言、风格不会重复请求，每版本最多自动请求 64 个不同句子，达到上限后不会通过逐出旧记录来重复收费。

一次可精确重建的文本事务会把涉及的**旧句子与新句子并集**作为 provider 的完整自然语言上下文，但问题失效只看实际编辑及累计未复检的精确 UTF-16 范围。插入或删除句号/空行导致一句拆成多句或多句合并时，split/merge 两侧关联句子都会进入局部复检；同一 VS Code 事务中的多处编辑和零宽边界也会一起映射。与局部范围不相交的同句问题并不会被整句清空：只有 `original` 与当前正文逐字一致、仍处于可编辑正文且能严格平移时才保留；在问题右端点插入词尾属于与该问题相关的编辑，因此像给 `take` 追加 `s` 的操作会使旧词形建议失效。自动复检回应只替换命中 dirty range 或与新返回问题相交的旧项。手动段落/全文检查则仍主动刷新所检查的完整正文段。保存、dirty-state/编码转换等没有正文 `contentChanges` 的通知不会清除结果或 pending 队列；无法无歧义重建的异常事务、超过 100 万 UTF-16 字符的同步扫描或超过 1024 个 change 的异常事务才会 fail closed 丢弃不再可靠的结果。

自动队列中的每个句子成功返回后立即与当前列表合并，并从 pending 队列移除；同批后续 API 请求失败不会回滚已成功的前句，剩余句子继续明确显示为“等待局部复检”。手动多段/整篇检查同样逐段提交已成功结果，单次最多 32 个正文段。自动检查因此不是每个按键触发一次网络请求：防抖、取消与去重会合并连续操作，但服务商网络延迟、请求频率限制和 API 费用仍决定它只能提供近实时反馈，而不能保证本地拼写检查器那样的即时响应。

### LaTeX 保护与发送范围

所有联网入口同时要求：当前 VS Code 窗口受信任、文档是已经有文件名和路径的本地 `file:` 或 Remote/WSL/Dev Container `vscode-remote:` `.tex`、language ID 为 `latex`/`tex`、扩展和 AI 总开关均开启、当前目标已经独立 consent，且 SecretStorage 中存在该目标自己的 Key。这里“已命名”不等于编辑器当前没有修改：自动检查和补全会读取当前内存文本，因此可能发送尚未按 `Ctrl+S` 写入磁盘的最新正文。`.bib`、untitled、Git/其他虚拟 URI、未信任窗口、数学区域、注释和代码环境不会成为请求正文。

提取器在本地用等长空格遮罩注释、`verb`/`verbatim`/`minted`/`lstlisting`、citation/ref/label/URL/路径/文件参数、未知宏的强制参数，以及代码和未知环境的内容；只有 `section`、`caption`、`footnote`、`emph`、`textbf`、`textit` 等明确正文命令保留可读参数。数学范围则替换为受保护、不可编辑、与源码 UTF-16 等长的语义占位符；公式内容不会发送，模型只知道此处存在一个 inline/display formula，并被明确要求把它视为上下文中的名词短语或宾语，不能把 `Take` 后的行间公式误报为缺少宾语，也不能把占位符或 padding 放进 `original`/`replacement`。模型被要求返回零基 UTF-16 offset，但 TeXLeaf 也能对模型常见的 Unicode code point、UTF-8 byte 与把 CRLF 视为一个换行的计数差异做有限重定位。无论采用哪种坐标解释，`original` 都必须是非空、单行的原文锚点并逐字对应一个无歧义的源码范围；如果上报范围不吻合，只允许回退到全文中唯一的逐字匹配。重复文本或多种解释指向不同位置时按歧义拒绝，不做 Unicode、大小写、引号、空白或换行内容归一化，也不做模糊匹配。Review 合约要求 `message` 与 `explanation` 使用简体中文，`replacement` 保持 `payload.language` 与来源正文的原语言。纯插入必须表示为带相邻不变原文的非空范围，并在 replacement 中保留锚点，不能使用零长度 `original`；本地验证非空 exact 锚点和 replacement 安全字符，但不会要求所有普通替换都包含 original。如果当前源码已由候选的 `original` 范围加紧邻上下文组成完整 `replacement`，则说明模型给出了会重报既有正文的截短范围，该条会被拒绝。通过定位后的建议还必须全部落在可编辑区、与其他保留建议互不重叠，并且 replacement 不含换行、反斜杠、美元号、百分号或花括号，才会进入 UI。

句子改写只允许连续纯正文范围，避免整句替换时抹掉不可见的 LaTeX 标记。行内补全只在当前行的零宽光标范围插入经过同类字符校验的 suffix；原生 Suggest 已选中候选、光标处于数学/命令区域、请求被编辑取消或文档版本变化时不显示结果。

### 性能与隐私边界

自动句子检查和行内补全各自有防抖，并在继续键入时取消旧请求；异步结果回到编辑器前再次检查 URI、版本、generation、总开关、workspace trust、Provider、模型、规范化目标地址、consent 和对应 Secret。切换 Provider/Base URL、关闭功能或清除 Key 会取消旧请求并持久清空旧问题。pending 句子、忽略记录和请求状态仍只在当前扩展宿主会话内存中使用。

已经通过安全校验的问题会以 JSON 记录写入当前 VS Code Profile/扩展宿主的私有 `globalStorageUri/ai-writing-issues-v1/`，因此在通常的单扩展宿主使用中，关闭文档或重启 VS Code 后可以恢复；它不写工作区、不加入 Settings Sync，也不保存论文全文。记录包含文档 URI、全文长度与 SHA-256、版本/时间戳，以及应用建议必需的单条 `original` 锚点、replacement、中文 message/explanation、类别和严重性。只有当前完整源码的 UTF-16 长度与 SHA-256 都和快照完全一致时，才按原 offset 重新验证 `original`、可编辑区和截短 replacement；文件被外部修改、hash/长度不匹配或单条验证失败时 fail closed 丢弃并要求重检，不跨源搜索相同短语。旧缓存即使拥有精确 source hash，也不能绕过新增的单条校验；在同一扩展宿主的正常流程中，清除问题、成功应用建议、关闭功能、切换目标或清除 Key 都会持久更新记录，防止随后正常重启时恢复已消费建议。

持久化和显示均有防御性上限：每文档最多 2048 条问题，单记录最多 2 MiB；每个 Profile 最多 256 个文档记录且总量最多 32 MiB，超出时按最近修改时间清理旧记录。缓存文件名由 URI 的 SHA-256 派生，写入以 750 毫秒防抖并采用同目录临时文件后 rename；这是 Profile-local 的 best-effort 原子快照，不宣称提供多个同时运行窗口之间的事务或强 CAS。格式损坏、UTF-8 无效、字段/控制字符/TeX replacement 不合规或记录超限时一律拒绝并清理，不能绕过在线结果的严格校验。

DeepSeek 对空 `content` 或非法 JSON 输出只自动重试一次；恰好一层、完整包裹结果的 ```` ```json … ``` ```` 围栏会先被安全剥离，围栏外有额外内容或顶层结构失败时不会宽松提取。认证、计费、限流、网络、超时、取消和字段错误不重试。单条建议的字段或位置无效时只丢弃该条；相互重叠的整个连通冲突组一起丢弃，完全相同的重复项保留一条，其他独立有效项继续使用。客户端只向 UI 暴露认证、余额、限流、超时、拒绝、截断、响应无效等安全分类，以及 `empty-content`、`invalid-json-output`、`content-too-large`、`invalid-issues`、`invalid-original`、`invalid-issue-offset`、`issue-original-not-found`、`issue-location-ambiguous`、`duplicate-issue`、`overlapping-issues`、`http-body-too-large` 等不含正文的内部子码；不记录 API Key、论文正文、原始响应或服务端任意错误消息。

DeepSeek、OpenAI API 或自定义服务可能按输入和输出 token 计费。自动检查和自动补全都会增加请求次数；需要严格控制费用时，可以关闭其中一个子功能，或保持总开关关闭，只在需要时显式开启。TeXLeaf 不读取余额，也不承诺与 Grammarly 的专有词典、团队风格指南或账户服务完全等价。

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

Math Preview 的产品方向受到 Ultra Math Preview 与 hscopes-booster 的启发；TeXLeaf 当前使用随 VSIX 提供的 MathJax Worker、区域扫描、宏处理、布局规划、缓存和 SVG 安全处理来完成活动公式预览。完整致谢和实现边界见 README、Wiki 与 `THIRD_PARTY_NOTICES.md`。

VS Code 没有允许单个扩展控制 Electron GPU 的公开 API，而且 MathJax TeX 解析/SVG 排版主要消耗 CPU，所以没有提供名不副实的硬件加速开关。需要降低开销时，优先提高 `debounceMs`、降低 `maxSourceLength`，或关闭 `mathPreview.enabled`；后台 Worker 与缓存始终启用，不需要额外配置。

## 内置 Snippet 与模板管理

`TeXLeaf: 管理 Snippet 与模板` 打开结构化面板，不显示或要求用户处理存储路径。Snippet 页支持 trigger/replacement/options/priority/category/description/flags/占位符版本/启用状态编辑，模板页支持名称、trigger、说明和完整 TeX 正文编辑；两页都有搜索、添加、复制、删除、恢复默认，以及带字段范围、大小写、正则、预览和撤销的批量查找替换。保存前后使用 revision 校验，检测到另一个窗口、Settings Sync 或高级编辑器的变化时拒绝覆盖。

在 Windows Stable 中，其典型位置是 `%APPDATA%\Code\User\globalStorage\zhangxh-math.texleaf\texleaf-snippets.jsonc`。实际路径由当前 VS Code Profile 与运行环境决定；命令入口会始终使用正确 URI。该文件不属于任何项目，切换工作区无需复制。不同 VS Code Profile 或不同 Remote 主机拥有各自的全局存储。

从旧 `local-lab.texleaf` 身份首次迁入时，先在旧版保存所有修改；如自定义过模板，还要逐项保留名称、trigger、说明和正文。新版检测到仍启用的旧版时会暂停激活，避免两个实例同时注册 `texleaf.*` 命令，也避免复制一个尚未保存的磁盘快照。此时先**禁用但不要卸载**旧版并执行“Developer: Reload Window”。新主片段文件尚不存在、旧 JSONC 严格校验通过且复制期间内容未变化时，新版会尽力逐字节复制片段库；旧文件不会被移动或删除。确认 Snippet 迁移无误、按需重建自定义模板后，再卸载旧身份扩展。未修改的四个工厂模板会由新版自动创建；旧模板 catalog、既有 `globalState` 与 Settings Sync 基线不会跨扩展 ID 自动迁移。

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

用户必须在 VS Code 中主动开启 Settings Sync，并在同步内容中包含 Extensions。关闭同步时，本地文件和所有编辑功能仍正常工作。手工安装的 VSIX 不会因为片段镜像而自动出现在另一台机器；每个设备仍需安装标识为 `zhangxh-math.texleaf` 的相同或兼容版本。

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

TeXLeaf 专注于 VS Code 源码编辑器中的活动公式预览。VS Code 的稳定扩展 API 无法在原文本范围里提供可点击、可交互、能自动重排编辑器行高的任意 MathJax 替换部件；Decoration 也没有可靠的点击回调。因此本版不提供整篇所见即所得替换或内置 PDF Webview，只保留不修改文档内容、字符偏移、光标或选择范围的当前公式浮动预览。

## 与其他扩展共存

TeXLeaf 可以和 LaTeX Workshop 等编译、预览或语言服务扩展同时使用。如果相同按键或补全触发重复：

1. 先确认 `texleaf.autoFraction`、`texleaf.matrixShortcuts` 等目标功能没有被用户或工作区设置关闭；升级不会重置这些覆盖值。
2. 在键盘快捷方式页面搜索 `texleaf` 与冲突按键；需要精确定位时运行 `Developer: Toggle Keyboard Shortcuts Troubleshooting`。
3. 关闭 `texleaf.enableCompletions`，判断是否为补全提供器重复。
4. 临时关闭 `texleaf.matrixShortcuts` 或 `texleaf.tabout`，缩小按键冲突范围。
5. 确认文件已经保存为 `.tex` 或 `.bib`，再用 `texleaf.languageIds` 在这两个后缀内限定适用语言。
