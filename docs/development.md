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

针对 0.7.2 的手工冒烟检查至少包括：

- 切换到 Windows 中文输入法，在已保存的 `.tex` 文件中分别按下全角左括号和顿号对应按键，确认每次只得到一个 `（` 和一个 `、`。
- 用全新隔离 Profile 激活扩展，运行 `TeXLeaf: 管理 Snippet 与模板`，确认无需显示任何存储路径即可载入 212 条 Snippet 和四个模板。结构化编辑一个 trigger 后保存，运行时应立即使用新 trigger；另一个干净工作区应看到同一 Profile 内容。
- 干净 Profile 不应物化 `globalStorageUri/templates/*.tex` 作为运行依赖。分别在空白文档完整输入 `tmpa-cn`、`tmpa-en`、`beamer-cn`、`beamer-en`，确认最后一字符输入后自动展开；在管理器模板页修改 trigger/正文、新增、复制、删除后，保存结果应立即生效。另用旧版四个 `.tex` 副本建立升级夹具，确认首次迁入内部 catalog 后再改动旧文件不会影响运行时。
- 在真实 `.tex` 与 `.bib` 文件中验证片段可用；把语言模式设为 LaTeX 的 `.md` 和 Untitled 编辑器仍不得展开。
- 在有缩进的行输入 `dm`，并从补全列表插入一次 `dm`，确认多行内容和 `\]` 继承当前缩进。
- 分别输入 `\axm`、`\dfn`、`\lem`、`\prp`、`\thm`、`\cor`、`\clm`、`\asm`、`\exm`、`\exr`、`\cnj`、`\hyp`、`\rmk`，确认全部在文本模式自动展开为对应环境；在原生 Suggest 中确认精确 TeXLeaf trigger 优先显示并预选，非精确前缀仍保持 VS Code 原生排序。再模拟模板、定理片段或 `dm` 自动展开未触发但 Suggest 已出现的情形，按 `Tab` 应展开精确 TeXLeaf 片段，而不是接受普通单词。
- 在数学区域依次输入 `1`、`/`、`2`：第一枚 `/` 后应保持 `1/`，输入 `2` 后才转换为 `\frac{1}{2}`；另行输入 `//`，确认显式分数片段仍能展开。
- 在数学区域通过普通 `type` 路径与文档变更后备路径分别输入 `Qhat`，确认都得到 `\hat{Q}`；同时抽查 `Qbar`、`Qdot`、`Qddot`、`Qtilde`、`Qund`、`Qvec` 及 `\alpha hat`，确认同类优先级没有回归。
- 展开 `align`、`matrix` 或 `pmat`，验证 `Tab` 先处理活动 tabstop、随后执行列操作，`Enter` 创建新行，`Shift+Enter` 退出环境。
- 在管理器中验证搜索、分类/启用筛选、Snippet 与模板增删改、trigger 编辑、批量查找替换的字段范围/大小写/regex/预览/撤销，以及 `Ctrl+S` 保存。让另一个窗口或高级 JSONC 在管理器载入后修改库，保存必须因 revision/CAS 冲突失败；超长字段和总量必须在客户端先报错，不能进入永久 busy。确认高级 JSONC 只是显式入口，设置页中没有 `texleaf.customSnippets`。
- 准备一份没有 `defaultsRevision` 的 0.2.x 全局文件和旧用户全局 `texleaf.customSnippets` 值，确认首次升级只迁移一次：现有条目/变量优先，旧设置的有效条目随后加入，缺失工厂项最后补齐，原文件先备份。另准备 revision 2 文件，确认 revision 3 只把未修改的 13 个定理条目迁移为带反斜杠的自动 trigger；已修改、已禁用或已删除的用户选择不得被覆盖，文件标记 revision 3 后删除默认项也不得复活。
- 从 Command Palette、片段侧栏和管理器分别触发 `TeXLeaf: 恢复默认片段`，确认都经过同一 modal 确认。未保存的高级 JSONC 或 Webview 草稿必须阻止恢复；成功后备份与目标哈希均正确，管理器重新载入并恢复 212 条规则。
- 在启用 Settings Sync 且包含 Extensions 的两个隔离配置环境中验证有效全局文件通过同步 `globalState` envelope 传播：仅 local 变化时上传，仅 remote 变化时经 CAS 与本地备份后应用；两边都相对 base 变化或首次两边均为不同非默认库时必须提示选择。dirty、无效 JSONC、缺少有效 `snippets` 结构或序列化 envelope 超过 256 KiB 时暂停 reconciliation 并保留上次有效镜像。还要覆盖窗口重新聚焦、约 15 秒轮询、首次约 30 秒水合宽限，以及新设备精确工厂默认文件安全恢复远端库。关闭 Settings Sync 时不得宣称已跨机同步。
- 启动 Zotero，准备含至少两条现有文献的 `reference.bib` 和至少两条尚未导入的 Zotero 文献。在 `\cite{}` 内确认自动出现 VS Code 原生 Suggest：已有 bibliography 候选排序在前，Zotero 候选随后显示且带来源标签；左侧只显示标题和紧凑来源，右侧分别显示标题、作者、期刊/出版物、年份、来源/导入状态与 citation key；标题、作者、年份和 citation key 查询均可过滤。再执行“输入 `a` → 退格清空 → 输入作者查询 → 接受候选”，确认无需把光标移出大括号也能自动重开并插入正确 key。
- 在 `\cite{keepA, query, keepB}` 的 `query` 中接受一条已有文献，输入逗号后依次接受两个 Zotero 条目，确认每次只替换当前逗号分段、`keepA/keepB` 保留，并且只有两个新条目按原换行风格追加到 bibliography。
- 分别把 `texleaf.bibliographyFormat` 设为 `bibtex` 与 `biblatex`，并把 `texleaf.bibliographyFile` 从默认 `reference.bib` 改为 `bib/sources.bib`，确认导入格式和目标文件都按设置生效；再验证仅显式设置旧 `texleaf.zoteroExportFormat` 时仍兼容，而新旧名称都显式设置时使用新名称。
- 保持 `reference.bib` 有未保存修改后再导入，确认插件读取并编辑当前文档模型但不自动保存用户的其他修改；在干净 bibliography 上导入则应保存成功。撤销一次应同时撤销 TeX 与 Bib 文本编辑。
- 分别验证 Zotero 未运行、错误端口、错误库名和超时：自动加载把原因写入 `TeXLeaf` 输出通道，手动刷新立即重试并显示错误，已有 bibliography 候选仍可选，两个文件都不发生部分写入；Better BibTeX 未安装/禁用时验证 Zotero Local API 回退。
- 在未信任 workspace 中进入 `\cite{}`，确认不自动弹框、不访问端口、不创建 `reference.bib`；手动命令给出明确提示。多根 workspace 中确认 bibliography 不会跨根选错。
- 在设置页搜索 `@ext:zhangxh-math.texleaf`，确认 Zotero 总开关、bibliography 路径与 BibTeX/BibLaTeX 格式位于“Zotero 与参考文献”分类；Math Preview 总开关、`auto`/`above`/`below` 位置和性能参数位于独立分类。
- 在 `$x^2$`、`$$\sum_n a_n$$`、`\(\frac{1}{2}\)`、`align` 和嵌套 `cases` 中移动光标，确认只出现一个当前公式预览；注释、`\verb`、`verbatim`、`lstlisting`、`minted` 中不出现。分别验证 `cursor`、`hover`、`both` 与总开关。`cursor` 卡片的底色必须 100% 不透明，并显示在源文字上层。
- 在上下都紧邻非空文字的长行内公式中连续输入，确认 `auto` 始终把浮动卡片放在活动源码行下方，不参与行宽或换行计算。光标位于起始行时，左边缘必须与 `$`/`\(` 对齐；把同一公式写成多行并把光标移到后续行时，左边缘必须改为对齐该行首个非空白字符，而不是光标横坐标或第 0 列。
- 给 `$$…$$`、`\[…\]` 和 `\begin{align}…\end{align}` 加入不同非零缩进及 Tab：卡片应稳定保持 opening delimiter 列；超宽卡片允许右端被编辑器裁切，但不得因 Monaco 的短 token span 错跳到第 0 列。对行间公式验证 `placement=auto` 下方优先、下方不足转上方、上下都不足仍在上方并保住源码/预览末尾；显式 `above`/`below` 仍严格服从设置。
- 在前言定义零参数、多参数、可选参数宏和 `DeclareMathOperator`，确认预览更新；递归宏、超长公式、非法 TeX 和快速连续编辑不能卡住扩展宿主，旧渲染结果不能覆盖新公式。切换深/浅主题、编辑器缩放和大文档时检查颜色、尺寸与防抖。
- 断网后重新启动只加载本项目的隔离扩展开发宿主并首次使用 Math Preview，确认不请求 CDN；检查输出 SVG 不包含脚本、事件属性、外部 URL 或 `foreignObject`。

固定的 Math Preview 视觉夹具可以分别复现行内文字重叠、源码缩进、行间 opening 对齐，以及超高公式末尾的垂直定位。`inline` 场景用于确认起始行定界符对齐与下方浮动；`display` 场景同时包含带缩进的 `\[`、`$$` 与 `\begin{align}`，用于检查静态 opening 列与跨行缩进补偿；`nested-display` 复现缩进 `enumerate` 中 `\[` 卡片被错误放到编辑区第 0 列的问题；`tall-display` 会把光标直接放到 28 行 `align` 的末行附近，便于确认 `auto` 保住源码末尾和预览底部。脚本只接受枚举后的主题、场景与位置值，并在启动时用 JSON 输出实际选项和安全 TeX atom 后的光标坐标：

```powershell
node .\test\run-math-preview-visual-host.cjs --scenario inline --placement auto --theme dark
node .\test\run-math-preview-visual-host.cjs --scenario display --placement auto --theme light
node .\test\run-math-preview-visual-host.cjs --scenario nested-display --placement auto --theme light
node .\test\run-math-preview-visual-host.cjs --scenario tall-display --placement auto --theme dark
node .\test\run-math-preview-visual-host.cjs --help
```

需要验证真实 Monaco 伪元素像素而不是只做肉眼检查时，给隔离宿主指定仅绑定回环地址的临时 CDP 端口，再从另一个终端运行只读检查器：

```powershell
node .\test\run-math-preview-visual-host.cjs --scenario nested-display --placement auto --theme light --debug-port 9339
node .\test\math-preview-cdp-check.cjs --port 9339 --scenario nested-display

node .\test\run-math-preview-visual-host.cjs --scenario tall-display --placement auto --theme light --debug-port 9340
node .\test\math-preview-cdp-check.cjs --port 9340 --scenario tall-display
```

检查器会读取 `before` 伪元素的实际边界：`nested-display` 场景要求卡片左边缘与 opening delimiter 的误差不超过 3 px，并确认 decoration 没有加入 `left`/`right`/`inset` 形式的伪视口拟合；超宽卡片允许右端被编辑器裁切。超高场景要求 SVG 根高度和 decoration 高度都大于 8em、二者一致且自动选择上方。CDP 只在这个隔离进程中显式开启，测试结束后关闭窗口或按 `Ctrl+C` 即会清理临时 Profile。

关闭隔离窗口后脚本只清理本次创建且经过路径校验的临时目录。发版前还应针对 `above`、`below` 和两种主题补齐矩阵；若固定 Monaco CSS 兼容层在某个 VS Code 构建中失效，改用 `presentation=hover` 验证公开 API 回退路径。该测试环境只加载当前 TeXLeaf 开发扩展，以便把行为和性能回归限定在本项目候选包内。

片段加载问题可以用以下最小文件复现：

```jsonc
// globalStorageUri/texleaf-snippets.jsonc
{
  "version": 1,
  "defaultsRevision": 3,
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
code --install-extension .\texleaf-0.7.2.vsix --force
```

安装后在普通 VS Code 窗口验证，而不是只在扩展开发宿主中验证。发布前至少执行：

```powershell
pnpm run release:verify
```

还应检查 VSIX 内容，确认 `dist/extension.js`、`dist/mathPreviewWorker.js`、README、CHANGELOG、LICENSE、`SUPPORT.md`、`THIRD_PARTY_NOTICES.md`、`media/icon.png` 与其他运行资源已包含，源码、测试、coverage 和本地配置未被打包。归档内的 README 图片与相对文档链接必须已由 `vsce --githubBranch main` 改写为公开 HTTPS 地址；安装后的扩展详情页应显示 PNG 图标，命令面板应能找到片段、Zotero 与 Math Preview 命令。手工 VSIX 不会因为 Settings Sync 而自动安装到另一台机器；跨机测试必须在两端安装兼容版本并保持扩展标识 `zhangxh-math.texleaf`。

Visual Studio Marketplace 使用现有 Publisher `zhangxh-math`；Marketplace 项目标识为 `zhangxh-math.texleaf`。可以在 Publisher 管理页手工上传 `texleaf-0.7.2.vsix`；后续自动发布优先使用短期联合身份凭据，不要把 PAT 写入仓库。Publisher 变更会建立新的扩展身份：升级冒烟必须先在旧版保存修改并记录自定义模板，安装新版后禁用旧版但暂不卸载，再 Reload Window；只有新主文件不存在、旧 JSONC 严格校验通过且复制期间未变化时，新版才尽力逐字节复制旧片段库，并保留旧文件。验证 Snippet、按需重建自定义模板后再卸载旧版。模板 catalog、既有 `globalState` 与 Settings Sync 基线不会跨 ID 自动迁移。

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
