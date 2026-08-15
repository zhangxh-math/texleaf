# TeXLeaf 开发指南

## 环境

准备可用的 Node.js、pnpm 与 VS Code。仓库路径可以包含空格或中文，但在自定义脚本中应始终引用路径。

安装依赖并完成基础验证：

```powershell
pnpm install
pnpm run check
pnpm test
pnpm run compile
pnpm run test:extension-host
```

- `pnpm run check` 执行 TypeScript 静态检查。
- `pnpm test` 运行不启动 VS Code 的核心单元测试。
- `pnpm run compile` 生成扩展运行产物。
- `pnpm run test:extension-host` 用隔离的临时 VS Code Profile 运行真实扩展宿主测试。
- `pnpm run release:verify` 依次执行静态检查、单元测试、生产 bundle 检查和隔离扩展宿主回归；`pnpm run package` 会先执行这道完整门禁。
- `pnpm run package` 生成可安装的 VSIX。

## F5 调试

1. 用 VS Code 打开仓库根目录。
2. 按 `F5`，选择扩展调试配置。
3. 等待“扩展开发宿主”窗口打开。
4. 在宿主窗口新建文件并先保存为 `.tex`。
5. 输入 `dm`、`;a`、`//` 等默认触发，或运行 `TeXLeaf: 搜索并插入片段`。
6. 修改源码并重新编译后，点击调试工具栏的“重新启动”验证变更。

针对 0.3.0 的手工冒烟检查至少包括：

- 切换到 Windows 中文输入法，在已保存的 `.tex` 文件中分别按下全角左括号和顿号对应按键，确认每次只得到一个 `（` 和一个 `、`。
- 用全新隔离 Profile 激活扩展，从 Command Palette 运行 `TeXLeaf: 打开全局 Snippet 配置文件`，确认 URI 位于扩展 `globalStorageUri`，并且首次文件包含 `defaultsRevision`、199 条规则以及 `GREEK`、`SYMBOL`、`MORE_SYMBOLS` 三个变量；切换到另一个工作区后仍读取同一份内容。
- 在真实 `.tex` 与 `.bib` 文件中验证片段可用；把语言模式设为 LaTeX 的 `.md` 和 Untitled 编辑器仍不得展开。
- 在有缩进的行输入 `dm`，并从补全列表插入一次 `dm`，确认多行内容和 `\]` 继承当前缩进。
- 在数学区域依次输入 `1`、`/`、`2`：第一枚 `/` 后应保持 `1/`，输入 `2` 后才转换为 `\frac{1}{2}`；另行输入 `//`，确认显式分数片段仍能展开。
- 在数学区域通过普通 `type` 路径与文档变更后备路径分别输入 `Qhat`，确认都得到 `\hat{Q}`；同时抽查 `Qbar`、`Qdot`、`Qddot`、`Qtilde`、`Qund`、`Qvec` 及 `\alpha hat`，确认同类优先级没有回归。
- 展开 `align`、`matrix` 或 `pmat`，验证 `Tab` 先处理活动 tabstop、随后执行列操作，`Enter` 创建新行，`Shift+Enter` 退出环境。
- 运行 `TeXLeaf: 编辑全局 Snippet`，验证大面板的载入、保存、从磁盘重新加载与未保存内容保护；确认设置页中已经没有 `texleaf.customSnippets`。
- 准备一份没有 `defaultsRevision` 的 0.2.x 全局文件和旧用户全局 `texleaf.customSnippets` 值，确认首次升级只迁移一次：现有条目/变量优先，旧设置的有效条目随后加入，缺失工厂项最后补齐，原文件先备份；重新启动后不会再次注入，用户删除一个默认项后也不会复活。
- 从 Command Palette、片段侧栏和大面板分别触发 `TeXLeaf: 恢复默认片段`，确认都经过同一 modal 确认。未保存文本或 Webview 内容必须阻止恢复；成功后备份与目标哈希均正确，大面板重新读盘并恢复 199 条规则。
- 在启用 Settings Sync 且包含 Extensions 的两个隔离配置环境中验证有效全局文件通过同步 `globalState` envelope 传播：仅 local 变化时上传，仅 remote 变化时经 CAS 与本地备份后应用；两边都相对 base 变化或首次两边均为不同非默认库时必须提示选择。dirty、无效 JSONC、缺少有效 `snippets` 结构或序列化 envelope 超过 256 KiB 时暂停 reconciliation 并保留上次有效镜像。还要覆盖窗口重新聚焦、约 15 秒轮询、首次约 30 秒水合宽限，以及新设备精确工厂默认文件安全恢复远端库。关闭 Settings Sync 时不得宣称已跨机同步。

片段加载问题可以用以下最小文件复现：

```jsonc
// globalStorageUri/texleaf-snippets.jsonc
{
  "version": 1,
  "defaultsRevision": 1,
  "variables": {},
  "snippets": [
    {
      "trigger": ";R",
      "replacement": "\\mathbb{R}",
      "options": "mA",
    },
  ],
}
```

保存后运行 `TeXLeaf: 重载片段`，并检查 VS Code 的“问题”与“输出”面板。

## 构建与安装 VSIX

```powershell
pnpm run package
```

构建完成后，可从命令面板选择 `Extensions: Install from VSIX...`，或在终端执行：

```powershell
code --install-extension .\texleaf-0.3.0.vsix --force
```

安装后在普通 VS Code 窗口验证，而不是只在扩展开发宿主中验证。发布前至少执行：

```powershell
pnpm run release:verify
```

还应检查 VSIX 内容，确认运行产物、README、CHANGELOG、LICENSE、`media/icon.png` 与 Webview 所需内容已包含，源码、测试、coverage 和本地配置未被打包。安装后的扩展详情页应显示 PNG 图标，命令面板应能找到 `TeXLeaf: 打开全局 Snippet 配置文件`、`TeXLeaf: 编辑全局 Snippet` 与 `TeXLeaf: 恢复默认片段`。手工 VSIX 不会因为 Settings Sync 而自动安装到另一台机器；跨机测试必须在两端安装兼容版本并保持扩展标识 `local-lab.texleaf`。

## 安全约束

片段加载器必须持续满足以下约束：

- 只解析 JSONC 数据。
- 不执行 function replacement。
- 不接受 RegExp literal；正则来自字符串，并经过选项与长度验证。
- 对单个条目做隔离诊断，不因一个坏片段使扩展整体失效。
- 对正则扫描长度设上限，避免在每次输入时扫描整份文档。
- 所有编辑都通过 VS Code WorkspaceEdit、TextEditor.edit 或 SnippetString 等原生 API 完成。
- 迁移、恢复默认和同步应用都必须在覆盖前校验基线哈希，并先创建、回读校验当前环境中的逐字节备份。
- 不把项目级旧设置提升为用户全局库；未信任工作区继续禁用 `texleaf.snippetFiles` 项目附加源。
- `globalState` 同步值必须先通过完整 JSONC/片段结构校验；dirty 或并发冲突不得采用“最后写入者静默覆盖”。

任何放宽这些约束的变更都应被视为安全敏感变更，并补充对应的错误路径与恶意输入测试。
