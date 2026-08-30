# Contributing to TeXLeaf

感谢你愿意改进 TeXLeaf。项目由个人在有限时间内维护，维护者没有编程背景，代码实现、审查建议和测试主要借助 AI 工具完成。打开 Issue 或 Pull Request 不会形成处理时限、合并、定制开发或私人支持承诺；通常优先处理带最小复现的 Bug。

## 先提交可复现问题

提交 Bug 时请尽量包含：

- VS Code、TeXLeaf、操作系统和远程环境版本；
- 最小 `.tex` / `.bib` 片段；
- 精确逐键、逐点击或逐命令步骤；
- 预期结果和实际结果；
- 与问题直接相关的脱敏日志；
- 是否使用中文输入法、LaTeX Workshop、Zotero/Better BibTeX 或其他补全/预览扩展。

不要提交 API Key、SecretStorage、论文机密正文、支付信息、完整个人目录或其他隐私数据。详见 [SUPPORT.md](SUPPORT.md)。

## Pull Request 范围

- 一个 PR 尽量只处理一个可以独立验证的问题；
- 先说明行为、边界和失败策略，再提交大规模重构；
- 保留用户已有的未提交修改，不做无关格式化或依赖升级；
- 新功能同时更新测试、README/Wiki、配置 Schema 和 CHANGELOG；
- 涉及 IME、文档范围、WorkspaceEdit、Webview、AI 或文件系统时必须保持 fail-closed；
- 不提交生成的 `dist/`、`.test-dist/`、`.tmp/`、VSIX、日志、API Key 或本机测试 Profile。

维护者可能无法独立人工审查复杂代码，因此 PR 可能长期等待、被要求缩小范围，或在无法证明安全与可维护性时不合并。

## 许可证与来源确认

TeXLeaf `1.0.0` 起的项目主体采用 `GPL-3.0-only`，并适用根目录 [NOTICE](NOTICE) 中 GPLv3 第 7(b) 节允许的合理署名条款与用户文档输出例外。

提交贡献即表示你确认：

1. 你有权提交这些代码、测试、文档或素材；
2. 被项目接受的贡献可以按 `GPL-3.0-only` 与 `NOTICE` 条款提供；
3. 你已经保留所有必须保留的第三方版权和许可证声明；
4. 贡献不包含来源不明、与项目许可证不兼容或禁止再分发的内容；
5. 如果使用 AI 工具生成或修改内容，你仍会检查功能、来源、许可证、安全和测试结果，不能把“AI 生成”当作权属或正确性保证。

第三方依赖与已有上游材料见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。完整许可证说明见 [Wiki](https://github.com/zhangxh-math/texleaf/wiki/License-and-Attribution)。

## 本地验证

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

涉及 VS Code 宿主、编辑器桥、存储、Hover、Problems、Math Preview 或引用工作流时，还应运行：

```bash
pnpm run release:verify
```

发布门禁包括主扩展和 Webview TypeScript 检查、511 项单元测试、三个生产 bundle、bundle/MathJax Worker 冒烟与隔离 Extension Host 回归。平台或 GUI 相关改动还需按 [开发与发布 Wiki](https://github.com/zhangxh-math/texleaf/wiki/Development-and-Release) 执行对应 CDP/人工场景。

## 文档

- README 只保留简明功能介绍和快速开始；
- Wiki 是详细使用手册，必须写出入口、操作步骤、预期结果、限制和排障；
- 新设置需要同步 package Schema、[[Configuration]] 和命令说明；
- 行为修复需要在 CHANGELOG 的当前版本记录用户可见结果。
