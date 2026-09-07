# AgentX Website

[中文](README.md) | English

This repository contains the AgentX product website and the Vue 3 Registry Web Console.

Website: <https://agentx-xai.github.io/agentx-website/>

## Contents

The site explains the Manifest, Skills, Rules, MCP, Lockfile, Workspace, and Drift workflow. The `console/` application provides live Workspace, membership, Manifest, policy, Registry, device, Drift, and audit operations against an AgentX Server API. It supports Codex, Claude Code, Cursor, Windsurf, Gemini CLI, GitHub Copilot, Cline, and Grok Build through the CLI adapter matrix.

The console reads `VITE_API_URL` and can send a saved Bearer token or use the optional browser OIDC PKCE flow (`VITE_OIDC_ISSUER`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_REDIRECT_URI`). It does not provide a fake local data fallback: an unavailable API is shown as an error.

## Development

Node.js 20 or newer is required:

```bash
npm ci
npm run dev
npm run build
```

Build and run the console separately:

```bash
cd console
npm ci
npm run dev
npm run build
npm run e2e
```

## Release

Push a tag matching `vMAJOR.MINOR.PATCH` to run the release workflow. It builds the website and console, creates a distribution archive, and publishes `SHA256SUMS`. The tag workflow runs both builds before the tag is created. Verify an archive with `sha256sum -c SHA256SUMS`.

See [`PRODUCT.en.md`](PRODUCT.en.md) for the product model and [`SECURITY.md`](SECURITY.md) for reporting guidance. The related repositories are [`agentx-cli`](https://github.com/agentx-xai/agentx-cli) and [`agentx-server`](https://github.com/agentx-xai/agentx-server).
