# 安装与更新

## 1. 从 GitHub 获取源码并构建

仓库：[yizhidaimaoguai-oss/dsh-workspace-files](https://github.com/yizhidaimaoguai-oss/dsh-workspace-files)。这是公开仓库，下面的 HTTPS 克隆方式无需登录 GitHub。若使用已配置的 GitHub SSH 密钥，请将克隆地址替换为 git@github.com:yizhidaimaoguai-oss/dsh-workspace-files.git。

安装 Git、Node.js 24 和 npm，然后在任意构建目录执行：

~~~sh
git clone --depth 1 https://github.com/yizhidaimaoguai-oss/dsh-workspace-files.git
cd dsh-workspace-files
npm ci
npm run build
npm test
npm run package
~~~

可在 Windows、macOS 或 Linux 上构建和运行。将 dist/dsh-workspace-files-1.0.0.tgz 复制到运行 DSH 的主机；VSIX 留在本机。Windows 安装命令中的路径可替换为带引号的盘符绝对路径。

构建可以在本机完成，也可以在 DSH 主机完成。只把 .tgz 安装在 DSH 主机；.vsix 要安装在实际运行桌面 VSCode 的电脑。两台电脑分开时，需要复制对应安装包。

也可以从 GitHub 仓库的 Actions 页面手动运行 Build release artifacts，完成后下载 release-artifacts 并解压。GitHub 登录、工作流成功和可用的 Actions 额度是这种方式的前提；目前没有公开 Releases 附件。

## 2. 安装到 DSH

先将 dist/dsh-workspace-files-1.0.0.tgz 复制到运行 DSH 的主机，并备份 DSH Web profile 的 package.json 和 cordis.patch.yml，再在 DSH 源码目录运行。务必传入包文件的绝对路径：

~~~sh
pnpm dsh plugin --profile web add "/absolute/path/dsh-workspace-files-1.0.0.tgz"
~~~

具体路径示例（按你的实际位置调整）：

**macOS / Linux**，在已经克隆并构建好的插件目录内执行：

~~~sh
plugin_package="$(pwd)/dist/dsh-workspace-files-1.0.0.tgz"
cd ~/DSH/deepseek-harness
pnpm dsh plugin --profile web add "$plugin_package"
~~~

**Windows PowerShell**，在已经克隆并构建好的插件目录内执行：

~~~powershell
$pluginPackage = (Resolve-Path ./dist/dsh-workspace-files-1.0.0.tgz).Path
Set-Location 'C:\path\to\deepseek-harness'
pnpm dsh plugin --profile web add "$pluginPackage"
~~~

上面是同机构建的示例；如果安装包来自其他电脑，请直接使用复制后的绝对路径。DSH CLI 会在 profile 中管理依赖，因此不要将相对路径原样交给插件安装命令。

插件名和 bundle 名均为 dsh-workspace-files。安装后检查 Web profile 的依赖及 dsh.profile.bundles 包含该名称。某些 DSH 预发布版本可能重新发现其他已安装 bundle；保留原有配置并检查安装前后的差异，避免意外启用旧插件。

停止并重新启动 DSH：

~~~sh
pnpm dsh web --no-open
~~~

使用启动日志中的登录链接进入网页。侧栏底部和会话顶部应出现“文件 / VSCode”，也可打开 /editor/。直接打开文件 API 而未登录会收到 401。

若使用已发布的 dsh 命令，可按该发行版的 CLI 用法去掉上面的 pnpm 前缀。此仓库不预设 DSH 的安装位置或 SSH 主机。

## 3. 安装本机 VSCode 扩展

~~~sh
code --install-extension "/absolute/path/dsh-http-files-1.0.0.vsix"
~~~

也可在 VSCode 的扩展页面执行“从 VSIX 安装”。显示名称为 DSH HTTP Files，ID 为 ahoge-local.dsh-http-files。更新已有扩展后，重新加载 VSCode 窗口。

## 4. 配对和保存

1. 用已登录的 DSH 网页打开 /editor/，选择一个工作目录。
2. 点击“连接本机 VSCode”，再点击“在本机 VSCode 中打开”。
3. 允许浏览器打开 VSCode；票据仅能使用一次，60 秒后过期。
4. 在 VSCode 打开现有文本，Ctrl+S 保存。
5. 后续执行“DSH: 打开已授权工作目录”，无需重复网页配对。

授权与 DSH 地址及工作目录绑定。换浏览器访问地址、换工作目录或凭据过期时可能需要重新配对。DSH 重启不会清除已持久化的客户端授权。

## 5. 可选：回答文件链接

此步骤修改 DSH 源码，先确保 checkout 没有未处理的冲突，并保留自己的改动。工具不下载源码、不重置仓库、不自动启动 DSH。

在本插件工程根目录运行：

~~~sh
node scripts/patch-dsh.mjs --check /absolute/path/deepseek-harness
node scripts/patch-dsh.mjs --apply /absolute/path/deepseek-harness
~~~

然后在 DSH 源码目录运行：

~~~sh
pnpm run build:lib:client
pnpm run build:web
~~~

重新启动 DSH 并刷新浏览器。已授权的工作目录可从回答中的文件链接或生成文件按钮直接打开本机 VSCode。首次未授权时，扩展提供“前往 DSH 授权”入口。

补丁检查失败时停止应用，并参照 [兼容性说明](compatibility.md)。不要强制忽略失败或重置其他修改。

## 更新与卸载

更新：重新构建包、安装新 .tgz/.vsix、重启 DSH。保留扩展 ID 可继续使用原有凭据。仅替换 VSIX 不能补上缺失的 DSH Chat 源码接口。

撤销访问：在网页“客户端授权”中撤销。VSCode 的“移除本机连接”只删除本机保存的连接，不撤销服务器上的授权。

卸载插件前，先从 DSH profile 的 bundle 列表移除 dsh-workspace-files，并通过当前 DSH 版本的插件管理命令移除其依赖。VSCode 扩展可从扩展页面卸载。是否删除服务端授权存储由管理员决定。
