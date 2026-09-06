# AgentX 产品文档

## 1. 产品概述

AgentX 用一份声明式配置管理 AI Agent 的工作环境。它把 Skills、Rules、MCP 服务、版本和团队策略集中描述，再生成 Codex、Claude Code 等 Agent 可以直接使用的本地配置。

AgentX 解决的是“换一台机器后，如何恢复同一套 Agent 环境”，而不是实时同步个人目录。它不会复制 API Key、登录会话、凭据、历史记录或缓存。

产品包含三部分：

- **CLI**：在开发者机器上初始化、安装、比较、锁定、同步和回滚环境。
- **Registry API**：保存团队 Workspace、成员、Manifest、不可变 Artifact、设备状态和审计记录。
- **Web Console**：管理 Workspace、成员、Registry、Manifest、策略、设备和 Drift。

当前优先支持 Codex 和 Claude Code。Cursor、Copilot 等适配器不属于当前稳定能力范围。

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
    targets: [codex, claude]
rules:
  - source: rules/team.md
    targets: [codex, claude]
mcp:
  - name: docs
    command: npx
    args: ["-y", "@example/docs-mcp"]
    targets: [codex]
```

`skills` 可以来自本地目录或固定 Git ref。`rules` 会生成 `AGENTS.md` 或 `CLAUDE.md`，`mcp` 会写入对应 Agent 的 MCP 配置。

### Lockfile

`agentx.lock` 记录 Skill 来源和内容 SHA-256。使用 `--frozen` 安装时，来源内容变化会被拒绝，保证不同机器安装同一份内容。

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

本地 CLI 用 `team pull` 和 `team push` 同步这个文档；设备 Agent 用它生成安装、更新和删除计划。

### Device、Drift 和 Reconcile

- **Device**：Workspace 中注册的一台开发机或构建机。
- **Heartbeat**：设备上报当前 Agent 和已安装包的摘要。
- **Drift**：设备实际摘要与 Workspace Manifest 不一致的项目。
- **Reconcile plan**：服务端根据期望状态和设备状态生成的 `install`、`update`、`remove` 动作。

## 3. 安装和首次使用

### 构建 CLI

要求 Rust 和 Cargo：

```bash
cargo build --release --manifest-path cli/Cargo.toml
./cli/target/release/agentx --help
```

开发阶段也可以直接使用：

```bash
cargo run --manifest-path cli/Cargo.toml -- --help
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
| `agentx doctor` | 检查 Codex、Claude Code 和本地目录 |
| `agentx lock` | 根据当前来源生成或更新 `agentx.lock` |
| `agentx install` | 安装 Skills、Rules 和 MCP 配置 |
| `agentx diff` | 比较期望内容与本机安装内容 |
| `agentx rollback` | 恢复最近一次安装留下的备份 |

默认安装前会询问确认。自动化环境使用 `--yes`，发布或 CI 环境建议同时使用 `--frozen`。

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

Workspace 模式必须保存 Workspace ID：

```bash
agentx registry login https://registry.example.com \
  --token "$AGENTX_TOKEN" \
  --workspace "$AGENTX_WORKSPACE_ID"
```

凭据保存在用户配置目录，不会写入项目 Manifest，也不会上传到服务器。

### 发布和拉取包

发布不可变版本：

```bash
agentx registry publish review-skill 1.2.3 ./review-skill.tar
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

Registry 会拒绝同一包的重复版本，Artifact 使用内容寻址并保持不可变。

### 同步团队 Manifest

拉取 Workspace 当前 Manifest：

```bash
agentx team pull --output agentx.yaml
```

将本地修改提交到 Workspace：

```bash
agentx team push --input agentx.yaml
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

生产环境建议由服务端返回的 UUID 作为 `--device` 参数，而不是手工命名设备 ID。

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
4. 将 Artifact 保存到 `.agentx/devices/<device-id>/artifacts/`。
5. 保存上一份设备状态。
6. 通过 heartbeat 上报已安装包摘要。

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

控制台主要页面：

- **Overview**：查看设备、已安装包和 Drift。
- **Registry**：发布 Artifact、查看版本、下载或审批发布。
- **Workspace**：创建 Workspace、邀请成员、调整角色。
- **Manifest**：编辑团队期望环境。
- **Policy**：设置签名和审批策略。
- **Audit**：查看成员、发布、Manifest、设备和策略变更。

## 7. 权限和策略

Workspace 角色从低到高为 `viewer`、`developer`、`admin`、`owner`。

- `viewer`：读取 Workspace、包、设备、Drift 和审计数据。
- `developer`：注册设备、发送 heartbeat、发布包。
- `admin`：修改 Manifest、策略、成员和审批发布。
- `owner`：管理 Workspace 生命周期和所有者级操作。

策略示例：

```json
{
  "require_signature": true,
  "require_approval": true
}
```

- `require_signature`：要求发布请求带签名，并要求服务端配置公钥验证器。
- `require_approval`：新发布进入 `pending_approval`，审批前不能下载或安装。

## 8. Hosted 部署

### PostgreSQL、MinIO 和 OIDC staging

仓库提供可复现的 staging 拓扑：

```bash
docker compose -f docker-compose.staging.yml up -d --build
```

它包含 PostgreSQL、MinIO、Dex OIDC、迁移任务、API 和 Web Console。验证流程：

```bash
AGENTX_TOKEN=... \
AGENTX_WORKSPACE_ID=... \
./scripts/staging-acceptance.sh
```

备份和恢复 PostgreSQL：

```bash
export AGENTX_DATABASE_URL='postgres://agentx:agentx-staging@localhost:5433/agentx'
./scripts/backup-restore.sh backup
./scripts/backup-restore.sh restore
```

验证 OIDC JWKS 轮换：

```bash
./scripts/staging-key-rotation.sh
```

生产部署必须替换示例密码、API Token、OIDC 客户端密钥和 MinIO 凭据，并将它们放入密钥管理系统，不要提交到 Git。

### 重要环境变量

| 变量 | 作用 |
| --- | --- |
| `AGENTX_DATABASE_URL` | PostgreSQL 连接串；设置后进入 hosted 模式 |
| `AGENTX_ARTIFACT_STORE` | `file` 或 `s3` |
| `AGENTX_S3_ENDPOINT` | S3/MinIO 地址 |
| `AGENTX_S3_ACCESS_KEY` / `AGENTX_S3_SECRET_KEY` | 对象存储凭据 |
| `AGENTX_OIDC_ISSUER` | OIDC issuer，启用 discovery 和 JWKS 验证 |
| `AGENTX_ARTIFACT_PUBLIC_KEY` | Ed25519 Artifact 公钥 |
| `AGENTX_RATE_LIMIT_PER_MINUTE` | 单 IP 每分钟请求上限 |
| `AGENTX_API_TOKEN` | 单节点或 staging bootstrap Token |

### 可观测性

- `/healthz`：进程存活检查。
- `/readyz`：数据库和 Artifact Store 可用性检查。
- `/metrics`：请求总数、失败数和 in-flight 请求数。
- HTTP 日志包含 request ID、方法、路径、状态码和耗时。
- outbox 超过最大重试次数后进入 dead-letter，并保留最后错误。

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

至少完成一次 staging 验收、Artifact 下载校验、备份恢复、OIDC JWKS 轮换和第二台设备同步回滚演练，再根据真实试用反馈决定计费、通知和新的 Agent adapter。

