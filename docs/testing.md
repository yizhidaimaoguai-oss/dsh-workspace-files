# 测试与手动验收

## 自动检查

在仓库根目录执行 `npm ci`、`npm run build`、`npm run check`、`npm test`。三个平台均运行全部 21 项测试，覆盖 HTTP 授权、读写冲突、路径边界、符号链接/联接、Windows 特殊路径和更新通知竞态。CI 配置为 Ubuntu / Windows / macOS 与 Node.js 22 / 24。

`npm run package` 验证包内容并生成 DSH tarball、VSIX 和 SHA256SUMS。此命令不上传 npm、Marketplace 或 GitHub。源码扫描只是基础防误提交检查，不替代人工审核。

## 本机 VSCode 与 DSH 联调

联调需要你自己的 DSH、浏览器和桌面 VSCode，CI 不自动模拟桌面协议唤起。以下步骤仅操作新建的测试文件：

1. 在 DSH 已登记的工作目录创建一个临时子目录，准备 UTF-8 文本，包含中文；再准备一份 BOM / CRLF 文本。
2. 安装两个发布包，重启 DSH；打开已登录网页的 `/editor/`，选择该工作目录。
3. 在网页打开文本、修改并保存，确认磁盘内容一致。
4. 点击“连接本机 VSCode”完成授权，确认打开的是本地窗口中的 `dshfs:` 文件。
5. 在 VSCode 修改并按 Ctrl+S，刷新网页确认修改已写入同一文件；检查 BOM / CRLF 保留。
6. VSCode 保留未保存的修改，同时在网页修改同一文件并保存。回到 VSCode 保存应提示版本冲突，不应覆盖网页修改。
7. 安装可选 DSH 补丁后，点击回答中指向该临时文件的链接，确认本地 VSCode 打开文件并定位行列。重复点击不应重复创建客户端授权。
8. 在网页撤销该客户端授权，再读写应失败。重新配对后恢复访问。
9. 关闭无关 Remote-SSH 窗口再测一次协议唤起；如果出现 SSH 密码框，按 [故障排查](troubleshooting.md) 判断窗口恢复问题。
10. 测试完毕后自行删除临时文件，撤销测试授权。

不要将登录 URL、Cookie、配对票据、客户端令牌或真实工作目录路径加入测试快照和 Issue。

## 验证范围

Windows 已通过 21 项自动测试，覆盖文件访问、授权、并发保存和更新通知。Linux/macOS 已配置 CI，尚未完成当前版本的实机验证；完整 DSH→VSCode 界面联调也未完成。文件系统与权限元数据边界见 [安全说明](../SECURITY.md)。
