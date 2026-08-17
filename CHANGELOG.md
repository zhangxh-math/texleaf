# Changelog

TeXLeaf 的所有重要变更都会记录在此文件中。版本格式遵循语义化版本。

## [0.8.11] - 2026-08-17

### Fixed

- 修复普通片段没有显式 tabstop、同时触发自动放大括号时，光标被整个替换范围带到 `\right` 之后的问题。例如在 `(sum)` 中展开后得到 `\left(\sum|\right)`，可以继续输入求和内容；输入 `+`、上下标或其他内容，使当前位置没有精确手动片段 trigger 后，按一次 `Tab` 可执行 Tabout。刚停在 `\sum` 后直接按 `Tab` 时，既有 `sum`-limits 手动片段仍优先展开；原本带 tabstop 的片段继续使用其既有占位符顺序。
- Math Preview 的 `cursor` / `both` 模式改为 last-known-good（stale-while-revalidate）更新：连续输入期间保留上一张有效卡片，以单一稳定 decoration 原位换帧，并给临时无效 TeX 或中间渲染失败 750 ms 宽限；Hover SVG 只在真正请求 Hover 时按需写入扩展私有缓存。持续输入不再因每次文档变化先清空卡片而出现“每敲一个键消失再出现”。
- 离开公式、禁用 Math Preview、运行“关闭当前 Math Preview”，或在无效状态停留超过宽限时仍会清理旧卡片；过时渲染结果不能覆盖新文档版本。VS Code 原生 Hover 在输入时仍可能由编辑器自行关闭，这一限制没有被 cursor decoration 的无闪烁更新夸大为已消除。

### Documentation

- README、配置/开发说明与 Wiki 已补充自动放大括号的光标恢复、Math Preview 连续输入策略、清理边界，以及 `typing-stability` CDP 冒烟场景；发布示例同步到 `0.8.11`，`0.8.10` 继续保留为历史记录。

## [0.8.10] - 2026-08-17

### Fixed

- TeXLeaf 的原生 Suggest 提供器现在只返回与光标前输入具有非空 trigger 前缀匹配的片段；已经不再匹配的候选会在列表刷新时移除，避免公式末尾仍选中 `+-` 等无关片段并被 `Tab` 误接受。完整片段库仍可通过 `Ctrl+Alt+L`（macOS 为 `Cmd+Alt+L`）浏览和插入。
- 原生 Suggest 可见时，如果当前位置确实存在可越过的右括号、`\rangle` 或数学结束分隔符，`Tab` 会先执行 Tabout；若实际规划不到跳出目标，则明确回到 VS Code 的 `acceptSelectedSuggestion`，不会吞掉按键或错误缩进。
- 数学区域的活动 Snippet Session 在 Suggest 可见且仍有下一 tabstop 时会先关闭 Suggest、再前往该占位符；普通 Suggest-aware Tabout 路径则明确排除精确 TeXLeaf trigger、Matrix action、活动 Snippet Session、Inline Suggest 和 Rename 输入框，保留这些既有上下文各自的 Tab 优先级。

### Documentation

- README、配置说明、开发冒烟步骤和 Wiki 已补充补全前缀过滤、Suggest/Tabout 决策以及完整片段选择器的说明，并同步到 `0.8.10` 发布文件名。

## [0.8.9] - 2026-08-17

### Fixed

- 修复微软拼音处于中文模式时，`Ctrl+.` 被输入法优先用于切换中英文标点、因而看起来像 TeXLeaf Quick Fix 没有响应的交互盲点。这不是 AI 建议缺失、Code Action Provider 返回空、用户键位被重绑或其他扩展冲突；切换输入法到英文模式后可继续使用 `Ctrl+.`，也可以从 `F1` / Command Palette 运行“快速修复...”、右键选择“快速修复...”或点击灯泡。
- 点击已经真正失效的问题树节点或 Quick Fix 时只刷新问题树、装饰线和状态栏，不弹出通知，也不播放音效；仍然安全有效、只是发生位置平移的问题继续按稳定 lineage ID 解析。

### Added

- TeXLeaf 专用 Hover 新增“应用这条建议”链接，无需依赖可能被中文输入法占用的 `Ctrl+.`。该链接只允许调用 TeXLeaf 白名单中的内部应用命令，模型提供的文字仍按不受信任内容渲染；点击后后端仍会重新验证当前文档版本、问题身份、范围、exact `original` 与可编辑 LaTeX 正文，失效建议不会修改文件。
- 在活动栏“AI 写作问题”列表点击某条建议后，对应正文会叠加主题自适应的背景与轮廓，其他问题仍保留下划线，便于在长文中确认当前审阅对象。定位与高亮不移动主光标、不触发原生 Diagnostic 音效；选择状态沿稳定 issue lineage 跟随无关前文编辑造成的安全平移，并在建议被应用、忽略、清除、判定失效或关闭 AI 后自动移除。
- 新增 `texleaf.aiWriting.deepseekBaseUrl`。DeepSeek 默认使用 `https://api.deepseek.com`，也可指向安全的兼容服务，并始终请求规范化后的 `{Base URL}/chat/completions`；OpenAI 继续独立使用 `{Base URL}/responses` 与 Structured Outputs，不在两个协议之间自动回退。

### Security and configuration

- AI 写作设置由 13 项增加到 14 项；全部 `texleaf.aiWriting.*` 配置均改为 application 级，只能由用户/Profile 设置控制。普通配置可以随 VS Code Settings Sync 同步，但工作区、文件夹和 `.vscode/settings.json` 不能开启 AI、重定向目标、切换 Provider/模型或改变费用相关参数；运行时还会只读取全局值作为纵深防护。
- 每一个规范化 DeepSeek 与 OpenAI Base URL 都使用独立的正文传输 consent 和 SecretStorage Key。默认 DeepSeek 官方地址继续兼容已有的 `v1` Key/consent；任意自定义 DeepSeek 地址使用新的目标专用记录，绝不会复用官方凭据，OpenAI 各地址以及两个 Provider 之间也互不复用。
- 两种 Base URL 使用相同的安全边界：远程目标必须为 HTTPS，HTTP 只允许 `localhost`、`127.0.0.1` 与 `[::1]`；拒绝 URL credentials、query、fragment、主机名尾随点和路径已经以对应 endpoint 结尾的地址，请求不跟随 HTTP 重定向。API Key 与 consent 不进入普通设置，也不随 Settings Sync 跨设备复制。

## [0.8.8] - 2026-08-17

### Fixed

- 修复连续应用 AI 建议时，前方一次安全编辑会平移后续问题、却因绝对 offset 变化重建全部内部 ID，导致已经显示的问题树节点或 Quick Fix 误报“文档已变化”的问题。增量保留已经证明未受影响的建议现在维持稳定的 lineage ID，同时仍更新 fingerprint、文档版本、范围和 UTF-16 offset，并在应用前继续逐字核对当前 `original`。
- 真正失效的旧问题树节点或 Quick Fix 不再弹出误导性的信息通知；TeXLeaf 会刷新当前问题树、装饰线与状态，并仅在状态栏短暂显示“问题列表已更新；旧建议已失效”。AI 总开关关闭、工作区不受信任或文档作用域不支持时仍分别给出准确原因。
- “应用当前全部 AI 建议”在模态确认后不再依赖 `DocumentIssues` 对象引用完全相同。它会按确认前捕获的稳定 ID 在当前安全状态中逐条重新解析，并重新验证文档版本、范围、原文和重叠；仅发生等价状态对象刷新时可以继续，确认前捕获的任一建议已移除、失效或无法唯一解析，或者文档正文发生变化时仍整批 fail closed。确认后新出现、未被确认的其他建议不属于本批操作。

### Reliability

- 隔离 VS Code Extension Host 回归现在覆盖真实旧问题树节点：先在问题前插入文字使范围整体平移，再通过刷新前保存的节点应用建议，验证正文只修改一次、问题立即消费、持久缓存清空；同时覆盖失效节点静默刷新与“应用全部”确认期间等价状态刷新的行为。

## [0.8.7] - 2026-08-17

### Fixed

- 修复接受词尾追加型 AI 建议后旧问题仍留在装饰线、Hover、活动栏列表或重启缓存中的问题。像 `one take` → `one takes` 这样的单条 Quick Fix，以及确认后的“应用全部”，现在会在正文写入成功后立即消费对应问题，不再依赖后续异步文档变更事件代为清理。
- 修复增量保留对右端点插入判断过宽的问题。在问题范围末端追加字符已经改变该建议所描述的词形时，旧问题会立即失效；同一句中真正与编辑无关、仍逐字匹配的问题仍按既有精确重映射规则保留。
- 在线结果与本地恢复都会拒绝“截短范围”伪问题：如果 `replacement` 已经由模型给出的 `original` 范围加紧邻上下文完整存在（例如当前正文已经是 `takes`，候选却只锚定 `take` 并仍建议 `takes`），该候选不会进入或重新出现在 UI。旧的精确源码缓存也会在恢复时逐条执行这一过滤。

## [0.8.6] - 2026-08-17

### Fixed

- 修复所有 AI 写作入口都可能立即报告 `configuration/language-too-long` 的回归。根因不是 API Key、余额、模型、Base URL 或论文长度，而是控制器把“按正文语言处理，并用简体中文解释建议”等完整输出指令误传成客户端 `language` 协议标签；该字符串超过 64 字符安全上限，被 DeepSeek/OpenAI 客户端在 HTTP 请求前一致拒绝。
- 语言设置现在通过单一映射转换为有界短标签：`auto` → `auto`、`english` → `English`、`chinese` → `Chinese`。自动句子检查、手动段落/选区检查、整篇检查、安全改写和行内补全均使用同一映射，DeepSeek 官方端点与 OpenAI 官方/自定义 Responses 地址都恢复可用。
- Review 的中文展示要求没有被移入可变标签或删除：`message` 与 `explanation` 仍由固定 system prompt 要求使用简体中文，`replacement` 仍保持被检查正文的原语言。

### Reliability and safety

- 增加短标签映射的边界回归覆盖，并保留两个客户端原有的联网前校验：64 字符标签可以进入 mock fetch，65 字符或含换行/控制字符的标签会以 `language-too-long` / `invalid-language` 在本地失败，mock fetch 调用数保持为 0。修复只纠正控制器传参，不放宽不受信任输入、模型名称、Base URL 或正文长度限制。

## [0.8.5] - 2026-08-17

### Fixed

- 自动增量检查不再因为一句中的局部编辑而清除该句所有旧建议。TeXLeaf 仍以旧句与新句并集提供完整语境，但失效范围收窄为实际 UTF-16 编辑区：只有与编辑相交、或与新返回建议相交的旧问题会被替换；同句其他问题只有在 `original` 与新正文逐字一致、仍位于可编辑正文且可严格平移时才保留。
- 数学公式改为受保护的等长语义占位符。公式源码不会发送给模型，也不能成为建议范围；占位符会告诉模型此处存在不可编辑的 inline/display formula，避免把 `Take` 后的行间公式误报为“缺少宾语”，同时保持源码 offset 的 UTF-16 一一映射。
- Review 提示现在明确要求 `message` 与 `explanation` 使用简体中文，`replacement` 保持被检查正文的原语言，不因中文解释而翻译作者文字。

### Changed

- AI 写作问题不再发布为 VS Code 原生 Diagnostic，也不再出现在 Problems 面板，从而避免原生诊断 Hover 与 TeXLeaf Hover 重复，以及 Error/Warning accessibility signal。编辑器改用无音频的装饰线标记；类别、解释、替换预览与真实严重性由 TeXLeaf 专用 Hover 和活动栏问题树显示，灯泡 Quick Fix 仍可安全应用或忽略单条建议。
- 当前问题列表会在扩展私有的本机 `globalStorage` 中跨文档关闭和 VS Code 重启恢复；它不写入工作区、不进入 Settings Sync，也不保存论文全文。只有当前完整源码的 UTF-16 长度与 SHA-256 都和快照完全一致时，才按精确 offset 逐条恢复；文件被外部修改、hash/长度不匹配或单条范围/原文/可编辑区校验失败时一律 fail closed 丢弃并要求重新检查，不跨源搜索相同短语。
- “清除 AI 写作诊断”在界面中更名为“清除 AI 写作问题”；既有命令 ID `texleaf.aiWriting.clearDiagnostics` 保持兼容。

### Performance, safety and limits

- 句子级发送上下文与问题级失效范围继续分离；句号/空行 split/merge、同一事务多处编辑、累计 pending 和零宽边界均按精确范围处理。无法重建的事务、超过 100 万 UTF-16 字符的同步增量扫描或超过 1024 个 change 的异常事务会 fail closed，而不是猜测旧问题位置。
- 本地恢复沿用与在线结果同等级的字段、控制字符、TeX replacement 和可编辑区校验。单文档最多保留 2048 条问题；单个持久化记录最多 2 MiB；当前 Profile 最多保留 256 个文档记录且总量最多 32 MiB，超限时按最近修改时间清理旧记录。
- AI 总开关仍默认关闭；只有用户明确同意并配置所选服务商 Key 后才可能联网和产生费用。自动检查仍为每批最多 8 句、每版本最多 64 个不同句子，手动整篇每次最多 32 个正文段；成功句逐句提交，后续请求失败不回滚已成功结果。

## [0.8.4] - 2026-08-17

### Fixed

- 修复整篇检查后只修改一处正文就清空其他问题的回归。增量失效现在以句子为单位：仅把文本事务涉及的旧句子与新句子并集标为待复检，其他全文问题在 `original` 与可编辑正文仍逐字成立时原样保留，并按同一事务的 UTF-16 位移精确平移。
- 句号或空行的插入/删除可能把一句拆成多句或把多句合并；TeXLeaf 会把 split/merge 两侧关联的旧句与新句全部纳入局部复检。一个 VS Code 事务中的多处编辑会一起精确重建，无法无歧义重建时才 fail closed 清除不再可靠的结果。
- 保存、dirty-state/编码转换等没有正文 `contentChanges` 的通知不再清空已完成的全文结果或待复检队列；同文档文本未变而版本推进时，已有问题与 pending 句子会安全迁移到新版本。
- TeXLeaf 本身不包含或播放检查音效。AI Diagnostic 统一以 VS Code `Information` 发布，避免新增 Error/Warning 标记或主光标进入其所在行时触发 VS Code 的 accessibility signal；TeXLeaf 问题树仍显示模型建议的真实严重性。点击树中问题现在只滚动到对应范围，不移动主光标或夺走列表焦点。

### Changed

- 自动检查从“当前段落”改为改动句子级队列；中文 `。！？` 即使句间没有空格也会正确分句，并兼容句末中英文引号和括号。`texleaf.aiWriting.maxParagraphLength` 设置名为兼容既有配置继续保留，但自动模式按单句应用该长度上限。
- 每个句子成功返回后立即与现有问题列表合并并从 pending 队列移除；如果同批后续 API 请求失败，已经成功的前句结果不会回滚或在重试时重复付费。仍未成功复检的句子会在活动栏与状态栏明确显示为“等待局部复检”，其他问题继续保留。
- 自动调度每批最多处理 8 个改动句子，同一文档版本最多自动请求 64 个不同句子；达到上限不会逐出旧去重记录后重复收费。手动检查多段选区或整篇文档仍保持每次最多 32 个正文段，并同时受单段与总字符上限约束。

### Privacy and cost

- AI 写作总开关仍默认关闭；Provider consent、按目标隔离的 SecretStorage、workspace trust、正文遮罩、API 独立计费和“不保证无延迟实时检查”的边界没有放宽。自动检查与行内补全只有在用户显式开启总开关、同意传输并配置对应 API Key 后才可能产生请求和费用。

## [0.8.3] - 2026-08-17

### Added

- 在 TeXLeaf 活动栏容器中新增 **AI 写作问题**列表。它针对当前活动 `.tex` 展示检查排队/进行中状态、可审阅问题数量、行号、类别、严重性、诊断、`original → replacement` 预览和解释；单击条目定位原文，条目操作可单独应用或在本次会话忽略。
- 新增公开命令 **TeXLeaf: 显示 AI 写作问题列表**（`texleaf.aiWriting.showIssues`）与 **TeXLeaf: 应用当前全部 AI 建议**（`texleaf.aiWriting.applyAll`）。批量应用前使用模态确认，并再次核对文档版本、每条 original 与建议范围；任何过期或重叠都会让整批操作停止。
- 问题列表新增 fail-closed 拒绝摘要。像“42 个可审阅问题；另忽略 20 条建议”这样的提示表示同批模型候选中有 42 条通过精确、安全映射，另 20 条因重复、重叠、字段无效或无法唯一定位而被本地丢弃；这不是 API Key、余额或认证错误，未主动应用前原文没有修改。

### Changed

- 自动段落检查的默认防抖从 1500 ms 调整为 900 ms，允许范围仍为 500–10000 ms。停止输入、打开/保存文档、切换活动编辑器，以及把光标移入另一个正文段落都会调度检查；继续输入会重置定时器并取消旧请求。尚未触发的编辑目标优先于纯光标导航，写完一句后立即按 Enter、输入空行或点击别处不会漏掉刚编辑的段落。
- 同一文档版本、相同段落内容和相同 Provider/模型/语言/风格组合只自动请求一次。光标在同一段落内来回移动不会重复调用 API，因此自动检查不是“每按一个键就联网”。
- 同一未修改文档版本最多自动检查 64 个不同段落；达到上限后直接停止新的自动请求，不会把旧去重记录当成 LRU 逐出后再次产生费用。
- 单次普通编辑只清除受影响正文段落的旧诊断；其他段落中仍逐字匹配的诊断会按文本位移安全平移并保留。多重编辑、版本跳变或无法精确重映射时仍保守清除，避免展示过期建议。

### Performance and safety

- 状态栏与活动栏列表会显示“待检查”“检查中”、当前问题数量和拒绝摘要，但不会为了刷新 UI 额外发起网络请求。网络往返、模型推理、服务商限流与账户配额决定实际响应速度和费用，因此该功能只能提供经过防抖的近实时反馈，不能保证本地语法引擎式的逐键即时响应。
- 列表中的单条应用、批量应用和点击定位都重新验证当前文档版本与 exact original；被安全忽略的候选没有可执行操作，也不会自动修改原文。列表 tooltip 不信任模型 Markdown，拒绝摘要只显示数量和脱敏原因码。
- 显式检查多段选区或整篇文档，除字符和单段长度限制外，再增加单次最多 32 个正文段落的硬上限；超过上限会停止并提示，其余正文不发送，避免大量极短段落造成无界的串行付费请求。单个文档的本地问题状态也设有防御性上限。

## [0.8.2] - 2026-08-17

### Fixed

- 修复 DeepSeek/OpenAI 已成功返回检查结果，却因模型使用不同字符计数方式而触发 `issue-original-mismatch`、整批不显示建议的问题。新的精确定位器会在零/一基的 UTF-16 code unit、Unicode code point、UTF-8 byte，以及原始/CRLF 视为单换行的坐标解释中收集候选；只有所有可行解释收敛到同一个逐字源码范围时才采用。
- 当上报 offset 无法直接匹配时，只允许把非空 `original` 回退到全文中唯一的逐字 occurrence。找不到时使用 `issue-original-not-found`，多种解释或重复原文无法消除歧义时使用 `issue-location-ambiguous`；非法范围与非法锚点分别使用 `invalid-issue-offset` 和 `invalid-original`。

### Reliability and safety

- Review 响应改为逐条校验：单条字段、位置或安全校验失败只丢弃该条，独立且不重叠的有效建议继续成为 Diagnostic；真正相交的区间按连通冲突组整组丢弃。完全相同的重复 issue 去重保留一条，多余项计为 `duplicate-issue`。顶层 `issues` 非数组、超过 64 项、JSON/响应无效时仍整批 fail closed。
- `original` 必须是非空、单行、长度受限且逐字匹配的原文锚点。Review prompt 要求模型把纯插入表示为包含相邻不变原文的范围，并在 replacement 中保留锚点；本地不会用“所有 replacement 必须包含 original”这种规则误伤普通替换。
- 精确定位不会做大小写、引号、Unicode 或空白/换行内容归一化，也不会做模糊相似度匹配；CRLF 兼容只改变 offset 的计数解释。含孤立 surrogate 的文本禁用 UTF-8 byte 解释，避免不可靠映射。
- 客户端只把被丢弃建议的数量和去重安全子码交给控制器；Output/通知不记录 `original`、请求/响应正文、API Key 或底层解析异常。全部建议被安全忽略时给出明确提示，部分有效时说明保留数量与忽略数量，原文仍只会在用户主动应用 Quick Fix 后修改。

## [0.8.1] - 2026-08-17

### Added

- 新增默认关闭、显式同意后才联网的 AI 写作助手：自动或手动检查 `.tex` 正文中的拼写、语法、标点、清晰度、措辞和风格，并通过 VS Code Diagnostic、Problems、Hover 与 Quick Fix 展示和应用建议。
- 新增当前段落/选区检查、整篇分段检查、安全句子改写、词语/句子行内补全、会话忽略和清除诊断，以及设置/清除当前 AI 服务商 API Key 等 Command Palette 命令；既有公开命令 ID 保持稳定。
- AI 写作支持 DeepSeek 官方 Chat Completions 与 OpenAI Responses 双 Provider。DeepSeek 默认 `deepseek-v4-flash`，可选择 `deepseek-v4-pro`；OpenAI 默认 `gpt-5.6-luna`，默认 Base URL 为 `https://api.openai.com/v1`，也可配置安全的 Responses-compatible 地址。
- 独立的 `TeXLeaf · AI 写作` 设置组现精确包含总开关、自动检查、行内补全、Provider、两个服务商各自的模型设置、OpenAI Base URL、语言、风格、两个防抖和两个发送长度上限共 13 项。

### Security and privacy

- API Key 只存入 VS Code SecretStorage，不进入普通设置、日志、项目、Git、Snippet Settings Sync 或 `globalState`，也不通过普通 Settings Sync 跨设备同步；每个 Profile/Remote 环境需分别设置。DeepSeek 使用独立 Secret；每一个规范化 OpenAI Base URL 也使用独立 Secret 和 consent，官方 OpenAI Key 不会自动复用于代理地址。
- 自定义 OpenAI 地址只允许 `{Base URL}/responses` 与 Structured Outputs 契约，不回退到 Chat Completions。远程地址必须使用 HTTPS，HTTP 只允许 `localhost`、`127.0.0.1` 与 `[::1]` 回环服务；拒绝 URL credentials、query、fragment 和已经带 `/responses` 的地址，请求不会跟随 HTTP 重定向。
- AI 联网只允许当前 VS Code 窗口受信任时、已经有文件名和路径的本地 `file:` 或 `vscode-remote:` `.tex`；自动检查与补全可能发送当前编辑器中尚未写入磁盘的最新正文。`.bib`、untitled、Git/其他虚拟 URI 与未信任窗口始终停用。总开关默认关闭，首次使用每个实际接收者还需分别确认正文传输与独立计费。
- 发送前在本地遮罩数学、注释、代码/未知环境、引用、标签、URL、文件参数和未知宏参数；只有明确的正文命令参数会保留。模型返回的范围、原文、重叠和 replacement 控制字符全部经过本地验证，失效或危险建议不会成为编辑。
- 继续输入、切换 Provider/Base URL、关闭功能或清除当前 Key 会取消旧请求；所有异步结果在显示或应用前复核文档版本、原文、配置、workspace trust、目标 consent 和 Secret 指纹。诊断状态及必要原文片段只存在于当前扩展宿主内存，不写入磁盘。
- OpenAI Responses 请求显式携带 `store:false`；这只是 TeXLeaf 发出的不存储请求，自定义第三方代理如何保留、处理或使用正文仍由其自身实现和政策决定。

### Reliability

- DeepSeek 空 content 或非法 JSON 只会自动重试一次；恰好一层、完整包裹结果的 ```` ```json … ``` ```` 围栏可以被安全剥离，围栏外有内容、嵌套围栏、字段/范围/原文/重叠错误均不会宽松提取或重试。
- AI 客户端只向控制器提供认证、权限、计费、限流、网络、超时、取消、拒绝、截断和无效响应等安全分类及内部子码；API Key、论文正文、原始响应和底层解析异常不会写入错误或日志。
- OpenAI 客户端使用 Responses `text.format` 的严格 JSON Schema，仍在本地复核模型输出；完成状态、拒绝、截断、空白或非法结构、响应体上限、超时与取消都有 fail-closed 处理。

### Compatibility

- DeepSeek 接入采用官方 Chat Completions 与 JSON Output，默认 `deepseek-v4-flash` 非思考模式；OpenAI 接入只采用官方定义的 Responses + Structured Outputs 请求形状。ChatGPT Plus/Pro、Codex 使用额度与 OpenAI API 分别计费，不能被插件读取或复用为 API 授权，也不能支付 DeepSeek 或自定义代理费用。
- 此功能覆盖 Grammarly 风格的核心校对、Quick Fix、改写和补全闭环，但不声称兼容 Grammarly 的专有词典、团队风格指南或账户服务。

## [0.7.2] - 2026-08-16

### Fixed

- 修复 VSIX 中 README 仍保留 `media/icon.png` 相对地址、导致扩展详情正文 Logo 显示为破图的问题；打包现在会按公开 GitHub `main` 分支把图片与本地文档链接改写为 HTTPS。

### Changed

- 补充 Marketplace 作者、横幅、免费定价、GitHub Markdown 与 Q&A 元数据，并新增独立支持说明；仓库、问题、主页和许可证资源链接继续指向公开的 `zhangxh-math/texleaf`。
- 清理会掩盖仓库元数据缺失的打包参数，并在 Marketplace 首发前把 Publisher ID 从 `local-lab` 调整为现有开发者身份 `zhangxh-math`；正式扩展身份现为 `zhangxh-math.texleaf`。新版会在旧扩展仍启用时暂停激活；用户保存并禁用旧版、Reload Window 后，若新主片段文件不存在、旧 JSONC 通过严格校验且复制期间未变化，则尽力逐字节复制旧库并保留旧文件。模板 catalog、既有 `globalState` 与 Settings Sync 基线不会跨 ID 自动迁移，自定义模板需在卸载旧版前手工保留并在新版重建。
- README 与 Wiki 新增按片段、Math Preview、Zotero 分组的上游项目致谢，并公开说明 TeXLeaf 由 zhangxh-math 与 OpenAI Codex 联合开发；同步移除 README/Wiki 中把“不依赖 Ultra Math Preview / hscopes-booster”作为宣传表述的文字，改为准确记录其产品灵感与当前实现。

### Distribution

- `texleaf-0.7.2.vsix` 同时作为 Visual Studio Marketplace 首发候选和 GitHub Release 资产生成，不提交到 Git 源码树。

## [0.7.1] - 2026-08-16

### Changed

- 精简 TeXLeaf 自身的引用补全展示：左侧候选继续以文献题目为主，不再额外制造 citation-key 样式候选；右侧详情去除重复字段，但保留一次明确标注的 Citation key，题目、作者、年份与 key 搜索能力不变。
- Snippet 与模板管理器重新排列表单网格，统一标签、输入框和说明文字的占位方式；较窄窗口仍会安全折叠为单列，Snippet 和四个模板的字段不再因说明长短出现参差。
- VS Code 设置页收敛为“片段”“文献”“预览”三个功能分组；原高级片段设置归入片段组，全部既有设置键、默认值与语义保持不变。LaTeX/TeX 的 VS Code 单词补全默认关闭以减少普通 word 候选干扰，用户显式设置仍可覆盖。
- 中文与英文 article 出厂模板的 BibTeX 样式由 `plain` 改为 `alpha`；Beamer 模板未新增参考文献命令。
- README 按片段、文献与预览三部分重写，Wiki 提供更完整的安装、配置、管理器、Zotero、Math Preview、排错与开发说明。源码仓库不再保存 VSIX 二进制；可安装文件只作为 GitHub Release 资产发布。

### Fixed

- 修复管理器表单中说明文字高度不同导致同一行输入框和选择框上下错位的问题。

### Distribution

- `texleaf-0.7.1.vsix` 由对应 tag 的源码重新构建并发布到 GitHub Releases，不提交到 Git 源码树。

## [0.7.0] - 2026-08-16

### Added

- 新增插件内置的“Snippet 与模板管理器”。Snippet 页支持搜索、分类/启用筛选、添加、复制、删除，以及 trigger、replacement、options、说明、分类、优先级、正则 flags、占位符版本和启用状态编辑；模板页支持名称、trigger、说明与完整 TeX 正文编辑，并允许新增、复制和删除自定义模板。
- 新增带预览的批量查找替换：可指定字段范围、大小写和正则模式，先显示匹配数量与最多 100 个前后对照，再应用到未保存草稿；保存前可用受 24 MiB 总预算限制的撤销历史回退。
- 管理器为 Snippet 与模板分别提供恢复默认；Snippet 页继续提供导入/导出和高级 JSONC。两页均支持 `Ctrl+S`、实时结构/正则/trigger 冲突校验和保存前后的 revision 复核，Snippet 文件另外执行文件 CAS；检测到可观察的外部变化时会拒绝覆盖并要求重新载入。

### Changed

- 四个 article/Beamer 模板的 canonical 内容改为当前 VS Code Profile 的插件内部模板库（`globalState` catalog）；干净 Profile 不再生成或依赖可编辑的 `globalStorageUri/templates/*.tex`。首次升级会读取旧文件一次以迁移已有自定义内容，并保留旧文件作为恢复来源；之后运行时只读取插件内部模板库。模板的新增、修改、删除或 trigger 修改在保存后立即更新展开匹配器。
- `TeXLeaf: 管理 TeX 模板` 现在打开统一管理器并直达模板页；原始 Snippet JSONC 仅保留为显式“高级”入口。Snippet 的内部 JSONC 后端继续提供原字节备份、原子替换、导入导出与既有 Settings Sync 兼容性，日常操作不再要求用户接触文件路径。
- 行内 Math Preview 的 `auto` 位置固定在活动源码行下方：光标位于公式起始行时对齐 `$`/`\(`，位于后续源码行时对齐该行首个非空白字符，而不是光标横坐标或编辑器第 0 列。行间预览稳定对齐 opening delimiter，并补偿跨行缩进和 Tab 差异；由于 VS Code 公共 API 不提供编辑器内容区的实时像素宽度，超宽卡片保留 opening 对齐并允许右端被编辑器裁切。
- 深色 Math Preview 使用纯白公式、`#0b0f14` 实底和高亮青色光标；浅色主题使用洋红色光标。SVG 加入高精度几何/文本/颜色渲染提示，光标规则略微加宽；没有给全部 MathJax 字形添加会破坏分数线、根号与定界符的描边。

### Fixed

- 修复 Snippet/模板跨页同时有草稿时，保存一页可能因内部变更通知错误刷新并覆盖另一页草稿的竞态。
- Webview 入站消息在复制模型前按 Snippet 10 MB、模板目录 256 KiB/128 条和单模板 192 KiB 预算拒绝超限数据；客户端使用对应的结构与总量预算尽早禁用保存，主机端仍执行最终权威校验并清楚报告超限。旧的 Webview 直写 JSONC 路径已移除：Snippet 结构化保存经过 Repository 的备份、原子文件替换与复核，模板保存经过内部 catalog 的备份和保存前后 revision 复核。
- 无效的已同步模板状态不再阻断管理器本身：运行时继续使用内存中的 factory/LKG，模板页仍可打开并显式恢复默认；普通保存不会隐式覆盖损坏状态。

### Not included

- 没有加入 PDF 面板或不完整的“整篇预览”。VS Code 稳定文本编辑器 API 无法提供 Overleaf/Obsidian 式、可点击切换源码并自动重排行高的任意 MathJax 替换部件；按产品要求，本版直接跳过该需求，只保留当前公式浮动预览。

### Verification

- 单元测试覆盖结构化管理器 CSP、无动态 HTML sink、生成脚本语法、CRUD/搜索/查找替换/CAS 协议标记、模板 catalog 安全上限与 factory 身份，以及最新行内/行间布局和深浅主题 SVG 外观。
- 隔离 VS Code Extension Host 覆盖内部模板 catalog 的四个默认展开、干净 Profile 不物化外部模板文件、Snippet/模板自动路径、Zotero 引用生命周期与 Math Preview；生产 Worker 和 VSIX 必须由本版源码重新构建，不能复用 0.6.1 的旧 bundle。

## [0.6.1] - 2026-08-16

### Changed

- 四个独立模板 `tmpa-cn`、`tmpa-en`、`beamer-cn`、`beamer-en` 现在会在已保存的空白 `.tex` 文档中输入完整 trigger 后立即自动展开；`texleaf.autoSnippets=false` 时仍可用精确 `Tab` 手动展开。模板继续读取当前 VS Code Profile 的可编辑 `.tex` 副本，升级不会覆盖用户修改。
- 13 个定理类环境改为带反斜杠的文本模式自动 trigger：`\axm`、`\dfn`、`\lem`、`\prp`、`\thm`、`\cor`、`\clm`、`\asm`、`\exm`、`\exr`、`\cnj`、`\hyp`、`\rmk`。definition 使用 `\dfn`，不会占用 TeX 原生命令 `\def`。
- 工厂库 revision 3 只把仍与 revision 2 出厂记录完全一致的定理片段窄迁移为新 trigger 与 `tAw`；已修改、禁用或与目标 trigger 冲突的记录不覆盖，其他已删除的规则和变量不复活，默认总数保持 212。
- 原生 Suggest 中，与当前输入精确相同的 TeXLeaf trigger 会临时使用普通关键字分组并优先预选，从而不受 `editor.snippetSuggestions: "bottom"` 影响；插入内容仍是完整 `SnippetString`，Tabstop 语义不变。非精确候选仍保留 Snippet 类型和 VS Code 原生排序。

### Fixed

- 为模板、定理环境和 `dm` 增加精确 trigger 的 `Tab` 兜底：自动输入事件偶发被输入法、外层 Snippet Session 或其他扩展延迟时，不再误接受 `document`、`theorem` 等普通单词补全；没有精确 trigger 时仍由原生 Suggest、模板占位符、矩阵和 Tabout 处理 Tab。

### Verification

- 隔离 VS Code Extension Host 回归覆盖四模板的直接输入与文档变化两条自动路径、`autoSnippets=false`、模板内嵌套 `dm`、`\thm` 自动展开与两个 tabstop、全部 13 个精确 Suggest 候选，以及 `snippetSuggestions=bottom` 下真实接受所选候选。
- 迁移回归覆盖 revision 1→3、revision 2→3、逐条用户自定义/禁用保护、目标 literal/regex trigger 冲突、删除不复活与原字节备份。

## [0.6.0] - 2026-08-16

### Added

- 新增四个独立、可编辑的 TeX 模板：`tmpa-cn`、`tmpa-en`、`beamer-cn`、`beamer-en` 在空白 `.tex` 文档中按 `Tab` 展开。模板首次复制到当前 VS Code Profile 的 `globalStorageUri/templates/`，升级不覆盖已有修改；新命令 `TeXLeaf: 打开独立 TeX 模板` 可直接定位。
- 从用户提供的 HSnips 文件中只加入 13 个定理类环境片段：axiom、definition、lemma、proposition、theorem、corollary、claim、assumption、example、exercise、conjecture、hypothesis、remark。它们均为文本模式的手动片段，不会在正文中自动误触发。
- 在 equation、align、aligned、gather、multline、flalign、split 等可换行数学环境中，光标位于安全匹配的 `\left…\right…` 内按 Enter 时，可自动生成上一行 `\right.\\` 与下一行 `\left.` 的跨行定界符结构，并保留 EOL 与缩进。

### Changed

- 原出厂行内数学触发词从 `mk` 改为 `lm`。工厂库 revision 2 只对仍与旧出厂记录完全一致的条目做窄迁移，并只追加本版新增的定理环境；用户删除的旧规则、变量和自定义 `mode.inline` 不会复活或被覆盖。
- Zotero 原生 Suggest 左侧统一只显示题目与紧凑来源，不再用 citation key 占据标题宽度；右侧详情分别显示完整题目、作者、期刊/出版物、年份、来源/导入状态和 key。题目、作者、年份与 key 均继续参与筛选，但 key 不出现在左侧候选标签中。
- article 模板使用 `geometry`、`mathtools`、`amsthm` 等较稳妥的现代默认，修正 theorem 共享计数器写法，bibliography 对应 `reference.bib`；Beamer 模板复用类内置环境并补齐其缺少的 8 个定理类环境。所有模板均移除个人姓名、邮箱、学校/导师信息、默认 `draft`、`showkeys` 与过时 `subfigure`。

### Fixed

- 修复 `\cite{a}` 退格回到 `\cite{}` 后再次输入时原生 Suggest 不会重新打开的问题。自动触发身份现在包含文档版本、光标与查询状态，同时避免接受候选后因内部编辑立即重弹。
- `\label{...}`、`\tag{...}` 与 `\tag*{...}` 参数现在对自动、Tab 手动、补全和 Visual 数学片段统一保持 opaque；例如 `\label{;a}` 不会再展开为 `\alpha`，参数闭合后外层数学环境立即恢复。
- Smart Enter 对嵌套跨光标定界符、命令 token、注释、verb、braced argument、已有 `\\`、alignment cell 与嵌套环境采取 fail-closed；不安全情形完全退回原有 Enter 行为。

### Verification

- 单元测试覆盖 citation 的标题/作者/年份/key 搜索、label/tag 跨行扫描、revision 2 数据保护、模板占位符与个人信息清理，以及 left/right Enter 的 LF/CRLF、星号环境、嵌套和危险边界。
- 隔离 VS Code Extension Host 回归覆盖 citation 的 `a → 退格清空 → Ada → 接受` 完整生命周期、四个模板真实 Tab 展开、定理环境、revision 1→2 窄迁移、label/tag 抑制和 equation/align Smart Enter。

## [0.5.6] - 2026-08-16

### Fixed

- 修复 0.5.5 中预览卡片仍可能从编辑区第 0 列开始、无法与缩进后的 opening delimiter 对齐的问题。Monaco 会把 `before` decoration 生成为位于源码范围起点的独立伪元素，而不是宿主范围的子元素；新版不再用 `left: 0` 覆盖这个原生静态位置，只在跨行缩进确实不同时使用受限的 `translateX(...)` 补偿。装饰范围也改为公式锚点处的零宽范围，避免正文范围参与定位。
- 修复超高公式仍被旧的 8em 显示上限压扁、从而让 `auto` 误判上下可用空间的问题。光标预览现在只在超过 40em 宽度时等比缩放；正常的高矩阵和多行环境保留真实高度，并以同一个显示高度驱动 SVG 根尺寸、Monaco decoration 和布局规划。256em 只作为异常 TeX 几何的绘制安全上限。
- 超高公式上下都放不下时仍固定选择上方；预览顶部可以被视口裁掉，而预览底部和当前公式源码尾部保持可见。

### Verification

- 新增直接连接隔离 VS Code 渲染器的 CDP 回归：读取真实 Monaco `::before` 伪元素边界，而不是只检查 CSS 字符串。缩进 `\[` 夹具中，卡片左边缘与 opening delimiter 的实测误差为 0.016 px；28 行 `align` 夹具的实测高度为 108.30em，选择 `above` 且顶部按设计裁切。
- 单元测试进一步禁止 `left`、`right` 与所有水平 `inset` 重新锚定，验证 30em 预览以完整高度参与可见行计算；Worker 冒烟测试使用真实 20 行环境验证 SVG 根高度与返回元数据一致且大于 8em。

## [0.5.5] - 2026-08-16

### Changed

- Math Preview 卡片的左边缘现在严格以公式真实的起始定界符为基准：行内公式对齐左侧 `$` 或 `\(` 的反斜杠；行间公式对齐 `$$` 的第一个 `$`、`\[` 的反斜杠或 `\begin{…}` 的反斜杠。上下锚点所在行较短或采用不同 Tab/空格缩进时，会按编辑器 Tab 宽度计算安全的视觉列补偿。
- `texleaf.mathPreview.placement=auto` 改为下方优先：下方能容纳时始终放下方，下方不足才切换到上方；上下都不足时仍保持在上方。
- 超高、多行公式在上下均放不下时，以当前可见公式尾部前约两行为卡片分界，使预览顶部可以被视口裁切，同时尽量保留预览底部和公式源码的最后三行。该策略只作用于 `auto`，显式 `above`/`below` 仍严格服从用户设置且不会自动滚动文档。

### Fixed

- 修复行间公式结束行比起始行更短，或两行使用不同 Tab 缩进时，预览左边缘不能与 opening delimiter 保持一致的问题。
- 修复 `auto` 在上下都能放下时可能优先选择上方，以及超高公式只留下光标所在一行源码的问题。

### Verification

- 布局回归覆盖 `$`、`\(`、`$$`、`\[` 与 `\begin{align}` 的起始列、短结束行、不同 Tab 缩进、下方优先、视口外边界和超高公式尾部保护；视觉 QA 脚本新增 `tall-display` 场景，并继续只接受枚举后的主题、场景和位置参数。

## [0.5.4] - 2026-08-16

### Changed

- Math Preview 的 `cursor` 卡片改为公式上方/下方的绝对定位浮层，不再作为公式末尾的行内附件参与文字行宽与自动换行。行内公式从起始定界符附近浮动，行间公式尽量靠近编辑区左侧。
- 新增 `texleaf.mathPreview.placement`，可选 `auto`（默认）、`above` 或 `below`；自动模式依据公式附近的空白行与当前可见区域选择方向。
- 深色与浅色主题的圆角 SVG 卡片底色均改为 100% 不透明，并把卡片放在源代码文字上层；编辑器壁纸和语法高亮不会再穿透并干扰公式。

### Fixed

- 修复行内公式预览出现后，同行后续输入被预览宽度推挤、折行或与预览重叠的问题。
- 修复多行长公式的预览从公式末尾开始、可用水平空间不足的问题；行间浮层改为尽量从编辑区左侧展开。

### Compatibility

- VS Code 稳定扩展 API 没有可用于此布局的公开 view-zone/任意浮层接口，因此 `cursor` 模式使用固定、内部生成且不接受用户内容的 Monaco decoration CSS 兼容层。它不能预留真正的垂直空间，公式上下均无空白行时仍可能暂时遮住相邻一行；若未来 VS Code、主题或平台不接受该定位，可使用原生 `hover` 模式。
- 该布局、扫描与渲染仍是 TeXLeaf 的独立实现，不安装、不调用也不依赖 Ultra Math Preview 或 Hyperscopes Booster，并且没有复制其源码、正则、CSS 或资源。

## [0.5.3] - 2026-08-16

### Changed

- Math Preview 卡片现在把背景、边框、内边距与圆角直接绘制在安全 SVG 内：深色主题使用近乎不透明的深色底，浅色主题使用近乎不透明的浅色底，不依赖 VS Code 未公开的 CSS 注入，也不会再让编辑器壁纸或透明主题干扰公式字形。
- 光标模式会在预览公式中的对应排版位置显示一条主题自适应竖线：深色主题为橙色，浅色主题为蓝色，与公式前景保持区分。原生 Hover 继续显示不带光标的干净公式。

### Fixed

- 新增保守的 TeX 光标边界规划，避免把标记插进控制序列、`\frac` 参数槽、`\left`/`\right` 定界符、上下标参数、环境名、注释、`\verb`、换行间距或 UTF-16 surrogate pair；歧义位置会吸附到最近的安全边界。
- 带光标版本渲染失败时自动回退到无光标公式，光标增强不会导致整张预览消失；极窄公式的显示尺寸也改由最终 SVG 重新计算，避免卡片被拉伸或产生透明留白。

### Verification

- 新增圆角卡片、深浅主题配色、光标规则、分数/下标/`align` 光标、危险 TeX 边界与窄公式纵横比回归测试，并在隔离的深色和浅色 VS Code 窗口中完成真实像素验证。

## [0.5.2] - 2026-08-15

### Fixed

- 修复 0.5.1 缩短缓存路径后，部分 Windows/VS Code 环境中的 Math Preview 光标卡片仍只有边框而没有公式的问题。MathJax SVG 现在以 Base64 `data:` URI 直接交给编辑器 decoration，不再经过 Chromium 对本地 `file:` SVG 的加载路径；本地短路径 SVG 仍保留给原生 Hover 使用。
- 新增包含 Unicode 字形与 SVG 内部 `href="#…"` 引用的数据 URI 回归测试，并使用隔离的 Extension Development Host 做真实界面验证，确认公式像素实际显示，而不只检查 SVG 文件是否生成。

## [0.5.1] - 2026-08-15

### Fixed

- 修复 Windows 上 Math Preview 只显示空背景框的问题：原 SVG 缓存文件名同时包含完整 SHA-256 和 UUID，会让 VS Code `globalStorage` 中的完整路径恰好达到 260 个字符；文件已生成，但 Monaco 无法把它加载到 decoration。缓存文件现改用 session-local 短序号，保留竞态隔离的同时将用户实际路径从 260 缩短到约 160 个字符。
- 扩展宿主回归测试新增预览资产短文件名断言，防止后续重新触发 Windows `MAX_PATH` 边界。

## [0.5.0] - 2026-08-15

### Added

- 新增 TeXLeaf 内置 Math Preview：主光标进入 `$…$`、`$$…$$`、`\(…\)`、`\[…\]` 或常见数学环境时，只渲染当前公式，并通过 VS Code 原生 decoration 在公式旁显示离线 SVG；也可选择原生 Hover 或两者同时显示。
- 新增 `texleaf.mathPreview.enabled` 总开关，以及显示模式、防抖、缩放、单公式长度上限和自定义宏设置；新增切换、刷新与关闭当前预览命令。
- 支持从当前文档前言解析 `newcommand`、`renewcommand`、`providecommand` 与 `DeclareMathOperator`；注释、verb/verbatim 和嵌套数学子环境不会产生错误或重复预览。

### Changed

- VS Code 原生设置页拆分为“编辑与片段”“Zotero 与参考文献”“高级”“Math Preview”四个分类；Zotero 总开关、bibliography 文件名和 BibTeX/BibLaTeX 格式现在集中显示在引用分类顶部。
- MathJax 与 New Computer Modern 字体随 VSIX 离线分发，并在首次预览时才载入独立 Worker。预览使用文档版本缓存、有上限的渲染缓存、防抖、过时代次丢弃和 5 秒超时，不阻塞扩展宿主主线程。
- Math Preview 完全复用 TeXLeaf 自己的 LaTeX 扫描器，不依赖 Ultra Math Preview、Hyperscopes Booster、TextMate grammar 或 Oniguruma WASM；没有复制上述扩展的源码、正则、CSS 或资源。

### Security

- MathJax 只装载明确允许的 TeX package，禁用动态 `require`/`autoload` 与 HTML 类扩展；输入长度、宏数量和宏展开受限。输出 SVG 会拒绝脚本、事件属性、外部链接与 `foreignObject` 等活动内容，并写入扩展私有缓存目录后供 decoration/Hover 读取。
- VSIX 随附 MathJax 组件的 Apache-2.0 许可证与第三方声明。

## [0.4.1] - 2026-08-15

### Fixed

- 修复 Better BibTeX 搜索条件包含不受 Zotero 接受的 `annotation` item type、导致 Zotero 候选始终为空的问题；过滤改在客户端完成，并在 Better BibTeX 搜索不可用时支持 Zotero Local API 回退。

### Changed

- citation 候选改为 VS Code 原生 Suggest 补全。bibliography 已有条目优先排序，Zotero 新条目随后显示并带来源标签；标题、作者与 citation key 都参与原生筛选。
- 原生补全每次接受一篇；在同一个 `\cite{}` 中输入逗号即可再次触发，连续加入多篇，同时保留其他逗号分段。
- `texleaf.pickCitation` 的显示名称改为更准确的 `TeXLeaf: 显示参考文献补全`，命令 ID 保持不变。
- 新增公开设置 `texleaf.bibliographyFormat`，可选 `bibtex` 或 `biblatex`，默认 `bibtex`；`texleaf.bibliographyFile` 继续默认 `reference.bib` 并允许自定义项目内 `.bib` 相对路径。0.4.0 的旧 `texleaf.zoteroExportFormat` 不再显示，但显式旧值仍作为兼容回退，显式新值优先。

## [0.4.0] - 2026-08-15

### Added

- 新增 Zotero 引用选择器：光标进入配置的 `\cite{…}` 类命令参数时自动打开，并通过不可选分隔标题把 `reference.bib` 已有条目与 Zotero 中尚未加入的条目分成两个区域。
- 每条候选以标题为主行，以作者、期刊/出版物和年份为副行；当前逗号分段会成为初始查询，选择框继续支持按标题、作者与 citation key 筛选。
- 引用选择器支持一次多选，也支持只替换同一个 `\cite{}` 中光标所在的逗号分段；已有 sibling key 不会被覆盖或重复插入。
- 用 citation key、DOI、ISBN 及“标题 + 第一作者 + 年份”识别已导入文献，可复用 bibliography 中不同的现有 key；未闭合条目、重复 key、危险 key 与明确元数据冲突会阻止自动追加。
- 选择 Zotero 条目时，通过 Better BibTeX 本地 JSON-RPC 获取权威 citation key 与单条导出，并用同一个纯文本 `WorkspaceEdit` 追加 `.bib`、修改 `.tex`。任一导出或校验失败时不会提交部分编辑。
- 新增 `TeXLeaf: 选择 Zotero 参考文献` 与 `TeXLeaf: 刷新 Zotero 参考文献缓存` 命令，以及 bibliography 路径、citation 命令、Zotero 端口/库/超时/缓存和 BibTeX/BibLaTeX 格式设置。

### Changed

- 扩展现在优先运行在本地 UI extension host，从而在 Remote SSH、WSL 或 Dev Container 项目中仍有机会访问桌面 Zotero；项目文件继续通过 VS Code Workspace FS/文档 API 编辑。
- README 与配置文档补充 Zotero、Better BibTeX、分组多选、原子文本编辑、未信任工作区以及 Remote 场景的说明，并移除“不负责引用管理”的旧边界。

### Security

- Zotero 连接固定为 `127.0.0.1`，只允许配置端口，不接受任意主机 URL；未信任工作区中不发起本地书目请求，也不自动创建或修改项目 bibliography。
- bibliography 设置只接受工作区内不含 `..` 的相对 `.bib` 路径。写入前会重新读取当前 VS Code 文档模型、重新解析并检查重复 key，避免覆盖脏文件或静默追加冲突条目。

## [0.3.0] - 2026-08-15

### Added

- 新安装首次创建全局 JSONC 时，直接写入当前版本的全部 199 条默认规则以及 `GREEK`、`SYMBOL`、`MORE_SYMBOLS` 三个正则变量；默认规则与个人修改现在位于同一份可审阅文件中。
- 新增 `TeXLeaf: 恢复默认片段`（`texleaf.restoreDefaultSnippets`），可从 Command Palette、片段侧栏标题和全局编辑面板运行。恢复使用原生 modal 确认，成功前会对现有文件做逐字节备份和回读校验。
- 新增 VS Code Settings Sync 镜像：有效全局库通过扩展 `globalState` 的同步键交给用户已启用的 Settings Sync，并在其他兼容安装中安全落回可编辑 JSONC 文件。

### Changed

- 运行时片段来源精简为用户全局 JSONC 和 `texleaf.snippetFiles` 显式项目附加文件，不再存在独立的 `builtin` 或 `settings` 来源。用户可以直接修改、禁用或删除任何工厂默认规则，完成迁移后删除项不会在启动时复活。
- `texleaf.customSnippets` 已从设置清单和运行时加载路径移除。`texleaf.snippetFiles` 继续默认为空，仅在用户明确配置时加载当前文档所属工作区的 extras；同等匹配条件下项目附加文件优先于全局库。
- 导入、导出、树视图、搜索和补全都以单一全局库为基础；导出不会混入项目附加文件。

### Fixed

- 修复 `Qhat` 被末尾字面 `hat` 规则抢先、无法展开为 `\hat{Q}` 的问题，并统一修复 `bar`、`dot`、`ddot`、`tilde`、`und`、`vec` 字母后缀与 `\alpha hat` 等命令后缀的优先级冲突。
- 恢复默认会同时保护原生文本编辑器和 Webview 中的未保存内容；确认期间发生磁盘变化、备份失败或重新加载验证失败时，不再静默覆盖用户文件。

### Migration

- 对已有 0.2.x 全局文件执行一次追加式迁移：现有片段和变量优先保留；旧版用户级 `texleaf.customSnippets` 中有效的纯数据条目随后加入；缺失的工厂规则和三个默认变量最后补齐。对象式且 `snippets` 为数组的 JSONC 会尽量保留注释、未知顶层字段、原顺序和未改动条目的格式；顶层数组或旧字符串格式会规范化并重新序列化。实际改写前会在 `globalStorageUri/backups` 创建原始逐字节备份，并写入 `defaultsRevision` 防止重复迁移。
- 只读取旧 `texleaf.customSnippets` 的用户全局值，不读取或提升工作区级旧值。无效旧设置会被报告并跳过，不会阻止其他有效内容迁移。
- 旧项目中的 `.vscode/texleaf-snippets.jsonc` 仍不会自动读取、复制或删除；需要时必须使用 `TeXLeaf: 导入片段` 显式选择。未信任工作区继续禁用项目级 `texleaf.snippetFiles`。

### Settings Sync

- Settings Sync 必须由用户在 VS Code 中主动启用；同步镜像不是额外的运行时片段源。应用远端镜像前会验证内容、检查 dirty 状态并比较本地基线哈希；lineage 会把从同一父版本各自修改形成的兄弟分支判定为冲突，不会采用静默覆盖。
- 同步 envelope 的 JSON 序列化结果上限为 256 KiB；无效、dirty 或超限内容继续在本机可用但暂停同步。由于 VS Code 没有公开 globalState 变更事件，接收侧通过窗口聚焦、repository/editor 事件与约 15 秒轮询检查，并为首次云端水合提供约 30 秒宽限。
- 同步导致本地替换时同样先创建备份，但备份只留在接收端当前环境，不上传到 Settings Sync。
- Settings Sync 不会自动安装手工分发的 VSIX。其他设备仍需安装标识为 `local-lab.texleaf` 的兼容版本；不同 Profile、Stable/Insiders、本地与 SSH、WSL、Dev Container 等 Remote 扩展宿主可能保持独立安装和存储。

## [0.2.3] - 2026-08-15

### Changed

- 用户 JSONC 主片段库改为 VS Code `globalStorageUri/texleaf-snippets.jsonc`，同一个 VS Code Profile 的所有工作区共享，无需在每个项目重复维护。
- Command Palette 与大编辑面板分别更名为 `TeXLeaf: 打开全局 Snippet 配置文件` 和 `TeXLeaf: 编辑全局 Snippet`，并指向同一份用户级文件。
- `texleaf.snippetFiles` 默认改为空数组，只在用户明确配置时加载项目专属附加文件；这些附加文件仍可覆盖全局规则。
- 来源优先级调整为项目附加文件 → 全局文件 → 设置页片段 → 内置片段。
- 多根工作区中的项目附加文件按当前文档所属根目录隔离；工作区外文档只使用用户级和内置来源。
- 导入与导出会拒绝覆盖尚未保存或在操作期间被外部修改的全局文件；导入对象式 JSONC 时保留未改动的注释与顶层元数据。
- 未信任工作区会限制 `texleaf.snippetFiles` 和项目对 `texleaf.customSnippets` 的覆盖，用户全局库仍可使用。

### Migration

- 旧版项目内的 `.vscode/texleaf-snippets.jsonc` 不会被读取、复制或删除，并且不再默认加载，避免不受信任的项目规则被静默提升为全局规则。需要保留其中的自定义内容时，可运行 `TeXLeaf: 导入片段` 并显式选择该文件一次。

## [0.2.2] - 2026-08-15

### Added

- Command Palette 中新增清晰可搜索的 `TeXLeaf: 打开 Snippet 配置文件` 入口，可直接打开或创建工作区 JSONC 片段文件。
- 默认支持 BibTeX language ID，并为本地、Remote 与虚拟工作区加入大小写不敏感的 `.tex`/`.bib` 后缀判断。

### Changed

- 重新绘制扩展与活动栏图标，TeX 字标改用接近 Computer Modern 的经典排版轮廓。
- 所有片段与编辑辅助严格限制到已保存的 `.tex` 和 `.bib` 文件；Untitled、Markdown、伪后缀及其他文件不再生效。

### Fixed

- 修复 Windows 中文输入法提交全角左括号或顿号时，异步 `type` 转发与组合文本覆盖命令次序颠倒，从而出现 `（（`、`、、` 的问题。相关输入命令现在按编辑器发出的顺序串行处理。

## [0.2.1] - 2026-08-15

### Fixed

- 自动分式现在也监听真实文档变更；物理键入、编辑 API 与其他扩展转发的输入都能在数学区域把 `1/2` 转换为 `\frac{1}{2}`，同时仍由显式 `//` 片段优先匹配。
- `align`、`align*` 与矩阵类环境的 Enter 兼容 LaTeX Workshop：即使其高优先级 Enter 绑定先收到按键，普通换行仍会回流到 TeXLeaf 并插入 `\\` 后换行。
- 扩展宿主回归测试不再用 TeXLeaf 自己的 `type` 命令模拟自动分式，而是逐字符触发真实 `onDidChangeTextDocument` 路径，并覆盖 LF/CRLF 的 Align 行列操作。

## [0.2.0] - 2026-08-15

### Added

- 在 VS Code 设置页加入 `texleaf.customSnippets` 多行 JSONC 输入框，少量自定义片段无需离开设置页即可维护。
- 新增 `TeXLeaf: 编辑工作区片段`（`texleaf.openSnippetEditor`）大面板，可编辑 `.vscode/texleaf-snippets.jsonc`，并提供保存、从磁盘重新加载、安全说明与外部修改冲突保护。
- 为扩展清单加入 PNG Marketplace 图标 `media/icon.png`。

### Changed

- 自动分数改为保留用户输入的 `/`，等首个有效分母字符到来时再完成转换；例如输入 `1/2` 时在 `2` 到来后生成 `\frac{1}{2}`。
- 自动片段优先于待处理的自动分数，因此显式 `//` 分数片段继续可用。
- 自定义片段的来源顺序为工作区文件、`texleaf.customSnippets` 设置、内置片段；显式 `priority` 继续参与规则选择。

### Fixed

- 修复 `dm` 以及补全列表插入的多行片段不继承当前代码缩进的问题。
- 修复 `align` 与 matrix 类环境中 `Tab`、`Enter`、`Shift+Enter` 被 snippet 模式拦截或执行错误的问题；列、行与退出环境导航现在按对应上下文工作。

## [0.1.1] - 2026-08-15

### Fixed

- 修复生产 bundle 选择 `jsonc-parser` UMD 入口后残留 `require("./impl/*")`，导致 VSIX 安装成功但扩展激活失败的问题。
- 发布验证现在会加载实际的 `dist/extension.js`，并拒绝任何未打包的相对运行时依赖。
- 将配置声明为资源作用域，消除按文档 URI 读取多根工作区设置时的扩展宿主警告。

## [0.1.0] - 2026-08-15

### Added

- 首个 TeXLeaf VS Code 扩展版本。
- 文本、行内数学与块级数学上下文片段。
- 自动展开和按 `Tab` 确认两种触发方式。
- `@0` 风格 tabstop 与 `@[0]` 风格正则捕获替换。
- 基于字符串 replacement 的 Visual 选择区包裹。
- 自动分数、括号放大、矩阵快捷键、Tabout 与片段补全。
- 安全的工作区 JSONC 片段文件 `.vscode/texleaf-snippets.jsonc`。
- 推荐的对象式片段库、兼容的数组简写，以及 v1/v2 占位符迁移。
- 片段打开、重载、导入、导出、搜索插入、切换启用与选择区包裹命令。
- 中文使用文档、配置参考、开发指南与第三方许可声明。

### Security

- 自定义片段仅作为 JSONC 数据解析，不执行函数 replacement 或其他 JavaScript 表达式。
- 正则片段使用有限的光标邻近扫描范围。
