# 评审报告 — WUF-121 Find 工作台居中可拖 + Intent/Actions 迁入

- **对照点（首轮）**：`37ba57a` … `1f24106` → 结论需改（见历史说明）
- **对照点（本轮）**：`55ba505` … `5479619`（集成分支 `feature/wuf-121-find-dialog-drag`）
- **规格**：本目录 `SPEC.md`（背景见 `grill.md`；实现说明见 `IMPLEMENT.md`）
- **结论**：通过
- **本地契约**：`npx tsx --test` 跑 `find-dialog-desktop-contract` / `find-workbench-geometry-contract` / `shell-workbench-layout-contract` / `shell-chrome-contract` → **38 pass / 0 fail**

---

## 本轮对三条需改的核对

| # | 上轮问题 | 本轮结果 |
| --- | --- | --- |
| 1 | RegexDraft 经 `focusIntent ?? focusPattern` 焦点回落查找框 | **已修** — `focusWorkbenchField()` 显式二选一；合同断言 `focusIntentCalls === 1` 且 `focusPatternCalls === 0` |
| 2 | Intent 入口按查找页高度居中 | **已修** — `present` 后 `measureSize(tab)` → `relayoutAfterPresent`；File→Intent… / RegexDraft 合同断言 Intent 尺寸居中（`topPx: 150`，非 Find 的 `250`） |
| 3 | Preview→Accept 合同偏薄 / `hostsIntentOrAction` 死断言 | **已修** — 新增用例走 `preview_intent` → `accept`，Buffer 变为 `HELLO world`，工作台仍停在 Intent（非仅恒真守卫） |

### 未回归（上轮已判到位）

几何居中 / 拖拽 / 夹紧 / 会话记位置；主壳无底栏两面板与 grid；Replace/RegexDraft 不静默写 Buffer；标记清除；File 菜单含 Find / Intent… 与 Ctrl+F — 相关合同仍绿。

---

## Standards

### 文档化标准

无硬违规。修复接缝清晰：`measureSize` 可选 surface 钩子、`focusWorkbenchField` / `relayoutAfterPresent` 命名清楚。

### 基线气味（判断项，不挡通过）

1. **Middle Man（轻）** — `measureWorkbenchSizeForTab` 几乎只是 `syncWorkbenchTabUi` + `workbenchDialogSize`。
2. **Shotgun Surgery（轻、预期）** — 可选 `measureSize` 跨 surface / FindDialog / main / 合同。
3. 上轮列出的 `hostsIntentOrAction` 恒真等气味仍在，但 Preview→Accept 路径断言已补足验收意图。

**本轴汇总**：硬违规 0。

---

## Spec

### 首轮缺口（已关闭）

见上表三条。破损的 `??` 焦点写法已删除；居中在目标标签可见后重测；Preview→Accept 有真实写 Buffer 断言（经 Intent IPC，非按钮点击；与壳 DOM 合同一起足以防「空壳」回退）。

### (a)(b)(c)

本轮相对 SPEC 无新增缺失 / 蔓延 / 错配。

**本轴汇总**：规格满足；三条需改均 FIXED。

---

## 收束说明

本票为 **单票**（`mt_branch_role=integration`，无 Work 子票）。代码已在集成分支 `feature/wuf-121-find-dialog-drag`（`5479619`），**无需合回**。结论 **通过**。
