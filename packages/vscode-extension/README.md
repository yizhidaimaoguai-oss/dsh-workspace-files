# DSH HTTP Files

Use local desktop VSCode to edit existing UTF-8 files in a remote DSH workspace through its Web port.

## Connect

1. Install this VSIX locally, and the companion dsh-workspace-files plugin on the DSH server (Windows, macOS or Linux).
2. Open the authenticated DSH /editor/ page and choose a workspace.
3. Click “连接本机 VSCode”, then “在本机 VSCode 中打开”.
4. Open existing files in VSCode and save with Ctrl+S.
5. Reopen a paired workspace with “DSH: 打开已授权工作目录”.

Only a one-time pairing ticket crosses the extension link. Long-lived credentials use VSCode SecretStorage. Revoke access from “客户端授权” in the DSH page.

## Answer file links

With the compatible DSH Chat patch installed, file links and produced-file buttons open this extension using the saved workspace authorization. Line/column navigation is supported. This feature requires both the plugin and the DSH patch.

## Known limitations

- Existing UTF-8 files only; no creation, deletion, renaming, symlinks, hard-link writes or binary editing.
- Default file limit 2 MiB; default directory limit 2000 entries.
- No remote terminal, Git, debugger or universal language-service support.
- Only loopback HTTP or HTTPS endpoints are accepted.
- External links may reach a restored Remote SSH window and trigger an unrelated SSH password prompt. Cancel it, open a local window with code --new-window, and retry. Window routing is not fully resolved.

The extension ID is ahoge-local.dsh-http-files. It is retained for existing users; no Marketplace publication or publisher ownership is implied.

MIT license.
