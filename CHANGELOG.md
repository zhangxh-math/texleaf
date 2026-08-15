# Changelog

TeXLeaf 的所有重要变更都会记录在此文件中。版本格式遵循语义化版本。

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
