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
