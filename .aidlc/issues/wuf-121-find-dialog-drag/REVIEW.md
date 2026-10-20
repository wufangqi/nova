# 评审报告 — WUF-121 Find 工作台居中可拖 + Intent/Actions 迁入

- **对照点**：`37ba57a` … `1f24106`（集成分支 `feature/wuf-121-find-dialog-drag`）
- **规格**：本目录 `SPEC.md`（背景见 `grill.md`；实现说明见 `IMPLEMENT.md`）
- **结论**：需改
- **本地契约**：`npx tsx --test` 跑 `find-dialog-desktop-contract` / `find-workbench-geometry-contract` / `shell-workbench-layout-contract` / `shell-chrome-contract` → **35 pass / 0 fail**（相关合同均绿，但未拦住下方焦点与居中问题）

---

## Standards

### 文档化标准

仓库无 `CODING_STANDARDS.md` / `CONTRIBUTING.md`。整体接缝与既有桌面合同风格一致：纯几何模块 `find-workbench-geometry.ts`、壳薄断言 `shell-workbench-layout.ts`、`tests/*-contract.test.ts`。SPEC 要求标签文案 `查找 | 替换 | Intent`，与壳菜单英文并存，**不**视为违规。

### 基线气味（均为判断项，非硬违规）

1. **Speculative Generality** — `hostsIntentOrAction()` 恒 `true`；`hasPersistentGeometryKey()` 恒 `false`；`WorkbenchGeometry` 与 `WorkbenchPoint` 同形别名。
2. **Duplicated Code** — 默认尺寸 `576`/`420` 在 `find-dialog.ts` 与 `workbenchDialogSize()` 回退中重复；命中复数文案在 `main.ts` 多处。
3. **Data Clumps** — `ClientSize` + `WorkbenchSize` 成对穿过 `openDialog` / `dragTitleBar` / `resolveGeometry`。
4. **Divergent Change** — `FindDialog` 同时承载标签、几何会话记忆、标记与 Intent 焦点（几何已抽出，仍偏胖）。
5. **控制流隐患（见 Spec）** — `applyRegexDraft` 中 `focusIntent?.() ?? focusPattern()`：`void` 使 `??` 右侧几乎总会执行。

**本轴汇总**：硬违规 0 · 判断项气味若干；真正要改的问题落在 Spec 轴行为错配。

---

## Spec

### (a) 缺失 / 部分

1. **Intent Preview/Accept 合同偏薄**  
   Testing Decisions：「工作台 Intent 页可 Preview/Accept；Actions 列表存在」。DOM/壳合同锁住 `.intent-panel` / `.action-panel` 在 `#find-dialog` 内，且 `main.ts` 仍挂接 Preview/Accept/Reject/Undo / Refresh；但新合同未行使 Intent Preview→Accept 路径，`hostsIntentOrAction()` 恒真无法防迁移回退到「只剩空壳」。**部分**。

### (b) 范围蔓延

- Esc 关闭工作台（`main.ts`）— 规格未点名，无害。

### (c) 实现看起来对但实际有问题（需改）

1. **RegexDraft 焦点落到查找框，而非 Intent 输入**  
   规格：「RegexDraft 仍打开工作台并落到 Intent 标签」；合同已断言 `focusIntentCalls === 1`，但未断言不调 `focusPattern`。  
   `find-dialog.ts` `applyRegexDraft`：`this.surface.focusIntent?.() ?? this.surface.focusPattern()` — `focusIntent()` 返回 `void`/`undefined`，`??` 右侧几乎总会再调 `focusPattern()`，焦点被抢到隐藏的查找框。

2. **打开 Intent 页时用错尺寸做居中**  
   规格：「打开时默认居中」/ `present(): … else centerInClient()`。  
   `openFindChrome` / `applyRegexDraft` 在 `present` / `syncWorkbenchTabUi` **之前**调用 `workbenchDialogSize()`；此时 `#find-panel-intent` 仍 `hidden`，量到的是查找页高度。随后切到更高的 Intent（含 Actions）面板，视觉中心偏上。File→Intent… 与 RegexDraft 入口受影响。

### 已对齐（无发现）

- 纯几何：居中 / 拖拽 / 夹紧 / 会话记忆 / 无安装级持久化键（`find-workbench-geometry` + FindDialog 合同）。
- 主壳无底栏两面板；`.app` grid `auto auto auto 1fr auto`；编辑区邻接状态栏（HTML/CSS 合同有效）。
- Intent 页 DOM 承载 Preview/Accept/Reject/Undo、Cloud path/Suggestions、Save as Action、Actions+Refresh；Ctrl+F / File→Find… / File→Intent… 入口在 chrome 合同中。
- Replace Accept / RegexDraft 不静默写 Buffer；标记激活与 dismiss/Buffer 编辑清除有合同。
- 无截图门禁、无安装级位置路径断言。

**本轴汇总**：主路径大半落地；**焦点回落**与 **Intent 入口居中测高** 为明确需改点；Preview/Accept 合同偏薄为次要缺口。

---

## 收束说明

本票为 **单票**（`mt_branch_role=integration`，无 Work 子票）。代码已在集成分支 `feature/wuf-121-find-dialog-drag`（`1f24106`），**无需合回**。结论 **需改**：请实现侧修焦点与 Intent 测高居中，并补能拦住的合同后再交评审。
