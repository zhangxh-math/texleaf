# TeXLeaf

<p align="center">
  <img src="media/icon.png" width="128" height="128" alt="TeXLeaf 叶片与 TeX 图标">
</p>

<p align="center"><strong>在 VS Code 里像写草稿一样快速输入 LaTeX。</strong></p>

TeXLeaf（完整扩展标识：`local-lab.texleaf`）是一款面向 LaTeX/TeX 与 BibTeX 源文件的 VS Code 扩展。它提供上下文感知的文本展开、正则片段、选择区包裹、分数与括号辅助、矩阵导航和 Tab 跳转，同时把自定义片段限制在可审阅的 JSONC 数据文件中。

本项目是全新的 VS Code 实现，设计灵感来自 [snippet-leaf](https://github.com/superle3/snippet-leaf)，并非其官方移植版或关联项目。上游 MIT 许可与署名见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 功能概览

- 上下文感知片段：可限定在文本、行内数学或块级数学区域触发。
- 自动或按 `Tab` 展开：常用短指令可以即时展开，较宽泛的触发词可要求确认。
- 正则片段：用 `@[0]`、`@[1]` 等占位符安全引用捕获组。
- Tabstop：用 `@0`、`@1` 等标记展开后的光标跳转位置。
- Visual 片段：通过命令把当前选择包进 `\underbrace`、`\cancel` 等结构。
- 编辑辅助：自动分数、外层括号放大、矩阵快捷键、Tabout 与补全。
- 单一全局片段库：199 条默认规则和全部个人修改都保存在同一份可编辑 JSONC 文件中，不再区分“内置片段”和“用户片段”。
- 安全恢复与同步：可一键恢复当前版本默认库，覆盖前自动备份；启用 VS Code Settings Sync 后，可通过扩展的同步镜像在设备间同步有效片段库。
- 安全加载：片段文件只解析 JSONC 数据，不使用 `eval`，也不执行 JavaScript `replacement` 函数。
- 严格文件作用域：所有片段与编辑辅助只在已经保存为 `.tex` 或 `.bib` 的文件中生效；Markdown、其他后缀和 Untitled 编辑器不会触发。

## 安装 VSIX

拿到 `texleaf-0.3.0.vsix` 后，可以任选一种方式安装。

在 VS Code 中：

1. 打开“扩展”视图。
2. 点击右上角 `…`。
3. 选择“从 VSIX 安装…”（`Extensions: Install from VSIX...`）。
4. 选中 VSIX，并按提示重新加载窗口。

也可以使用命令行：

```powershell
code --install-extension .\texleaf-0.3.0.vsix
```

覆盖安装同版本构建时可追加 `--force`。安装后请打开现有 `.tex`/`.bib` 文件，或先把新文件保存成这两种后缀之一；无后缀的 Untitled 编辑器不会运行 TeXLeaf。如果当前工作区已打开，请执行 `Developer: Reload Window`，确保扩展完成激活。

## 快速体验

在已经保存的 `.tex` 文档中试试这些默认触发。是否自动展开取决于片段的 `A` 选项和当前数学上下文；没有 `A` 时，在触发词后按 `Tab`。`.bib` 文件也允许使用自定义与文本模式片段，但不会凭空获得 LaTeX 数学上下文。

| 输入 | 典型展开 | 说明 |
| --- | --- | --- |
| `mk` | `\( … \)` | 行内数学 |
| `dm` | `\[ … \]` | 块级数学 |
| `;a` | `\alpha` | 希腊字母 |
| `sr` | `^{2}` | 平方 |
| `sq` | `\sqrt{…}` | 根式并进入参数 |
| `//` | `\frac{…}{…}` | 分子、分母依次跳转 |
| `1/2` | `\frac{1}{2}` | 数学区域中输入首个分母字符 `2` 时自动成分数；`//` 显式片段仍保留 |
| `x2` | `x_{2}` | 正则捕获示例 |
| `Qhat` | `\hat{Q}` | 数学模式下的单字母后缀重音；`bar`、`dot`、`ddot`、`tilde`、`und`、`vec` 同类规则也可用 |

默认库共 199 条规则，还覆盖常见上下标、关系符、微积分、矩阵/环境和选择区包裹。参见 [默认片段速查](docs/default-snippets.md)；完整内容可以直接在全局 JSONC 文件中查看和修改，也可以通过 `TeXLeaf: 搜索并插入片段` 检索。

## 单一全局片段库

运行 `TeXLeaf: 编辑全局 Snippet`，可以在带有保存、从磁盘重新加载和安全说明的大文本面板中编辑全局主文件。运行 `TeXLeaf: 打开全局 Snippet 配置文件` 则会在 VS Code 原生 JSONC 编辑器中打开同一个文件。该文件由 VS Code 放在 TeXLeaf 的 `globalStorageUri` 中，同一个 VS Code Profile 下切换项目或工作区时无需复制配置。

```text
<VS Code 用户数据>/globalStorage/local-lab.texleaf/texleaf-snippets.jsonc
```

Windows Stable 的典型完整路径是：

```text
C:\Users\<用户名>\AppData\Roaming\Code\User\globalStorage\local-lab.texleaf\texleaf-snippets.jsonc
```

实际位置可能随 VS Code Profile、Insiders、Remote 或便携模式变化，因此最可靠的入口始终是扩展命令，不要把典型路径写死到脚本中。

首次创建时，TeXLeaf 会把当前版本的全部 199 条默认规则以及 `GREEK`、`SYMBOL`、`MORE_SYMBOLS` 三个正则变量写入这份文件。运行时不再另外加载 `builtin` 或 `settings` 来源：全局文件本身就是完整片段库，所以可以直接修改、禁用或删除任何默认规则。文件中的 `defaultsRevision` 只标记一次性迁移是否完成；迁移后，用户主动删除的默认规则不会在下次启动时被偷偷补回。

推荐使用首次创建文件中已有的对象格式；简写的顶层数组也兼容导入和项目附加文件。JSONC 允许注释与尾随逗号，但每个片段必须是纯数据对象，`trigger` 和 `replacement` 必须是字符串。下面是结构示例；编辑真实全局文件时，应保留其中已有的三个默认变量和其他默认规则，只添加或修改需要的条目。

```jsonc
{
  "version": 1,
  "defaultsRevision": 1,
  "variables": {
    // 保留文件中已有的 GREEK、SYMBOL、MORE_SYMBOLS
    "SET": "R|Q|Z|N",
  },
  "snippets": [
    // 保留文件中仍需要的默认规则，并添加自己的规则
    // 数学模式下输入 ;R 后立即展开
    {
      "trigger": ";R",
      "replacement": "\\mathbb{R}",
      "options": "mA",
      "description": "实数集",
    },

    // 第一个捕获组写作 @[0]，第二个写作 @[1]
    {
      "trigger": "([A-Za-z])(\\d)",
      "replacement": "@[0]_{@[1]}",
      "options": "rmA",
      "priority": 10,
      "syntaxVersion": 2,
    },

    // @0、@1 是展开后的光标停靠点
    {
      "trigger": "set",
      "replacement": "\\{ @0 \\mid @1 \\}",
      "options": "m",
    },
  ],
}
```

在大面板中保存会立即重新加载片段；直接编辑文件时也可执行 `TeXLeaf: 重载片段`。`texleaf.snippetFiles` 默认为空，仅用于明确添加项目专属的额外文件。当相同规则来自多个位置时，显式工作区附加文件优先于全局文件；显式 `priority` 仍先参与规则选择。详细字段、转义规则和错误处理见 [片段格式](docs/snippets.md)。

### 从 0.2.x 升级

如果 0.2.x 已经创建了全局文件，0.3.0 会在首次激活时执行一次安全迁移：保留现有规则和变量，将旧版用户级 `texleaf.customSnippets` 值中有效的纯数据片段加入其后，再补齐缺失的默认规则与三个默认变量。对于对象式且 `snippets` 为数组的 JSONC，迁移会尽量保留注释、未知顶层字段、原顺序和未改动条目的格式；顶层数组或旧字符串格式需要规范化，因此会重新序列化。现有内容始终优先；发生实际写入前会把原文件逐字节备份到 `globalStorageUri/backups`，即使规范化重写也能从备份恢复原始字节。迁移完成后不会再次自动补齐缺失默认项。

`texleaf.customSnippets` 设置项已经移除，也不再是运行时片段来源。0.3.0 只为升级兼容而读取一次旧设置中的**用户全局值**；工作区级旧值不会被提升为全局配置。若旧设置内容无效，TeXLeaf 会报告并跳过它，不会执行其中的代码。

旧版本留在项目 `.vscode/texleaf-snippets.jsonc` 中的内容仍不会被自动读取、复制或删除。若要迁移，运行 `TeXLeaf: 导入片段` 并明确选择旧文件一次即可。未信任工作区只会忽略项目级 `texleaf.snippetFiles`，防止项目静默注入自动片段；用户全局文件不受影响。

### 恢复默认与备份

运行 `TeXLeaf: 恢复默认片段`，或点击片段侧栏/全局编辑面板中的同名按钮，可以用当前扩展版本附带的完整默认库替换全局文件。恢复前会显示确认框；只有确认后才会继续，并且会先在 `globalStorageUri/backups` 中创建和校验原文件的逐字节备份。若文件在确认期间被另一个窗口修改、当前文本编辑器或大面板仍有未保存内容、备份失败或重新加载验证失败，TeXLeaf 会取消操作而不是静默覆盖。

备份是普通 JSONC 文件，并且只保存在执行操作的当前 VS Code 环境中。恢复成功通知会提供“打开备份”，需要撤回时可以审阅该文件并通过 `TeXLeaf: 导入片段` 合并回来。

### VS Code Settings Sync

`globalStorageUri` 文件本身不会被 VS Code 原生上传。TeXLeaf 会把**有效且已保存**的完整 JSONC 封装到私有 `globalState` envelope，并注册为可同步键；它不会把大段片段写进公开 `settings.json`，也不会增加第二个运行时片段源。用户必须在 VS Code 中主动启用 Settings Sync，并启用 Extensions 同步，镜像才可能在设备间传输。

同步 envelope 的 JSON 序列化结果上限为 256 KiB。超过上限、文件仍有未保存内容或 JSONC 无效时，本地文件和最后有效片段仍可继续使用，但本次内容不会上传。VS Code 没有向扩展提供 globalState 同步变更事件，因此 TeXLeaf 会在窗口重新聚焦、片段库重新加载、编辑器保存/关闭及约 15 秒轮询时检查；全新设备首次等待云端状态时还会保留约 30 秒水合宽限，不应把它理解为实时共同编辑。

只有相对共同基线的单边变化才会自动应用；本地与云端两边都已变化时会提示冲突，不静默选择“最后写入者”。同步 envelope 还携带 lineage，因此两台机器从同一父版本各自修改形成的兄弟分支也会判定为冲突。应用云端内容前还会检查 dirty 状态、验证结构、复核本地哈希并创建本地原字节备份。备份本身不会上传到 Settings Sync。

Settings Sync 同步的是扩展状态，不是这个本地 VSIX 安装包。使用手工安装的 `texleaf-0.3.0.vsix` 时，另一台机器仍需安装标识为 `local-lab.texleaf` 的相同或兼容版本，镜像才有消费者。不同 VS Code Profile、Stable/Insiders，以及本地、SSH、WSL、Dev Container 等扩展宿主仍可能拥有彼此独立的安装与存储；同步是在这些副本之间汇合内容，不是共用同一个磁盘路径。

> 安全边界：TeXLeaf 不把片段文件当作 JavaScript。正则必须写成字符串并配合 `r`，`replacement` 只能是字符串；函数、RegExp literal、导入语句和其他可执行表达式都不会运行。

## 选项速查

多个选项可以组合，例如 `mA`、`rmA`。

| 选项 | 含义 |
| --- | --- |
| `t` | 仅文本模式 |
| `m` | 任意数学模式，相当于同时允许 `M` 和 `n` |
| `M` | 仅块级数学模式 |
| `n` | 仅行内数学模式 |
| `A` | 输入后自动展开；省略时使用配置的手动触发键，默认是 `Tab` |
| `r` | 将字符串 `trigger` 作为正则表达式 |
| `v` | Visual 片段，仅处理当前选择 |
| `w` | 要求触发词位于词边界 |

`@0` 是第一个 tabstop，随后为 `@1`、`@2`。在正则替换中，`@[0]` 是第一个括号捕获组，`@[1]` 是第二个；它们不是 tabstop。详见 [片段格式](docs/snippets.md)。

## 命令

打开命令面板（`Ctrl+Shift+P`）并输入 `TeXLeaf`：

- `TeXLeaf: 打开全局 Snippet 配置文件`
- `TeXLeaf: 编辑全局 Snippet`
- `TeXLeaf: 恢复默认片段`
- `TeXLeaf: 重载片段`
- `TeXLeaf: 搜索并插入片段`
- `TeXLeaf: 切换启用状态`
- `TeXLeaf: 导入片段`
- `TeXLeaf: 导出片段`
- `TeXLeaf: 用片段包裹所选内容`

命令 ID 分别为 `texleaf.openSnippetFile`、`texleaf.openSnippetEditor`、`texleaf.restoreDefaultSnippets`、`texleaf.reloadSnippets`、`texleaf.pickSnippet`、`texleaf.toggle`、`texleaf.importSnippets`、`texleaf.exportSnippets` 和 `texleaf.wrapSelection`。

## 设置

在设置页搜索 `texleaf` 可以控制自动/手动触发、自动分数、括号放大与着色、成对字符处理、Visual 片段、矩阵快捷键、Tabout、补全、项目附加片段文件、排除环境和适用语言。片段库正文不再放在设置项里，请使用全局 JSONC 文件。`texleaf.languageIds` 只能在 `.tex`/`.bib` 范围内进一步收窄语言，不能把功能扩展到其他后缀。设置项说明见 [配置参考](docs/configuration.md)。

## 本地开发与 F5 调试

要求本机可以运行 Node.js、pnpm 与 VS Code。克隆或打开仓库后：

```powershell
pnpm install
pnpm run check
pnpm test
pnpm run compile
```

然后在这个仓库中按 `F5`，选择扩展调试配置。VS Code 会打开一个“扩展开发宿主”窗口；在该窗口创建并先保存一个 `.tex` 文件，再输入 `dm`、`;a` 或 `//` 验证行为。代码变更后重新启动调试宿主，或按调试工具栏中的重启按钮。

构建可安装包：

```powershell
pnpm run package
```

更多说明见 [开发指南](docs/development.md)。

## 已知边界

- `replacement` 只接受字符串。为了避免用户配置文件执行任意代码，TeXLeaf 不支持也不会执行函数 replacement。
- 数学模式判断基于编辑器文本与配置，是轻量语法感知，不是完整 TeX 编译器；复杂宏、异常分隔符和 verbatim 类环境可能需要加入 `texleaf.excludedEnvironments`。
- Conceal 不做像素级文本替换，也不把源代码伪装成编译后的公式。任何装饰都基于 VS Code 原生能力，源文本、光标位置与选择范围保持真实可编辑。
- 正则只扫描光标附近的有限文本，受 `texleaf.maxRegexScanLength` 约束；这是为了避免大文档中的卡顿和失控回溯。
- 为避免片段污染 Markdown、代码块和临时草稿，编辑功能固定只接受已保存的 `.tex` 与 `.bib` 后缀（大小写不敏感）；Untitled 和伪后缀如 `.tex.md` 会被拒绝。
- TeXLeaf 专注输入效率，不负责 LaTeX 编译、PDF 预览、引用管理或语言服务器功能，可与 LaTeX Workshop 等扩展配合使用。
- Settings Sync 只有在用户主动启用后才工作；同步镜像不会安装手工分发的 VSIX，也不保证本地与 Remote 扩展宿主共享同一存储。自动备份只保存在发生替换的当前环境。

## 许可与致谢

TeXLeaf 采用 MIT License；许可证正文随源码和 VSIX 一同分发。

交互理念与片段语法受到 [superle3/snippet-leaf](https://github.com/superle3/snippet-leaf) 启发；其许可证声明为 MIT，版权信息为 `Copyright (c) 2022 artisticat1`。完整第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
