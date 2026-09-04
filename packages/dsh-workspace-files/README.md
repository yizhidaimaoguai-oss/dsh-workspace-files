# dsh-workspace-files

DSH plugin for browsing and editing registered workspace files through an authenticated web UI and a workspace-scoped desktop HTTP API.

Source and full installation guide: https://github.com/yizhidaimaoguai-oss/dsh-workspace-files#从-github-安装

## Install

Build the repository, then install its npm tarball into the DSH Web profile:

~~~sh
pnpm dsh plugin --profile web add /absolute/path/dsh-workspace-files-1.0.0.tgz
pnpm dsh web --no-open
~~~

Use the DSH login link, then open /editor/ or “文件 / VSCode”.

Requires Windows/macOS/Linux, Node.js 22.19+ and the DSH connection, workspaceRegistry, webServer, slots, sessions and workspaces services. The verified DSH revision is documented in the repository compatibility guide.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| maxFileBytes | 2097152 | Maximum editable UTF-8 file bytes |
| maxDownloadBytes | 52428800 | Maximum download bytes |
| maxEntries | 2000 | Maximum directory entries |
| clientTokenDays | 30 | Client authorization lifetime, 1–365 days |
| clientStateFile | Runtime user home + .dsh/workspace-files/clients.json | Hashed client-grant storage |
| sshTarget | Empty | Legacy Remote SSH endpoint only; current UI uses HTTP |

Pair the companion DSH HTTP Files VSCode extension through the web UI. The bundle does not contain the extension VSIX.

## Limitations

Only existing UTF-8 files are editable. Creation, deletion, renaming, symlinks and hard-link writes are unsupported. The optional answer-file-link integration requires a separate DSH Chat/Markdown source patch and frontend rebuild.

The plugin does not create remote terminals, run Git or start language servers. It does not change model prompts, tool definitions or session events.

MIT license.
