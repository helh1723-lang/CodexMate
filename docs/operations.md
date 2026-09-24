# 运维

安装、升级、诊断与故障处置。所有命令都可以加 `--home <path>` 指定本机状态目录（默认 `~/.codexmate`），便于演练与隔离。

---

## 1. 安装与前置条件

```bash
npm ci
npm run build        # tsc → dist/ ，vite → web-dist/
```

或作为依赖安装后使用 `npx codexmate <command>`。要求 Node ≥ 22.13（内建 `node:sqlite`）、Git、GitHub CLI、Codex CLI。

**运行时会出现 `ExperimentalWarning: SQLite is an experimental feature`** —— 这是 Node 对内建 SQLite 的提示，属预期行为。

### 前置授权

```bash
gh auth login        # 需要 repo 权限范围
codex login          # API Key 或 ChatGPT 登录均可
```

---

## 2. 首次接入检查清单

```bash
npx codexmate doctor
```

逐项确认：Node / Git / `gh` / Codex CLI 可用、`gh` 身份正确、Codex 已登录。输出的 `device` 就是后面要填进仓库配置的活跃设备 ID。

> `doctor` 会提示认证模式：若检测到 `CODEX_API_KEY` / `OPENAI_API_KEY` 环境变量，会明确标注「独立计费」；未检测到则提示「以 Codex 登录状态为准」。**剩余额度始终显示「未知」**，产品不会估算。

### Owner 初始化仓库

```bash
npx codexmate init /path/to/repo     # 需交互确认
```

生成 `.codexmate/config.yml`、`.github/ISSUE_TEMPLATE/codexmate_task.yml`、`.gitignore` 片段与 `cm:*` 标签。**必须审查并提交到默认分支**后才对协作者生效；提交前 Worker 身份保持禁用。

### 协作者加入

```bash
npx codexmate join /path/to/repo
```

核验 `gh` 身份与绑定账号一致、`origin` 与仓库一致、默认分支配置可读、角色合法。

### 把设备 ID 填进公共配置

```yaml
workers:
  <你的 login>: <codexmate doctor 输出的 device>
```

同步后本机才会被认定为活跃 Worker。未指定时任何写操作都会报 `INACTIVE_DEVICE`。

---

## 3. 日常运行

| 方式 | 命令 | 说明 |
|---|---|---|
| 面板 | `npx codexmate ui` | `http://127.0.0.1:4317`，只监听本机 |
| 前台 Worker | `npx codexmate start` | 轮询 + 通知；**默认不自动执行** |
| 单次轮询 | `npx codexmate start --once` | 适合放进系统任务计划 |
| MCP | `npx codexmate mcp` | stdio，供你自己的 Codex 读取状态 |
| 演练 | `npx codexmate demo` | 独立数据库，不碰 GitHub |

不建议把 `start` 常驻在无人值守的环境里开启自动推送。若确实需要，请先把「自动执行」与「自动推送」分开评估。

---

## 4. 备份与恢复

本机全部状态在 `--home` 目录下：

```
~/.codexmate/
  codexmate.db  (+ .db-wal / .db-shm)   ← 状态、审计、锁、租约
  codexmate.db.backup                    ← schema 升级前的自动备份
  logs/<runId>.jsonl                     ← 每次运行的逐事件日志
  worktrees/<repoId>/<runId>/            ← 任务工作树
  updates/<version>/                     ← 已校验的更新包
```

**备份**：停掉 `ui` / `start` 后复制整个目录（WAL 模式下不要只拷 `.db` 而不拷 `.db-wal`）。

**恢复**：把目录放回原位再启动。启动时会执行 `recover`：逐个检查写锁持有进程是否还活着（`process.kill(pid, 0)`），已退出的进程对应的 `running` 运行会被置为 `paused` 并提示「需核对远端与工作树后手动恢复」，锁被释放。

```bash
npx codexmate recover     # 也可以手动触发
```

---

## 5. 升级与回滚

### 5.1 受签名的升级路径

```bash
# 发布方（离线保存私钥）
npx codexmate release sign codexmate-1.1.0.tgz \
  --release-version 1.1.0 --private-key priv.pem --out manifest.json

# 使用方：体积 → SHA-256 → 签名 三重校验
npx codexmate release verify codexmate-1.1.0.tgz --manifest manifest.json --public-key pub.pem
npx codexmate release stage  codexmate-1.1.0.tgz --manifest manifest.json --public-key pub.pem
```

`stage` 只在**校验全部通过后**才把包复制到 `updates/<version>/`，并打印后续人工步骤：

> 停止 Worker 和 UI，备份 SQLite 后运行 `npm install -g <已验证包路径>`。旧包保留可回滚。

`release sign` 的 `--out` 使用 `wx` 标志：**已存在则拒绝覆盖**（避免误覆盖已知良好的清单），如需重签请先移除或换路径。

### 5.2 数据库 schema 升级

`PRAGMA user_version` 控制。启动时：

- 低版本 → `BEGIN IMMEDIATE` 内建表并升到 1；升级前会复制一份 `codexmate.db.backup`。
- **高版本 → 直接拒绝启动**（`SCHEMA_NEWER`），提示升级客户端，避免旧 Worker 按旧语义写入。

### 5.3 回滚

1. 停掉 Worker 与面板。
2. 装回旧包：`npm install -g <旧包路径>`。
3. 若 schema 已被升过，用 `codexmate.db.backup` 覆盖回滚（会丢失备份点之后的本机记录；GitHub 上的任务与代码不受影响）。

---

## 6. 诊断

| 手段 | 命令 / 端点 |
|---|---|
| 环境与认证 | `npx codexmate doctor` |
| 本机状态快照 | `npx codexmate status --json` |
| 进程存活 | `GET /health`（返回版本），`GET /ready`（实际执行一次 SQL） |
| 对账预览 | `npx codexmate sync --dry-run` |
| 运行日志 | `npx codexmate logs <issue>`（始终脱敏） |
| 中断运行 | `npx codexmate recover` |
| 审计流水 | 面板「最近动态」或 `npx codexmate export` |
| 协调器健康 | `GET /health` → `{ok:true, mode:"experimental-coordinator"}` |

---

## 7. 故障处置手册

### 7.1 GitHub 限流 / 5xx

**表现**：`GITHUB_ERROR HTTP 429` 或 `请求正在退避，请稍后同步`。

**机制**：收到 429 / 5xx / 403+rate limit 时，按 `Retry-After`（上限 1 小时）设置退避窗口；窗口内所有请求直接快速失败，不打 GitHub。GET 请求带 `If-None-Match`，304 复用缓存。

**处置**：等待窗口结束即可，无需干预。不要反复手动 `sync`。

### 7.2 断网

同步失败会在项目上记录 `error`，面板顶部显示「同步中断：当前显示缓存数据」，并产生一条 `sync-error` 通知。**不会伪造远端成功**，`lastSync` 保持原值。

恢复联网后执行 `npx codexmate sync`。若断网期间队友已推进任务，对账时会检测到 `revision` / `owner` / `updatedAt` 变化并阻止使用旧审批（`REMOTE_CHANGED`）。

### 7.3 Worker 进程崩溃

- 本机写锁以 `pid` 记录持有者；重启时的 `recover` 会识别已退出进程，把对应 `running` 运行置为 `paused` 并释放锁。
- **已经创建过 PR 的情况不会重复建**：草稿 PR 创建前会查询同分支的 open PR，命中即复用（`draft()` 幂等）。
- 工作树与日志保留，供人工检查。

### 7.4 出现「疑似双写」

1. 立即停止两端的自动执行开关。
2. `npx codexmate status --json` 查看本机 Run 与锁；检查远端该任务分支的提交历史。
3. 本项目默认模式不产生双写（明确 assignee + 本机写锁）。**协调模式未通过跨设备验证，客户端自动抢占保持禁用**——若你手动启用了协调器，先停掉它。
4. 冲突以人工核对为准，不要依赖工具自动裁决。

### 7.5 审查显示「已过期」

PR 的 head SHA 变了（有人推了新提交）。这是预期行为：过期审查不会被视为已通过。重新执行 `npx codexmate review <pr>`。

### 7.6 任务无法启动

按报错码排查：

| 码 | 含义 | 处理 |
|---|---|---|
| `TASK_OWNER` | 任务未指派给你 / 状态不一致 / Issue 已关闭 | 让维护者重新分配或检查结构化区块 |
| `DEPENDENCY_BLOCKED` | 前置 Issue 未关闭 | 先完成 `needs` 中的任务 |
| `DUPLICATE_RUN` | 该 revision 已运行过 | 用 `task resume`，或让维护者提升 revision |
| `INACTIVE_DEVICE` | 本机不是公共配置里的活跃设备 | 在 `workers` 中填入 `doctor` 输出的 device |
| `ROLE_CHANGED` | 远端角色变了 | 重新 `join`（连接）仓库 |
| `CONFIG_NEWER` / 只读 | 远端配置 schema 比客户端新 | 升级客户端 |
| `WORKER_BUSY` | 本机已有可写 Worker | 先暂停或 `recover` |
| `REMOTE_CHANGED` | 复核期间远端变化 | 重新 `sync` 并重新审批 |
| `SECRET_DETECTED` | 变更或历史含疑似凭据 | 人工清理后重试；不要绕过扫描 |

### 7.7 显示「额度未知」

这是**设计行为**。产品只展示官方或进程实际暴露的用量，不估算剩余额度与重置时间。

---

## 8. 协调器部署（实验性）

仅组织级场景需要，且**必须**置于 TLS 反向代理之后。

```bash
cp templates/organization/coordinator.example.json coordinator.json
# 填入真实 tokenSha256（等于 SHA-256(Bearer token) 的 64 位十六进制）、worker 设备 ID、仓库白名单

npx codexmate coordinator --config coordinator.json --port 4320 --host 127.0.0.1
```

Docker Compose 示例见 `templates/organization/`（`read_only: true` + `tmpfs /tmp` + 卷持久化 `/data`）。

接口语义（`POST /v1/<action>`，`Authorization: Bearer <token>`）：

| action | 需要 fence | 说明 |
|---|---|---|
| `acquire` | 否 | 旧租约必须已 `stopped`，否则 409 |
| `renew` | 是 | 缺 fence → 403 |
| `validate` | 是 | 校验 holder + fence + 未停止 + 未过期 |
| `stop` | 是 | 只有当前 fence 能停止当前租约 |

状态码约定：`400` 请求体不合法 · `401` 身份无效 · `403` 超出仓库范围或缺少 fence · `409` 租约冲突或 fence 失效。

**租约过期不等于原 Worker 已停止。** 过期只是让 `validate` 失败；接管必须等到旧持有者显式 `stop`。这是为了防止网络分区后「旧 Worker 复活继续写」。

---

## 9. 数据保留与清理

```bash
npx codexmate prune      # 删除超过策略 retentionDays 的 Run 日志
```

保留：工作树、run/review/handoff 记录、审计流水。面板「工作区设置 → 数据与隐私」可导出匿名化报告。

**GitHub 上已发布的评论与 Issue 不会随本机清理而消失。**

---

## 10. 禁止事项

- 不要把演练 home（`.local/demo`）用于真实仓库。
- 不要提交数据库、认证文件或真实日志。
- 不要在未配置 `workers` 的情况下开启自动执行。
- 不要在协调器前省略 TLS。
- 不要为了「让它跑起来」而绕过密钥扫描或审批失败。
