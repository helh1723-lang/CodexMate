# 极简聊天交接入口

最后更新：2026-09-25。当前统一交接在 [HANDOFF.md](HANDOFF.md)，完整验收证据在 [docs/acceptance.md](docs/acceptance.md)，本轮问题和修复在 [docs/progress.md](docs/progress.md)。

上一位 Agent 的旧版删除操作保留，未恢复旧工作台。原版本可从标签 `pre-chat-redesign-20260924`（9986ddb）追溯，该标签现在也已推送到远端 `origin`，两端都能取到。

当前上下文实现不依赖 `thread/inject_items`；通过明确提示词注入，本轮已用真实 Codex 的两个独立线程验证召回。旧文档里的额度重置时间、代理端口和不存在的 `sync_proxy_env.py` 不再作为接续指引。

## 发布状态

改动已提交为 `c2b6844`（81 个文件，+1996 / -3543）并推送到 `origin/codex/minimal-agent-chat`；`main` 未改动，仍是 9986ddb。审查记录见 PR #1（draft）：<https://github.com/helh1723-lang/CodexMate/pull/1>。保持 draft 是因为双人双机实测还没做，未达标前不合并主分支。
