# 架构

面向 `CodexMate_Full_PRD.md` 实现的工程说明。目标是让接手者能在不读完全部源码的情况下定位改动点。

## 1. 设计目标与硬约束

| 目标 | 架构上的体现 |
|---|---|
| 不新增云端依赖 | 两端都只主动出站访问同一个 GitHub 仓库；协调器是可选组件且默认不启用 |
| 本机优先 | 所有执行、日志、线程 ID、审批都在本机；GitHub 只承载低频任务投影 |
| 远端不可信 | 适配器与 `core` 之间只有结构化数据；远端正文永远不被当作指令 |
| 能力可替换 | 外部依赖（`gh`、Codex SDK、Git）都收在 `adapters/`，上层只依赖接口 |
| 不双写 | 本机写锁 + 明确 assignee + 可选 lease/fencing（三层，逐级加强） |

## 2. 分层与依赖方向

```
        ┌───────────┬──────────┬───────────┐
        │  cli/     │ server/  │  mcp/     │   ← 三个入口，行为必须一致
        │ (commander)│(express)│ (@mcp/sdk)│
        └─────┬─────┴────┬─────┴─────┬─────┘
              └──────────┼───────────┘
                         ▼
                    core/service.ts          ← 唯一的业务编排点
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   core/model.ts   core/security.ts   core/planning.ts
   core/state.ts   （状态机、schema、密钥扫描与脱敏、依赖图与冲突）
                         │
        ┌────────────────┼─────────────────┬──────────────┐
        ▼                ▼                 ▼              ▼
   store/index.ts   adapters/*        web/ (只读渲染)  operations/*
   （SQLite WAL）   github/git/codex                （适配器/发布签名）
```

**依赖规则（改动时必须遵守）**

- `core/` 不依赖 `cli/`、`server/`、`web/`、`mcp/`。业务逻辑不认识 UI。
- `adapters/` 之间互不调用；`github.ts` 不读 Codex 凭据，`codex.ts` 不碰 GitHub。
- `scheduler/` 不执行本机命令，只分配租约。
- 三个入口都通过 `Service` 的同一组方法，不允许绕过去直接写 store 或调适配器。

`Service` 的两个外部依赖可注入（便于测试与替换）：

```ts
new Service(store, runner = new CodexRunner(), github = slug => new GitHub(slug))
```

`GitHub` 的执行器同样可注入（`constructor(slug, run = exec)`），因此适配器的退避、条件请求、幂等分支可以在**不联网**的情况下测到真实代码路径。

## 3. 模块职责

| 模块 | 职责 | 关键文件 |
|---|---|---|
| `core/model.ts` | 所有 schema 与类型：Task / Run / Review / Handoff / Plan / Approval / Action / Policy；`AppError` 与 `assert` | 单一事实来源 |
| `core/state.ts` | Issue 状态机，禁止非法迁移 | 表驱动，`done` 必须由人类关闭 Issue 触发 |
| `core/security.ts` | 密钥扫描 / 脱敏 / 公开文本裁剪 / 错误分类 / 不可信提示词封装 | `redact`、`scanText`、`publicText`、`classifyError`、`untrustedPrompt` |
| `core/planning.ts` | 依赖环检测、阻塞判定、文件冲突预警、分配建议、质量统计 | 纯函数，无副作用 |
| `core/service.ts` | 编排：连接、初始化、同步、审批、执行、发布、审查、交接、规划、恢复、清理、tick | 唯一写入路径 |
| `store/index.ts` | SQLite（WAL）记录读写、事务、事件去重、审计、写锁 | `records`/`audit`/`locks`/`leases`/`events` |
| `adapters/process.ts` | 受控子进程执行（超时、输出上限、AbortSignal） | 所有外部命令的唯一出口 |
| `adapters/github.ts` | `gh` REST 封装：ETag 条件请求、分页、退避、Issue 编解码、幂等 PR / 评论 | 见 `docs/protocol.md` |
| `adapters/git.ts` | worktree 生命周期、路径安全、密钥扫描、提交、非强推推送、上下文采集 | `GitWorktree` |
| `adapters/codex.ts` | Codex SDK 封装：中性工作目录、只读沙箱、MCP 全禁、结构化输出 | `CodexRunner` |
| `adapters/codex-runtime.ts` | 解析当前平台的 Codex 可执行文件路径 | 无副作用 |
| `server/index.ts` | 127.0.0.1 API：Host/Origin/token 防护、CSP、异步长任务、错误脱敏 | 单端口 |
| `web/` | 中文本机面板（React + Vite），只读渲染 + 提审批请求 | 构建到 `web-dist/` |
| `mcp/index.ts` | stdio MCP：3 个只读工具 + 4 个「仅提请求」工具 | 无批准工具 |
| `scheduler/lease.ts` | 事务性租约与单调 fence | 过期不自动接管 |
| `scheduler/server.ts` | 实验性协调器（组织部署用） | 需 TLS 反代 |
| `operations/adapters.ts` | 声明式 CI / 通知适配器（不能执行代码） | 授权绑定配置哈希 |
| `operations/release.ts` | Ed25519 签名 / 校验 / 暂存 | 哈希 + 签名 + 体积三重校验 |

## 4. 关键数据流

### 4.1 一次受管 Run（`task run`）

```
1  请求     Service.request(action)          → 生成 Approval（内容摘要 + 15 分钟有效期）
2  确认     Service.approve(id, true)        → 事务内校验：pending / 未过期 / 摘要一致
3  权限     Service.permission(p, action)    → 角色、远端配置版本、远端角色、活跃设备、GitHub 权限、origin 一致性
4  新鲜度   Service.fresh(p, issue)          → 重新拉取 Issue，比对 revision/owner/updatedAt，变化则阻断
5  依赖     t.needs 逐个检查远端 Issue 已关闭
6  加锁     store.lock('writer:<repo>', runId) → 本机只允许一个可写 Run
7  工作树   GitWorktree.create('cm/<issue>/<user>-r<n>', base) → 独立 worktree
8  执行     CodexRunner.run(...)             → 只读沙箱产出 {summary, changes[]}
9  落盘     GitWorktree.apply(...)           → 范围 / 路径 / 哈希 / 密钥扫描逐项校验后才写文件
10 复核     再次拉取 Issue，确认仍归属本人且仍 running
11 检查     Service.checks(...)              → 只跑本机白名单且绑定基准 SHA 的命令
12 记录     saveRun → status = completed / blocked，写入本机日志
```

任何一步失败都不会污染主工作树：worktree 与日志都保留，便于人工检查。

### 4.2 同步与对账（`sync`）

```
permission → tasks（分页 + 解码）→ validateGraph（环检测）
           → 读取默认分支配置（config schema / members / workers）
           → 逐任务落库；本人且 ready → 通知（按 issue+revision 去重）
           → 逐审查比对 PR head SHA，变化则置 stale
           → 逐 handoff_pending 任务解析评论中的交接载荷（校验 schema/编号/版本/作者/SHA 格式）
           → 记录 lastSync；失败则记录 error 并保留缓存，绝不伪造成功
```

## 5. 本地数据库

单文件 `codexmate.db`（WAL，`user_version` 用于 schema 升级；更高版本直接拒绝启动并提示升级客户端）。

| 表 | 用途 |
|---|---|
| `records(kind, id, data)` | 通用 JSON 记录；`kind` 取值：`meta` `project` `task` `run` `review` `handoff` `plan` `approval` `notification` `adapter` `adapter-grant` `cancel` |
| `audit(id, at, repoId, action, detail)` | 本机审计流水（已脱敏），面板「最近动态」与导出用 |
| `locks(key, holder, pid)` | 本机写锁：`writer:<repoId>`，启动时按 pid 存活性对账 |
| `leases(key, holder, fence, expires, stopped)` | 协调模式租约；`stopped` 是「旧持有者已确认停止」的唯一依据 |
| `events(id, at)` | 事件幂等登记（`INSERT OR IGNORE`，`changes>0` 表示首次处理） |

**SQLite 是本地缓存与日志索引，GitHub 才是仓库范围的异步任务真相源。** 冲突时进入人工确认，不静默覆盖远端。

## 6. 状态机

```
ready ──▶ running ──▶ review ──▶ done(必须由人类关闭 Issue)
  │           │           │
  ├─▶ blocked │           └─▶ blocked
  ├─▶ needs_approval      └─▶ handoff_pending
  └─▶ cancelled ◀── 各状态
```

`core/state.ts` 以表驱动方式限制迁移；`done` 额外要求远端 Issue 已关闭。非法迁移抛 `INVALID_TRANSITION`。

## 7. 一致性与幂等

| 对象 | 幂等键 |
|---|---|
| Run | `repo + issue + revision + owner + device`（同设备一次有效 Run） |
| 草稿 PR | 先查 `pulls?state=open&head=owner:branch&base=...`，命中即复用 |
| 审查 | `repo + pr + head_sha + reviewer + round`；head 变化即过期 |
| 检查点 | `run_id + commit_sha` |
| 交接 | `repo + issue + revision + from + to + checkpoint_sha` |
| Issue 评论 | HTML 注释 marker（见 `docs/protocol.md`） |

三层防双写：

1. **本机写锁**（`locks`）——同一台机器不会并发两个可写 Run。
2. **明确 assignee**——默认模式只执行指派给自己的任务，不抢未认领任务。
3. **lease + fencing**（可选、实验性）——`stopped=1` 是接管的必要前提；过期本身不构成接管理由。

## 8. 与 PRD §13 的偏差

| PRD 提议 | 实际实现 | 原因 |
|---|---|---|
| `packages/*` monorepo | 单包 `src/*` 分层 | 规模不需要 monorepo 工具链；分层约束照旧 |
| `templates/.codexmate/config.yml` | `templates/config.yml`，`init` 内联生成 | 避免安装后模板路径解析问题；模板用于人工参考 |
| `docs/protocol.md` 等 | 已补齐（本目录） | 与 PRD §13 一致 |

`init` 生成的配置与 `templates/config.yml` 同 schema，可直接互相替换。
