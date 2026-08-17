# Third-Party Notices

TeXLeaf 由 zhangxh-math 与 OpenAI Codex 联合开发，并作为独立于下列上游项目的 VS Code 扩展发行。其交互理念与部分片段语法受到开源项目启发；完整致谢见 README 与 Wiki，本文件重点记录实际发行组件、来源与许可证。

## snippet-leaf

- 项目：https://github.com/superle3/snippet-leaf
- 许可证：MIT License
- 上游许可证中的版权声明：Copyright (c) 2022 artisticat1

上游 MIT 许可证原文如下：

```text
MIT License

Copyright (c) 2022 artisticat1

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

TeXLeaf 自身的许可条款见根目录 [LICENSE](LICENSE)。

## jsonc-parser

- 项目：https://github.com/microsoft/node-jsonc-parser
- 用途：安全解析带注释的 JSON 配置
- 许可证：MIT License

```text
The MIT License (MIT)

Copyright (c) Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## MathJax

- 组件：`@mathjax/src` 4.1.3
- 项目：https://www.mathjax.org/
- 用途：在 TeXLeaf 的隔离后台 Worker 中把当前 LaTeX 公式排版为 SVG
- 作者：MathJax Consortium
- 许可证：Apache License 2.0

## MathJax New Computer Modern Font

- 组件：`@mathjax/mathjax-newcm-font` 4.1.3
- 项目：https://www.npmjs.com/package/@mathjax/mathjax-newcm-font
- 用途：MathJax SVG 输出所使用的本地字体数据
- 作者：MathJax Consortium
- 许可证：Apache License 2.0

以上两个 MathJax 组件的完整 Apache-2.0 许可证文本随发行包保存在 [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt)。TeXLeaf 没有修改这些依赖的源文件；发布时只把所需模块打进独立 worker bundle。

TeXLeaf 的 Math Preview 产品方向受到 Ultra Math Preview 与 hscopes-booster 公开功能和架构的启发。当前发行包中的实际渲染组件与许可证如上所列；归档不包含这两个仓库的源码、正则表达式、CSS、图标、动画、文档或测试。若未来发行内容发生变化，本通知也必须同步更新。
