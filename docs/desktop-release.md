# BeefTV 桌面发布

生产桌面包使用仓库根目录的 `VERSION` 作为唯一版本源。发布脚本会把版本号、当前 Git 提交和 UTC 构建时间同时注入前端与 Go 后端，并生成不依赖 Vite 开发服务器的 Wails 应用包。

```bash
./scripts/build-beeftv-release.sh
```

如果系统没有全局 Go，可通过 `BEEFTV_GO_DIR` 指定本地工具链目录：

```bash
BEEFTV_GO_DIR=/tmp/beeftv-go.rpIfVN/go ./scripts/build-beeftv-release.sh
```

验收重点：

- `backend/cmd/desktop/build/bin/BeefTV.app` 存在；
- Wails 将 `frontend/dist` 编译进应用二进制；应用包内应存在 `Contents/MacOS/BeefTV`，并由构建日志确认完成 `Compiling frontend` 与 `Packaging application`；
- macOS `Info.plist` 的 `CFBundleShortVersionString` 和 `CFBundleVersion` 与根目录 `VERSION`（去掉 `v` 前缀）一致；
- `/api/health/live` 与 `/api/system/version` 返回的版本信息来自同一份发布元数据；
- 发布启动不需要 `127.0.0.1:3000` 的 Vite 开发服务器。

发布前先停止 Wails/Vite 开发进程，避免开发输出与生产构建并发写入同一目录。
