# DSH Workspace Files

[中文](README.md)

**Made by Codex**

Edit existing files in registered DSH workspaces through the browser or a local desktop VSCode window, using the same DSH Web port.

This repository contains the dsh-workspace-files DSH plugin and the DSH HTTP Files VSCode extension. It is a third-party project, separately maintained from DeepSeek Harness.

## Features

- Browser directory browsing, UTF-8 editing, image/PDF preview and downloads.
- Workspace-scoped pairing, revocable credentials, direct remote saves and optimistic concurrency checks.
- Desktop VSCode filesystem provider without a separate VSCode Remote SSH connection.
- Optional DSH Chat patch for answer file links and produced-file buttons, including line/column navigation.

## Requirements

The plugin supports Windows, macOS and Linux with Node.js 22.19+. Windows passes 21 tests. Linux and macOS are included in CI; this version has not completed real-host verification on those systems. The verified DSH source revision is recorded in [compatibility.json](patches/compatibility.json). Desktop VSCode 1.90+ is required.

Browser file editing and desktop HTTP pairing work without the optional source patch. **Answer-link integration requires applying the included patch and rebuilding DSH.** Compatibility with other DSH revisions is not guaranteed.

Plain HTTP is supported only for loopback addresses. Use HTTPS for direct remote addresses, including tailnet addresses, or retain an existing local port forward.

Only existing UTF-8 files are editable. Creation, deletion, renaming, symlinks and hard-link writes are unsupported. Virtual workspaces do not provide remote terminals, Git, debugging or universal language-service support.

A known issue can route external extension links into a restored Remote SSH window. See [troubleshooting](docs/troubleshooting.md).

## Install from GitHub

The repository is public. HTTPS cloning does not require a GitHub login. Install Git, Node.js 24 and npm; DSH must already be installed on the server.

~~~sh
git clone --depth 1 https://github.com/yizhidaimaoguai-oss/dsh-workspace-files.git
cd dsh-workspace-files
npm ci
npm run build
npm run check
npm test
npm run package
~~~

The dist directory receives an npm tarball, a VSIX and SHA256SUMS. All three platforms run server and portable tests. See SECURITY.md for filesystem race and metadata limitations.

Copy dist/dsh-workspace-files-1.0.0.tgz to the DSH host. From its deepseek-harness source directory, install it using the actual absolute package path:

~~~sh
pnpm dsh plugin --profile web add "/absolute/path/dsh-workspace-files-1.0.0.tgz"
~~~

Stop the running DSH instance, then restart it with pnpm dsh web --no-open.

Copy dist/dsh-http-files-1.0.0.vsix to the desktop computer and install it locally:

~~~sh
code --install-extension "/absolute/path/dsh-http-files-1.0.0.vsix"
~~~

Sign in to DSH, open /editor/, choose a workspace and pair with desktop VSCode. Answer file links require the optional DSH source patch and rebuild described in [installation](docs/installation.md).

The repository root is a workspace containing multiple packages, not the installable DSH package. npm, Marketplace and GitHub Releases packages have not been published. See [development](CONTRIBUTING.md), [protocol](docs/protocol.md) and [security](SECURITY.md).

The extension ID is ahoge-local.dsh-http-files. It is retained for compatibility; this repository does not claim that the publisher is registered on VSCode Marketplace. The workflows build artifacts only and do not publish automatically.

[MIT license](LICENSE).
