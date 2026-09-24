# CodexMate

**本机优先的 GitHub 驱动协作工具。** 两名分处异地、各自使用独立 Codex 账户的开发者，共享同一个 GitHub 仓库，通过 Issue / PR / Git 检查点异步协作。

- **不需要**同一个局域网、公网 IP、端口映射或 VPN。
- **不需要**自建云端服务器（v0.1–v0.3 完全不需要）。
- **不共享**账号、凭据或额度。

> 当前版本 **1.1.0-rc.1**：可运行的候选实现，**尚未通过 PRD 全部发布门槛**。请先读 [`docs/acceptance.md`](docs/acceptance.md) 了解哪些结论已经实测、哪些仍需两台机器两个人验证。

---

## 它解决什么问题

GitHub 已经解决了代码同步与团队协作。CodexMate 不重造 GitHub，只自动化原本需要两个人反复手动做的动作：

| 现在要手工做的 | 用 CodexMate |
|---|---|
| 查 Issue、复制粘贴给 Codex、手动建分支 | 收到通知 → 本机确认 → 自动建 worktree 并启动 Codex |
| 手动总结、提交、开 PR、催对方看 | 检查通过后幂等创建草稿 PR，写回结构化摘要 |
| 收到 PR 后自己整理 diff 再发给 Codex | 一键本机只读审查，结论绑定 head SHA |
| 对方卡住，只能聊天问进度 | 用 commit + `handoff/v1` 检查点，让对方**新开自己的线程**接续 |
| 两人凭感觉分任务 | 依赖图、文件冲突预警、建议式分配 |

---

## 产品边界（全版本持续有效）

这些是设计上的硬约束，不是「暂未实现」：

- **不合并额度、不共享账号。** 每人只在自己设备上使用本人登录的 Codex。
- **不承诺跨设备恢复原线程。** 跨机器只传 Git 检查点与交接上下文，接手者创建新线程。
- **不接管既有 Codex Desktop 会话。** 只管自己启动的 Run。
- **不代替人工最终决策。** 不自动合并受保护分支、不自动部署、不接受来自 Issue/PR 的未批准执行指令。
- **不把 GitHub 当高频聊天服务器。** 只写低频任务、状态与摘要。
- **不保证「额度耗尽自动续跑」。** 仅在错误可明确分类、检查点已保存、接手者已授权时才交接。
- **额度与限流状态显示「未知」，不估算。** 只展示官方或进程实际暴露的值。

实现层面的对应约束：

- 远端 Issue/PR 正文一律视为**不可信数据**，不能授予本机执行权限。
- Codex 以 **只读沙箱** 运行，只提出变更建议；由主机校验路径、哈希、范围后写入。
- 所有写入动作都经过**绑定内容与版本的审批**，过期/重复/远端变化一律阻断。

---

## 环境要求

| 组件 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 22.13 | 使用内建 `node:sqlite`（仍会打印 Experimental 警告） |
| Git | 任意较新版本 | worktree 与检查点 |
| GitHub CLI | `gh`，已 `gh auth login` | 需 `repo` 权限范围 |
| Codex CLI | 已 `codex login` | 支持 API Key 或 ChatGPT 登录；两种模式的计费含义不同 |

平台：Windows 11 / macOS / 主流 Linux，同一份 Node.js 代码路径。

---

## 获取与分发给协作者

`codexmate` **尚未发布到 npm registry**，所以 `npx codexmate` 只在你本机已装好该包时才有意义。把工具交到对方手上的三种方式：

| 方式 | 适合 | 你做什么 | 对方做什么 |
|---|---|---|---|
| 源码 | 两人都能访问同一个仓库 | 把仓库地址给对方 | `git clone` → `npm ci` → `npm run build`，之后用 `npm run cli -- <命令>` |
| 打包 | 只想给一个可执行产物 | `npm pack` 得到 `codexmate-1.1.0-rc.1.tgz` | `npm i -g ./codexmate-1.1.0-rc.1.tgz` |
| 签名 | 需要来源与完整性可验证（推荐对外） | `npm pack` → `release sign` → 一并给对方 tgz + 清单 + 公钥 | `release verify` 通过后再 `release stage` |

三条路安装出来的东西完全一样，差别只在**能不能验证来源**。第三方分发只走签名路径，细节见 [`docs/operations.md`](docs/operations.md)。

全局安装完成后，下文示例里的 `npx codexmate <命令>` 可以直接简写为 `codexmate <命令>`。

---

## 快速开始

源码方式：

```bash
npm ci
npm run build
```

### 1. 先做本机诊断

```bash
npx codexmate doctor
```

会逐项检查 Node、Git、`gh`、Codex CLI、GitHub 身份与 Codex 登录状态，并如实展示认证模式与「未知」的额度。任何一项失败都会给出可操作提示。

### 2. 零风险体验（不碰 GitHub）

```bash
npm run demo
# 打开 http://127.0.0.1:4317
```

演练工作区使用独立数据库，**不调用 Codex、不写入 GitHub**，界面上有明确横幅标注。可以完整走一遍：任务看板 → 审批 → 运行 → 草稿 PR → 审查 → 规划 → 接力。

### 3. 连接真实仓库

仓库维护者（Owner）在已 clone 的仓库根目录执行：

```bash
npx codexmate init /path/to/repo
```

`init` 会预览并创建：`.codexmate/config.yml`、Issue 模板、`.gitignore` 条目、`cm:*` 标签。**需要交互确认**，且必须提交到默认分支后才对协作者生效。

协作者：

```bash
npx codexmate join /path/to/repo
```

`join` 会核验：当前 `gh` 账号、仓库权限、`origin` 是否与绑定仓库一致、默认分支配置是否可读。角色取 `owner/developer/reviewer/viewer` 与 GitHub 实际权限的**下限**——本机配置无法提升 GitHub 授权。

### 4. 启动

```bash
npx codexmate ui          # 本机面板 http://127.0.0.1:4317
npx codexmate start       # 前台轮询（默认只同步与通知，不自动执行）
npx codexmate mcp         # stdio MCP，供你自己打开的 Codex 读取协作状态
```

`codexmate start` 默认**不会**自动启动任务。自动执行与自动推送是本机策略里的两个独立开关，默认关闭。

---

## 命令参考

全局选项：`--home <path>`（本机私有状态目录，默认 `~/.codexmate`）、`--repo <id>`、`-V/--version`。

### 仓库与环境

| 命令 | 作用 |
|---|---|
| `doctor` | 本机环境与认证诊断 |
| `join [root]` | 连接已初始化的仓库（核验身份与权限） |
| `init [root]` | 创建仓库配置、模板与标签（仅 Owner，需确认） |
| `status [--json]` | 查看真实本机状态与任务 |
| `sync [--dry-run]` | 拉取远端任务并对账 |

### 任务

| 命令 | 作用 |
|---|---|
| `task list [--mine]` | 列出任务 |
| `task run <issue>` | 启动受管 Run（建 worktree → 只读 Codex → 应用变更 → 跑检查） |
| `task resume <issue>` | 恢复本机已存在的运行 |
| `task pause <issue>` | 请求暂停本机 Run |
| `task publish <issue>` | 推送任务分支并创建/复用草稿 PR |
| `task repair <issue> --review <id>` | 按已发布的审查意见修复（有轮次上限） |
| `assign <issue> --to <login>` | 分配任务（仅维护者，需确认） |

### 审查与接力

| 命令 | 作用 |
|---|---|
| `review <pr>` | 启动本机只读 AI 审查 |
| `publish-review <id>` | 复核后发布审查评论（永不自动 Approve） |
| `handoff [issue] --to <login>` | 推送检查点并申请交接 |
| `handoff accept <id>` / `handoff reject <id>` | 接手者接受 / 拒绝 |

### 审批、数据与运维

| 命令 | 作用 |
|---|---|
| `approvals list` / `approve <id>` / `revoke <id>` | 查看与处理本机审批 |
| `policy [--file <path>]` | 查看或保存本机策略 |
| `logs <issue> [--redacted]` | 本机运行日志（始终脱敏输出） |
| `export` | 导出本机记录 |
| `recover` | 对账中断的本机运行 |
| `prune` | 清理过期运行日志（保留工作树与历史） |
| `plan --goal <t> --acceptance <t>` / `publish-plan <id>` / `revert-plan <id>` | 生成 AI 拆解草案、确认后创建 Issue、撤销未开始的任务 |

### 分发与实验能力

| 命令 | 作用 |
|---|---|
| `release sign <pkg> --release-version <v> --private-key <f> --out <f>` | 生成 Ed25519 签名清单 |
| `release verify <pkg> --manifest <f> --public-key <f>` | 校验体积、哈希与签名 |
| `release stage <pkg> --manifest <f> --public-key <f>` | 校验通过后暂存，等待人工安装 |
| `adapter add/list/grant/revoke/read/notify` | 声明式 CI / 通知适配器（无任意代码执行权限） |
| `coordinator --config <file>` | **实验性**组织协调服务；客户端自动抢占仍禁用 |

---

## 一次完整的协作流程

```
Issue (#42, 指派给 B) ──▶ B 本机通知 ──▶ B 确认启动
   │                                        │
   │                            worktree: cm/42/B-r1（隔离，不碰主工作树）
   │                                        │
   │                            Codex 只读沙箱产出「变更建议」
   │                                        │
   │                            主机校验：范围 / 哈希 / 密钥扫描 / 可信检查
   │                                        │
   │                            草稿 PR + Issue 结构化摘要
   │                                        ▼
   └────────── A 收到待审提醒 ──▶ A 本机只读 AI 审查（绑定 head SHA）
                                    │
                          人工核对后发布评论（不 Approve、不合并）
                                    │
                    B 按意见修复（≤ maxRepairAttempts 轮）
                                    │
                     人工按仓库规则合并 ──▶ Issue 关闭 ──▶ 解锁依赖任务
```

**中途接力**：B 遇到明确的 usage-limit 错误或主动移交 → 保存检查点 → 推送 → 生成 `handoff/v1`（目标、验收完成情况、精确 SHA、剩余任务、风险、已跑的检查）→ Issue 置 `handoff_pending` → A 接受后从精确 SHA **新开自己的线程**。任一时刻同一任务只有一个获授权的可写 Owner。

---

## 配置

### 仓库公共配置（`.codexmate/config.yml`，提交进仓库）

```yaml
schema: codexmate.config/v1
repo:
  default_branch: main
members:
  - login: user-a
    role: owner
    paths: [src, docs]
  - login: user-b
    role: developer
    paths: [src, tests]
workers:            # 每个成员的活跃设备 ID，来自 `codexmate doctor`
  user-a: <device-id>
  user-b: <device-id>
```

参考 [`templates/config.yml`](templates/config.yml)。

### 本机私有配置（**不入仓库**）

`autoStart`、`autoPush`、可信检查命令（绑定基准 SHA）、超时、修复轮次上限、日志保留天数、通知与免打扰。用面板的「工作区设置」或 `codexmate policy --file` 修改。

### 配置优先级（低优先级永远不能覆盖高优先级）

```
不可突破的安全限制
  > 本机用户审批 / 组织策略
    > 仓库可信默认分支中的公共配置
      > Issue 中的任务建议
        > PR / 评论中的非可信文本
```

---

## 安全模型摘要

完整威胁模型与逐条控制见 [`docs/security.md`](docs/security.md)。

- **凭据不出本机。** GitHub 走 `gh` 自己的凭据存储；Codex 走本机登录。写入工作树的只有代码。
- **远端文本不可信。** Issue/PR 正文、`AGENTS.md`、仓库脚本都当作数据处理，不提升工具权限。
- **写入前扫描。** diff、暂存内容与分支历史都会扫描疑似凭据；命中即阻止提交与推送，并阻止发布到 GitHub。
- **路径与范围校验。** 拒绝绝对路径、路径逃逸、符号链接穿透、敏感路径（`.env`、`auth.json`、`id_rsa` 等）与超大/二进制文件。
- **审批绑定内容。** 审批记录带内容摘要，任务版本、策略或远端状态变化都会使旧审批失效；15 分钟过期。
- **本机面板只监听 127.0.0.1**，带 Host / Origin 校验与一次性会话 token。
- **MCP 只提请求，没有批准工具。** 任何写入仍需你在 CLI 或面板确认。

---

## 项目结构

```
src/
  core/        任务/运行/审批/交接/审查/规划/策略/诊断/状态机
  store/       SQLite（WAL）事务、事件去重、审计、本机写锁
  adapters/    gh REST（ETag/退避）、Git worktree 隔离、Codex SDK 只读运行器
  server/      127.0.0.1 API（Host/Origin/token 防护、异步审批）
  web/         中文本机面板（总览/看板/依赖图/审查/接力/规划/质量/审批/设置）
  cli/         命令行入口
  mcp/         stdio MCP（只读 + 仅提审批请求）
  scheduler/   SQLite 事务 lease / fencing；实验性协调器
  operations/  声明式适配器、Ed25519 发布签名
templates/     仓库配置模板、组织部署示例
tests/         单元 + 集成 + 浏览器 E2E
docs/          架构 / 协议 / 安全 / 运维 / 验收
```

> 与 PRD §13 的偏差：PRD 提议 `packages/*` monorepo，实际实现为单包 `src/*` 分层。分层约束（CLI/UI/MCP 统一走 `core`；适配器不读 Codex 凭据；协调器不执行本机命令）保持一致。

---

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm test            # 单元 + 集成（node:test）
npm run build       # tsc -p tsconfig.build.json && vite build
npm run test:ui     # Playwright 浏览器 E2E（启动演练实例，需要 msedge/chromium）
npm run check       # 以上前三项
npm run dev         # 开发模式跑面板
npm run cli -- <args>   # 直接跑 TS 版 CLI
```

测试要点：适配器层通过注入执行器在**进程边界**替换 `gh`，因此退避、条件请求、幂等分支跑的都是真实代码而不是 mock 替身。

---

## 已知限制

- **跨网络双人 E2E 未实测。** 需要两台不同网络的机器、两个不同的 GitHub / Codex 账户。演练数据不能替代该验证。
- **多人自动抢占未启用。** `coordinator` 是实验性组件，未经过跨设备故障注入；客户端自动抢占保持禁用。
- **GitHub assignee / 正文不是原子锁。** 默认模式靠「明确 assignee + 只执行本人任务」保证不双写，不承诺事务级 exactly-once。
- **额度与限流重置时间显示「未知」。**
- **审查是辅助意见。** 未运行的测试会明确写「未运行」；AI 不能 Approve。

---

## 文档

| 文档 | 内容 |
|---|---|
| [`CodexMate_Full_PRD.md`](CodexMate_Full_PRD.md) | 完整产品需求与版本计划（最高约束） |
| [`docs/architecture.md`](docs/architecture.md) | 分层、模块职责、数据流、本地数据库 |
| [`docs/protocol.md`](docs/protocol.md) | Issue 结构化区块、交接载荷、事件与幂等键 |
| [`docs/security.md`](docs/security.md) | 威胁模型、控制措施、审批矩阵 |
| [`docs/operations.md`](docs/operations.md) | 安装、升级回滚、诊断、故障处置 |
| [`docs/acceptance.md`](docs/acceptance.md) | **实测结果与未验证事项**（先读这个再判断完成度） |
