# 极简协作聊天技术架构

更新：2026-09-25。当前默认入口不使用原 Issue/Approval/PR 工作台。

| 模块 | 职责 |
| --- | --- |
| `src/desktop` | Electron 生命周期、目录选择、受限外链与 preload |
| `src/web` | 黑白聊天、会话历史、向导、权限卡片、折叠过程/差异 |
| `src/chat/http.ts` | loopback API；Host、Origin、随机 token 校验 |
| `src/chat/service.ts` | 本地授权、显式协作工具、唤醒预算、提交/整合/审查 |
| `src/chat/app-server.ts` | 固定 Codex 0.156.1，stdio JSON-RPC，持久线程、流式事件、steer/interrupt |
| `src/chat/context.ts` | 最近历史、增量归一化、脱敏、单轮总预算 |
| `src/chat/repository.ts` | worktree、远端身份、扫描、检查、cm 分支同步、精确 SHA 审查 |
| `src/chat/relay-client.ts` / `src/relay/server.ts` | 房间认证、持久消息、重放、取消墓碑与在线状态 |

## 执行路径

用户目标 → 中转登记活动任务 → 双方同一基准的独立工作树 → 显式工具交换分工 → 双方实际提交 → 发起方独立集成 → 同伴检查精确 SHA → 完成。

普通回复、终端、presence 和手动上下文导出不会触发新的 Agent 轮次。`peer_send` 才是模型主动要求对方行动的入口。每端默认最多 20 次唤醒；重启未知状态暂停对账，继续增加 20 次预算。

补充要求用事件 ID 集合追踪，旧审查不能覆盖新要求。审查前后都核对 HEAD 与干净状态，避免把修改后的检查结果归到原提交。停止会使待处理权限失效，异步步骤返回后再次检查取消状态。

## 存储与生命周期

新库位于 `<home>/chat/codexmate.db`，SQLite WAL。旧 `<home>/codexmate.db` 不迁移、不覆盖。桌面 home 默认为 Electron userData，CLI 默认为 `~/.codexmate`；可显式设置 `CODEXMATE_HOME`。

本机记录 tasks/messages、room/project grant、inbox/outbox、received/handled、wake/checkpoint、cancel、peerctx/ctxseen/ctxcursor。账号凭据由本机 Codex 管理。中转存 token 哈希、房间、消息、确认与取消记录。

Git push 和 SQLite 不属于同一分布式事务。不能承诺全局 exactly-once；消息去重、确定性工作树、精确 SHA 检查和不确定时暂停共同避免盲目重复执行。

Electron 就绪放在 `app.whenReady().then(...)` 中，避免在 ESM 顶层阻塞模块加载。renderer 无 Node 权限、开启 contextIsolation 和 sandbox。App Server 动态工具属于实验协议，升级固定版本后必须复测真实 smoke。

## 证据边界

本机模拟 Agent + 真实 Git、中转协议、真实单机 Codex 和 Electron 是不同验证层次，不能合并叙述成两账号异地验收。完整证据见 [acceptance.md](acceptance.md)。
