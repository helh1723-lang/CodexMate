# 安全与隐私

本文同时描述**威胁模型**与**当前实现的实际控制**。未实现的控制会被明确标注，不与「设计意图」混淆。

---

## 1. 资产

| 资产 | 存放位置 | 是否可能离开本机 |
|---|---|---|
| GitHub 凭据 | `gh` 自己的凭据存储（不经过 CodexMate） | 否 |
| Codex / ChatGPT 凭据 | Codex CLI 自己的登录存储 | 否 |
| 私有源代码 | 本机仓库与 worktree | 只作为任务分支推送到**你自己的** GitHub 仓库 |
| 未提交文件、`.env`、云凭据 | 本机 | 否（且被扫描阻止进入提交） |
| 跨设备传输内容 | GitHub Issue / PR / 评论 | 仅任务元数据、代码与摘要；**绝不包含任何登录凭据** |

---

## 2. 威胁与控制

| 威胁 | 实现中的控制 | 位置 |
|---|---|---|
| Issue/PR 中的恶意提示词（prompt injection） | 远端内容整体作为**不可信 JSON** 注入，并用显式安全边界包裹；不提升工具权限、不改变本机审批策略 | `security.untrustedPrompt` |
| 仓库脚本 / 测试含危险操作 | 只运行本机策略里**白名单且绑定基准 SHA** 的命令；命令不得含 `; & \| \` \r \n`，必须是「可执行文件 + 独立参数」；模型无权运行项目脚本 | `Service.checks` |
| 远端指令诱导外泄 Token | 凭据不进 worktree；diff、暂存内容、**分支历史**、逐个变更文件都过密钥扫描；输出统一脱敏 | `security.scanText` / `git.scan` |
| GitHub Token 权限过大 | 复用 `gh` 的最小权限授权；CodexMate 不新增凭据存储 | — |
| 两端争抢任务 | 三层：本机写锁 → 明确 assignee → 可选 lease + fencing（`stopped=1` 才算旧持有者已停止） | `store.lock` / `planning` / `scheduler/lease` |
| 自动强推 / 覆盖代码 | 只操作 `cm/<issue>/<user>-r<n>` 专用分支；推送使用 `--set-upstream`，**永不 force**；写文件前校验原始内容哈希 | `git.push` / `git.apply` |
| AI 错审或测试幻觉 | 审查结论绑定 head SHA；提示词要求「未复现的结论标为待验证」；未运行的测试显示「未运行」；**不自动 Approve** | `Service.review` |
| 未授权远程执行 | 不提供默认公网控制面；面板只监听 `127.0.0.1`；MCP 是 stdio 且**无批准工具** | `server` / `mcp` |
| 仓库误暴露敏感摘要 | 发布前 `publicText` 扫描 + 裁剪（≤3900 字节）；日志只留本机 | `security.publicText` |
| 符号链接 / 路径逃逸 | 拒绝绝对路径、`..`、盘符、NUL；`realpath` 比对；逐级 `lstat` 拒绝符号链接 | `git.safePath` |
| 本机 API 被其他网页访问 | Host 校验、Origin 校验、一次性会话 token、CSP、`X-Frame-Options: DENY`、`Cache-Control: no-store` | `server/index.ts` |
| 协调器被冒用 | Bearer token 只比对 SHA-256；principal 绑定 worker 与仓库白名单；fence 必须显式提供 | `scheduler/server.ts` |
| 更新包被替换 | Ed25519 签名 + SHA-256 + 体积三重校验；校验失败不落盘 | `operations/release.ts` |
| 适配器被用作 SSRF / 凭据外传 | 只允许 `https:`、禁止 URL 内凭据与查询串、禁止任意代码执行、通知只允许 GitHub 链接 | `operations/adapters.ts` |

---

## 3. 敏感路径与密钥扫描

### 3.1 禁止自动处理的路径

匹配即拒绝（不提交、不允许模型修改）：

```
.env / .env.*  ·  auth.json  ·  credentials*  ·  id_rsa / id_ed25519  ·  .npmrc
.git  ·  .codex  ·  .codexmate  ·  node_modules
*.pem  *.key  *.p12  *.pfx
```

同时拒绝：二进制文件（含 NUL 字节）、> 2 MB 的文件。

### 3.2 凭据扫描模式

```
gh[pousr]_[A-Za-z0-9]{20,}      github_pat_[A-Za-z0-9_]{20,}
sk-(proj-)?[A-Za-z0-9_-]{20,}
AKIA[0-9A-Z]{16}
-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----
(password|passwd|api[-_]?key|access[-_]?token|secret)\s*[=:]\s*["']?[^\s"',;]{12,}
Bearer\s+[a-zA-Z0-9._~-]{16,}
```

三重防线：

1. **提交前**：`git diff` + 分支历史 + 未跟踪文件全部扫描 → 命中即 `SECRET_DETECTED`，拒绝提交。
2. **推送前**：再次执行 `scan`，防止「提交后又被改动」。
3. **发布到 GitHub 前**：所有写入 Issue / PR / 评论的文本过 `publicText` → 命中即拒绝发布。

`redact()` 用于日志、错误、审计、导出：命中片段替换为 `[REDACTED]`。**扫描假阴性仍是风险**，因此工作树不自动删除，保留人工复核入口。

---

## 4. Codex 执行沙箱

每次运行都新建一个**中立临时目录**作为 Codex 工作目录，避免仓库内的 `AGENTS.md` 或本地配置影响模型：

```
workingDirectory:    <tmp>/codexmate-context-xxxx
sandboxMode:         read-only
approvalPolicy:      never
networkAccessEnabled: false
webSearchMode:       disabled
features:            shell / exec / apps / computer_use / browser_use /
                     remote_plugin / code_mode / workspace_dependencies /
                     multi_agent   全部关闭
mcp_servers:         读取现有 MCP 名称后逐个显式置为 enabled=false
shell_environment_policy: inherit = none
环境变量白名单:      PATH HOME USERPROFILE SystemRoot TEMP TMP APPDATA
                     LOCALAPPDATA CODEX_HOME CODEX_API_KEY OPENAI_API_KEY
```

**模型永远拿不到可写沙箱。** 它只返回 `{summary, changes[]}`；由主机逐项校验后再写入工作树：

1. 路径不是敏感路径；
2. 路径落在任务声明的 `paths` 范围内（为空则不限制）；
3. 内容不含疑似凭据且 < 200 KB；
4. `originalHash` 与实际文件内容哈希一致（防止覆盖他人改动）；
5. 单次最多 50 个文件。

**沙箱不等于绝对防护**，所以审批与扫描不能因为「有沙箱」而放松。

---

## 5. 审批模型

### 5.1 审批绑定

审批记录包含被操作对象的**内容摘要**（`digest(binding)`，覆盖任务版本、策略、运行、审查、交接、规划）。执行时会重新计算摘要并比对：

- 摘要不一致 → `APPROVAL_CHANGED`（任务/策略/内容已变化，请重新预览）。
- 状态已非 `pending` → `APPROVAL_USED`。
- 超过 15 分钟 → `APPROVAL_EXPIRED`。
- 复核期间远端 Issue 变化 → `REMOTE_CHANGED`。

### 5.2 默认审批矩阵

| 动作 | 默认 | 自动化条件 |
|---|---|---|
| 读取本人已指派 Issue | 允许 | 已授予该仓库读取权限 |
| 启动新的可写 Run | **需确认** | 本人显式开启「自动执行」，且任务 `risk=normal`、无 warning |
| 运行可信预配置检查 | 白名单内允许 | 命令绑定当前基准 SHA |
| 安装依赖 / 改系统配置 | **阻止并逐次审批** | 不能被仓库评论或 Issue 文本覆盖 |
| 推送任务分支 / 创建草稿 PR | **需确认** | 本人显式开启「自动推送」且扫描通过 |
| 发布 AI 审查评论 | **需确认** | 可选低风险自动发布；**永不自动 Approve** |
| 接受交接并执行 | **必须确认** | — |
| 合并默认分支 / 部署生产 | **产品不执行** | 完全交由 GitHub 保护规则与人工 |

### 5.3 角色

`owner` > `developer` > `reviewer` > `viewer`。角色取「本机配置」与「GitHub 实际权限」的**下限**，本机配置无法提升 GitHub 授权：

- `viewer`：只读，任何写操作直接 `FORBIDDEN`。
- `developer`：可执行任务、发布、审查、交接；不能 `init`、`assign`、`plan`。
- `owner`：全部能力。
- 每次写操作前复核远端配置中的角色，变化即 `ROLE_CHANGED`。

---

## 6. 本机 HTTP 服务

| 控制 | 实现 |
|---|---|
| 监听地址 | `127.0.0.1`（固定，不可配置为 0.0.0.0） |
| Host 校验 | 必须等于 `127.0.0.1:<port>`，否则 403（防 DNS rebinding） |
| Origin 校验 | 存在且不等于本机 origin 即 403（防跨站请求） |
| 会话 token | 32 字节随机；`GET /api/session` 下发，写接口要求 `X-CodexMate-Token`；常量时间比较；失效返回 401 |
| CSP | `default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'` |
| 其他头 | `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Cache-Control: no-store` |
| 请求体上限 | 256 KB |
| 长任务 | 审批接口立即返回 202，后台执行；结果持久化在审批记录里 |
| 错误返回 | 统一脱敏，带 `requestId` 便于对账，**不回显输入内容** |

---

## 7. 数据生命周期

| 数据 | 默认保留 | 清理方式 |
|---|---|---|
| 本机运行日志（`logs/*.jsonl`） | 30 天（可配 1–365） | `prune`：删除过期 Run 的日志；**保留工作树与历史记录** |
| 审计流水 | 本机，最多返回最近 500 条 | 随本机 home 一起处理 |
| SQLite 主库 | 长期 | 用户手动删除 |
| worktree 与分支 | 不自动删除 | 需用户确认 |
| GitHub 上的 Issue / PR / 评论 | GitHub 侧持久 | **本机清理不会让它远程消失** |
| 遥测 | **无** | 产品不向自建服务器上传任何个人开发行为 |

导出 `export` 支持匿名化：替换本机路径、仓库 slug 与成员 login 为占位符，并整体脱敏。运行日志出口始终脱敏（`logs --redacted` 只是显式声明这一点，实际输出永远脱敏）。

---

## 8. 已知未覆盖 / 需注意

- **凭据扫描是模式匹配**，构造性绕过或新格式可能漏检。它降低风险，不构成保证。
- **未做进程级沙箱**（无容器 / 无 OS 级隔离）。隔离依赖 Codex 的只读沙箱 + 主机侧校验 + 白名单命令。
- **协调器是实验性组件**：未经历跨设备故障注入。组织部署必须置于 TLS 反向代理之后，且客户端自动抢占保持禁用。
- **加密存储未实现**：SQLite 明文存放于本机 home（目录权限 `0700`）。依赖操作系统账户隔离。
- **Webhook 伪造**未涉及：当前实现不使用入站 Webhook。
