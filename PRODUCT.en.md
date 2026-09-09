# AgentX Product Guide

[中文](PRODUCT.md) | English

## Overview

AgentX restores a declarative AI Agent environment across machines. A project `agentx.yaml` describes Skills, Rules, MCP servers, and target agents. The CLI resolves and locks sources, scans content, writes native adapter files, reports drift, and can roll back the previous installation. It never copies API keys, login sessions, history, or caches.

The system has three parts:

- CLI for local install, lock, diff, doctor, Registry, team, device sync, and rollback.
- Server for Workspaces, memberships, policies, manifests, immutable artifacts, devices, Drift, audit, and outbox jobs.
- Website and Web Console for operational Workspace, Registry, device, policy, and audit views.

## Manifest and adapters

```yaml
version: 1
skills:
  - name: review
    source: { type: local, path: skills/review }
    targets: [codex, claude]
rules:
  - source: rules/team.md
    targets: [codex, claude]
mcp:
  - name: docs
    command: npx
    args: [-y, '@example/docs-mcp']
    targets: [codex]
```

Skills may come from a contained local directory or a Git URL with a required fixed ref. The CLI rejects absolute/escaping paths, symlinks, oversized files, unsafe or duplicate names, and unsupported targets before target mutation. Rules and Skills are emitted to each Agent's native project or user path. Shared instruction files use managed markers so user text is preserved. Codex uses `AGENTS.md`, `~/.codex/skills`, and `~/.codex/config.toml`; Claude uses `CLAUDE.md`, `~/.claude/skills`, and `~/.claude.json`. The other target paths are listed in the CLI README. MCP currently models `command` and `args`; URL, headers, and environment transports require native configuration.

Lock format version 2 stores every Skill source, requested Git ref, resolved Git revision, framed directory SHA-256, Rule hash, and MCP declaration. `install --frozen` refuses any changed managed input. `diff --target` checks Skills, Rules, MCP, and the lockfile. Installation prints concrete destinations and MCP commands, stages and re-hashes all Skill trees before replacement, and records one rollback journal for Skills, Rules, MCP configs, and the lockfile. `rollback` restores the complete previous generation while preserving user text outside managed rule markers. Windsurf MCP is written to `~/.codeium/windsurf/mcp_config.json`; Cline CLI MCP is written to `~/.cline/mcp.json`.

## Registry, Workspace, and devices

The Server assigns Workspace roles: `viewer` reads, `developer` registers devices and publishes, `admin` changes policies/manifests and approves releases, and `owner` controls Workspace lifecycle. A Workspace Manifest is a strict versioned document containing unique package name, semantic version, and lowercase SHA-256 entries. Each entry must match a downloadable release in the same Workspace. The CLI synchronizes this separate document through `agentx.team.yaml`; it never uploads the local source-oriented `agentx.yaml`. Artifacts are immutable and content-addressed.

Devices report installed digest maps through heartbeat. Server Drift compares them with the current manifest and reports `missing`, `changed`, and `extra`; a saved empty manifest is an explicitly empty desired state. Reconcile plans are deterministically ordered and contain `install`, `update`, and `remove` actions. The CLI downloads, verifies, caches, and can roll back device state. Scoped endpoints authorize every operation and do not fall back to global data when a scoped repository is unavailable.

`registry publish` accepts either a Skill directory or a validated gzip tar. Directory input is archived deterministically. Hosted archives must contain a root `SKILL.md`; traversal, duplicate entries, links, device nodes, executables, credential files, and size-limit violations are rejected. Device sync validates all artifacts before atomically replacing the selected Agent's real Skill directories, and rollback restores the previous files. Device IDs are unique within a Workspace, not globally.

Hosted users run `agentx registry login <url> --oidc`. The CLI obtains issuer, public client ID, audience, and scope from the unauthenticated `/v1/auth/config` endpoint, completes OAuth 2.0 Device Authorization, stores access/refresh metadata, and refreshes shortly before expiry. `registry workspaces`, `registry use <workspace>`, and `registry logout` provide selection and local session removal. Automation should use `--token-stdin` or `AGENTX_TOKEN`; `--token` can be exposed in process arguments.

The CLI requires HTTPS Registry, issuer, and provider endpoint URLs except on loopback. It rejects embedded credentials, query strings, fragments, discovery issuer mismatches, insecure endpoints, and redirects. Tokens, Workspace/device IDs, package names, and semantic versions are validated before requests or local mutation; JSON, errors, artifacts, cursors, pages, and credentials are bounded; downloads are SHA-256 verified before output is written. Credentials are replaced atomically and use mode `0600` on Unix.

Policies accept only boolean `require_signature` and `require_approval` settings. Signature enforcement cannot be enabled until a verifier is configured. Only a `pending_approval` release can transition to `approved`; repeated or already-public approvals are conflicts and do not emit duplicate events. Pending releases cannot be downloaded. Package uploads are limited to 51 MiB, JSON bodies to 2 MiB, and idempotency keys are bound to the original request fingerprint. PostgreSQL uploads use per-Workspace/key advisory locks and are not serialized globally in an API process.

Artifact signing keys rotate through `AGENTX_ARTIFACT_PUBLIC_KEYS`: list the new and previous base64 Ed25519 public keys during the overlap window, switch publishers to the new private key, then remove the previous public key. `AGENTX_ARTIFACT_PUBLIC_KEY` remains supported for single-key deployments.

For PostgreSQL, release and device creation bind `Idempotency-Key` to a request fingerprint under a workspace/key transaction lock. Exact retries replay the original resource; mismatched reuse is rejected. Duplicate Workspace slugs, memberships, and release versions return stable public 400 errors, while missing approval targets return 404; unexpected repository failures remain non-sensitive 500 errors. Workspace, membership, policy, manifest, device, approval, audit, and outbox changes also share a unit of work, so a failed side effect cannot leave a partial domain mutation.

## Security and operations

Use HTTPS, OIDC, least-privilege roles, private artifact storage, and a secret manager. Never commit tokens, cloud credentials, or untrusted executable MCP commands. File mode is for a single development node. Its separate JSON records cannot provide cross-file transactions, so legacy mutations return an explicit "committed but audit failed" error if audit persistence fails. External deployments set `AGENTX_DEPLOYMENT_MODE=hosted`, which requires PostgreSQL, S3/MinIO, OIDC with an audience and public CLI client, an explicit CORS allowlist, and disabled legacy unscoped routes. Production defaults require PostgreSQL TLS, secure S3 transport, and HTTPS OIDC and Console origins. Hosted mode rejects API-token/HMAC fallback by default; only isolated staging may explicitly enable `AGENTX_ALLOW_HOSTED_BOOTSTRAP_AUTH=true` and `AGENTX_ALLOW_INSECURE_HOSTED=true`. Scoped services fail closed when a repository lacks Workspace-aware persistence. The outbox emits structured delivery logs, retries handler failures, exposes worker persistence/retry/dead-letter counters, and dead-letters exhausted events. The four-role authorization contract is exercised as a 20-operation HTTP matrix.

Administrators create expiring Workspace invitations for canonical email addresses and may list or revoke them. A principal can list and atomically claim only invitations matching an OIDC `email` claim with an explicit boolean `email_verified: true`; missing, false, or string-valued verification fails closed. Direct public membership creation by raw `issuer|subject` is not exposed. Workspace deletion preserves an audit tombstone and enqueues digest-scoped cleanup; the worker globally rechecks references and removes an S3 object only after its last release reference disappears. Publication and cleanup share the same digest lock.

Account export/deletion and platform legal-hold enforcement are implemented and tested. Hosted startup requires immutable compliance-administrator principal IDs and an explicit positive audit-retention duration; tenant owners cannot manage holds. The worker preserves active-hold data and deletion/hold tombstones while pruning eligible expired audit events. Public signup remains blocked until owners approve the production retention/deletion policy and provide real backup-expiry evidence. Hosted startup also requires Terms, Privacy, and Support URLs plus abuse and security email addresses, exposes only those public values through `/v1/site/config`, and the Console renders them. Deployment owners must replace placeholders with real owner-approved documents, retention/deletion commitments, subprocessors, and staffed contacts before launch.

When the public issuer URL is not routable from the API network, `AGENTX_OIDC_BACKCHANNEL_URL` may point discovery and JWKS retrieval at an internal HTTPS endpoint. Tokens continue to require the exact public `AGENTX_OIDC_ISSUER`; the backchannel transport refuses requests outside that issuer path. Plain HTTP is accepted only under the explicit insecure-staging override.

The Web Console uses Authorization Code + PKCE through `oidc-client-ts` and sends the OAuth access token, not the ID token, to the API. OIDC state, user data, and tokens live in tab-scoped `sessionStorage`, automatic silent renewal is enabled, and an API 401 receives at most one renew-and-retry attempt. `VITE_DEPLOYMENT_MODE` is explicit: production defaults to `hosted`, development defaults to `local`, and hosted Docker builds require an OIDC issuer and client ID. An incompletely configured hosted runtime renders only a persistent configuration error, makes no API calls, and exposes neither local token controls nor business navigation. `VITE_OIDC_SCOPE` requests provider-specific API scopes and `VITE_OIDC_AUDIENCE` adds the common audience authorization parameter when required. In OIDC mode no manual token control or compile-time API token is exposed. The Console walks every collection cursor, derives the current Workspace role from `/v1/me` and memberships, hides unavailable mutations, and only exposes approval/download actions for legal release states. An authenticated user with no Workspace sees empty collections and can create the first Workspace without calls to legacy unscoped endpoints. The production image serves the SPA as a non-root Nginx process, proxies `/v1` to the API on the same origin, and emits browser security headers.

Hosted database changes use Goose's version table and a PostgreSQL session advisory lock. Run `AGENTX_DATABASE_URL=... go run ./cmd/migrate up`; `status` and `version` are read-only. A one-step `down` additionally requires `AGENTX_ALLOW_MIGRATION_DOWN=true` and a verified backup, and migrations reject unsafe reverse conversions.

Hosted Workspace, membership, release, device, and audit collections execute pagination in PostgreSQL. API replicas also share per-IP fixed-window quotas through PostgreSQL migration 003; quota storage failures fail closed for business routes while health, readiness, and metrics remain observable.

The API emits JSON request logs with request ID, actor, Workspace, template route, status, and duration. `/metrics` includes HTTP, artifact-upload-failure, Drift-report, and worker counters. Set `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to enable the standard OTLP/HTTP exporter; no endpoint means no exporter connection. Request spans contain tenant context and child spans cover PostgreSQL, Registry preparation, and artifact operations. Unknown dependency errors are logged with request ID and returned as stable non-sensitive error envelopes.

## Verification

```bash
make test
AGENTX_POSTGRES_TEST_URL='postgres://...' make release-check
```

Each release repository accepts `vMAJOR.MINOR.PATCH` tags. Tag workflows run checks before release workflows publish archives and `SHA256SUMS`; verify artifacts with `sha256sum -c SHA256SUMS`.
