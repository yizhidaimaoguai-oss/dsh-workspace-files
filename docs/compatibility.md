# 兼容性

已验证的 DSH 上游信息见 [机器可读记录](../patches/compatibility.json)。该记录是测试基线，不是对后续版本的兼容承诺。

## 基础插件依赖

服务端使用 DSH 的 connection、workspaceRegistry 和 webServer 服务。浏览器侧使用 slots、sessions 和 workspaces。它要求 connection.fetch.register、connection.requestRejection 和 webServer.register 等接口存在。

服务端支持 Windows、macOS 和 Linux。Linux 保留 /proc/self/fd 目录锚定；Windows/macOS 采用逐段路径、链接和文件身份重检。Windows 当前版 21 项测试通过；Linux/macOS 已配置 CI，当前版本尚未完成实机验证。DSH 主程序在每个系统上的支持范围仍取决于上游版本。Windows 工作目录使用本地盘符路径；回答链接不支持 UNC 和设备路径。

## 回答链接补丁

补丁增加可选的 chatWorkspaceOpener 服务，并让 MarkdownFileMentions 接收可选的 resolveLink 回调：

- DSH Chat 将所属 Session 和目标文件传给插件。
- 插件用当前工作目录模型解析目标，生成本机 VSCode 扩展链接。
- VSCode 使用已有工作目录凭据读取文件，服务端负责最终访问校验。
- 未安装此插件时，DSH 保留原来的文件打开方式和 URL 白名单。

补丁包含源码、相关测试及包说明，不包含构建产物。必须重建 DSH 客户端库和 Web 前端。

补丁工具先执行 git apply --check；已经应用时只报告状态；存在不兼容时拒绝修改。将来 DSH 提供等价官方接口后，可移除补丁依赖，但需重新验证接口和生命周期。

## 发布身份

DSH npm 包名为 dsh-workspace-files；VSCode 扩展 ID 为 ahoge-local.dsh-http-files。这些名称沿用开发版以兼容既有安装，不表示已在 npm 或 Marketplace 获得名称所有权。

若公开发布前更换 publisher/name，必须同步修改服务端 client.template.js、public/app.js 中的 URI，重新生成 client.js，并重新配对。不要只修改 VSCode 的 package.json。
