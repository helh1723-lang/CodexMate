# CodexMate 开发交接

最后更新：2026-09-24。当前是开发中的 **1.1.0-rc.1 候选实现**，不是已通过 PRD 所有门槛的正式版本。

**判断完成度请看 [`docs/acceptance.md`](docs/acceptance.md)，不要只看版本号。** 该文档逐条列出「已实测 / 部分覆盖 / 未验证」。

## 目标与授权边界

- 实现 `CodexMate_Full_PRD.md` 中到 v1.1 为止的累计产品能力。
- 用户暂时没有用于联调的 GitHub 仓库和两位协作者；演练数据不能当作真实双机验证。
- 用户要求保留交接，能够独立运行、验证、接续开发。
- 不共享账号或额度；不迁移跨机原线程；不自动合并或部署；远端内容不能授予本机执行权限。

## 当前代码

- TypeScript / Node 22、React / Vite、SQLite 项目基础，依赖已安装。
- `src/core`：任务、运行、审批、交接、审查、规划、策略、诊断，共享 Service。
- `src/store`：SQLite WAL、事务、事件去重、审计与本机写锁。
- `src/adapters`：真实 gh REST、Git worktree、扫描与提交、Codex SDK 结构化修改建议。
- `src/server`：127.0.0.1 API、Host/Origin/token 检查、共享审批入口。
- `src/web`：中文总览、任务看板、依赖图、审查、交接、规划、质量、审批与设置。
- `src/cli` / `src/mcp`：CLI 与 stdio MCP；MCP 只提出写请求，不提供批准工具。
- `src/scheduler`：SQLite 事务 lease/fencing；过期不自动接管，需旧持有人确认停止。
- `src/operations`：声明式适配器、Ed25519 发布签名。
- 演练种子数据使用独立数据库，不调用真实 Codex 或 GitHub。
- `README.md` + `docs/`（architecture / protocol / security / operations / acceptance）已补齐，并被 `package.json#files` 收录。

## 本轮改动（2026-09-24）

| 变更 | 说明 |
|---|---|
| **修复** `release sign` 参数冲突 | 子命令的 `--version` 会被根命令全局 `-V/--version` 抢占，导致只打印版本号就退出、**签名清单从未写出**。改为 `--release-version`；`--out` 命中已存在文件时抛 `MANIFEST_EXISTS` 而不是裸 `EEXIST`。 |
| 修复 `stageRelease` 签名类型 | 与 `verifyRelease` 统一为 `string \| KeyObject`。 |
| 可测试性改造 | `GitHub` 增加可注入执行器（`constructor(slug, run = exec)`）并导出 `GitHubLike`；`Service` 增加可注入 GitHub 工厂。生产路径不变，测试可在**进程边界**替换 `gh`。 |
| 协调器状态码 | 鉴权失败 401、越权/缺 fence 403、租约冲突仍 409（此前统一 409，运维无法区分配置错误与并发争抢）。 |
| 新增测试 | `tests/github.test.ts`(10)、`tests/sync.test.ts`(6)、`tests/release.test.ts`(4)、`tests/coordinator.test.ts`(1)、共用工具 `tests/helpers.ts`。测试总数 23 → **44**。 |
| 新增文档 | `README.md`、`docs/*.md`（此前 `package.json#files` 引用了不存在的 `README.md` 与 `docs`，`npm pack` 一直静默丢弃）。 |

## 检查点状态

全量复验（2026-09-24）结果：

```
npm run typecheck   ✅ 0 错误
npm test            ✅ 44 / 44 通过（≈20s）
npm run build       ✅ tsc + vite（4570 modules）
npm run test:ui     ✅ 2 / 2 通过
npm pack --dry-run  ✅ 52 files，含 README 与 docs
```

本机环境实测：Node v22.22.2、Git 2.55.0、gh 2.96.0（已登录，`repo` 权限）、codex-cli 0.156.1（ChatGPT 登录）。`codexmate doctor` 6 项全通过。

**仍不能声称完整产品通过验收**：真实 GitHub 仓库交互、真实 Codex 执行、跨网络双人 E2E、跨设备故障注入、跨平台安装均未验证。详见 `docs/acceptance.md` 第 3–6 节。

## 自主操作

```powershell
Set-Location 'E:\vibe coding\codexmate'
npm ci
npm run typecheck
npm test
npm run build
npm run test:ui
npm run demo
```

浏览器打开 `http://127.0.0.1:4317`。若构建失败，先依据错误修复。
真实空工作台：`npm start`（先 build）；诊断：`npm run cli -- doctor`。
演练状态在 `.local/demo/`；真实 CLI 默认使用本人 `~/.codexmate/`，可用 `--home` 指定。
不要把演练 home 用于真实仓库；不要提交数据库、认证文件或真实日志。

> Windows 提示：Bash 工具默认 PATH 缺少 coreutils，需要先
> `export PATH="/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:$PATH"`；
> PowerShell 工具在该机器上常返回空 stdout，建议把输出重定向到文件再读。

## 接续顺序

1. 读取本文件和 `docs/acceptance.md`，不要只凭版本号宣布完成。
2. 运行 typecheck/test/build/test:ui，修复失败项，再扩展功能。
3. 真实仓库可用后，两个不同用户、不同网络完成 Issue → worktree → SDK → PR → review 和 checkpoint 接力（T01/T03/T04/T06/T09）。
4. 多人协调、签名分发未验证时保持禁用；租约单元测试不等同跨设备无双写保证。
5. 可选：补 `LICENSE`、初始化 Git 仓库（当前工作区不是 Git 仓库，`docs/` 与 `README.md` 尚未纳入版本控制）。

## 注意事项

- **子命令不要使用 `--version`**：会被根命令的全局 `-V/--version` 抢占并直接退出，静默不执行。新增 CLI 参数时留意同名冲突。
- GitHub assignee/正文不是原子锁，不能承诺默认模式多机 exactly-once。
- Runner 只读生成变更，主机校验路径/哈希再写入。SDK 用户配置/MCP 继承须审查，不能仅靠提示词声称安全。
- 审批绑定内容、版本、策略；过期、重复、远端变化均需阻止。
- 日志/导出/发布扫描或脱敏；二进制、符号链接、敏感路径保留人工处理入口。
- 未运行测试显示「未运行」；真实额度显示「未知」。
- 测试中的离线执行器只替换 `gh` 进程，**不替换被测代码**；新增适配器逻辑应沿用这一注入方式，不要退化成 mock 替身。
