# DSH Workspace Files

[English](README.en.md) · [安装指南](docs/installation.md) · [兼容性](docs/compatibility.md) · [开发指南](CONTRIBUTING.md)

**本插件由Codex完成**

通过 DSH Web 的同一端口，在浏览器或本机桌面 VSCode 中编辑远程工作目录。VSCode 保存直接写回服务器，无需额外建立 VSCode Remote SSH 连接。

本仓库包含两个发布包：

| 包 | 当前版本 | 用途 |
| --- | --- | --- |
| dsh-workspace-files | 1.0.0 | DSH 插件、网页文件管理、工作目录范围的 HTTP API |
| DSH HTTP Files | 1.0.0 | 本机 VSCode 虚拟文件系统扩展 |

DSH 页面入口名称为 **文件 / VSCode**。这是第三方插件工程，与 DSH 官方项目分别维护。VSCode 扩展 ID 为 ahoge-local.dsh-http-files；保留此 ID 可沿用已有连接。

## 功能

- 浏览 DSH 已登记的工作目录，打开、编辑并保存现有 UTF-8 文本。
- 浏览器预览图片和 PDF，下载文件。
- 网页一次授权，本机 VSCode 通过同一 HTTP/HTTPS 服务编辑。
- 检测外部修改，保存时校验文件版本，避免覆盖另一端的新内容。
- 授权按工作目录隔离、默认 30 天有效，可从网页撤销。
- 应用兼容补丁后，点击 DSH 回答中的 Markdown 文件链接或生成文件按钮，在本机 VSCode 打开；支持中文路径及行列定位。

## 要求和边界

- 服务端支持 Windows、macOS 和 Linux；Node.js 22.19+。Windows 已通过 21 项自动测试；Linux/macOS 已纳入 CI，当前版本尚未完成实机验证。
- DSH 已验证版本为 0.1.2-alpha.3 的一个特定提交，见 [兼容性](docs/compatibility.md)。不承诺支持所有 DSH 版本。
- 浏览器文件管理和 VSCode HTTP 编辑不要求修改 DSH 主仓库。
- **回答文件链接功能需要附带的 DSH 源码补丁**；它目前不是只安装 npm 包就能启用的独立功能。
- 本机 VSCode 1.90+；构建工具建议 Node.js 24。
- HTTP 仅接受 localhost/回环地址；直接访问远端域名或 Tailscale 地址时需 HTTPS。也可沿用现有端口转发。
- 第一版不支持新建、删除、重命名、符号链接、硬链接写入及二进制编辑。默认文本上限 2 MiB，目录上限 2000 条。
- 虚拟工作区不提供远程终端、Git、调试或完整远程语言服务；部分 VSCode 扩展不支持虚拟文件系统。
- VSCode 可能恢复旧的 Remote SSH 窗口并弹出密码框。这是尚未彻底处理的窗口路由问题，见 [排障](docs/troubleshooting.md)。

## 从 GitHub 安装

仓库地址：[yizhidaimaoguai-oss/dsh-workspace-files](https://github.com/yizhidaimaoguai-oss/dsh-workspace-files)。这是**公开仓库**，使用下面的 HTTPS 地址克隆无需登录 GitHub。准备 Git、Node.js 24 和 npm；DSH 主机需已安装并能够启动 DSH。

### 1. 下载源码并生成安装包

在任意构建目录执行，Windows PowerShell、macOS 和 Linux 均可使用：

~~~sh
git clone --depth 1 https://github.com/yizhidaimaoguai-oss/dsh-workspace-files.git
cd dsh-workspace-files
npm ci
npm run package
~~~

生成的 dist/ 包含：

- dsh-workspace-files-1.0.0.tgz：安装到运行 DSH 的主机。
- dsh-http-files-1.0.0.vsix：安装到你本机的桌面 VSCode。
- SHA256SUMS：两个安装包的校验值。

### 2. 在 DSH 主机安装插件

把 .tgz 放到 DSH 主机，在 **deepseek-harness 源码目录**执行。将下面的 /absolute/path 替换为包文件所在的绝对路径；Windows 可使用带引号的盘符路径。

~~~sh
pnpm dsh plugin --profile web add "/absolute/path/dsh-workspace-files-1.0.0.tgz"
~~~

停止已运行的 DSH，再重新启动：

~~~sh
pnpm dsh web --no-open
~~~

### 3. 在本机安装 VSCode 扩展

将 .vsix 下载或复制到你使用桌面 VSCode 的电脑，在本机终端执行：

~~~sh
code --install-extension "/absolute/path/dsh-http-files-1.0.0.vsix"
~~~

也可在 VSCode 扩展页面选择“从 VSIX 安装”。已安装过该扩展时，安装后重新加载窗口。

### 4. 连接并编辑

使用 DSH 启动日志提供的登录链接进入网页，点击 **文件 / VSCode**，或打开同一地址的 /editor/。选择工作目录，点击“连接本机 VSCode”并完成配对；之后在本机 VSCode 按 Ctrl+S 即写回 DSH 主机。

**点击 DSH 回答中的文件链接打开 VSCode，还需要应用兼容补丁并重建 DSH。** 详见 [完整安装指南](docs/installation.md)，其中包含 Windows/macOS/Linux 的路径示例与补丁命令。

仓库根目录是多包工程，不是可直接安装的 DSH 插件包；请按上面步骤生成并安装 .tgz。当前未发布 npm 包、VSCode Marketplace 扩展或 GitHub Releases 下载附件。

## 工程结构

~~~text
packages/
  dsh-workspace-files/   DSH 插件与网页
  vscode-extension/     桌面 VSCode 扩展
patches/                可选的 DSH Chat/Markdown 兼容补丁
scripts/                构建、检查、测试、打包和补丁工具
docs/                   安装、兼容性、协议与排障
examples/               通用配置示例
.github/                CI、手动构建发布附件、Issue/PR 模板
~~~

## 授权与同步

浏览器沿用 DSH 登录与来源检查；一次性配对票据有效 60 秒。长期客户端凭据存入 VSCode SecretStorage，服务端只保存散列。文件访问仍由服务端校验工作目录范围。

VSCode 每 4 秒检查最近访问的文件和目录，最多 256 项。网页切回焦点时，若没有未保存编辑则自动载入远程变化；存在编辑时保留草稿并提示冲突。这是文件保存同步，不是多人实时协同编辑。

详见 [安全说明](SECURITY.md) 和 [协议](docs/protocol.md)。

## GitHub 与发布

源码托管在 [GitHub](https://github.com/yizhidaimaoguai-oss/dsh-workspace-files)。CI 运行检查和测试；手动工作流只生成构建附件，不自动发布到 npm、VSCode Marketplace 或 GitHub Releases。发布说明见 [开发指南](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
