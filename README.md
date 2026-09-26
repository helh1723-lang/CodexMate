# CodexMate

两个人的 Codex，一起做同一件事。

Codex 的会话是绑在本机的：你在自己机器上和 Codex 聊了半天，同伴在另一台机器上跑 Codex，它对你们聊过的内容一无所知。CodexMate 解决的就是这件事——**让两个独立账号、两台机器上的 Codex 知道对方做了什么，再把这个"知道"变成真正能合并的成果。**

不是共享账号，不是共享额度，也不是把线程拷来拷去。各自的 Codex 留在各自的机器上执行，只互传**脱敏后的进展**和**真实提交**。

---

## 它怎么解决上下文割裂

两侧都不转让自己的线程所有权，但可以同步"长什么样"：

| 机制 | 传什么 | 解决什么 |
|---|---|---|
| **进展增量同步** | 改动文件路径、执行过的命令与结果、当前轮次的关键结论 | 你的 Codex 知道同伴已经写到哪一步、定了什么接口，不必重复试探 |
| **同伴消息** | `peer_send` 明确指派给对方的话 | 需要对方行动时才唤醒对方，不做无意义的互相致谢 |
| **结果交换** | 真实 commit SHA、分支、约定检查输出 | 同伴的成果是可验证的提交，不是一句"我写好了" |
| **整合与互审** | 发起方合并双方分支，交给同伴 Codex 审查 | 由两边交叉验证，而不是一方说了算 |

### 上下文为什么不会把彼此撑爆

两只 Codex 互传上下文，最容易演变成「你把我说的话复述一遍、我把你的复述再回传」的放大回路，几轮之后上下文窗口就废了。所以这里做了四道闸：

1. **增量同步** —— 按上次同步位置发送新增条目；锚点已离开最近历史页时降级为有预算的最近进展。
2. **节流与次数上限** —— 自动同步有冷却时间，每个任务的同步次数有上限。
3. **分层压缩** —— 注入提示词时只完整保留最新若干条，更早的折叠成一行计数。
4. **字节预算** —— 自动同步条目 12 KB、手动同步条目 48 KB；单次提示词中全部待同步上下文合计最多 6,000 UTF-8 字节。

普通自动唤醒会标记已注入的上下文，不逐轮重复附加；不确定的进程重启需要用户对账后继续。手动同步仅更新同伴上下文，不单独唤醒 Agent。

---

## 快速开始

源码运行需要 Node.js ≥ 22.13、Git、共享 Git 远端和自己的 Codex 账号。产品已固定并打包 Codex 0.156.1，支持在设置中登录。

```bash
npm install
npm run build
npm run desktop        # 打开桌面端
```

两边都要做同一件事：**先各自选同一个 Git 远端仓库，再连到同一个房间。**

详细的逐步说明见 [`docs/getting-started.md`](docs/getting-started.md)。

### 部署中转服务

异地协作需要一个双方都能连到的中转。账号凭据和线程 ID 留在本机；中转能读取并存储消息、命令输出、文件路径和摘要，其中可能包含代码片段。当前仅使用 TLS 保护传输，没有端到端加密，需使用可信服务器。

```bash
# 先按 docs/operations.md 设置 RELAY_DOMAIN 并解析域名
docker compose -f templates/relay/compose.yaml up -d --build
# 或本地测试
npm run relay         # http://127.0.0.1:8787
```

远程中转必须是 HTTPS/WSS，本机 loopback 测试允许 HTTP。

### 命令行

```bash
codexmate ui          # 默认：启动本机界面
codexmate relay       # 运行中转服务端
```

---

## 不可动摇的边界

这些是设计选择，不是还没做：

- **不共享账号、凭据、额度。** 各自登录各自的 Codex。
- **不跨机恢复原线程。** 同步的是脱敏后的上下文投影，不是线程本身；仍是各自的会话。
- **不接管用户手动开的 Codex 会话。** CodexMate 只管理自己在 `cm/` 下创建的工作树。
- **不自动合并主分支或部署。** 双方提交会自动整合到 `cm/` 成果分支，主分支合并与发布由你决定。
- **远端内容一律视为不可信数据。** 同伴消息和上下文只用于已授权任务，不能扩大本机权限。
- **额度与限流显示「未知」，不做估算。**

---

## 仓库结构

```
src/chat/     协作聊天主链路：服务状态机、本机 App Server、线路类型
src/chat/context.ts  上下文同步：归一化、脱敏、增量、预算
src/relay/    中转服务（Express + WebSocket，去重/重放/在线状态）
src/web/      界面（React）
src/desktop/  Electron 外壳
docs/         文档（getting-started / protocol / security / acceptance）
templates/relay/  Docker + Caddy 部署模板
```

---

## 下载桌面版

从 [GitHub Releases](https://github.com/helh1723-lang/CodexMate/releases) 下载 `2.0.0-alpha.3`：

- Windows x64：`CodexMate-2.0.0-alpha.3-Windows-x64.exe`
- Apple silicon Mac：`CodexMate-2.0.0-alpha.3-macOS-arm64.dmg`
- Intel Mac：`CodexMate-2.0.0-alpha.3-macOS-x64.dmg`

桌面包包含 Electron 和固定版本 Codex CLI，不需要另装 Node.js。Windows 运行 `.exe` 并按安装向导操作；Mac 打开匹配芯片型号的 `.dmg`，将 CodexMate 拖到“应用程序”。每台电脑仍需安装 Git、登录自己的 Codex 账号，并配置双方共同使用的 Git 远端和 HTTPS 中转。

本 alpha 尚未代码签名，macOS 包也未公证。请先核对 Release 的 SHA-256；Windows SmartScreen 或 macOS Gatekeeper 仍可能拦截。Mac 首次尝试打开后，如确认下载来源和校验值可信，可在“系统设置 → 隐私与安全性”中使用“仍要打开”。详见 [Apple 官方说明](https://support.apple.com/zh-cn/102445)。

## 完成度

不要只看版本号判断交付状态；请以 [`docs/acceptance.md`](docs/acceptance.md) 的实测记录和未验收清单为准。

Windows x64 安装包会在原生 Windows runner 上完成安装、启动和捆绑 Codex CLI 检查；macOS arm64 与 x64 包会分别在原生 Apple silicon 和 Intel runner 上挂载、检查架构并启动验证。两账号跨设备完整协作、实际用户 Mac 安装体验及异地 TLS 部署仍需继续验收。

技术架构见 [docs/architecture.md](docs/architecture.md)，部署打包见 [docs/operations.md](docs/operations.md)，进度见 [docs/progress.md](docs/progress.md)，接续开发见 [HANDOFF.md](HANDOFF.md)。

`2.0.0-alpha.3` 从 `codex/minimal-agent-chat` 独立分支构建，尚未合并到 `main`。上一版 v1.1 工作台保留在标签 `pre-chat-redesign-20260924`。

## 许可

MIT
