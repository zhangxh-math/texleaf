# TeXLeaf 支持

如果 TeXLeaf 的片段、AI 写作、Zotero 引用或 Math Preview 行为不符合预期，请先查看 [故障排查](https://github.com/zhangxh-math/texleaf/wiki/Troubleshooting)。

仍然无法解决时，请在 [GitHub Issues](https://github.com/zhangxh-math/texleaf/issues) 新建问题，并尽量附上：

- VS Code、TeXLeaf 与操作系统版本；
- 当前文件的扩展名和 VS Code 语言模式；
- 可以复现问题的最小 TeX/BibTeX 片段；
- `输出 → TeXLeaf` 与 `开发人员: 打开扩展日志文件夹` 中相关的非敏感错误；
- 问题发生前后的具体按键或命令。

请先移除论文正文、个人目录、DeepSeek/OpenAI/自定义服务的 API Key、其他访问令牌、邮箱、Zotero 私有库内容及敏感信息。AI 错误报告只需提供脱敏的最小句子、所选 Provider、模型名、错误类别/安全子码，以及自定义 DeepSeek 服务是否实现 Chat Completions + JSON Output，或自定义 OpenAI 服务是否实现 Responses + Structured Outputs；不要粘贴 SecretStorage 内容、完整自定义 URL 路径、请求/响应正文或服务端原始错误。全部 14 个 AI 普通设置只能位于用户/Profile 层并可随 VS Code Settings Sync 同步；API Key 与每个规范化目标的 consent 不会随其跨设备复制，不同设备、Profile 或 Remote 扩展宿主需要分别确认并设置。安全漏洞请不要公开粘贴可利用细节；可以先创建只描述影响范围的最小 Issue，以便协调后续报告方式。

源码仓库、版本记录与安装包：

- [源码仓库](https://github.com/zhangxh-math/texleaf)
- [版本记录](CHANGELOG.md)
- [GitHub Releases](https://github.com/zhangxh-math/texleaf/releases)
- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=zhangxh-math.texleaf)
