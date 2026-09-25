# BeefTV 桌面发布

生产桌面包使用仓库根目录的 `VERSION` 作为唯一版本源。发布脚本会把版本号、当前 Git 提交和 UTC 构建时间同时注入前端与 Go 后端，并生成不依赖 Vite 开发服务器的 Wails 应用包。

本地合同检查仍由 `scripts/verify-beeftv-local-release.sh` 负责。macOS 发布脚本会先跑该门禁；Windows 发布脚本只做本机打包，不重复整套门禁。

## macOS

```bash
./scripts/build-beeftv-release.sh
```

如果系统没有全局 Go，可通过 `BEEFTV_GO_DIR` 指定本地工具链目录：

```bash
BEEFTV_GO_DIR=/tmp/beeftv-go.rpIfVN/go ./scripts/build-beeftv-release.sh
```

产物：

```text
backend/cmd/desktop/build/bin/BeefTV.app
backend/cmd/desktop/build/bin/BeefTV.app/Contents/Resources/plugin-packages/*.beeftv-plugin
```

验收重点：

- `backend/cmd/desktop/build/bin/BeefTV.app` 存在；
- Wails 将 `frontend/dist` 编译进应用二进制；应用包内应存在 `Contents/MacOS/BeefTV`，并由构建日志确认完成 `Compiling frontend` 与 `Packaging application`；
- macOS `Info.plist` 的 `CFBundleShortVersionString` 和 `CFBundleVersion` 与根目录 `VERSION`（去掉 `v` 前缀）一致；
- `/api/health/live` 与 `/api/system/version` 返回的版本信息来自同一份发布元数据；
- 发布启动不需要 `127.0.0.1:3000` 的 Vite 开发服务器。

## Windows（amd64，必须在 Windows 本机执行）

在仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-beeftv-windows-release.ps1
```

产物：

```text
backend\cmd\desktop\build\bin\BeefTV.exe
backend\cmd\desktop\build\bin\plugin-packages\*.beeftv-plugin
```

官方插件必须和 `BeefTV.exe` 放在同一目录下的 `plugin-packages\`。从开始菜单、快捷方式或资源管理器启动时，工作目录不一定是仓库或 exe 所在目录；应用按可执行文件位置查找官方插件，不依赖当前工作目录。

### 本机前提

脚本发现缺工具就退出，不会安装全局工具，也不会改用户 PATH。

| 前提 | 用途 | 依据 |
| --- | --- | --- |
| Windows 10/11 amd64 | Wails Windows 目标 | [Wails CLI platforms](https://wails.io/docs/reference/cli) |
| Go 1.25 或更新，且在 PATH（或 `BEEFTV_GO_DIR\bin\go.exe`） | 编译桌面后端；`backend/go.mod` 要求 1.25 | 仓库 `backend/go.mod` |
| Bun 在 PATH | `wails.json` 的 `bun install --frozen-lockfile` 与 `bun run build:desktop` | 仓库 `backend/cmd/desktop/wails.json` |
| `CGO_ENABLED` 不能是 `0` | `gorm.io/driver/sqlite` 依赖 `github.com/mattn/go-sqlite3` | [go-sqlite3 README](https://github.com/mattn/go-sqlite3#windows) |
| PATH 中的 `gcc`/`clang`，或可执行的 `CC` | 编译 go-sqlite3。Go 1.25 起 Windows CGO 需要支持 DWARF 5 的 GCC（binutils 2.37 或更新） | [go-sqlite3 Windows](https://github.com/mattn/go-sqlite3#windows)、[Go Minimum Requirements · cgo](https://go.dev/wiki/MinimumRequirements#cgo) |
| 已有 `plugin-packages/*.beeftv-plugin`，或能现场打包 | 官方协议包是运行时依赖 | 仓库 `plugin-packages/build-packages.sh` |
| Microsoft WebView2 Runtime | 运行 Wails 窗口。Windows 11 通常已安装 | [Wails Windows](https://wails.io/docs/guides/windows)、[Wails installation](https://wails.io/docs/gettingstarted/installation) |

现场打包官方插件时的顺序：

1. 若已有 `plugin-packages/*.beeftv-plugin`，直接使用；
2. 否则若本机有 `bash`、`zip` 和 `node`，调用现有 `plugin-packages/build-packages.sh`；
3. 否则用 Bun 或 Node 运行 `plugin-packages/embed-documentation.mjs`，再用 PowerShell 写出带正斜杠路径的 zip。反斜杠路径会被插件校验拒绝。

构建使用与 macOS 相同的 Wails 模块 `github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`，并显式传入 `-platform windows/amd64`、`-webview2 download`。Wails 把生产二进制写到 `build/bin`。缺少 WebView2 时，下载策略会提示安装官方 bootstrapper。

本脚本不生成 NSIS 安装包。Wails 的 `-nsis` 需要另装 NSIS，且默认安装脚本是否包含 `plugin-packages\` 未经本仓库验证。当前支持的发布形态是：把 `BeefTV.exe` 和旁边的 `plugin-packages\` 一起分发。

在非 Windows 主机交叉编译出来的 exe，不能当作 Windows 验收通过。

## 启动目录与数据目录

桌面进程默认数据目录来自 Go 的 `os.UserConfigDir()`，再拼 `BeefTV`：

| 系统 | 默认数据目录 |
| --- | --- |
| Windows | `%AppData%\BeefTV`（Roaming） |
| macOS | `~/Library/Application Support/BeefTV` |

其中包含 SQLite、本地资源和迁移备份。隔离调试时设置 `CANVAS_DESKTOP_DATA_DIR`。`CANVAS_BACKEND_DATA_DIR` 只作用于 `cmd/server`，不会改桌面数据目录。

官方插件源目录是安装包内的只读输入；启动后会复制到数据目录下的 `plugin-packages\`。源目录找不到时，桌面后端无法完成启动。

需要知道的限制：

- 未签名的 `BeefTV.exe` 可能被 SmartScreen 拦截；本脚本不签名。
- 构建机没有 C 编译器时，脚本会失败。常见 MSYS2/MinGW 路径若存在但不在 PATH，脚本会指出路径，不会自动加入 PATH。
- 数据库连接串目前把数据目录与 `/open_ai_canvas.db` 直接拼接。Windows 一般接受正斜杠；数据目录名里如果出现 `?` 或 `#`，可能被当成 DSN 参数。

发布前先停止 Wails/Vite 开发进程，避免开发输出与生产构建并发写入同一目录。
