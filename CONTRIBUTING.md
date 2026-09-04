# 开发与发布

## 环境与命令

建议 Node.js 24、npm 和 Git。Windows、macOS、Linux 均执行服务端、解析器和 VSCode 核心测试。

~~~sh
npm ci
npm run build
npm run check
npm test
npm run package
~~~

- build：从 client.template.js 和 link-target.cjs 生成浏览器模块 client.js。
- check：检查 JavaScript 语法、生成文件一致性、包元数据和常见机器专属数据。
- test：运行当前平台的全部测试。
- test:server：仅运行服务端测试，支持三个系统。
- package：生成 npm 包、VSIX 和 SHA256SUMS，并检查 npm 发布文件清单。

check 的敏感数据检查只是辅助，不替代人工检查。不要将真实 Cookie、票据、客户端授权文件或个人工作区复制到工程内。

## 修改源文件

修改 client.template.js 或 link-target.cjs 后运行 npm run build，并提交生成的 client.js。不要只编辑生成文件。VSCode 运行时代码无需打包器或第三方运行时依赖。

DSH 服务端函数直接使用注入的 Context 服务，因此不打包一份 Cordis 运行时；接口兼容性由所支持的 DSH 版本决定。

## 验证

本工程自动测试覆盖路径解析、文件读写、并发保存、来源校验、配对、撤销与桌面文件系统核心。DSH 渲染/Chat 接口的测试随补丁一起提供，需要在对应 DSH checkout 中运行。

真实 VSCode 联调是显式的手动步骤，见 [测试说明](docs/testing.md)。CI 不连接开发者的 DSH、不保存私人连接、不自动启动桌面 VSCode。

## 提交前

运行 build、check、test，检查 git diff，确保没有本机路径或凭据。行为变化更新 README、协议或排障说明，并添加能覆盖实际风险的测试。

## GitHub 工作流

CI 在 Ubuntu/Windows/macOS 与 Node.js 22/24 上运行。Linux Node.js 24 任务额外打包并上传构建附件。

“Build release artifacts”工作流可手动触发，仅上传附件。它不持有 npm token 或 Marketplace PAT，也不自动创建公开 Release。

发布时：

1. 核对工程与两个发布包的版本一致。
2. 运行完整跨平台测试和必要的真实 VSCode 联调。
3. 下载或本地生成 dist/ 中的包，并核对 SHA256SUMS。
4. 由维护者创建 Git 标签与 GitHub Release，上传 .tgz、.vsix 和校验文件。
5. 若计划发布到 npm/Marketplace，先确认包名和 publisher 所有权，再配置各平台要求的凭据；不要把凭据提交到仓库。

源码与打包附件分开保存。GitHub 仓库不应包含 node_modules、dist、生成的 VSIX、私人测试状态或 DSH 运行数据。
