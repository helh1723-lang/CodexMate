# 极简聊天交接入口

最后更新：2026-09-25。当前统一交接在 [HANDOFF.md](HANDOFF.md)，完整验收证据在 [docs/acceptance.md](docs/acceptance.md)，本轮问题和修复在 [docs/progress.md](docs/progress.md)。

上一位 Agent 的旧版删除操作保留，未恢复旧工作台。原版本仍可从本地 Git 标签 `pre-chat-redesign-20260924`（9986ddb）追溯；没有重新验证该标签是否存在于远端。

当前上下文实现不依赖 `thread/inject_items`；通过明确提示词注入，本轮已用真实 Codex 的两个独立线程验证召回。旧文档里的额度重置时间、代理端口和不存在的 `sync_proxy_env.py` 不再作为接续指引。
