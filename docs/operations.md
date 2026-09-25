# 启动、部署与打包

## 本机开发

需要 Git 和 Node.js 22.13+。新安装推荐 `npm ci` 保持锁文件一致。

```sh
npm ci
npm run check
npm run desktop
# 或浏览器本机界面
npm start
```

浏览器地址 `http://127.0.0.1:4317`。测试时使用独立 home：

```sh
npm run cli -- ui --home .local/client-a --port 4317
npm run cli -- ui --home .local/client-b --port 4318
npm run relay -- --home .local/relay --port 8787
```

上述两个客户端仍是同一台电脑、同一默认登录，仅适合本机联调，不能标成两个账号实测。测试浏览器脚本会使用 4318，运行前避免端口冲突。

## 异地 HTTPS 中转

准备双方可信的服务器、已解析的域名、开放的 80/443、Docker Compose。在仓库根目录运行：

PowerShell：

```powershell
$env:RELAY_DOMAIN = 'relay.example.com'
docker compose -f templates/relay/compose.yaml up -d --build
```

macOS/Linux shell：

```sh
export RELAY_DOMAIN=relay.example.com
docker compose -f templates/relay/compose.yaml up -d --build
```

双方填 `https://relay.example.com`。Caddy 自动处理证书与 WSS，relay 8787 仅容器网络暴露。健康检查 `/health`。查看日志：`docker compose -f templates/relay/compose.yaml logs --tail 100`。

停止用 `docker compose -f templates/relay/compose.yaml down`，不要加 `-v`，否则会删除房间和消息数据卷。数据库备份应在服务停止后复制完整数据卷；本机备份同样先退出应用，并包括 SQLite WAL 文件或使用 SQLite backup API。

中转没有公共多租户运营防护和自动保留策略，也没有端到端加密，只建议可信小组自部署。模板已提供，但尚未在本次环境实际运行 Docker/TLS 部署。

## 安装包

```sh
npm run dist:win  # Windows x64 NSIS
npm run dist:mac  # 在 macOS 上运行，DMG
```

输出 `artifacts/desktop/`。CI 位于 `.github/workflows/desktop.yml`，仅手动触发或 chat-v 标签构建。GitHub 更新使用独立改造分支、PR、CHANGELOG 和明确的 alpha 版本；不会自动部署或合并主分支。macOS 按构建机器本机架构产出，避免只安装了一种 Codex 原生依赖却打包两种架构；如需 arm64 和 x64，分别在对应机器安装依赖、构建和测试。

当前没有配置 Windows 信任签名和 Apple 公证。安装包生成成功不代表安装、卸载、自动升级或所有平台均验收通过。

## 验证

```sh
npm run check
npm run test:ui
node scripts/smoke-desktop.mjs
node scripts/smoke-desktop.mjs "artifacts/desktop/win-unpacked/CodexMate.exe"
node scripts/smoke-codex.mjs
node scripts/verify-context.mjs
```

后两项会调用本机真实 Codex 并消耗本机额度。浏览器测试 Windows 用 Edge，其他平台需要安装 Playwright Chromium。无第二台机器时不得把这些结果写成跨设备完成。
