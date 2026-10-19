# 评审报告 — WUF-119 编辑器可编辑表面未撑满视口

- **对照点**：`7d8febd` … `36340c6`（集成分支 `feature/wuf-119-editor-surface-fill`）
- **规格**：本目录 `SPEC.md` / `grill.md`
- **结论**：通过（单票已在集成分支，无工作分支需合回）
- **本地契约**：`editor-viewport-scroll-contract`（含 WUF-118 CSS + 本票几何）与 width / gutter / TitleChrome / Intent / Action / Find / Recovery / virtual-editor 相关用例均绿；无截图门禁

---

## Standards

### 文档化标准

无硬性违规。仓库无 `CODING_STANDARDS.md` / `CONTRIBUTING.md`。改动沿用既有 WUF-111/118 接缝：策略与探针在 `editor-layout.ts`，运行时落在 `VirtualEditor`，CSS 兜底 + Node 契约同套合并，与既有 `*contract.test.ts` 风格一致。

### 基线气味（均为判断项，非硬违规）

1. **Duplicated Code** — `surfaceFillsViewportClientHeight` 与 `gutterFillsViewportClientHeight` 谓词同形，仅高度字段不同；可抽一层共享，但与 WUF-118 分探针写法一致。
2. **Duplicated Code** — `EDITOR_SURFACE_PAD_TOP_BOTTOM_REM = 0.85` 需与样式表上下 padding 同步；属既有双锁模式。
3. **Mysterious Name（测试）** — 「fill still holds after a non-zero scrollTop」用例未设置/断言 `scrollTop`，名称略过称。
4. **Shotgun Surgery** — 高度地板跨 layout / VirtualEditor / CSS / 契约四文件；对本仓布局接缝属预期。

### 对齐良好

`refreshSurfaceHeight` 在空/disabled `bind`、`syncWindow`、`flushEdit`、`ResizeObserver(.editor-viewport)` 后写入 window / textarea / gutter 的 `minHeight`；CSS `min-height: 100%` 仍作兜底并由 `assertEditorViewportScrollCss` 锁 gutter。

**本轴汇总**：硬违规 0 · 判断项气味若干（最重：测试名对 scrollTop 过称）。

---

## Spec

### (a) 缺失 / 部分

1. **VirtualEditor 应用路径未进契约（软缺口）**  
   规格 Testing Decisions：「协作：…可用轻量集成/合同覆盖『重算后表面高度』」。现测仅对 `editorSurfaceMinHeightPx` / `probeEditorSurfaceFill` 做纯函数断言，无 DOM 集成证明三处 `minHeight` 真写入。判定：**「可用」= 可选**；主缝几何探针 + WUF-118 CSS 锁已合并进同一套件。相对「防 CSS 绿、真机矮」意图覆盖偏弱，**非硬缺项**。

2. **grid 轨未 CSS 字符串锁**  
   规格要求加固 `min-height: 0`（或等价）。`styles.css` 已改为 `minmax(0, 1fr)`，但 `assertEditorViewportScrollCss` 未锁该串。行为已落地。

### (b) 范围蔓延

- `flushEdit` 后也调用 `refreshSurfaceHeight` — 规格字面只列 bind / syncWindow / ResizeObserver；额外路径无害。
- ResizeObserver 顺带 `refreshContentWidth` — WUF-118 邻接能力，非本票必写。

未改动 Intent / Action / Find / Recovery / TitleChrome 行为；无 `EditableSurface` 等领域词、无 ADR、无截图门禁。

### (c) 实现看起来对但可能错

未发现硬 Spec 错配。公式 `max(viewportClientHeight, mountedLineCount * LINE_HEIGHT + 垂直 padding)`、三处最小高度、空/disabled 撑满、CSS 百分比兜底、虚滚仍由 `scrollTop` 驱动、壳层固定与双轴滚动既有锁保留 — 均与 SPEC 对齐。「非零 scrollTop 仍 fill」用例测软，实现上表面高度 ≥ clientHeight 与规格「滚动中」一致。

**本轴汇总**：规格基本满足；软缺口为可选 VirtualEditor 集成测与 grid 串未锁。

---

## 收束说明

本票为 **单票**（`mt_branch_role=integration`，无 Work 子票）。实现直接落在集成分支 `feature/wuf-119-editor-surface-fill`（`36340c6`），**无工作分支需要合回**。
