# 实现说明 — WUF-121

单票集成在 `feature/wuf-121-find-dialog-drag`（本地 tracking 名 `feature/wuf-121`）。

## 改动摘要

- **Find 工作台**：`FindDialog` 扩展为居中 / 标题栏拖拽 / 客户区夹紧 / 会话内记位置；标签 `查找 | 替换 | Intent`。
- **底栏迁移**：主壳去掉常驻 `.intent-panel` / `.action-panel`；能力迁入 Intent 页（含 Actions 列表）；壳 grid 收敛为 chrome + 编辑 `1fr` + 状态栏。
- **入口**：Ctrl+F / File→Find…；新增 File→Intent…；RegexDraft 打开 Intent 标签并标记命中。
- **标记**：`markHits` / `clearMarks` / 关窗与 Buffer 编辑清标记；不写 Buffer。

## 主缝与合同

- 主缝：`desktop/src/find-dialog.ts` + `find-workbench-geometry.ts`
- 壳薄断言：`shell-workbench-layout.ts`
- 测试：`find-dialog-desktop-contract`、`find-workbench-geometry-contract`、`shell-workbench-layout-contract`、`shell-chrome-contract` 等

## 评审返工（相对 REVIEW 需改三项）

1. RegexDraft 焦点：显式二选一聚焦 Intent，合同断言 `focusPatternCalls === 0`。
2. Intent 入口居中：`present` 后再 `measureSize(tab)` 重排；合同覆盖 File→Intent… 与 RegexDraft 用 Intent 页高度。
3. Intent Preview→Accept：合同走 `preview_intent` → `accept` 写 Buffer，避免空壳回归。
