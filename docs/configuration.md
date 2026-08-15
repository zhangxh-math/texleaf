# TeXLeaf 配置参考

在 VS Code 设置中搜索 `texleaf` 即可修改配置。工作区级设置适合团队统一使用，用户级设置适合个人习惯。

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
| `TeXLeaf: 编辑全局 Snippet` | `texleaf.openSnippetEditor` | 在大文本面板中编辑、保存或重新读取所有工作区共享的用户级主文件。 |
| `TeXLeaf: 打开全局 Snippet 配置文件` | `texleaf.openSnippetFile` | 从 Command Palette 打开或创建 `globalStorageUri/texleaf-snippets.jsonc`。 |
| `TeXLeaf: 恢复默认片段` | `texleaf.restoreDefaultSnippets` | 确认并备份现有文件后，用当前版本的完整 199 条默认规则恢复全局库。 |
| `TeXLeaf: 重载片段` | `texleaf.reloadSnippets` | 重新读取全局库与当前项目明确配置的附加文件，并刷新诊断。 |
| `TeXLeaf: 搜索并插入片段` | `texleaf.pickSnippet` | 从可用片段中搜索并插入。 |
| `TeXLeaf: 切换启用状态` | `texleaf.toggle` | 启用或停用 TeXLeaf，并保存到工作区设置（无工作区时保存到用户设置）。 |
| `TeXLeaf: 导入片段` | `texleaf.importSnippets` | 从安全的 JSON/JSONC 文件导入片段。 |
| `TeXLeaf: 导出片段` | `texleaf.exportSnippets` | 将当前全局片段库导出为可审阅的数据文件；不会混入项目附加规则。 |
| `TeXLeaf: 用片段包裹所选内容` | `texleaf.wrapSelection` | 选择 Visual 片段并包裹当前选择。 |

## 全局片段库

`TeXLeaf: 编辑全局 Snippet` 打开一个专用大面板，固定编辑 VS Code 为 TeXLeaf 分配的用户级 `globalStorageUri/texleaf-snippets.jsonc`。面板提供保存、从磁盘重新加载、安全说明，以及对文本编辑器脏文件和外部磁盘修改的冲突保护。需要 VS Code 原生 JSONC 语言服务时，从 Command Palette 使用 `TeXLeaf: 打开全局 Snippet 配置文件` 打开同一个文件。

在 Windows Stable 中，其典型位置是 `%APPDATA%\Code\User\globalStorage\local-lab.texleaf\texleaf-snippets.jsonc`。实际路径由当前 VS Code Profile 与运行环境决定；命令入口会始终使用正确 URI。该文件不属于任何项目，切换工作区无需复制。不同 VS Code Profile 或不同 Remote 主机拥有各自的全局存储。

首次创建时，文件直接包含当前版本的 199 条默认规则、`GREEK`、`SYMBOL`、`MORE_SYMBOLS` 三个变量，以及 `defaultsRevision` 迁移标记。运行时只有这份全局文件和用户显式配置的项目附加文件，不再有隐藏的 `builtin` 或 `settings` 片段源。用户可以在全局文件中直接修改、禁用或删除默认规则；`defaultsRevision` 已完成后，启动时不会把用户删除的规则重新补回。

无论从全局文件、导入文件还是项目附加文件加载，`replacement` 都必须是字符串。函数、RegExp literal、导入语句或其他 JavaScript 表达式不会执行。

`texleaf.snippetFiles` 只用于显式添加项目专属文件，默认不会读取 `.vscode/texleaf-snippets.jsonc`。旧版留下的工作区文件不会被读取、复制或删除；若要把其中的内容迁入全局库，请运行 `TeXLeaf: 导入片段` 并明确选择该文件。

在未信任工作区中，VS Code 会限制 `texleaf.snippetFiles`，防止项目在未经同意时注入自动片段。用户级全局 JSONC 主文件仍然可用。

### 0.2.x 一次性迁移

0.3.0 首次看到没有当前 `defaultsRevision` 的有效全局文件时，会执行一次追加式迁移。原文件中的片段和变量优先；随后加入旧版用户级 `texleaf.customSnippets` 中尚不存在的有效纯数据条目，最后补齐缺失的工厂默认规则和三个默认变量。对象式且 `snippets` 为数组的 JSONC 会尽量保留注释、未知顶层字段、原顺序与未修改条目的格式；顶层数组或旧字符串格式需要规范化，因此会重新序列化，但迁移前的原始字节仍保存在备份中。

`texleaf.customSnippets` 已从 0.3.0 设置清单中移除，也不再参与运行时匹配。迁移代码只读取旧设置的用户全局值一次，不读取或提升工作区级旧值。若旧设置无效，只跳过相关定义并报告问题。迁移需要改写文件时会先在 `globalStorageUri/backups` 中创建逐字节备份；全局文件本身无效或在迁移期间发生变化时不会覆盖。

### 恢复默认与本地备份

`TeXLeaf: 恢复默认片段` 可从 Command Palette、片段侧栏标题和全局大面板运行。它是完整替换而不是合并：确认后使用当前版本的 199 条默认规则与三个变量替换全局文件。原生文本编辑器或大面板有未保存内容时会被拒绝；确认期间磁盘哈希变化时会取消；写入前先创建并校验原文件的逐字节备份，再通过临时文件替换并重新加载验证。

备份位于当前环境的 `globalStorageUri/backups`，不会纳入 Settings Sync。恢复成功通知可以直接打开备份；若要撤回，可审阅后运行 `TeXLeaf: 导入片段`。

### Settings Sync 镜像

可编辑的唯一真源仍是当前 VS Code Profile/扩展宿主下的 `globalStorageUri/texleaf-snippets.jsonc`。这个文件不会被 Settings Sync 原生上传；TeXLeaf 把有效、已保存的完整 JSONC 内容封装到一个私有 `globalState` envelope，并通过 `globalState.setKeysForSync(...)` 注册。片段库不会写入公开 `settings.json`，同步镜像也不是额外的运行时片段来源。

用户必须在 VS Code 中主动开启 Settings Sync，并在同步内容中包含 Extensions。关闭同步时，本地文件和所有编辑功能仍正常工作。手工安装的 VSIX 不会因为片段镜像而自动出现在另一台机器；每个设备仍需安装标识为 `local-lab.texleaf` 的相同或兼容版本。

同步 envelope 的 **JSON 序列化结果上限为 256 KiB**，不是单纯源文件的字节数。超过上限时本机文件和当前片段继续可用，但新内容不上传。JSONC 无效、缺少有效 `snippets` 结构、原生文本编辑器 dirty，或全局大面板存在未保存内容时，上传与下载 reconciliation 都会延后，并保留上一次有效云端镜像。

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

### Tabout

Tabout 优先遵守活动 snippet 的 tabstop；没有可前往的 tabstop 时，再尝试越过临近的右括号或数学分隔符。若 `Tab` 已被其他扩展接管，可通过键盘快捷方式页面检查 `texleaf` 命令的 when 条件与冲突来源。

### 数学上下文

TeXLeaf 识别常见的 `$ … $`、`\( … \)`、`$$ … $$`、`\[ … \]` 与配置允许的环境。该判断面向低延迟输入，不等价于完整 TeX 解析：注释、转义、嵌套宏和不完整源码都可能影响结果。把 `verbatim`、`lstlisting`、`minted` 等不应展开的区域加入 `texleaf.excludedEnvironments`。

### Conceal 边界

TeXLeaf 不进行像素级 Conceal，也不会用覆盖层把源文本替换成“看似编译完成”的公式。若版本提供编辑器装饰，它只使用 VS Code 原生 decoration 能力，不改变文档内容、字符偏移、光标或选择范围。需要完整排版效果时应使用 LaTeX PDF 预览。

## 与其他扩展共存

TeXLeaf 可以和 LaTeX Workshop 等编译、预览或语言服务扩展同时使用。如果相同按键或补全触发重复：

1. 先确认 `texleaf.autoFraction`、`texleaf.matrixShortcuts` 等目标功能没有被用户或工作区设置关闭；升级不会重置这些覆盖值。
2. 在键盘快捷方式页面搜索 `texleaf` 与冲突按键；需要精确定位时运行 `Developer: Toggle Keyboard Shortcuts Troubleshooting`。
3. 关闭 `texleaf.enableCompletions`，判断是否为补全提供器重复。
4. 临时关闭 `texleaf.matrixShortcuts` 或 `texleaf.tabout`，缩小按键冲突范围。
5. 确认文件已经保存为 `.tex` 或 `.bib`，再用 `texleaf.languageIds` 在这两个后缀内限定适用语言。
