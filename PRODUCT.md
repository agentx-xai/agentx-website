# AgentX 产品文档

[English](PRODUCT.en.md) | 中文

## 1. 产品概述

AgentX 用一份声明式配置管理 AI Agent 的工作环境。它把 Skills、Rules、MCP 服务、版本和团队策略集中描述，再生成 Codex、Claude Code、Grok Build 等 Agent 可以直接使用的本地配置。

AgentX 解决的是“换一台机器后，如何恢复同一套 Agent 环境”，而不是实时同步个人目录。它不会复制 API Key、登录会话、凭据、历史记录或缓存。

产品包含三部分：

- **CLI**：在开发者机器上初始化、安装、比较、锁定、同步和回滚环境。
- **Registry API**：保存团队 Workspace、成员、Manifest、不可变 Artifact、设备状态和审计记录。
- **Web Console**：管理 Workspace、成员、Registry、Manifest、策略、设备和 Drift。

当前 CLI 已支持 Codex、Claude Code、Cursor、Windsurf、Gemini CLI、GitHub Copilot、Cline 和 Grok Build。每个 target 会把同一份 Manifest 编译为对应的 Rules、Skills 和 MCP 配置格式；不复制登录会话、API Key 或缓存。

## 2. 核心概念

### 本地 Manifest

项目根目录的 `agentx.yaml` 描述本地环境：

```yaml
version: 1
skills:
  - name: review
    source:
      type: local
      path: skills/review
    targets: [codex, claude, grok]
rules:
  - source: rules/team.md
    targets: [codex, claude]
mcp:
  - name: docs
    command: npx
    args: ["-y", "@example/docs-mcp"]
    targets: [codex]
```

`skills` 可以来自本地目录或必须固定 `ref` 的 Git 源。`rules` 和 `mcp` 会按 target 生成对应 Agent 的文件：Cursor 使用 `.cursor/rules/*.mdc` 与 `.cursor/mcp.json`，Windsurf 使用 `.windsurf/rules`、`.windsurf/skills` 与用户级 `~/.codeium/windsurf/mcp_config.json`，Gemini CLI 使用 `GEMINI.md`、`.gemini/skills` 与 `.gemini/settings.json`，Copilot 使用 `.github/copilot-instructions.md`，Cline 使用 `.clinerules`、`.cline/skills` 与用户级 `~/.cline/mcp.json`，Grok Build 使用项目级 `.grok/rules/*.md`、`.grok/skills/<name>/SKILL.md` 与 `.grok/config.toml` 中的 `[mcp_servers.<name>]`。这些路径遵循各 Agent 的官方发现规则。

### Lockfile

版本 2 的 `agentx.lock` 记录 Skill 来源、请求的 Git ref、解析后的 Git revision、带长度边界的目录 SHA-256、Rule 哈希和 MCP 声明。使用 `--frozen` 安装时，任一受管输入变化都会被拒绝。安装前会验证全部路径和内容、列出目标路径与 MCP 命令、暂存并复核全部 Skill；同一份回滚 journal 覆盖 Skills、Rules、MCP 和 lockfile。

### Workspace Manifest

团队 Workspace 的 Manifest 是服务器端的期望状态。它可以包含带版本和 SHA-256 的包：

```json
{
  "version": 1,
  "packages": [
    {
      "name": "review-skill",
      "version": "1.2.3",
      "sha256": "<artifact-sha256>"
    }
  ]
}
```

本地 CLI 用独立的 `agentx.team.yaml` 和 `team pull`/`team push` 同步这个严格文档；本地来源配置 `agentx.yaml` 不会被误传。包名必须唯一，版本必须是 SemVer，SHA-256 必须是 64 位小写十六进制，并且每项必须对应同一 Workspace 中可下载且摘要一致的 Release。设备 Agent 用它生成安装、更新和删除计划；已保存的空包列表表示明确的空期望状态。

### Device、Drift 和 Reconcile

- **Device**：Workspace 中注册的一台开发机或构建机。
- **Heartbeat**：设备上报当前 Agent 和已安装包的摘要。
- **Drift**：设备实际摘要与 Workspace Manifest 不一致的 `missing`、`changed` 或 `extra` 项目。
- **Reconcile plan**：服务端根据期望状态和设备状态生成确定排序的 `install`、`update`、`remove` 动作。

## 3. 安装和首次使用

### 构建 CLI

要求 Rust 和 Cargo：

```bash
cargo build --release --manifest-path ../agentx-cli/Cargo.toml
../agentx-cli/target/release/agentx --help
```

开发阶段也可以直接使用：

```bash
cargo run --manifest-path ../agentx-cli/Cargo.toml -- --help
```

### 初始化项目

```bash
mkdir my-agent-project
cd my-agent-project
agentx init
```

`agentx init` 会创建一个空的 `agentx.yaml`。编辑它，加入需要的 Skills、Rules 和 MCP 服务。

### 检查环境并安装

```bash
agentx doctor
agentx lock
agentx install --yes --frozen
agentx diff
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `agentx doctor` | 检查支持的 Agent 命令或配置目录 |
| `agentx lock` | 根据当前来源生成或更新 `agentx.lock` |
| `agentx install` | 安装 Skills、Rules 和 MCP 配置 |
| `agentx diff` | 比较期望内容与本机安装内容 |
| `agentx rollback` | 恢复最近一次安装留下的备份 |

默认安装前会询问确认。自动化环境使用 `--yes`，发布或 CI 环境建议同时使用 `--frozen`。

### 为不同 Agent 安装

Manifest 中的 `targets` 控制单个 Skill、Rule 或 MCP 是否安装到某个 Agent。命令行的 `--target` 选择本次安装目标；省略时保持向后兼容，只安装 Codex 和 Claude Code：

```bash
agentx install --target cursor --yes --frozen
agentx install --target windsurf --yes --frozen
agentx install --target gemini --yes --frozen
agentx install --target copilot --yes --frozen
agentx install --target cline --yes --frozen
agentx install --target grok --yes --frozen
```

## 4. 团队 Registry 使用

### 启动本地服务

最简单的单机模式使用文件存储：

```bash
cd server
AGENTX_DATA_DIR=../data go run ./cmd/app
```

服务默认监听 `http://localhost:8080`。

健康检查：

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

### 登录 Registry

单机 API Token 模式：

```bash
agentx registry login http://localhost:8080 --token "$AGENTX_TOKEN"
```

Hosted 人员登录使用 OAuth 2.0 Device Authorization Grant：

```bash
agentx registry login https://registry.example.com --oidc
agentx registry workspaces
agentx registry use "$AGENTX_WORKSPACE_ID"
agentx registry logout
```

CLI 通过 Registry 的公开 `/v1/auth/config` 获取 issuer、public client ID、audience 和 scope；端点不会返回 client secret。登录保存 access/refresh token 并在到期前自动刷新。CI 等受控自动化应通过 `--token-stdin` 或 `AGENTX_TOKEN` 提供 token；`--token` 可能出现在进程参数中。

除 loopback 本地开发外，Registry URL、OIDC issuer 和 provider endpoint 必须使用 HTTPS，且不能包含内嵌凭据、query 或 fragment。CLI 禁止 HTTP 跳转，拒绝 discovery issuer 不匹配，限制 JSON、错误、Artifact、cursor、页数和凭据大小；请求或文件变更前会校验 token、Workspace/设备 ID、包名和 SemVer，下载内容会在写入前核对 SHA-256。凭据以原子方式保存在用户配置目录，Unix 权限为 `0600`，不会写入项目 Manifest，也不会上传到服务器。

### 发布和拉取包

发布不可变版本：

```bash
agentx registry publish review-skill 1.2.3 ./review-skill
```

启用签名策略后必须提供 Ed25519 签名：

```bash
agentx registry publish review-skill 1.2.3 ./review-skill.tar \
  --signature "$SIGNATURE"
```

拉取并校验 SHA-256：

```bash
agentx registry pull review-skill 1.2.3 \
  --output ./downloads/review-skill.tar
```

目录会被打包为确定性 gzip tar；传入文件时必须是合法 Skill archive。Hosted Registry 会拒绝同一包的重复版本，Artifact 使用内容寻址并保持不可变。archive 必须在根目录包含 `SKILL.md`，且不能包含路径逃逸、重复条目、链接、设备文件、可执行文件、凭据文件或超限内容。

### 同步团队 Manifest

拉取 Workspace 当前 Manifest：

```bash
agentx team pull --output agentx.team.yaml
```

将本地修改提交到 Workspace：

```bash
agentx team push --input agentx.team.yaml
```

只有具有管理员权限的成员可以更新团队 Manifest。每次更新都会生成新的 revision，并写入审计和 outbox 事件。

## 5. 设备注册和自动修复

### 注册设备

可以通过 Web Console 注册，也可以调用 API：

```bash
curl -X POST "$AGENTX_API/v1/workspaces/$AGENTX_WORKSPACE_ID/devices" \
  -H "Authorization: Bearer $AGENTX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"laptop-2","agent":"agentx"}'
```

省略 `id` 时服务端会生成 UUID；也可显式使用 `laptop-2` 等稳定 ID。设备 ID 在 Workspace 内唯一，相同 ID 可以安全地存在于不同 Workspace。

### 查看修复计划

```bash
agentx agent plan --device "$AGENTX_DEVICE_ID"
```

计划会列出：

- `install`：设备缺少期望包。
- `update`：设备摘要与期望 SHA-256 不同。
- `remove`：设备安装了 Manifest 中不存在的包。

### 执行同步

```bash
agentx agent sync --device "$AGENTX_DEVICE_ID"
```

同步过程会：

1. 从 Workspace 获取当前修复计划。
2. 从 Registry 下载需要的 Artifact。
3. 重新计算 SHA-256，校验失败时停止，不写入状态。
4. 安全解包所有 Artifact；任一预检失败时不修改 Agent 目录。
5. 将 Artifact 保存到 `.agentx/devices/<device-id>/artifacts/`，并在目标目录同一文件系统保存上一代备份。
6. 原子替换 `--target` 对应的真实 Skill 目录并保存设备状态。
7. 通过 heartbeat 上报已安装包摘要。

同步完成后，可以通过 Drift 页面或 API 确认 Drift 数量归零。

### 回滚

```bash
agentx agent rollback --device "$AGENTX_DEVICE_ID"
```

回滚恢复上一次同步前的设备状态，并立即发送 heartbeat。回滚不会删除服务器上的不可变 Artifact。

## 6. Web Console

启动前端开发服务器：

```bash
cd web
npm ci
npm run dev
```

默认地址是 `http://localhost:5173`。可以通过环境变量配置 API：

```bash
VITE_API_URL=http://localhost:8080 npm run dev
```

Hosted 控制台使用 `oidc-client-ts` 完成 Authorization Code + PKCE 登录，并以 OAuth access token 而不是 ID token 调用 API。`VITE_DEPLOYMENT_MODE` 为显式模式：production 默认 `hosted`、development 默认 `local`，hosted Docker 构建必须同时提供 OIDC issuer 与 client ID；hosted 运行配置不完整时只显示持久配置错误，不发 API 请求、不暴露本地 token 控件并隐藏业务导航。OIDC state、用户信息和 token 仅存放在当前标签页的 `sessionStorage`；客户端启用自动 silent renew，并在 API 返回 401 时最多续期重试一次。OIDC 模式不显示手工 Token 输入，也不接受编译期 API Token。控制台会遍历每个 collection 的全部 cursor，通过 `/v1/me` 和 membership 推导当前角色，只显示该角色允许的操作，并按 Release 状态显示审批或下载。生产镜像以非 root Nginx 提供 SPA，通过同源 `/v1` 反向代理 API，并设置浏览器安全响应头。

控制台主要页面：

- **Overview**：查看设备、已安装包和 Drift。
- **Registry**：发布 Artifact、查看版本、下载或审批发布。
- **Workspace**：创建 Workspace、向 email 发出带角色和期限的邀请、查看/撤销邀请、领取与已验证 OIDC email 匹配的邀请，以及调整成员角色。
- **Manifest**：编辑团队期望环境。
- **Policy**：设置签名和审批策略。
- **Audit**：查看成员、发布、Manifest、设备和策略变更。

## 7. 权限和策略

Workspace 角色从低到高为 `viewer`、`developer`、`admin`、`owner`。

- `viewer`：读取 Workspace、包、设备、Drift 和审计数据。
- `developer`：注册设备、发送 heartbeat、发布包。
- `admin`：修改 Manifest、策略、成员和审批发布。
- `owner`：管理 Workspace 生命周期和所有者级操作。

服务端使用表驱动 HTTP 测试验证四种角色在成员、包、发布、下载、审批、设备、heartbeat、Drift、Audit、Policy、Manifest、Reconcile 和 Workspace 删除等 20 项操作上的权限边界。

策略示例：

```json
{
  "require_signature": true,
  "require_approval": true
}
```

- `require_signature`：要求发布请求带签名，并要求服务端配置公钥验证器。
- `require_approval`：新发布进入 `pending_approval`，审批前不能下载或安装。

策略只接受上述两个布尔字段；未配置签名验证器时不能启用 `require_signature`。只有 `pending_approval` 可以转为 `approved`，重复审批或审批已公开版本会返回稳定冲突，且不会重复写入 Audit/outbox。

## 8. Hosted 部署

### PostgreSQL、MinIO 和 OIDC staging

仓库提供可复现的 staging 拓扑：

```bash
docker compose -p agentx-staging -f docker-compose.staging.yml up -d --build
```

它包含 PostgreSQL、MinIO、Dex OIDC、迁移任务、API 和 Web Console。验证流程：

```bash
AGENTX_TOKEN=... \
AGENTX_WORKSPACE_ID=... \
make staging-acceptance
```

该门禁先构建 CLI，再运行 API/S3 发布下载、token stdin 登录、独立设备 plan/sync/rollback/Drift/再次收敛，以及真实 Dex Web PKCE 和 CLI Device Flow。所有 staging Compose 操作必须保留 `-p agentx-staging`，避免切换到另一组 volume。

数据库迁移使用 Goose 版本表和 PostgreSQL session advisory lock；默认命令是 `up`，也支持 `status` 和 `version`。单步回滚必须先验证备份，再显式允许：

```bash
cd server
AGENTX_DATABASE_URL=... go run ./cmd/migrate up
AGENTX_DATABASE_URL=... go run ./cmd/migrate status
AGENTX_ALLOW_MIGRATION_DOWN=true AGENTX_DATABASE_URL=... go run ./cmd/migrate down
```

备份和恢复 PostgreSQL：

```bash
export AGENTX_DATABASE_URL='postgres://agentx:agentx-staging@localhost:5433/agentx'
./scripts/backup-restore.sh backup
AGENTX_COMPOSE_PROJECT=agentx-staging ./scripts/staging-backup-restore-drill.sh
```

恢复演练只写入名称带 `agentx_restore_drill_` 前缀的临时数据库并在核对后删除，不覆盖 staging 源数据库。`backup-restore.sh restore` 是面向已明确指定目标的破坏性恢复操作，不应用于日常验收。

验证 OIDC JWKS 轮换：

```bash
./scripts/staging-key-rotation.sh
```

生产部署必须替换示例密码、OIDC 客户端和 MinIO 凭据，并将 secret 放入密钥管理系统，不要提交到 Git。Hosted 默认拒绝 API token/HMAC 与 OIDC 并存，并要求 PostgreSQL TLS、HTTPS OIDC/Console origin 和安全 S3 传输；staging 的 bootstrap 与非安全传输分别必须显式设置 `AGENTX_ALLOW_HOSTED_BOOTSTRAP_AUTH=true` 和 `AGENTX_ALLOW_INSECURE_HOSTED=true`，生产不得启用。

### 重要环境变量

| 变量 | 作用 |
| --- | --- |
| `AGENTX_DEPLOYMENT_MODE` | `local` 或 `hosted`；生产环境必须显式使用 `hosted` |
| `AGENTX_DATABASE_URL` | PostgreSQL 连接串；hosted 模式必填 |
| `AGENTX_ARTIFACT_STORE` | `file` 或 `s3` |
| `AGENTX_S3_ENDPOINT` | S3/MinIO 地址 |
| `AGENTX_S3_ACCESS_KEY` / `AGENTX_S3_SECRET_KEY` | 对象存储凭据 |
| `AGENTX_OIDC_ISSUER` | OIDC issuer，启用 discovery 和 JWKS 验证 |
| `AGENTX_OIDC_BACKCHANNEL_URL` | 可选的内部 HTTPS discovery/JWKS 地址；令牌仍严格校验公开 issuer；明文仅限显式 insecure staging |
| `AGENTX_OIDC_CLI_CLIENT_ID` / `AGENTX_OIDC_CLI_SCOPE` | Hosted CLI Device Flow 的 public client 与 scope；hosted 必填 |
| `AGENTX_ARTIFACT_PUBLIC_KEY` | 兼容旧部署的单个 Ed25519 Artifact 公钥 |
| `AGENTX_ARTIFACT_PUBLIC_KEYS` | 逗号分隔的当前和上一把 Ed25519 公钥，用于无中断轮换 |
| `AGENTX_RATE_LIMIT_PER_MINUTE` | 单 IP 每分钟请求上限；PostgreSQL hosted 实例共享配额 |
| `AGENTX_API_TOKEN` | 本地单节点 Token；hosted 默认拒绝 |
| `AGENTX_ALLOW_HOSTED_BOOTSTRAP_AUTH` | 仅隔离 staging 使用的显式 API token/HMAC 回退开关；生产禁止启用 |
| `AGENTX_ALLOW_INSECURE_HOSTED` | 仅隔离 staging 使用的明文传输开关；生产禁止启用 |
| `AGENTX_ALLOWED_ORIGINS` | 逗号分隔的 Web Console 来源；hosted 模式必填且禁止 `*` |
| `AGENTX_TRUSTED_PROXIES` | 逗号分隔的可信反向代理 IP/CIDR；未设置时不信任代理头 |
| `AGENTX_ALLOW_LEGACY_UNSCOPED` | 本地兼容开关；hosted 模式禁止启用 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | 可选 OTLP/HTTP collector；均为空时 tracing 关闭 |
| `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES` | 标准 OpenTelemetry 资源标识覆盖 |
| `VITE_DEPLOYMENT_MODE` | Web 的 `local` 或 `hosted` 模式；生产镜像必须使用 `hosted` |
| `VITE_OIDC_ISSUER` / `VITE_OIDC_CLIENT_ID` | Hosted Web 构建必填；缺失时构建失败，运行时失败关闭 |

### 可观测性

- `/healthz`：进程存活检查。
- `/readyz`：数据库和 Artifact Store 可用性检查。
- `/metrics`：请求总数、失败数、in-flight、Artifact 上传失败、Drift 报告，以及 worker cycle、handler、retry、dead-letter 和 repository failure 计数。
- HTTP JSON 日志包含 request ID、actor、workspace、模板路由、方法、状态码和耗时。
- 设置 OTLP endpoint 后导出 HTTP、PostgreSQL、Registry prepare 和 Artifact Store span；未设置时不连接 collector。内部依赖错误只写入带 request ID 的日志，对外返回稳定的非敏感错误 envelope。
- outbox 成功交付会写结构化日志；worker 不再忽略 claim/ack 错误，超过最大重试次数后进入 dead-letter 并保留最后错误。Kubernetes 基线对重复 worker cycle failure 和任意新增 dead-letter 告警。
- Workspace、成员、Policy、Manifest、Device 和 Approval 的领域记录、Audit 与 outbox 在 PostgreSQL 中共享同一事务；任一写入失败都会整体回滚。
- Hosted collection 在 PostgreSQL 中执行 cursor/limit 分页；限流窗口也存放在 PostgreSQL，因此多个 API 副本共享同一配额。限流存储故障时业务路由返回 503，健康和指标端点保持可用。
- file/PostgreSQL repository 统一使用 typed sentinel 表达业务错误：重复 Workspace slug、membership、release version 与不兼容的幂等键复用返回稳定 400，缺失的审批目标返回 404；未知 repository 故障仍返回不泄漏内部原因的 500。

## 9. API 快速参考

所有业务 API 在启用认证时需要：

```http
Authorization: Bearer <token>
```

常用接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/readyz` | readiness 检查 |
| `GET` | `/v1/workspaces` | 查看当前用户的 Workspace |
| `GET/PUT` | `/v1/workspaces/:id/manifest` | 读取或更新团队 Manifest |
| `GET/POST` | `/v1/workspaces/:id/packages/:name/releases` | 发布包或查看版本 |
| `GET` | `/v1/workspaces/:id/devices` | 查看设备 |
| `POST` | `/v1/workspaces/:id/devices/:device_id/heartbeat` | 上报设备状态 |
| `GET` | `/v1/workspaces/:id/devices/:device_id/plan` | 获取修复计划 |
| `GET` | `/v1/workspaces/:id/drift` | 查看 Drift |
| `GET` | `/v1/workspaces/:id/audit-events` | 查看审计事件 |

集合接口默认返回：

```json
{
  "items": [],
  "count": 0,
  "next_cursor": ""
}
```

支持 `limit` 和 `cursor` 分页。

## 10. 安全使用建议

- 不要把 Token、OIDC refresh token 或云存储密钥放进 `agentx.yaml`。
- 发布前检查 Artifact 内容和 SHA-256；启用签名策略后再配置服务端公钥。
- 不要把不可信 MCP 命令直接加入团队 Manifest。MCP 命令会在设备上执行。
- 只使用固定 Git ref，并提交 `agentx.lock`。
- 生产环境使用 HTTPS、OIDC 和最小 Workspace 权限。
- 定期执行 PostgreSQL 备份恢复演练，并监控 `/readyz`、`/metrics` 和 dead-letter 事件。

## 11. 常见问题

### `agentx team pull` 提示没有 Workspace

重新登录并指定 Workspace：

```bash
agentx registry login "$AGENTX_API" \
  --token "$AGENTX_TOKEN" \
  --workspace "$AGENTX_WORKSPACE_ID"
```

### 发布后无法下载

先查看发布状态。如果策略开启 `require_approval`，需要管理员调用控制台的审批操作，或调用：

```http
POST /v1/workspaces/:id/packages/:name/:version/approve
```

### Drift 没有归零

依次检查：

1. Manifest 中的 `sha256` 是否对应 Registry 中实际 Artifact。
2. 设备是否使用正确的 `--device` ID。
3. 是否执行了 `agentx agent sync` 并成功发送 heartbeat。
4. API 是否能从 `/readyz` 通过 Artifact Store 检查。

### `--frozen` 安装失败

说明来源内容和 `agentx.lock` 不一致。确认修改是有意的，然后运行：

```bash
agentx lock
agentx install --yes --frozen
```

### 如何判断服务是否适合上线

至少完成一次 staging 验收、Artifact 下载校验、备份恢复、OIDC JWKS 轮换和第二台设备同步回滚演练。当前实现已验证基于显式 `email_verified: true` OIDC claim 的 invitation/list/claim、账户导出/删除、平台级 legal hold、审计保留 worker，以及 Workspace 删除后的 S3 最后引用清理；相关领域/audit/outbox 写入保持事务原子性。Hosted 要求显式配置 compliance administrator 的不可变 OIDC principal ID 和正数保留天数，Workspace owner 不能管理 hold。公开注册仍须由所有者批准实际保留/删除期限、提供云端备份到期证据，并提供真实 Privacy、Terms、subprocessor 清单以及 staffed support/abuse/security 联系方式。Hosted 配置缺少这些法律/联系值时会拒绝启动，但仓库中的占位值不构成发布内容。
