# CodexMate：GitHub 驱动的跨设备 Codex 协作工具

**完整产品需求文档（PRD）｜规划版 v1.0**  
**文档日期：2026-09-24**　**文档状态：产品与技术设计，尚未实现**  
**覆盖版本：v0.1 → v0.2 → v0.3 → v1.0 → v1.1（可选）**  
**核心场景：两人、两个独立 Codex 账户、两台位于不同网络的电脑、一个共享 GitHub 仓库。**

> 本文是一个**覆盖首版和后续升级的完整产品 PRD**，不是仅列出未来方向的 MVP 方案。每一版本都描述交付内容、用户流程、实现边界和验收标准。标记为“拟议”的命令、配置及数据结构属于 CodexMate 的产品设计，并非已存在的软件接口。

---

## 0. 执行摘要

### 0.1 一句话定位

CodexMate 是运行在开发者自己电脑上的轻量协作工具：通过 GitHub Issues/PR 交换任务与工作成果，由各自登录的本地 Codex 执行、审查和接续开发；无需让两台电脑处于同一局域网，也无需首版自建云端通信服务器。

### 0.2 核心价值

GitHub 已经解决代码同步与团队协作。CodexMate **不重复开发 GitHub**，只自动化原本需要两个人反复做的步骤：

1. 将已分配 Issue 一键变成隔离的本地 Codex 开发任务。
2. 自动记录任务与分支、生成进度摘要、创建草稿 PR 并请求队友审查。
3. 将 PR 审查意见转换为可执行的修复任务，并回填验证结果。
4. 在一方明确遇到额度限制、离线或主动移交时，通过 Git 提交和结构化交接包让另一方**开启自己的新线程**接续工作。
5. 后续支持依赖感知、有限自动分配、多项目仪表盘和可选的本机 MCP 接口。

### 0.3 产品边界（全版本持续有效）

- **不合并额度、不共享账号。** 每个人只在自己的设备上使用本人登录的 Codex。API Key 模式和 ChatGPT 登录模式分开显示，不把 API 使用量伪装成订阅额度。
- **不承诺跨设备恢复原线程。** 本机可以恢复本机保存的线程；跨机器只能传递 Git 检查点和交接上下文，由接手者创建新线程。
- **不接管既有 Codex Desktop Goal。** CodexMate 自己启动和管理的任务可受其调度；若官方未来公开稳定的现有会话挂接接口，才考虑专门适配。
- **不代替人工最终决策。** 默认不自动合并受保护分支、不自动部署、不接受来自 Issue/PR 的未经批准的执行指令。
- **不将 GitHub 当高频聊天服务器。** 任务、状态和摘要是低频异步事件；秒级聊天和实时终端镜像不属于基础产品。
- **不保证“额度耗尽自动续跑”。** 仅在错误可明确识别、检查点已安全保存、接手者已授权且可用时尝试交接；具体额度余额、重置时间只展示官方确实提供或用户手动设置的值。

### 0.4 发布策略

| 版本 | 产品主题 | 核心产出 | 目标用户 |
|---|---|---|---|
| v0.1 | 双人可靠协作 | 一键领任务、独立 worktree、Codex 执行、草稿 PR、人工确认的 AI 审查 | 两人，一个仓库 |
| v0.2 | 自动接力与减少沟通 | 结构化检查点、授权接力、依赖识别、冲突预警、可观察运行状态 | 经常异步协作的双人 |
| v0.3 | 协作效率升级 | 本地 Web 面板、MCP 工具、有限自动任务分配、PR 反馈闭环 | 希望少打开命令行的双人/三人 |
| v1.0 | 稳定多人版 | 多仓库、角色权限、可靠调度器、审计、安装与更新、通知适配 | 2–8 人的小团队 |
| v1.1（可选） | 高级智能协同 | 跨任务规划、策略化并行、质量分析、插件生态、组织部署 | 有持续使用需求的团队 |

**版本升级原则：** v0.1 的 GitHub-only 模式永远保留；高级调度或本地 UI 不能使基础双人版强制依赖付费服务器。

---

## 1. 背景、用户与竞争替代方案

### 1.1 问题描述

两个开发者共享一个 GitHub 仓库、分别使用 Codex 时，常见摩擦不是代码传不过去，而是：每次复制 Issue 给 Codex；人工创建任务分支；对齐接口更改；重复描述上一个人的开发进度；手工催审、测试和修复；一方中断后队友不知道从哪里继续。

### 1.2 目标用户

- **主要用户：** 两名分处异地、使用不同 GitHub/Codex 账户的个人开发者；熟悉 GitHub 基础操作，希望尽量少管理 AI 执行流程。
- **扩展用户：** 2–8 人小团队，多个仓库，分工明确，需要任务依赖、审计和权限控制。
- **非目标用户：** 只需要偶尔提交代码的团队；不允许代码上传 GitHub 的涉密项目；期待绕过 Codex 使用限制或共享账户凭据的用户。

### 1.3 Jobs to Be Done

| 场景 | 当前方法 | 使用 CodexMate 后 |
|---|---|---|
| 队友分配任务 | 查 Issue、复制粘贴到 Codex、建立分支 | 本地通知后，一键确认并启动受管任务 |
| AI 完成开发 | 手动总结、提交、开 PR、提醒对方 | 检查后自动生成草稿 PR 与结构化摘要 |
| 收到 PR | 找上下文、自己整理 diff、发给 Codex | 一键启动本地只读审查，提交可追溯反馈 |
| 对方卡住 | 聊天追问代码与执行进度 | 根据 commit + 交接包重建接续上下文 |
| 多任务并行 | 两人凭感觉分配 | 依赖可视化、文件冲突提示、有限调度 |

### 1.4 对直接使用 GitHub 的差异化要求

CodexMate 必须减少**可以量化的重复人工步骤**。如果只有任务展示、聊天和分支列表，却不能稳定缩短从 Issue 到 PR 的流程，应判定产品价值不足；同等效果可用现有 GitHub Actions 时优先复用，不另造一套服务。

---

## 2. 成功标准和范围约束

### 2.1 北极星指标

在保证代码质量和安全的前提下，减少“一条有效 Issue → 第一份可审查 PR”过程中的人工操作次数及时间。

### 2.2 观测指标（本机优先，默认不上传遥测）

| 指标 | 定义 | v0.1 验收目标 | v1.0 目标 |
|---|---|---|---|
| 启动成功率 | 有效任务获得许可后，成功建立工作树并调用 Codex 的比例 | ≥95%（受控测试） | ≥99%（受控测试） |
| 接收延迟 | 可访问 GitHub 时 Issue 标记为 ready 到客户端可见 | P95 ≤ 120 秒 | P95 ≤ 90 秒 |
| 重复执行率 | 同一 task revision 意外启动两个可写 Worker 的比例 | 双人受控测试为 0 | 故障注入测试为 0 |
| 人工操作次数 | 将任务从 Issue 推进至草稿 PR 所需非审批操作 | 比纯手工流程至少减少 3 步 | 比纯手工至少减少 5 步 |
| 断线恢复 | 离线后重启可核对本地/远端任务并给出明确状态 | 通过核心用例 | 覆盖跨进程与跨设备故障 |
| 敏感信息外泄 | 由工具写到 Issue、PR、日志的凭据 | 0 | 0 |

> 上述数字是**产品验收目标而非已实测结果**。数据只能由用户授权后的本地统计或测试环境得出，不声称测到个人真实额度。

### 2.3 性能边界

- v0.1 每人每仓库仅有 1 个可写执行任务；审查不与同仓库写任务争抢同一个工作树。
- GitHub API 默认轮询间隔 60 秒，优先条件请求和指数退避；不承诺实时同步。
- 每条 GitHub 进度摘要建议 ≤ 4 KB；完整本地日志保留在本机并支持删除。
- 平台：Windows 11、macOS、主流 Linux；不同系统优先支持相同 Node.js/CLI 代码路径。

---

## 3. 总体架构与跨网络通信

```text
                GitHub（无需新增服务器）
       ┌────────────────────────────────────┐
       │ Issues / Issue comments / PR / Git │
       │ Repository settings / Actions（后续）│
       └───────────────┬────────────────────┘
                       │ HTTPS 443，主动出站
            ┌──────────┴──────────┐
            │                     │
    电脑 A / 网络 A          电脑 B / 网络 B
    ┌────────────────┐     ┌────────────────┐
    │ CodexMate CLI  │     │ CodexMate CLI  │
    │ GitHub Adapter │     │ GitHub Adapter │
    │ Local Scheduler│     │ Local Scheduler│
    │ SQLite + Logs  │     │ SQLite + Logs  │
    │ Codex SDK      │     │ Codex SDK      │
    │ Git Worktree   │     │ Git Worktree   │
    └────────────────┘     └────────────────┘

    v0.3：各自可选本地 Web UI + stdio MCP
    v1.0：可选可靠调度器（GitHub Actions / 轻量协调服务）
```

**通信方案：** 两台机器都主动请求同一个 GitHub 仓库。无须同局域网、公网 IPv4、端口映射、VPN 或双方同时在线。GitHub 保存异步任务状态与代码；本地 Worker 重连后按事件 ID、更新时间和 commit SHA 对账。GitHub 不负责传递敏感凭据，也不承载完整 Codex 对话。

### 3.1 技术栈（推荐，非硬性绑定）

| 组件 | 技术选择 | 说明 |
|---|---|---|
| 核心运行时 | TypeScript + 维护中的 Node.js LTS | CLI 与后续 Web/MCP 复用业务层 |
| 本地 Codex 控制 | `@openai/codex-sdk` | 由本机身份启动线程、运行、恢复本机线程 |
| GitHub 接入 | Octokit REST 或 `gh` | 任务、评论、PR、仓库权限；优先最小权限 |
| Git 隔离 | Git Worktree + 任务分支 | 一个任务一个工作树 |
| 本地持久化 | SQLite（WAL） | 队列、线程 ID、事件游标、检查点、日志索引 |
| 配置 | `.codexmate/config.yml` + 本机用户配置 | 公共规则入仓；凭据和私有审批保存在本机 |
| 后台运行 | 用户级服务或手动运行 CLI | 不要求管理员权限 |
| 本地 UI（v0.3） | React/Vite 或等效轻量方案 | 只监听 127.0.0.1，默认不公网暴露 |
| MCP（v0.3） | 受控 stdio MCP server | 提供读取与需明确授权的动作 |
| 多人调度（v1.0） | GitHub Actions 单调度实例；必要时可选支持 CAS 的协调服务 | 不把非原子 Issue 标签误当互斥锁 |

### 3.2 认证边界

- GitHub：本人 `gh auth login` 或受限 GitHub App 安装授权；仓库访问范围由使用者选择。
- Codex：每人本机登录，Worker 在本机环境执行。启动前显示实际凭据来源（能判断时）；若使用 API Key，明确提示独立计费。
- 两台机器之间传输的只有 GitHub 允许公开给仓库协作者的任务元数据、代码和摘要；任何登录 Cookie、ChatGPT Token、Codex 授权文件都不传输。

---

## 4. 用户角色、权限与安装流程

### 4.1 角色

| 角色 | v0.1–v0.3 | v1.0 |
|---|---|---|
| 仓库维护者 Owner | 配置仓库、邀请协作者、启用动作 | 管理策略、调度器、成员与审计 |
| 开发者 Developer | 处理分配给自己的任务、提交 PR、查看协作摘要 | 多仓库/多任务管理，受策略约束 |
| 审查者 Reviewer | 在本人机器上审查请求 | 可设领域和目录责任人 |
| 只读观察者 Viewer | 暂不支持 | 仅查看进度，不可启动远端执行 |

GitHub 原有仓库权限是基本访问边界；CodexMate 角色只能在其权限范围内进一步收紧，不能凭本地配置提升 GitHub 授权。

### 4.2 首次上手

1. 安装 Node.js、Git、GitHub CLI、Codex CLI/SDK 必需运行时。
2. 每个人分别执行 `gh auth login`、`codex login`，运行 `codexmate doctor` 校验环境、可访问仓库、Git 干净程度及本机认证模式。
3. Owner 在仓库目录执行 `codexmate init`：确认后创建 `cm:*` 标签、Issue 模板、公共配置；自动建立 `.gitignore` 防止提交本地状态。
4. 邀请 B 成为 GitHub 协作者；B clone 后运行 `codexmate join`，读取公共配置并明确选择自己的自动执行/自动提交权限。
5. 各自 `codexmate start`（前台）或安装本机用户级后台服务；演示 Issue → Codex → draft PR → AI 审查。

首次配置成功以可视化/CLI 的**端到端演练通过**为准，而不只是“连接成功”。

---

## 5. 核心业务对象与统一数据契约

### 5.1 对象

- **Project：** 一个 GitHub 仓库（后续扩展多个），包含成员、约定检查命令及分支策略。
- **Task：** 与 Issue 一一关联，包含负责人、验收标准、依赖、版本号和状态。
- **Run：** 一次具体执行尝试：工作树、线程 ID、设备 ID、执行模式、结果；一个 Task 可有多个 Run。
- **Checkpoint：** 可交接的 commit SHA + 结构化摘要 + 测试结果，明确创建者与时点。
- **Review：** 一个 PR 的一次审查结果，与 head SHA 绑定，过期时须重新审查。
- **Handoff：** 从一位负责人到另一位负责人的移交请求/接受/完成记录。
- **Event：** 状态变化、审批、审查、错误的不可重复处理事件。

### 5.2 GitHub Issue 状态

主路径：`ready → running → review → done`；可从合适状态进入 `blocked`、`handoff_pending`、`cancelled`、`needs_approval`。`done` 的依据是人类按仓库规则合并/关闭 Issue，而非模型单方面声称完成。

| 状态 | 进入条件 | 允许后续状态 | 关键责任 |
|---|---|---|---|
| ready | Issue 有负责人、验收标准且依赖可运行 | running、blocked、cancelled | 指派者 |
| needs_approval | 本机需审批新的任务/命令/推送 | running、blocked、cancelled | 本机用户 |
| running | 本地已复核责任人并创建可写 Run | review、blocked、handoff_pending、cancelled | 当前 Owner |
| review | 草稿 PR 已创建或待修复 | running、done、blocked | Author + Reviewer |
| handoff_pending | 产生安全检查点，目标人待接受 | running、blocked、cancelled | 交出方 + 接手方 |
| blocked | 错误/冲突/缺审批/依赖阻塞 | ready、running、handoff_pending、cancelled | 任务 Owner |
| done | PR 按规则合并并完成 Issue | — | 人工合并者 |
| cancelled | 有权限的用户取消 | —；重新打开应增加 revision | 人工操作者 |

### 5.3 Issue 机器可读标记示例（拟议协议）

使用结构化数据区块作为一个仓库级可读投影；保留普通人类描述。高频运行日志不写 Issue 正文。由明确授权的操作者更新；协作双方对 `revision`、`updated_at` 和 `assignee` 再确认，**不将正文修改视为原子操作**。

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
execution:
  mode: approve-first
  risk: normal
  allowed_checks: ["npm test", "npm run lint"]
latest_checkpoint: null
```

公共配置中的白名单及本机策略优先于 Issue 文本；Issue 中的 `allowed_checks` 只是**建议**，不能授予额外命令权限。推荐标签：`cm:ready`、`cm:running`、`cm:review`、`cm:blocked`、`cm:handoff`。状态以单一结构化记录为准，标签只是用于筛选的投影，发现不一致时停止自动执行并修复。

### 5.4 本地数据库建议

```text
repositories(repo_id, local_root, github_user, last_sync_at)
tasks(repo_id, issue_number, revision, remote_state, local_state, owner, last_seen_updated_at)
runs(run_id, repo_id, issue_number, revision, device_id, thread_id, worktree_path,
     branch, started_at, ended_at, execution_mode, last_error)
checkpoints(checkpoint_id, run_id, commit_sha, report_path, test_summary, created_at)
reviews(review_id, pr_number, head_sha, verdict, local_report_path, published_at)
events(event_id, type, source_id, processed_at, outcome)
approvals(approval_id, scope, action, approved_by, expires_at, revoked_at)
```

`thread_id` 留在本机，不写 GitHub。跨设备 Handoff 不试图拷贝 SDK 的会话存储。SQLite 是本地缓存和日志索引，GitHub 是仓库范围的异步任务真相源；发生冲突则进入人工确认，不静默覆盖远端状态。

---

## 6. 完整功能需求（跨版本统一定义）

### F01｜仓库接入与环境检查（v0.1）

**用户故事：** 我希望 5 分钟内把一个已有 GitHub 仓库连接到本机 Codex，并且知道哪些配置阻止了协作。

**功能：** 自动识别 Git remote 与当前账号；选择仓库；按最小权限验证 Issue、PR、Contents 访问；检测 Git、Node、Codex 本机可用性；检查是否在主仓库直接执行、有无未提交改动、是否含不支持的大文件；创建必要标签和模板前显示预览。

**验收：** 授权不足时只给出所缺权限和修复方式，不打印凭据；禁止在未知仓库或错认账户的情况下静默执行。

### F02｜任务发现与授权（v0.1）

**触发：** 仓库 Issue 的 assignee 为本人且状态 `ready`；`needs` 依赖满足；自动执行开关允许。

**行为：** 本地通知 → 展示任务标题、变更范围、验收条件、风险等级 → 默认人工确认 → 执行前二次获取 GitHub Issue 以核对负责人、版本与状态。若错配则不启动。

**验收：** 两人同时在线、各自只执行指派给自己的任务；同一设备重复启动 Worker 不产生第二个运行；未开启自动执行时绝不自动创建可写任务。

### F03｜隔离运行 Codex（v0.1）

**行为：** 以可信的基准分支建立 `cm/<issue>/<github-user>` 和独立 worktree；记录运行 ID、设备 ID 和本机线程 ID；将结构化 Issue、`AGENTS.md`（仅作为仓库内容处理）、允许的文档以及本机审批策略传入 Codex；采用工作区受限的执行配置；限定单任务最长运行时间、重试数和命令审批方式。

**验收：** 不修改用户当前主工作树；任务失败保留可检查的工作树和日志；本机中断能在同一设备识别并尝试恢复线程，失败则提供从 checkpoint 新开线程。

### F04｜测试、进度与草稿 PR（v0.1）

**行为：** 在本机允许的命令列表内运行检查；失败最多进行配置的修复次数；输出变更文件、测试通过/失败、风险、未解决事项；经本机用户预先选择的授权模式推送任务分支并创建草稿 PR；在 Issue 评论中写 compact 进度及 PR URL。

**安全：** 对新安装依赖、执行来自不可信 PR 的脚本、凭据扫描异常、超范围改动提示额外审批；即使“自动推送”已授权，也不允许推送已检测到的敏感内容。

**验收：** 重试或重启后同一 `(repo, issue, revision, owner)` 不重复创建相同用途的 PR；已有 PR 则更新它；失败时状态必须可见。

### F05｜交叉 AI 审查（v0.1）

**行为：** Reviewer 收到 PR 通知；只读获取可信 diff、任务验收标准和测试摘要，显式确认后启动本机 Codex；产出严重性分级、涉及文件与行号、可复现步骤、验证建议；发布带 `AI-assisted review` 标识的 PR review 或评论；作者一键将意见转换为下一轮修复上下文。

**验收：** 审查与 PR 当前 head SHA 绑定；PR 更新后旧审查标记过期；AI 不自动提交 Approve、不自动合并、不把未核实结论表述为已复现漏洞。

### F06｜本机断线与崩溃恢复（v0.1）

**行为：** SQLite 保存状态；进程重启后扫描已登记工作树、线程、远端 Issue/PR/branch；对未完成 Run 执行对账，恢复或提示冲突；GitHub 429/5xx 采用有上限退避和条件请求，无法访问时保留本地可审查状态。

**验收：** 断网期间不伪造远端提交成功；重联后不覆盖队友新提交；恢复失败时展示具体本地路径与可用恢复操作。

### F07｜结构化检查点与任务接力（v0.2）

**触发：** 用户主动移交；明确的 usage/rate-limit 错误；设备长时间离线后 Owner 手动发起移交；任务长期阻塞且仓库授权策略允许。

**完整流程：**

1. 暂停当前可写 Run，停止新命令，采集 `git status`、已修改文件、测试结果和当前任务目标。
2. 检查密钥及提交权限，取得用户对推送检查点的授权；生成可检查 commit，不允许以强推覆盖队友工作。
3. 生成 `handoff/v1`：目标、验收项完成情况、当前分支及精确 commit SHA、已有 PR、依赖、执行过的检查及其结果、剩余任务、已知风险和最低权限需求。
4. 在 Issue 创建交接事件，状态设 `handoff_pending`；原 Owner 的可写 Run 进入冻结，不应并行写同一任务。
5. 目标用户本机收到请求，检查 SHA、代码、权限后点击接受。接受并通过远端责任人核对后检出 checkpoint，创建**新的**本地 Codex 线程。
6. 原 Owner 收到交接完成通知，保留只读历史，禁止自动恢复旧可写任务，除非重新分配。

**异常：** 未提交的敏感文件不能被自动移交；额度错误分类不确定时只提示用户；目标人离线或拒绝时保持 `handoff_pending` 或回滚到 `blocked`，不擅自切换责任人。

**验收：** A 在一条任务做到一半后移交，B 可仅凭仓库数据接续并完成 PR；任一时刻同一任务只有一个获授权的可写 Owner，无法确认则全部暂停等待用户解决。

### F08｜任务依赖和文件冲突预警（v0.2）

- Issue 通过 `needs: [issue_number]` 声明前置任务；未合并/未满足的依赖默认阻止自动执行，用户可以在本机只读探索。
- 启动前估算潜在文件改动范围（依赖清单、目录责任区或先行只读规划）；与其他进行中任务的实际变更文件取交集，给出**预警而非精确冲突预测**。
- A 修改公共接口时，允许生成 `contract-change` 协作摘要，链接 API diff/Schema 文件和受影响任务。B 收到后确认是否更新当前工作树。
- PR 合并后，解锁依赖该任务的 ready Issues；不自动将未审查的主分支变更合入运行中工作树。

**验收：** 依赖未完成时不误启动写任务；检测到两个任务计划修改同一关键文件时提醒明确解决策略。

### F09｜可观察运行状态和通知（v0.2）

- 运行状态：空闲、可接任务、执行中、需审批、网络不可用、疑似额度限制、离线、手动暂停；仅“最近心跳”是可推断的，不把它显示为保证在线。
- 通过 GitHub Issue 评论或低频更新时间维持跨设备心跳（例：5 分钟一次且仅活跃时），本地实时信息不必全部上传。
- 仅消费官方/进程实际暴露的 usage 数据、错误和状态；若剩余额度不可取得，显示“未知”，不估算精确重置时间。
- 通知粒度：任务待领取、运行失败、需审批、PR 待审查、交接请求、依赖解除；支持免打扰和去重。

**验收：** 不因离线心跳推断自动抢走他人任务；同一故障连续重试只触发一条可更新的通知。

### F10｜本地协作仪表盘（v0.3）

**定位：** 显示真实 GitHub 和本地运行事实，而非 AI 总结页。默认启动本机 loopback 地址，登录凭据和内网服务端口不暴露给队友。

**页面结构：**

1. **总览**：本人身份、绑定仓库、GitHub/Codex 实际连接状态、当前任务、队友最近活动、待审批数量。
2. **看板**：ready / running / review / blocked / done，来源均可点回 GitHub Issue/PR。
3. **任务详情**：目标与验收、责任人、依赖图、实时本机日志入口、checkpoint、关联分支/PR、公开摘要。
4. **审查中心**：待审 PR、最近 head SHA、检查结果、AI 审查草稿、人工发布和过期提示。
5. **接力中心**：交接包对比、风险、接受/拒绝、责任转移历史。
6. **设置**：仓库、身份、审批策略、并发/重试、通知、数据保留。

**交互原则：** 危险动作二次确认；状态可追溯，点击能直达原始 Issue、PR、commit 或本地日志；禁止把估算结果装饰为精确实时数据。

### F11｜本机 MCP 接口（v0.3）

**定位：** 在用户自己打开的 Codex 里自然语言查看协作状态、请求任务，而非靠 MCP 偷偷控制其他用户电脑或未知已有 Goal。

拟议工具名及权限：

| 工具 | 作用 | 权限 |
|---|---|---|
| `cm_status` | 查看本人当前仓库与任务状态 | 只读 |
| `cm_list_tasks` | 列出本人 Issue、待审 PR | 只读 |
| `cm_task_context` | 获取指定任务的结构化上下文 | 只读 |
| `cm_request_run` | 请求本机执行一个已授权 Issue | 本机确认 |
| `cm_request_review` | 请求本机对 PR 作只读审查 | 本机确认 |
| `cm_create_handoff` | 创建交接包并请求转交 | 二次确认，必要时授权推送 |
| `cm_accept_handoff` | 接受交接并新建受管 Run | 本机确认 |

服务使用 stdio 并绑定本机用户；不提供默认公网端口。所有工具需校验 caller 所属本地进程/会话、仓库白名单与权限，不能因为模型调用就绕过用户设置。MCP 工具返回结构化结果和 GitHub 链接；运行被阻止时必须返回明确原因。

### F12｜有限自动任务分配（v0.3）

**v0.3 仅做低风险建议与串行授权分配**：对无人认领的 ready Issue，结合用户声明的技能标签、依赖、最近活动和可执行任务上限生成候选分配建议。Owner 确认后，由唯一授权操作者完成 Issue 指派；不允许两台 Worker 自行同时抢占。

**推荐排序（非强制）：** 依赖已满足 → 目录匹配 → 手动优先级 → 本机可用状态。用户始终可覆盖建议。任务规模超过 1 人天、跨越多个关键模块、验收不可验证时，先建议拆 Issue，不直接自主运行。

**验收：** Owner 不操作时不会擅自改派；同一 Issue 最终只有一个 assignee；调度建议保留可解释依据。

### F13｜PR 反馈闭环（v0.3）

- 将审查意见按 `critical/high/medium/low` 分类，并保留来源、验证状态和所关联 head SHA；发布前人工核对。
- 作者可将选中意见转换为一个受管修复 Run；修复完成重新跑最小回归检查、更新同一 PR，并通知 Reviewer。
- 限制自动修复次数（默认 2 轮），防止“两个 Codex 无限互相挑错”；连续无进展须人工仲裁。
- 接口契约发生变化时，自动通知已声明依赖此任务的 Issue Owner，但不能直接写入对方正在运行的线程。

**验收：** Reviewer 看到“原意见、修复 SHA、重测结果”；重复审查没有无限循环。

### F14｜多仓库与角色化管理（v1.0）

- 同一台电脑可绑定多个仓库，仓库级隔离 GitHub 授权、执行规则、运行数量和本地缓存。
- 支持 Owner、Developer、Reviewer、Viewer；支持 CODEOWNERS/目录负责人映射作为审查建议，不取代 GitHub branch protection。
- 提供仓库配置版本与迁移器，版本不兼容时只读降级并提示升级，避免旧 Worker 错误写入新协议。
- 允许每人多台设备，但同一 GitHub 身份同一仓库须显式指定活跃 Worker 或获得调度器 lease；断线切换不得产生双写。

### F15｜可靠调度与租约（v1.0）

**为什么需要升级：** GitHub Issue 标签、assignee 和评论修改不是严格原子抢任务接口。多名 Worker 同时自动领取无人认领任务，在 GitHub-only 轮询模式下不能给出可靠的 exactly-once 保证。

**设计：**

1. 默认仍使用 v0.1 的“明确 assignee + 本机只执行本人任务”，完全不需要调度服务。
2. 若启用多人自动领取，Owner **显式选择**一个可信调度器模式。候选 A：GitHub Actions 单一调度工作流，使用仓库级串行策略，但 Worker 启动前仍要校验唯一 lease；候选 B：轻量可选协调服务，使用具备原子 compare-and-set/事务的存储分配 lease。
3. `lease` 至少包含 `(repo, issue, revision, owner, run_id, fence_token, expires_at)`；每次状态写入/接续需要核对 fence token。租约过期不代表原 Worker 已停止，接手前必须确保旧 Worker 不再持有有效可写资格；无法确认则转人工。
4. Dispatcher 只分配任务，不保管用户 Codex 认证、不在公共服务器调用个人订阅身份；各本机 Worker 负责执行。
5. 调度事件附带幂等键、审计记录与失败补偿；Actions 工作流的并发配置**本身不能保证用户电脑的 exactly-once 执行**。

**验收：** 并发领取、延迟心跳、网络分区、进程僵死、GitHub 重试和协调服务重启的故障注入测试均不能造成未经用户确认的双写；如无法满足则可靠调度功能不得发布。

### F16｜审计、通知与正式分发（v1.0）

- 本地记录每次自动启动、批准、拒绝、任务改派、推送、PR 发布、交接、策略修改，提供可导出且可脱敏的审计包；仓库范围的关键事件保留简洁 GitHub 记录。
- Windows/macOS/Linux 安装与自更新签名校验；升级前自动备份本地 SQLite schema，失败可回滚配置。
- 可选 GitHub 原生通知、邮件/IM Webhook；通知载荷只含 Issue/PR 链接和非敏感状态，不发送完整代码或登录信息。
- 通过可访问性与键盘操作测试；不同仓库规则冲突时显示清晰优先级。

### F17｜高级规划与生态扩展（v1.1，可选）

- 在用户提供明确目标及验收条件的前提下，先生成任务拆分草案、依赖图和预期受影响目录；**人类确认后**才创建 Issues。
- 根据仓库测试历史和真实失败模式建议优先回归测试；不将“AI 自评分数”当成代码质量事实。
- 自定义 GitHub/CI/通知适配器；所有三方适配器默认只读沙盒，提升权限时单独授权。
- 团队可选部署专属协调服务及组织级数据保留策略；基础个人协作不需迁移到专属服务。
- 导出任务流转数据和指标报告（可选择本地匿名化），避免制造“自动化带来了巨大效率提升”的无证据结论。

---

## 7. 关键端到端流程（含失败处理）

### 7.1 正常开发：Issue → PR

1. Owner 创建 Issue #42，写明验收和依赖，指派 B 并标记 ready。
2. B 本机 Worker 检测到任务 → 本机弹出任务卡 → B 允许启动。
3. Worker 二次检查 Issue、Git 状态及执行权限 → 创建工作树/分支 → 调用本机 Codex SDK。
4. Codex 执行过程中，本机记录结构化进度；达到 checkpoint 才把低频摘要写回 GitHub。
5. 完成后运行允许的测试与扫描 → B 授权推送（或使用针对该仓库预先授权的受限自动推送）。
6. 插件创建/复用 draft PR，关联 Issue，写摘要、验证结果、剩余风险 → Reviewer 收到提醒。
7. A 在本机执行只读 AI 审查 → 人工核对并发布 → B 修复 → 人工按仓库规则合并。

### 7.2 额度不足交接

1. B 的受管执行收到可明确分类的 usage-limit 错误；若无法判断，保持 unknown-error。
2. B 确认保存检查点、扫描并推送，生成 `handoff/v1`。
3. A 查看交接摘要和待办，接受后在新工作树检出 exact SHA，使用自己的 Codex 登录新开线程。
4. A 完成 PR 或将后续任务重新分给 B；Issue 记录移交事件。**不声称额度可以合并或原 Goal 已迁移。**

### 7.3 双方异地、其中一方离线

A/B 通过 GitHub HTTPS 交换任务；若 B 离线，A 仍可提交 Issue；B 恢复联网后轮询发现。若 B 离线后 A 要求重新分配，先将 B 的旧 Run 标记待取消，满足可靠租约/人工确认条件后才允许新 Owner 可写执行。不能仅凭“5 分钟没心跳”自动抢走正在运行的任务。

### 7.4 冲突与审批

新任务与进行中任务涉及相同核心文件 → 提示选择“等待对方 PR 合并 / 在独立 worktree 先做只读规划 / 人工确认并行风险”。模型提出 `rm -rf`、运行仓库外命令、修改部署环境等高风险动作时停止请求本机审批，不能通过 GitHub 评论替代审批。

---

## 8. 命令行与交互设计

### 8.1 CLI 设计（拟议，不代表已有命令）

```text
codexmate doctor                    # 本地诊断
codexmate init                      # 初始化仓库配置（需确认）
codexmate join                      # 连接已初始化的仓库
codexmate start [--daemon]          # 启动本地 Worker
codexmate status [--json]           # 查看真实任务与本机状态
codexmate task list [--mine]        # 列出任务
codexmate task run 42               # 执行已授权 Issue
codexmate task pause 42             # 暂停本机 Run
codexmate task resume 42            # 恢复本机运行或检查点
codexmate review 58                 # 只读 AI 审查 PR
codexmate handoff 42 --to user-a    # 申请安全交接
codexmate handoff accept 42         # 接受后新开本地线程
codexmate approvals list            # 查看/撤销本机授权
codexmate logs 42 [--redacted]      # 本机日志
codexmate sync --dry-run            # 对账预览
```

### 8.2 首版 CLI 状态屏

```text
CodexMate · org/repo · @user-a                 同步于 09:32
GitHub: 已连接          Codex: 本机登录（来源已核验）
本机执行：1 / 1         自动执行：关闭        推送：需确认

我的任务      #41 API 适配            running   [查看日志]
等待我审查    PR #58 登录页            review    [开始审查]
队友任务      #42 用户中心            ready     [打开 Issue]
需要关注      #39 测试修复            blocked   [查看原因]

提示：不会显示未经官方接口验证的剩余额度或重置时间。
```

### 8.3 v0.3 本地面板重点页面

- **总览：** 两列“我的任务 / 团队任务”，下方“待审批 / 待审查”，连接状态和本机真实日志入口始终可见。
- **任务详情：** 顶部单一主操作（启动、暂停、审查、接受交接之一），中部验收项、变更与测试，底部事件时间线。
- **交接确认：** 左侧“已完成 / checkpoint”，右侧“未完成 / 风险”，突出精确 SHA、实际分支与接手权限。
- **设置：** 将“自动读取 Issue”“自动启动 Codex”“自动推送草稿 PR”“自动申请接力”设为不同开关，不能打包成模糊的“全部自动化”。

---

## 9. 公共配置与个人配置

### 9.1 仓库公共配置（建议）

```yaml
schema: codexmate.config/v1
repo:
  default_branch: main
  project_mode: github-only
members:
  developers: [user-a, user-b]
  reviewers: [user-a, user-b]
issues:
  ready_label: cm:ready
  require_assignee: true
  require_acceptance: true
  require_dependencies: true
execution:
  max_concurrent_writers_per_user: 1
  default_mode: approve-first
  max_repair_attempts: 2
  allowed_check_commands:
    - npm run lint
    - npm test
pull_requests:
  draft_by_default: true
  human_merge_required: true
handoff:
  enabled: true
  target_must_accept: true
sync:
  polling_seconds: 60
```

### 9.2 本机私有配置（示例）

```yaml
active_repo: org/repo
execution:
  auto_start_assigned: false
  auto_push_draft_pr: false
  require_approval_for_dependency_install: true
  worktree_root: ~/.codexmate/worktrees
handoff:
  auto_offer_on_verified_usage_limit: false
notifications:
  enabled: true
  quiet_hours: null
privacy:
  telemetry_enabled: false
  local_log_retention_days: 30
```

**配置优先级：** 不可突破的安全限制 > 本机用户审批/组织策略 > 仓库可信默认分支中的公共配置 > Issue 的任务建议 > PR/评论中的非可信文本。任何低优先级数据均不得覆盖高优先级限制。

---

## 10. 异步协议、幂等与一致性

### 10.1 事件记录（拟议）

```json
{
  "schema": "codexmate.event/v1",
  "event_id": "uuid",
  "repo": "org/repo",
  "issue": 42,
  "revision": 3,
  "type": "checkpoint.created",
  "actor": "user-b",
  "run_id": "uuid",
  "created_at": "2026-09-24T01:00:00Z",
  "payload": {
    "branch": "cm/42/user-b",
    "commit": "<full-commit-sha>",
    "summary": "已完成登录接口，测试待补齐"
  }
}
```

GitHub Issue/PR/comment 是投影和事件传输层。事件 ID 在本地保存，重复轮询只处理一次；如果远端事件丢失，以 Issue 最新状态、PR head SHA 和 Git 引用重建。普通双人模式用明确 assignee 管理责任人，但不声称具备事务锁。自动多人模式必须另外提供经故障验证的 lease/fencing 方案。

### 10.2 幂等键

- 任务 Run：`repo + issue + revision + owner + device_id`；同一设备一次有效 Run。
- 草稿 PR：`repo + issue + revision + source_branch + target_branch`；优先查找现有 Open PR。
- 审查结果：`repo + pr + head_sha + reviewer + review_round`；head 变化后旧结果过期。
- 检查点：`run_id + commit_sha`；同 SHA 不重复写评论。
- Handoff：`repo + issue + revision + source_owner + target_owner + checkpoint_sha`。

### 10.3 API、轮询与退避

- 优先 GitHub 条件请求、分页、少量批量读取；轮询带随机抖动，避免用户启动时瞬间同步请求。
- 尊重 `Retry-After`、主/次速率限制和错误类别；指数退避有上限并允许手动刷新。
- GitHub 返回 401/403 时暂停写操作，明确区分授权不足、令牌失效和 API 限流。
- 仅在发布的低频阶段写 GitHub，逐 token 日志永久只保留本地。

---

## 11. 安全、隐私和威胁模型

### 11.1 资产

GitHub 凭据、Codex/ChatGPT 本机凭据、私有代码、未提交文件、`.env`/云凭据、用户本机文件、远程分支与受保护主分支。

### 11.2 主要威胁及控制

| 威胁 | 控制方式 |
|---|---|
| Issue/PR 中的恶意提示词 | 视为不可信任务数据；不自动升级工具权限、禁用其对本地审批策略的修改能力 |
| 仓库脚本和测试含危险操作 | 仅运行本机明确允许的可信检查，来源未审查时确认；沙盒不能替代审批 |
| 远端指令诱导外泄 Token | 凭据不写进工作树；本机密钥扫描、输出脱敏、限制敏感目录读取和网络外传能力 |
| GitHub Token 权限过大 | 最小化仓库和读写范围，凭据优先留在 OS 安全存储 / `gh` 管理中 |
| 两端争抢任务 | 双人模式明确 assignee；多人自动化引入可靠协调、fencing 与故障测试 |
| 自动强推/覆盖代码 | 默认禁止强推；只操作专用任务分支，冲突时停机提示 |
| AI 错审或测试幻觉 | 审查附带 head SHA 与实际测试输出；未运行测试必须写“未运行” |
| 未授权远程执行 | 不提供默认公网控制面；MCP 仅本机、动作经用户审批 |
| 仓库误暴露敏感摘要 | 仅传简洁必要信息，秘密扫描，敏感日志仅本机保存 |
| 多人权限冲突 | 不超越 GitHub 基础权限；受保护分支仍由 GitHub 规则保障 |

### 11.3 默认审批矩阵

| 动作 | 默认行为 | 自动化条件 |
|---|---|---|
| 读取本人已指派 Issue | 允许 | 已授予该仓库读取权限 |
| 启动新的可写 Codex Run | 弹出确认 | 本人对该仓库显式开启自动执行 |
| 运行可信预配置检查 | 按配置允许 | 命令在本机白名单且运行环境符合规则 |
| 安装新的依赖 / 修改系统配置 | 阻止并请求审批 | 必须逐次授权，不被仓库评论覆盖 |
| 推送任务分支 / 创建草稿 PR | 默认确认 | 本人显式开启受限自动推送、扫描通过 |
| 提交 AI 审查评论 | 默认预览并确认 | 可选允许自动发布低风险评论，不能自动 Approve |
| 接受交接并执行 | 必须确认 | v1.0 策略可预授权明确范围的交接，但高风险仍需确认 |
| 合并 main / 部署生产 | 永远保留仓库定义的人工与 GitHub 保护规则 | 产品本身默认不执行 |

### 11.4 数据生命周期

- 本机默认保存运行日志 30 天，用户可随时清除；本机线程与 worktree 的删除由用户确认。
- 公共 Issue/PR 评论是 GitHub 上的持久资料，删除需要遵守 GitHub 仓库权限，不宣称本机删除会远程消失。
- 不默认把个人开发行为传到 CodexMate 自建服务器；v1.0 仅在启用协调服务时发送必要的状态及 lease，不上传源代码或 Codex 凭据。
- 支持一键导出个人任务/运行历史与擦除本机缓存；组织政策不能悄悄突破用户已知的数据边界。

---

## 12. 版本计划与交付定义

### 12.1 v0.1：双人 GitHub 原生版

**范围：** 单仓库，明确双成员、单账号单活跃 Worker、CLI，人工确认优先。

**交付包：** 安装命令、`init/join/doctor/start`、本地 SQLite、Issue 监听、worktree、SDK Run、允许的测试、草稿 PR、审批式只读审查、断线恢复、基础配置与测试脚本。

**发布门槛：** 两台不同网络电脑实测完整 Issue → PR → 审查；无双写；无 Token 泄漏；崩溃重启不重复创建 PR；对 GitHub 断网、超时、限流给出真实状态。

**不包含：** 自动抢占未指派 Issue、跨设备自动交接、桌面 UI、MCP、多人协调服务。

### 12.2 v0.2：结构化接力与依赖管理

**依赖：** v0.1 的 Run/Checkpoint/事件记录稳定；推送和审查具幂等性。

**交付包：** `handoff/v1`、手动和可验证错误触发的接力建议、交接请求/接受、基于 commit 的新线程接续、依赖图、文件冲突预警、接口变更摘要、低频心跳和通知去重。

**发布门槛：** 同局域网与跨网络均能从半成品 checkpoint 接续；断线后不产生双写；未获批准或含密钥的改动不能自动流出；使用错误分类回放不会误将普通超时当额度耗尽。

### 12.3 v0.3：本地 UI、MCP 和半自动调度

**依赖：** v0.2 的统一状态模型与权限模型就绪。

**交付包：** 本地 Web 仪表盘、真实数据入口、本机 MCP 工具、Owner 确认式分配建议、审查意见修复闭环、通知配置和跨平台用户级后台运行。

**发布门槛：** UI 每条状态能追溯到 GitHub 或本地 Run；MCP 无法绕过本机审批；自动修复不会无限循环；所有受管动作在 CLI/UI/MCP 行为一致。

### 12.4 v1.0：可公开分发的多人版

**依赖：** v0.3 完整稳定、诊断和权限模型足够清晰，任务抢占实现经过故障注入。

**交付包：** 多仓库 2–8 人支持、角色权限、可选协调模式、带 fencing 的任务 lease、审计日志、正式安装与签名更新、多设备活跃 Worker 管控、GitHub App 可选授权、版本迁移与基本通知集成。

**发布门槛：** 多人高并发领取不双写；网络分区与恢复测试通过；越权操作被阻断；旧版本客户端可安全降级；未安装协调器的 GitHub-only 双人模式持续可用。

### 12.5 v1.1：可选增强版

**交付包：** AI 任务拆解建议与人工确认、跨任务规划与冲突缓解、基于真实数据的质量报告、可扩展适配器、组织专属部署选项。

**发布门槛：** 所有规划操作可撤销、保留人类审核入口；关键建议有证据与来源；新增集成不能获得隐含的本机/仓库写权限。

### 12.6 版本能力总表

| 能力 | v0.1 | v0.2 | v0.3 | v1.0 | v1.1 |
|---|:---:|:---:|:---:|:---:|:---:|
| 独立账户、Issue → Codex → PR | ✓ | ✓ | ✓ | ✓ | ✓ |
| Worktree 隔离、本机线程恢复 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 人工确认的交叉 AI 审查 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 结构化接力、依赖与冲突预警 | — | ✓ | ✓ | ✓ | ✓ |
| 可观察状态、低频活动提醒 | 基础 | ✓ | ✓ | ✓ | ✓ |
| 本地 Web UI、stdio MCP | — | — | ✓ | ✓ | ✓ |
| 建议式任务分配、审查闭环 | — | 部分 | ✓ | ✓ | ✓ |
| 多仓库、角色权限、多人可靠调度 | — | — | — | ✓ | ✓ |
| 正式安装、审计、GitHub App 授权 | — | — | — | ✓ | ✓ |
| 智能任务拆解、插件生态 | — | — | — | — | 可选 |

---

## 13. 实施架构与代码仓库规划

```text
codexmate/
  packages/
    core/              # Task/Run/Checkpoint/Handoff/策略/状态机
    github-adapter/    # Issues/PR/评论/授权/条件请求/限流
    codex-runner/      # SDK 封装、执行与审批接口
    local-store/       # SQLite 与事务性本地日志
    git-worktree/      # 分支、工作树、提交/推送/冲突检测
    cli/               # v0.1 起交付
    web-ui/            # v0.3 起交付；仅本机
    mcp-server/        # v0.3 起交付；stdio
    scheduler/         # v1.0 可选协调与租约适配
    notifications/     # 本地通知与后续第三方适配
  templates/
    .codexmate/config.yml
    ISSUE_TEMPLATE/codexmate_task.yml
  docs/
    PRD.md
    architecture.md
    security.md
    operations.md
    protocol.md
  tests/
    unit/
    integration/
    e2e/
    fault-injection/
```

**分层约束：** CLI/UI/MCP 都通过同一个 `core` 调用能力；业务逻辑不直接依赖 UI，GitHub 适配器不读取 Codex 凭据，协调器不执行用户本地命令。v0.1 就预留接口，但不提前实现空洞的大型插件框架。

---

## 14. 测试、验收与质量门禁

### 14.1 功能验收

| ID | 测试 | 预期 |
|---|---|---|
| T01 | A 校园网、B 手机热点连接同仓库 | 无内网互通仍能完成正常协作 |
| T02 | B 没有 GitHub Issue 写权限 | `doctor` 报错并禁止越权写入 |
| T03 | 两个 Worker 同时读取指派给 B 的 Issue | 仅 B 的活跃 Worker 启动一次写任务 |
| T04 | Worker 在创建 PR 后立即崩溃 | 重启发现已有 PR，不再创建重复 PR |
| T05 | GitHub 返回 429/5xx、客户端断网 | 尊重退避，状态不伪报成功 |
| T06 | Codex 本机线程可恢复 | 恢复原本机线程或提示需 checkpoint |
| T07 | 审查期间 PR head SHA 变化 | 原审查过期，不作为新提交已审通过 |
| T08 | 恶意 Issue 要求输出 API Key | 拒绝越权读取/输出，不写入 GitHub |
| T09 | v0.2 A 将半完成任务交给 B | B 从精确 SHA + 摘要新建线程继续 |
| T10 | v0.2 B 拒绝交接 | 不改变唯一可写 Owner，不暗中执行 |
| T11 | v0.2 依赖 Issue 未完成 | 不自动启动依赖任务 |
| T12 | v0.3 MCP 请求执行未授权命令 | 被本机审批策略阻断 |
| T13 | v0.3 AI 修复连续两轮失败 | 停止并提示人工，不无限循环 |
| T14 | v1.0 同一 Issue 被多人同时候选领取 | 调度器只发出一个有效 lease |
| T15 | v1.0 断网旧 Worker 重连 | 失效 fence token 无法提交新的受管写事件 |
| T16 | v1.0 旧配置版本的客户端接入 | 只读降级或迁移，不破坏仓库状态 |
| T17 | 任一版本出现扫描出的密钥 | 阻止自动推送和公开摘要 |
| T18 | 用户关闭自动执行 | 只读取与通知，不会后台启动新的写 Run |

### 14.2 性能与可靠性

- 单机运行 24 小时、GitHub 连续短暂失连、系统睡眠唤醒和网络切换，任务状态保持可恢复。
- 100 个历史 Issue 的仓库中按 ETag/分页拉取，界面与 CLI 不冻结；遇限流准确退避。
- 单次 Checkpoint 的 GitHub 摘要体积可控；不将逐 token 日志写入评论。
- 强制终止进程、删除工作树、分支被外部强推或 PR 被队友关闭后，必须能诊断并阻止错误续写。

### 14.3 安全测试

- Prompt injection、隐藏命令、`AGENTS.md` 非可信指示、恶意 PR 内容、Symlink 逃逸、命令白名单绕过、凭据扫描假阴性回归、Webhook 伪造（若开启）及 MCP 未授权工具调用。
- 私有仓库和主分支保护规则测试；GitHub App/Token 取消授权后立即阻止后续仓库写操作。
- 协调器网络分区/lease 过期/旧 Worker 复活故障注入是 v1.0 自动抢任务的强制门槛。

---

## 15. 项目风险、取舍和降级路径

| 风险 | 影响 | 设计缓解 |
|---|---|---|
| Codex SDK 或 CLI 升级导致接口变化 | 本地运行失效 | runner 适配层、版本锁定、兼容性集成测试，错误时回退到人工执行 |
| 实际 SDK 身份来源不同于预期 | 额度/计费被误解 | 启动前检测并展示本地可观察认证模式，不声称两人额度相加 |
| GitHub API 限流或服务中断 | 任务延迟 | 低频轮询、ETag、退避、本地缓存与重联对账 |
| 标签/Issue 非原子写入 | 两人误抢相同任务 | v0.1 严格 assignee；自动抢占仅在可靠调度器上线后启用 |
| 各地网络无法访问 GitHub | 同步阻塞 | 清晰标记离线；不伪造公网直连能力；允许本地保存检查点待网络恢复 |
| 上下文交接损失 | 接手者重复工作 | 完整 commit、验收逐项进度、测试日志、待办及依赖写入 handoff |
| 两个 AI 循环互相提出修改 | 无止境消耗额度 | 有上限的审查/修复轮次，人类仲裁和显式预算阈值 |
| 自动运行不可信仓库代码 | 本机安全风险 | 隔离工作树、权限限制、可信检查白名单、高风险审批；不把沙盒当绝对防护 |
| 产品过度复杂 | 维护成本超过协作收益 | 基础 GitHub-only 模式始终可用，每一升级按人工步骤节省收益评估 |

**降级路径：** 任一自动化组件故障，用户仍可用同一 GitHub Issue、任务分支和 PR 人工接续；数据采用可读的 YAML/JSON 摘要和普通 Git 结构，尽量避免锁定到专有服务。

---

## 16. 开发优先级与建议里程碑（按依赖顺序，不承诺工期）

| 顺序 | 工作包 | 交付判定 |
|---|---|---|
| 1 | CLI 基架 + `doctor` + GitHub/Codex 本机认证检测 | 可在两台机器安全连接同一仓库 |
| 2 | Issue Adapter + Task 状态机 + 本地 SQLite | 指派任务能正确发现与幂等登记 |
| 3 | Worktree + SDK Runner + 审批门 | 无主工作区污染，失败可恢复 |
| 4 | 测试/扫描 + Draft PR + 交叉只读审查 | 完成 v0.1 跨网 E2E |
| 5 | Checkpoint + Handoff 协议 | 完成 v0.2 中途交接 E2E |
| 6 | 依赖、冲突预警、心跳与通知 | v0.2 增强功能通过误报/限流测试 |
| 7 | Web UI + MCP + 修复闭环 | v0.3 功能与权限一致 |
| 8 | 可靠调度、多人/多仓库、正式分发 | v1.0 故障注入和安全门槛通过 |
| 9 | 可选高级智能规划/适配器 | 真实用户验证后推进 v1.1 |

### 16.1 最小一期任务拆分（可直接创建 GitHub Issues）

1. `CM-001` 创建 monorepo、基础类型、配置 schema 和 CLI 框架。
2. `CM-002` 实现本机认证探测、GitHub repo 权限检测和 `doctor`。
3. `CM-003` 实现 Issue 过滤、条件请求、事件去重和本地 SQLite。
4. `CM-004` 实现 Git Worktree、任务分支、工作区健康检查。
5. `CM-005` 实现 Codex SDK adapter、运行/暂停、运行日志与本机恢复。
6. `CM-006` 实现审批门、可信检查、密钥扫描与自动修复次数限制。
7. `CM-007` 实现幂等草稿 PR 创建、任务摘要和状态对账。
8. `CM-008` 实现只读 PR AI 审查、head SHA 绑定及人工发布。
9. `CM-009` 完成跨网络双人 E2E、故障和安全测试、发布说明。

各 Issue 必须具备明确验收条件，优先交付一个从头到尾可运行的纵向切片，再增加高级自动化。

---

## 17. 开放问题及默认决策

| 问题 | 当前默认 | 何时复核 |
|---|---|---|
| 默认是否自动执行 Issue？ | 否，用户明确开启后可自动执行本人的低风险任务 | v0.1 用户测试后 |
| GitHub issue 元数据如何存储？ | 人类描述 + 单一 schema 区块，标签为派生视图 | v0.1 兼容性测试后 |
| 是否需要 WebSocket 或自建服务器？ | v0.1–v0.3 不需要 | v1.0 多人原子调度需求出现时 |
| 额度错误能否自动识别？ | 只匹配官方可观察的明确错误，其余 unknown | v0.2 集成测试时 |
| 任务可否自动移交给任何人？ | 不可，需目标人授权；多人后也须遵守权限和 lease | v0.2/v1.0 |
| MCP 是否能控制已有 Desktop Goal？ | 不承诺，管理本插件启动的 Run | 仅在官方稳定能力发布后 |
| 是否支持 GitHub Enterprise Server？ | v1.0 评估，先确保 GitHub.com 的 MVP | v1.0 立项时 |
| 是否做独立云端多用户账号体系？ | 不做；优先复用 GitHub 身份 | 出现组织级运营需求后 |
| 产品是否收费？ | 当前不设计收费和代付额度；可自托管优先 | 有真实运维成本与需求时 |

---

## 18. 开发验收的最终定义（Definition of Done）

**v0.1 的 DoD：** 两位不同用户、两台不同网络的电脑，安装后不用互传任何 ChatGPT/GitHub 登录凭据；Owner 建立 Issue 并指定队友；被指派者一键调用本机 Codex 在独立工作树开发，生成真实分支和草稿 PR；另一人使用自己的 Codex 审查；发生断网/重启仍不重复提交、不覆盖主工作树；所有高风险动作遵守本机审批。

**v1.0 的 DoD：** 在维持上述简单路径的同时，支持多人多仓库和可选可靠任务调度；半成品可通过精确 SHA + 交接包跨用户接续；多客户端高并发和网络分区下没有未经确认的双写；本地 UI 和 MCP 均能访问真实任务数据且不能绕过安全策略；发布包可安装、诊断、升级和回滚。

如果 v0.1 已经无法稳定比“直接两人用 GitHub + 手动 Codex”节省操作，优先改进端到端工作流，不推进更复杂的分布式功能。

---

## 19. 官方实现参考与核验范围

以下链接仅支持相关平台能力的存在，不代表 CodexMate 已实现本文的拟议协议。正式编码时仍应根据项目锁定的 SDK/CLI 版本复核 API 类型和当期授权规则。

- Codex SDK（本地 TypeScript 线程启动/恢复）：https://developers.openai.com/codex/sdk
- Codex 身份与程序化工作流（企业访问令牌具有适用范围，不应假定个人账户可用）：https://developers.openai.com/zh-Hans/docs/enterprise/access-tokens
- GitHub Issues API：https://docs.github.com/en/rest/issues/issues
- GitHub Pull Requests API：https://docs.github.com/en/rest/pulls/pulls
- GitHub PR Reviews API：https://docs.github.com/en/rest/pulls/reviews
- GitHub REST API 最佳实践（条件请求及限流）：https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- GitHub REST API 限流：https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub Actions workflow syntax（并发仅负责工作流层，不等于客户端 exactly-once）：https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax

**结束。本文可直接作为产品总 PRD；建议将 v0.1–v1.0 的任务状态与数据契约部分视为实现时应保持向后兼容的核心。**
