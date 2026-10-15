# Nova

轻量 AI 记事本的**核心与桌面壳**（内部代号，非正式品牌名）。

以 Notepad++ 式冷启动为底：打开即用、无项目 / 无索引；AI 只提案 **Patch**，人 **Accept** 落笔。

## 当前状态

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 核心合同 | `IntentService` / Buffer / FindBar / 十秒 Demo（CLI + 测试） | 已合入 `main` |
| 桌面壳 | Tauri UI + IPC 挂接同一套核心 | 已合入 `main` |
| 性能内核 | Rust Rope / mmap 等 | 未开 |
| 产品名 / 变现 | — | 挂起 |

验证目标平台：**Windows**。Linux / macOS 尽力而为。

## Windows 安装包下载

打好的 **MSI / NSIS** 挂在 GitHub Releases：

**[最新版本下载](https://github.com/wufangqi/nova/releases/latest)**

| 包 | 说明 |
| --- | --- |
| `.exe`（NSIS） | 一般用户推荐 |
| `.msi` | 适合静默 / 企业部署 |

需要 Windows 10+；缺 WebView2 时安装器会引导补齐。安装包内嵌便携 Node，用于 Intent IPC（无需本机预装 Node）。离线 AI 仍需另备本地模型（可选）。

发布方式：推送 tag `v*`（如 `v0.1.0`），或在 Actions 里手动跑 **Windows Release** 工作流。

## 快速开始

### 核心（任意 OS）

```bash
npm install
npm test
npm run build
npm run demo:visual-ten-second   # 无 GUI：热键→粘贴→Intent→diff→Accept
```

### 桌面（推荐 Windows）

```bash
npm install && npm run build
npm --prefix desktop install
npm run desktop:dev
```

全局热键默认 **Ctrl+Alt+N**。窗口内点 **Demo** 可跑可视化十秒路径。详见 [`desktop/README.md`](./desktop/README.md)。

### 桌面（Linux，尽力而为）

需本机 `sudo` 安装 WebKit/GTK 开发包后：

```bash
./scripts/install-desktop-linux.sh
# 或：装好系统依赖后 npm run desktop:dev
```

打包安装器（MSI/NSIS）仅面向 Windows：`npm run desktop:build`。

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm test` | 合同测试（含 IPC / Demo） |
| `npm run notepad` | CLI：唤出 → 粘贴 → 保存 |
| `npm run demo:ten-second` | 进程内十秒 Demo |
| `npm run demo:visual-ten-second` | 与 Tauri 相同的 IPC 十秒路径 |
| `npm run gates:windows` | 冷启动 / 热键 / 大文件地板 |
| `npm run desktop:dev` | 启动 Tauri 开发窗 |
| `npm run desktop:build` | 打 Windows 安装包 / release |

环境变量：`NOVA_IPC_HOST` 覆盖 IPC host；`NOVA_CLOUD_ENABLED=1` 默认打开云端 Outbound 标记。

## 架构要点

```
desktop/ (Tauri UI)
    │ invoke
    ▼
src/ipc/          ← 唯一写入缝仍是 IntentService.accept
    ▼
IntentService · EditorShell · FindBar · …
```

- **真身**：Buffer（逻辑文本 + Encoding/EOL）；无 Workspace / Project。
- **离线**：编辑器可无模型运行；离线 AI / 完整 Demo 需评测机预置本地模型。默认安装包**不**强制装箱大模型。

## 目录

```
src/           核心与 CLI、IPC host
tests/         合同测试
desktop/       Tauri 前端 + src-tauri
scripts/       辅助安装（如 Linux 桌面）
```
