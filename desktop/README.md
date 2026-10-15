# Nova desktop（Tauri）

Windows-first 桌面壳：经 IPC 薄封装挂接仓库根目录的 `IntentService` / `EditorShell` / FindBar 等。**Accept 只走核心合同**，不另开写入路径。

对应 Stage：**WUF-80**（`feature/wuf-80-tauri-shell`）。

## 依赖

| | Windows（主目标） | Linux（尽力而为） |
| --- | --- | --- |
| Node | 20+ | 20+ |
| Rust | `rustup` stable | 同左 |
| WebView | WebView2（`tauri.conf` 可引导下载） | `libwebkit2gtk-4.1-dev` 等（见下方） |

## 开发

均在**仓库根**（`nova/`）执行：

```bash
npm install
npm run build
npm --prefix desktop install
npm run desktop:dev
```

### Linux 一次性系统依赖

```bash
# 仓库根
./scripts/install-desktop-linux.sh
```

或手动 `apt` 安装 WebKit/GTK/glib 开发包后再跑 `npm run desktop:dev`。

### 无 GUI 冒烟（任意 OS）

```bash
npm run demo:visual-ten-second
```

## 窗口内自测清单

1. 启动后有一个 Untitled 标签；输入后标题出现 `*`
2. **New** 开第二标签；点击切换
3. Path 栏 **Open** / **Save**（未命名走另存）
4. 干净 Untitled **Close** 无提示；脏则确认
5. **Ctrl+Alt+N**（全局）→ 聚焦并新建 Untitled，旧标签保留
6. Intent（如 `uppercase`）→ **Preview** → 看 diff + Cost → **Accept** / **Reject**；Accept 后 **Undo**
7. 打开 **Cloud path** → Preview 出现 Outbound 提示
8. **Demo** → 粘贴 `hello demo` → 预览 → Accept（无本地模型时 AI 失败有指引，编辑器仍可用）

## 打包与发布

```bash
# 仓库根：编译核心 → 拷贝 dist 到 Tauri resources → 打 MSI/NSIS
npm run desktop:build
```

- **Windows（本机）**：`desktop/src-tauri/target/release/bundle/{msi,nsis}/`
- **CI 发布**：推送 `v*` tag 或手动跑 Actions **Windows Release** → [Releases](https://github.com/wufangqi/nova/releases/latest)
- CI 会把便携 `node.exe` 打进安装包，用户无需先装 Node
- **Linux**：安装器目标仍是 Windows；本机可用 `scripts/install-desktop-linux.sh` 出二进制

## IPC 约定

- Host：Node 跑 `dist/ipc/cli-host.js`（dev 可用 tsx 跑 `src/ipc/cli-host.ts`）
- 协议与方法名：`../src/ipc/protocol.ts`
- 覆盖 host：`NOVA_IPC_HOST`
- 默认开云端标记：`NOVA_CLOUD_ENABLED=1`

前端 `invoke(*_cmd)` → host method → 核心 API。完整命令表以 `protocol.ts` 与 `src-tauri` 中的 command 注册为准；常见路径：

| UI | Host / 核心 |
| --- | --- |
| 标签 / 编辑 / 打开保存 | `EditorShell.*` |
| Intent Preview / Accept / Undo | `IntentService.parse` · `preview` · `accept` · `undo` |
| 全局热键 | OS shortcut → `evoke` + `hotkey-evoke` 事件 |
| Demo | 与 `runVisualTenSecondDemo` 同一 IPC 序列 |
