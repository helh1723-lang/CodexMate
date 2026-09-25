# 协作协议

## 角色

三个参与方，职责严格分离：

| 角色 | 位置 | 职责 |
|---|---|---|
| **本机服务** | 各自机器 | 管理本地状态机、驱动本机 Codex、跑检查、提交 `cm/` 分支 |
| **中转服务** | 自部署 | 搬运已校验消息、去重、重放、在线状态。**不理解消息语义，不接触线程与凭据** |
| **本机 Codex** | 各自机器 | 各自的使用者与额度，只在自己的协作工作树里工作 |

## 中转服务

### HTTP

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | 返回 `{ok, protocol}`，`protocol` 当前为 `1` |
| `POST` | `/rooms` | 创建房间，返回 `{id, member, token, invite}` |
| `POST` | `/join` | 用邀请码加入，返回 `{id, member, token}` |

约束：

- 邀请码以 **SHA-256 摘要**存放，服务端不保存原始邀请码。
- 成员令牌同样只存摘要，比对使用 `timingSafeEqual`。
- 房间最多两名成员；邀请码单人使用后立即失效。
- 房间未配对时 24 小时过期；配对后不过期。
- 请求体上限 8 KB，按来源 IP 每分钟 60 次。

### WebSocket

连接后 5 秒内必须认证，否则断开。

客户端 → 服务端：

| type | 载荷 | 说明 |
|---|---|---|
| `auth` | `{room, member, token}` | 认证（超时即断开） |
| `event` | `{event}` | 发送一条线路事件，须符合线路 schema |
| `ack` | `{id}` | 确认已收到某条事件 |

服务端 → 客户端：

| type | 载荷 | 说明 |
|---|---|---|
| `ready` | — | 认证通过 |
| `batch` | `{cancelled, events}` | 投递待办事件；**取消标记永远排在前面** |
| `accepted` | `{id}` | 事件已被接受持久化 |
| `presence` | `{members}` | 成员上下线 |
| `error` | `{id?, message}` | 拒绝或错误 |

要点：

- **重放优先于冲刷。** 客户端收到 `ready` 后先等 `batch`，再补发离线期间积压的事件。
- **去重。** 事件按 id 幂等；重复且内容一致则直接回 `accepted`，内容冲突则报错。
- **双向投递。** 服务器把同伴事件补发给接收端，本机发送事件保留在自己的记录中；并非把自己发出的事件再次回传。
- WS 单帧上限 128 KB，这也是上下文预算的上界来源。

### 中转的状态机约束

服务端强制这些规则（不是客户端自觉）：

- 一个房间同时只能有一个活动任务。
- 非 `start` 类型的事件必须属于已知且未关闭的任务。
- 只有发起方可以发 `complete`。
- 已取消的任务只接受 `cancel`。
- 线路事件的 `sender` 必须是认证成员自己。

## 线路事件

```ts
type Wire = {
  id: string;          // UUID
  room: string;        // UUID
  task: string;        // UUID
  sender: string;      // UUID，自己的成员 ID
  type: WireType;
  payload: Record<string, unknown>;
  correlation?: string;
  at: number;
};

type WireType =
  | 'start'        // 发起：目标、基准提交、远端身份
  | 'message'      // 同伴消息（可携带上下文增量）
  | 'context'      // 显式上下文同步
  | 'supplement'   // 使用者补充要求
  | 'result'       // 提交结果：SHA、分支、检查输出
  | 'review'       // 请求集成审查
  | 'reviewed'     // 审查结论
  | 'complete'     // 全部完成
  | 'cancel';      // 停止
```

## 任务阶段

```
working ──双方均提交──▶ integrating ──▶ reviewing ──通过──▶ complete
   ▲                                        │
   └──────────── 修正（最多两轮）──────────────┘
```

异常时进入 `paused`（带原因），可对账后继续；`cancelled` 是终态，不能恢复，需新建任务。

用户补充要求的事件 ID 构成 requirements 集合。集成审查及 complete 必须对应同一集合；新增补充会使旧审查失效，中转也拒绝用过期集合结束任务。

## 上下文同步

### 数据结构

```ts
type ContextEntry = { kind: 'user'|'agent'|'command'|'file'|'system'; text: string; ok?: boolean };

type ContextBundle = {
  id: string; task: string; sender: string;
  phase: string; branch: string;
  note?: string;
  entries: ContextEntry[];
  cursor?: string;      // 上次同步位置
  truncated?: boolean;
  at: number;
};
```

接收端用 zod 严格校验后才落库，任何不符合 schema 的一律拒绝。

### 导出与裁剪

1. 从 `thread/items/list` 显式读取最近 100 条（desc 后恢复时间顺序），避免一直读取默认第一页；取不到时降级为本机已记录消息。
2. 按 `cursor` 只取新增部分。
3. 归一化五类条目，跳过已经包含同伴上下文的宿主提示词，避免回传放大；**推理链（`reasoning`）与内部类型一律不外发**。
4. 脱敏后，若仍疑似凭据则该条目丢弃。
5. 合并重复文件状态、去重相同文本、按 UTF-8 字节预算裁剪，**保留最新**。

### 预算

| 阶段 | 上限 |
|---|---|
| 自动同步（附在 `peer_send` 上） | 12,000 字节 |
| 手动同步 | 48,000 字节 |
| 注入单次提示词（所有待处理 bundle 合计） | 6,000 UTF-8 字节 |
| 中转 WS 单帧 | 128 KB（上述预算的设计依据） |

### 触发时机

| 触发 | 说明 |
|---|---|
| `peer_send` | 自动附带增量；冷却期 15 秒、每任务最多 40 次 |
| 用户点「同步上下文」 | payload 为 `{context: bundle}`，只落库，随下一次显式请求注入，不额外唤醒 |
| 无新增内容 | **不发**。宁可不同步，也不重复灌同一批历史 |

## 本机 Codex 接口

CodexMate 通过 stdio JSON-RPC 驱动本机 Codex（`app-server --listen stdio://`）。

用到的请求：`initialize`、`account/read`、`account/login/start`、`thread/start`、`thread/resume`、`thread/items/list`、`turn/start`、`turn/steer`、`turn/interrupt`。

处理的请求：`item/tool/call`、各类 requestApproval、`item/tool/requestUserInput`。

处理的通知：`item/agentMessage/delta`、`item/completed`、`turn/completed`、`account/login/completed`。

启动时明确禁用：外部 MCP 连接、apps、浏览器/电脑操作、多 Agent、Web 搜索，并把网络访问关掉。

暴露给 Codex 的协作工具只有四个：`peer_send`、`peer_read`、`submit_result`、`submit_review`。**没有任何 git push / commit / 部署工具。**

## Git 约定

- 基准提交必须已存在于远端（`branch -r --contains` 校验）。
- 每个成员的分支：`cm/<任务ID>/<成员前8位>-<work|integration|review-*>`。
- 推送只对 `cm/` 前缀分支；主分支永不由程序改动。
- 集成后校验双方提交 SHA 都是结果的祖先——**合并看起来干净不代表内容都在**。
