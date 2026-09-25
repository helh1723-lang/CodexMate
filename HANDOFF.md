# CodexMate 开发交接

更新：2026-09-25。当前目标是极简双 Agent 协作聊天，当前分支 `codex/minimal-agent-chat`。原 v1.1 检查点为标签 `pre-chat-redesign-20260924`（9986ddb）；本轮尊重用户通过另一 Agent 删除旧版的决定，不恢复旧工作台。

## 可以独立接续的入口

1. `npm ci`，然后 `npm run check`。
2. `npm run desktop` 打开桌面；或 `npm start` 打开本机浏览器服务。
3. 中转本机测试：`npm run relay -- --home .local/relay --port 8787`。
4. 双方配置真实同一 Git 远端、各自登录、创建/加入房间并各自授权。
5. 异地部署、打包和诊断命令见 [docs/operations.md](docs/operations.md)。

## 本轮做了什么

当前更新版本 `2.0.0-alpha.2`，版本变更见 [CHANGELOG.md](CHANGELOG.md)。原始日志、验证报告和本机路径通过 `.gitignore` 排除，GitHub 仅发布脱敏验证摘要和已检查的界面截图。

复查最新代码，修复了 Electron 启动卡死、手动上下文 payload、上下文积压预算、历史分页、停止竞态、停止后权限请求、脏工作树审查、补充要求后的过期审查，以及 WebSocket 超大消息和重复连接问题。新增回归测试。完整修复记录见 [docs/progress.md](docs/progress.md)。

`npm run check` 当前通过 23 项测试。真实 Electron 能打开窗口并识别本机 ChatGPT 登录。完整证据、剩余限制以 [docs/acceptance.md](docs/acceptance.md) 为准，不以版本号判断完成。

## 已推送状态

- 提交 `c2b6844`，81 个文件（+1996 / -3543），分支 `codex/minimal-agent-chat`，已推送到 `origin`。
- `main` 未改动，仍为 9986ddb；旧版状态由标签 `pre-chat-redesign-20260924`（9986ddb）追溯，标签已推送。
- PR #1（draft）：<https://github.com/helh1723-lang/CodexMate/pull/1>。保持 draft，双人双机实测完成前不合并主分支。
- 上传前已扫过凭据特征、明文 URL 账号密码、本机路径与账号标识；未发现残留。`.workbuddy/memory/`、`artifacts/desktop/`、`dist/`、`web-dist/`、`.local/` 均不入库。

### 本机 git 目录坑（会重复出现）

本机 git 无法在 `.git/` 下新建目录：`codex/minimal-agent-chat` 这类含 `/` 的分支名，`git commit` 会写出对象和 reflog，但**引用文件写不进去**，于是 `git log` 报 "does not have any commits yet"。`fetch` / `push` 的远端跟踪引用同样不会落地。修法是手动补目录再写文件：

```sh
mkdir -p .git/refs/heads/codex .git/refs/remotes/origin/codex
printf '%s\n' '<sha>' > .git/refs/heads/codex/minimal-agent-chat
printf '%s\n' '<sha>' > .git/refs/remotes/origin/codex/minimal-agent-chat
```

`git pack-refs` 会把 `refs/remotes/origin/*` 收走，之后这些文件会消失，属正常。

## 仍需做的事

- 找第二个账号和实际设备，通过真实 HTTPS 中转完成一次从目标到双方实际修改、互动消息、精确 SHA 整合和审查的完整任务。
- 按 Windows↔Windows、macOS↔macOS、Windows↔macOS 分别记录；模拟 Agent 不替代这些测试。
- 在 macOS 构建并运行原生包，确认包含正确架构 Codex 可执行文件；配置发行签名/公证属于后续发布工作。
- 补做跨机故障矩阵：运行中断网、对端离线停止、进程退出、权限拒绝、冲突/两轮失败、长会话。
- Docker 模板尚需真实服务器启动和 TLS 验证。没有默认公共中转。

## 开发注意

- 新数据 `<home>/chat/codexmate.db`，旧库保留。保留所有 worktree，不能为恢复而覆盖用户原工作区。
- Git 与 SQLite 不能原子提交；未知动作必须对账，不能承诺全局 exactly-once。
- 修改上下文预算时同步更新 `context.ts` 注释、协议和回归测试。
- Codex 固定 0.156.1；动态工具属于实验协议。升级前重新核对官方类型并跑实际 smoke。
- 模型本机凭据和线程留在各自设备；中转可见消息正文，不能宣传端到端加密。
- 验证桌面程序前先清掉 `ELECTRON_RUN_AS_NODE`。某些代理式终端会注入该变量，Electron 会退化成纯 Node 运行，现象是应用秒退、退出码 0、连 userData 都不建，日志为 `SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'`。这是环境问题，不是产品缺陷；`scripts/smoke-desktop.mjs` 已自行清理该变量。
- 本次更新在 `codex/minimal-agent-chat` 分支统一管理，版本 `2.0.0-alpha.2`；包含上一位 Agent 删除旧版的工作，不要盲目 restore/reset。主分支合并需结合 PR 和未完成验收决定。
- 额度重置、代理端口属于会变化的本机状态。不要把旧交接中的时间/端口当成当前事实，也不要运行仓库内不存在的修复脚本。
