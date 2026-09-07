# AgentX Product Guide

[中文](PRODUCT.md) | English

## Product

AgentX is a declarative, local-first manager for AI Agent environments. The CLI compiles one manifest into native Skills, Rules, and MCP configuration for Codex, Claude Code, Cursor, Windsurf, Gemini CLI, GitHub Copilot, Cline, and Grok Build. The Server provides Workspace-scoped Registry, policy, device, audit, and Drift APIs. This repository provides the public website and Web Console.

AgentX restores an environment; it does not copy API keys, login sessions, chat history, or caches. Review MCP commands before installing a team manifest because they execute on the local machine.

## Website and console workflows

The website introduces the three-stage workflow: declare a manifest, lock source content, and reconcile device state. The console is an operational interface, not a marketing-only mockup:

- Overview lists Workspace devices, package counts, and Drift.
- Registry publishes immutable artifacts, lists releases, approves pending releases, and downloads scoped artifacts.
- Workspace creates Workspaces, invites members, changes roles, and deletes an owner-controlled Workspace.
- Manifest and Policy read and update versioned JSON documents.
- Audit displays append-only events returned by the Server.

Every console action calls the corresponding `/v1` API route and displays API errors. Without an API or authorized token, data is not silently substituted with local demo state.

## Server integration

Set `VITE_API_URL` to the Server origin. Optional configuration:

| Variable | Purpose |
| --- | --- |
| `VITE_API_TOKEN` | initial Bearer token for development |
| `VITE_OIDC_ISSUER` | OIDC discovery issuer |
| `VITE_OIDC_CLIENT_ID` | public browser client ID |
| `VITE_OIDC_REDIRECT_URI` | PKCE callback URL |

The Server authorizes Workspace roles (`viewer`, `developer`, `admin`, `owner`), enforces signatures and approval policies, limits requests, validates artifact SHA-256, and exposes device heartbeat, Drift, reconcile plans, audit, readiness, and metrics. Hosted deployments should keep legacy unscoped routes disabled.

## Local verification

```bash
npm ci
npm run build
cd console
npm ci
npm run build
npm run e2e
```

The Playwright tests cover the console views and Workspace, member, policy, manifest, device, release, approval, and download interactions using an HTTP route fixture. Staging validation must additionally run against a real Server, PostgreSQL, object store, and OIDC provider.

## Publishing

`vMAJOR.MINOR.PATCH` tags run website and console builds before a GitHub Release is created. The release contains the site archive and `SHA256SUMS`. GitHub Pages deployment remains available from the `main` branch workflow. See [`README.en.md`](README.en.md), [`agentx-cli`](https://github.com/agentx-xai/agentx-cli), and [`agentx-server`](https://github.com/agentx-xai/agentx-server) for the rest of the system.
