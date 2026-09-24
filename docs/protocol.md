# 协议

本文描述 CodexMate 写在 GitHub 上的全部结构化数据，以及两端之间的约定。**这些协议属于 CodexMate 自己的设计**，不是已存在的平台接口。

设计原则：

- GitHub 是**低频异步事件总线与投影层**，不是聊天服务器；逐 token 日志永远只留本机。
- 所有结构化数据都嵌在人类可读正文之外的独立区块里，人类描述保持可读、可编辑。
- 任何来自远端的内容都是**数据**，不具备授权能力。
- 写入前一律脱敏扫描；命中疑似凭据即拒绝发布。

---

## 1. Issue 结构化区块（`codexmate.task/v1`）

人类描述写在上方，机器可读数据放在固定标记之间：

```markdown
<人类可读的任务描述，可自由编辑>

<!-- codexmate:task -->
```yaml
schema: codexmate.task/v1
issue: 42
revision: 3
state: ready
owner: user-b
reviewers: [user-a]
priority: medium
acceptance:
  - 登录成功返回约定会话信息
  - 非法凭据返回统一错误
needs: [39]
base_branch: main
paths: [src/auth, tests/auth]
risk: normal
```
<!-- /codexmate:task -->
```

字段约束（由 `taskSchema` 校验）：

| 字段 | 约束 |
|---|---|
| `schema` | 固定 `codexmate.task/v1` |
| `issue` | 正整数；**必须**等于 Issue 编号，否则解码直接报错 |
| `revision` | 正整数；每次受管变更 +1，是审批失效与幂等的基准 |
| `state` | `ready` / `needs_approval` / `running` / `review` / `blocked` / `handoff_pending` / `done` / `cancelled` |
| `owner` | 单个 login；空串表示未分配 |
| `acceptance` | 至少 1 条，每项 ≤ 3000 字符 |
| `needs` | 前置 Issue 编号数组 |
| `paths` | 声明变更范围；写入时用作白名单 |
| `risk` | `normal` / `high`；`high` 不参与自动执行 |
| `base_branch` | 默认 `main` |

编码时人类正文被保留（`encodeTask` 只替换标记区块），解码时 `body` 字段取回人类部分。

### 1.1 一致性校验（重要）

`decodeTask` 会把结构化记录与 GitHub 原生字段对照：

- `owner` 必须与 assignees **完全一致**（有 owner 时恰好 1 个 assignee；无 owner 时 0 个）。
- `state` 必须与唯一一个 `cm:*` 标签一致。

不一致时不报错，而是给任务打上 `warning`；**带 warning 的任务一律禁止启动执行**，需要在 UI 或 CLI 中先修复。这避免了「标签与正文谁说了算」的歧义。

### 1.2 标签只是投影

`cm:ready` `cm:running` `cm:review` `cm:blocked` `cm:handoff` `cm:needs_approval` `cm:done` `cm:cancelled` 仅用于 GitHub 侧筛选。**状态以结构化区块为准**；发现不一致时停止自动执行。

---

## 2. 交接载荷（`codexmate.handoff/v1`）

交接时在 Issue 评论里追加一条机器可读载荷：

```markdown
交接给 @user-a，检查点 3f2c…（40 位 SHA）。
<!-- codexmate-handoff-json:<base64(JSON)> -->
```

解码后的 JSON：

```json
{
  "schema": "codexmate.handoff/v1",
  "id": "uuid",
  "repoId": "…",
  "issue": 42,
  "revision": 3,
  "from": "user-b",
  "to": "user-a",
  "sha": "<40 位 commit SHA>",
  "branch": "cm/42/user-b-r3",
  "goal": "任务标题",
  "acceptance": ["…逐项验收条件…"],
  "remaining": ["剩余待办"],
  "risks": ["已知风险"],
  "checks": [{ "name": "npm test", "exitCode": 0, "output": "…截断 500 字符…" }],
  "needs": [39],
  "status": "pending",
  "createdAt": "2026-09-24T01:00:00.000Z"
}
```

### 接手前的全部校验（缺一不可）

接收方在同步时逐条核对，任一条不满足就**丢弃该载荷**（不报错、不入账、不可执行）：

| 校验 | 目的 |
|---|---|
| `schema === 'codexmate.handoff/v1'` | 版本匹配 |
| `repoId` 等于当前仓库 | 防跨仓重放 |
| `issue` 且 `revision` 等于当前任务 | 防接受旧交接 |
| `from` 等于任务当前 `owner` | 交接只能来自现任负责人 |
| 评论作者 `user.login === from` | 防第三方伪造交接 |
| `/^[a-f0-9]{40}$/` 匹配 `sha` | SHA 格式合法 |
| 该 `id` 未被记录过 | 幂等 |

接受时还会：重新拉取任务确认仍为 `handoff_pending` 且 owner / revision 未变 → `git fetch` 该分支并校验 `FETCH_HEAD === sha` → owner 改为接手者且 `revision+1` → **从精确 SHA 新开本机线程**。

原负责人侧：可写 Run 置 `frozen` 并保留只读历史，不会自动恢复。

---

## 3. 评论幂等 marker

所有自动评论都带一个 HTML 注释 marker；发表前先分页查找，命中即复用，不重复发表：

| 场景 | marker |
|---|---|
| 草稿 PR 通知 | `<!-- codexmate:publish:<issue>:<revision>:<sha> -->` |
| 交接 | `<!-- codexmate:handoff:<handoffId> -->`（载荷另有 base64 marker） |
| 审查发布 | `<!-- codexmate:review:<reviewId> -->` |
| PR 正文 | `<!-- codexmate:pr:<issue>:<revision> -->` |
| 规划生成的 Issue | `<!-- codexmate:plan:<planId>:<index> -->`（发布前先按 marker 查重） |

评审评论发布时会先列出该 PR 的全部 reviews，已含 marker 则跳过；`event` 固定为 `COMMENT`——**永不提交 `APPROVE`**，也不触发合并。

---

## 4. 事件与幂等键

`store.once(id)` 基于 `events` 表的 `INSERT OR IGNORE`：`changes > 0` 表示首次处理。

| 对象 | 幂等键 |
|---|---|
| 受管 Run | `repo + issue + revision + owner + device_id` |
| 草稿 PR | 查询 `state=open & head=<owner>:<branch> & base=<base>`，命中即复用（重启/崩溃后不会重复建 PR） |
| 审查结果 | `repo + pr + head_sha + reviewer + review_round` |
| 检查点 | `run_id + commit_sha` |
| 交接 | `repo + issue + revision + from + to + checkpoint_sha` |
| 通知 | `<repoId>:<事件键>`（如 `ready:<issue>:<revision>`），`put` 覆盖即去重 |

**刻意不做的**：不把 assignee 或评论当作原子锁。GitHub 的 Issue 写入不是事务，因此默认模式靠「明确 assignee + 只执行本人任务」避免双写，而不是声称拥有事务级 exactly-once。

---

## 5. 仓库公共配置（`codexmate.config/v1`）

```yaml
schema: codexmate.config/v1
repo:
  default_branch: main
members:
  - login: user-a
    role: owner        # owner | developer | reviewer | viewer
    paths: [src, docs] # 用于分配建议与冲突预警，不构成权限
workers:               # 活跃设备；来自 `codexmate doctor` 输出的 device ID
  user-a: <device-id>
execution:
  default_mode: approve-first
```

读取路径：`GET /repos/:owner/:repo/contents/.codexmate/config.yml?ref=<default_branch>`（base64 解码后按 YAML 解析，禁用别名展开）。

使用规则：

- **版本不兼容**（`schema` 不认识）→ 本机进入**只读降级**：可查看、不可写，并提示升级客户端。
- **每次写操作前复核**：远端角色必须与本机记录一致，否则 `ROLE_CHANGED`；写操作还要求本机 device 等于 `workers[<login>]`，否则 `INACTIVE_DEVICE`。
- 本机私有配置（自动执行、自动推送、可信检查、超时、日志保留）**不写入仓库**。

配置优先级（低优先级不能覆盖高优先级）：

```
不可突破的安全限制 > 本机审批/组织策略 > 仓库默认分支公共配置 > Issue 任务建议 > PR/评论文本
```

---

## 6. MCP 工具

stdio，仅绑定本机当前用户；不提供任何公网端口。

| 工具 | 作用 | 权限 |
|---|---|---|
| `cm_status` | 读取已绑定仓库与本机状态 | 只读 |
| `cm_list_tasks` | 读取已同步任务 | 只读 |
| `cm_task_context` | 读取任务、验收、依赖与本机运行 | 只读 |
| `cm_request_run` | 为一个已授权 Issue **提出**执行请求 | 仅创建审批 |
| `cm_request_review` | **提出** PR 只读审查请求 | 仅创建审批 |
| `cm_create_handoff` | **提出**交接请求 | 仅创建审批 |
| `cm_accept_handoff` | **提出**接受交接请求 | 仅创建审批 |

**MCP 没有批准工具。** 上述四个写请求都必须由用户在本机 CLI 或面板确认后才会执行；模型无法通过 MCP 绕过用户设置。工具返回结构化结果与 GitHub 链接；被阻止时返回明确原因。

---

## 7. 声明式适配器（`codexmate.adapter/v1`）

```json
{
  "schema": "codexmate.adapter/v1",
  "id": "ci-status",
  "name": "CI 状态读取",
  "kind": "ci",
  "url": "https://ci.example.com/api/status",
  "method": "GET",
  "description": "读取构建状态，只读。"
}
```

约束：

- `kind: ci` 只允许 `GET`；`kind: notification` 只允许 `POST`。
- URL 必须 `https:`，且**不能**带用户名/密码/查询串。
- 注册不授予调用权；`grant` 记录配置哈希，配置改动自动失效。
- 通知载荷只允许：`https://github.com/...` 链接 + ≤100 字符状态摘要，且摘要同样过密钥扫描。
- 适配器**不能**加载 JavaScript 或启动进程。

---

## 8. 发布清单（`codexmate.release/v1`）

```json
{
  "schema": "codexmate.release/v1",
  "version": "1.1.0",
  "file": "codexmate-1.1.0.tgz",
  "sha256": "<64 位十六进制>",
  "size": 152500,
  "signature": "<base64(Ed25519 对 {schema,version,file,sha256,size} 的签名)>"
}
```

校验顺序：**体积 → SHA-256 → 签名**，任一不符即拒绝；校验未通过的包**不落盘**。详见 `docs/operations.md`。
