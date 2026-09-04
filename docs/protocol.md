# HTTP 协议与文件一致性

所有路径均位于 DSH Web 的同一 origin 下。服务器绑定地址、TLS 和反向代理由 DSH 部署管理。

## 浏览器 API

基础路径 /api/workspace-files/，沿用 DSH 登录 Cookie 与 Host/Origin 校验。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| ui、app.js、style.css | GET | 网页文件管理 |
| workspaces | GET | 已登记工作目录 |
| list | GET | workspace、path 指定目录列表 |
| file | GET / PUT | 读取文本 / 带版本保存 |
| download | GET | 下载或支持类型的预览 |
| desktop-ticket | POST | 为 workspace 和可选 path 签发一次性票据 |
| desktop-clients | GET / POST | 查看授权 / 按 id 撤销 |
| vscode | GET | 旧版 Remote SSH 链接兼容接口，网页主入口不使用 |

浏览器写请求必须包含同源 Origin、Content-Type: application/json 和 X-DSH-Workspace-Files: 1。

## 桌面 API

基础路径 /dsh-files-bridge/，保持 DSH Host/Origin 校验；除 exchange 外，要求 Authorization: Bearer 凭据。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| exchange | POST | 将一次性 ticket 换成工作目录范围的凭据 |
| info | GET | 授权工作目录与到期时间 |
| stat | GET | 路径的类型、大小与修改信息 |
| list | GET | 目录列表 |
| file | GET / PUT | 读取文本 / 带版本保存 |

桌面请求不能通过 workspace 参数扩大授权范围。服务端验证工作目录仍登记且根路径与授权时一致。

读取文本返回 content 和 version 等字段。保存提交 path、content、version。文件自读取后发生变化时返回 409；不存在、禁止访问、不支持的文件类型或过大分别使用相应 4xx 状态。

## URI 与凭据

- /connect 扩展链接携带 server 和短时 ticket。
- /open 扩展链接携带 server、workspace、path、line、column，不携带长期凭据。
- 长期凭据只存入 VSCode SecretStorage；服务端保存 SHA-256 散列。
- 默认授权文件为 DSH 运行用户主目录下的 .dsh/workspace-files/clients.json，配置可覆盖。
- DSH Cookie、配对 ticket 和客户端凭据不应进入日志、Issue 或 Git 仓库。

## 同步

保存采用版本检查和原子替换，保持基本文件模式及 UTF-8 BOM/CRLF 字节内容。VSCode 对最近访问的资源轮询，不递归扫描整棵工作区。网页在重新获得焦点时检查当前文件变化。

这是乐观并发控制，不是多用户实时文本协作。访问已登记文件并不等于授权执行其中的命令；此扩展只提供文件系统。
