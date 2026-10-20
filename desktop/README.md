# Nova desktop（Tauri）

Windows-first 桌面壳：经 IPC 薄封装挂接仓库根目录的 `IntentService` / `EditorShell` / FindBar 等。**Accept 只走核心合同**，不另开写入路径。

当前版本与安装包对齐：**v0.1.1**。

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
2. **File → New**（Ctrl+N）开第二标签；点击切换；**Ctrl+W** 关标签（脏则三路确认）
3. **File → Open… / Save / Save As…**（Ctrl+O / S / Shift+S）
4. 编辑区占满视口；长文可纵向滚、长行可横向滚；左侧 **行号 gutter** 横向钉左
5. **Ctrl+G** 跳行弹层：Enter 跳转 / Esc 关闭
6. **Ctrl+F** 打开 Find 工作台（居中；标题栏可拖）；切换 **查找 / 替换 / Intent** 页签
7. Intent 页：自然语言或手改 pattern → 命中高亮（不写 Buffer）→ Preview → Accept；Actions 列表在同一页
8. **Help → Demo…**：粘贴 `hello demo` → 预览 → Accept（无本地模型时 AI 失败有指引，编辑器仍可用）
9. **Help → About**：产品名与版本（应与安装包一致）
10. **Ctrl+Alt+N**（全局）→ 聚焦并新建 Untitled，旧标签保留

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
| Find 工作台（查找 / 替换 / Intent） | `find` · `preview_replace` · `replace_accept` · `apply_draft` |
| Intent Preview / Accept / Undo | `IntentService.parse` · `preview` · `accept` · `undo` |
| Save as Action / 列表再跑·改名·删 | `ActionService.*`（经 IPC；落笔仍走 `accept` / `reject`） |
| 全局热键 | OS shortcut → `evoke` + `hotkey-evoke` 事件 |
| Demo | 与 `runVisualTenSecondDemo` 同一 IPC 序列 |
