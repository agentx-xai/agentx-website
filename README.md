# AgentX Website

[English](README.en.md) | 中文

<p align="center"><img src="https://raw.githubusercontent.com/agentx-xai/.github/main/profile/agentx-mark.svg" alt="AgentX" width="88"></p>

<p align="center">
  <a href="https://github.com/agentx-xai/agentx-website/actions/workflows/deploy.yml"><img src="https://github.com/agentx-xai/agentx-website/actions/workflows/deploy.yml/badge.svg" alt="Website deployment"></a>
  <a href="https://github.com/agentx-xai/agentx-website/releases"><img src="https://img.shields.io/github/v/release/agentx-xai/agentx-website" alt="Latest release"></a>
  <a href="https://github.com/agentx-xai/agentx-website/blob/main/LICENSE"><img src="https://img.shields.io/github/license/agentx-xai/agentx-website" alt="MIT license"></a>
</p>

<p align="center">AgentX 官方产品网站和 Registry Web Console。</p>

AgentX 官方产品官网，展示声明式管理 AI Agent 环境的工作方式，并提供 CLI、Registry 和 Web Console 的入口。

官网地址：<https://agentx-xai.github.io/agentx-website/>

## 页面内容

- 产品定位：Manifest、Skills、Rules、MCP、Lockfile 和 Drift
- 使用流程：Declare、Lock、Reconcile
- 能力说明：Local-first、团队 Workspace、内容哈希和审计
- 快速开始：CLI 初始化、锁定和安装命令
- 支持 Codex、Claude Code、Cursor、Windsurf、Gemini CLI、Copilot、Cline 和 Grok Build
- GitHub 入口：[`agentx-cli`](https://github.com/agentx-xai/agentx-cli)、[`agentx-server`](https://github.com/agentx-xai/agentx-server)

完整中文产品文档见 [`PRODUCT.md`](PRODUCT.md)，English version见 [`PRODUCT.en.md`](PRODUCT.en.md)。

## 本地运行

要求 Node.js 20+：

```bash
npm install
npm run dev
```

默认 Vite 开发服务会输出本地地址。生产构建和预览：

```bash
npm run build
npm run preview
```

控制台位于 [`console/`](console/)：

```bash
cd console
npm ci
npm run dev
```

## 发布

仓库的 GitHub Actions 会在 `main` 分支 push 后执行 `npm ci`、`npm run build`，并把 `dist/` 发布到 GitHub Pages。首次启用时，在仓库 Settings → Pages 中将 Source 设置为 **GitHub Actions**。

也可以手动触发 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)。部署后的页面地址由 GitHub Pages 提供，当前为：

```text
https://agentx-xai.github.io/agentx-website/
```

推送形如 `v0.1.2` 的 Tag 会触发 [`.github/workflows/release.yml`](.github/workflows/release.yml)，先构建网站，再创建 GitHub Release 并上传 `dist/` 压缩包和 SHA-256 校验和。Tag 可通过 GitHub Actions 的 `Tag` workflow 从指定分支创建。

## 目录

| 路径 | 用途 |
| --- | --- |
| `src/` | 官网 Vue 页面和样式 |
| `console/` | Registry Web Console |
| `PRODUCT.md` | 产品定义、使用方式和路线 |
| `.github/workflows/deploy.yml` | GitHub Pages 构建与部署 |

## 参与贡献

欢迎通过 [Issues](https://github.com/agentx-xai/agentx-website/issues) 报告网站或 Console 问题，通过 [Pull Requests](https://github.com/agentx-xai/agentx-website/pulls) 提交改进。提交前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)；安全问题请使用 [`SECURITY.md`](SECURITY.md) 的私密报告流程。本仓库使用 [MIT License](LICENSE)。
