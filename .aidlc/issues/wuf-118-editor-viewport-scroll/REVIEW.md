# 评审报告 — WUF-118 编辑器视口显示不全与滚动作用域

- **对照点**：`6c80e2a` … `9102d59`（集成分支 `feature/wuf-118-editor-viewport-scroll`）
- **规格**：本目录 `SPEC.md` / `README.md`
- **结论**：通过（单票已在集成分支，无工作分支需合回）
- **本地契约**：`npm test` → 263 pass / 0 fail（含新增 scroll 契约与既有 Intent / Action / Find / Recovery / TitleChrome 相关用例）

---

## Standards

### 文档化标准

无硬性违规。仓库无 `CODING_STANDARDS.md` / `CONTRIBUTING.md`。软约定（合同测试、不做像素截图、Accept 走核心）与既有 `editor-layout` + `*contract.test.ts` 接缝一致：新增探针 / `assertEditorViewportScrollCss` / `tests/editor-viewport-scroll-contract.test.ts` 对齐既有 viewport-width 契约风格。

### 基线气味（均为判断项，非硬违规）

1. **Mysterious Name** — `EDITOR_VIEWPORT_WIDTH_CHAIN` 注释已称 layout chain，却仍挂 width 名，现含 `minHeight` / `overflow` / gutter / app。
2. **Duplicated Code** — `assertEditorViewportScrollCss` 调用宽度断言后再次解析同一批选择器；wrap 属性断言与宽度契约有重叠。
3. **Speculative Generality / Middle Man** — `gutterHorizontalPinTranslateX` 近乎非负恒等，主要为接缝可测。
4. **Speculative Generality** — `.line-gutter { will-change: transform; }` 无规格要求。
5. **Speculative Generality** — `EDITOR_SCROLL_SCOPE` 仅被常量相等断言，未用 CSS 锁死 chrome 固定。

### 对齐良好

`VirtualEditor` 的内容宽度扩展与 gutter 钉左落在 layout seam 之后；`editorContentWidthPx` 是真实共享策略。改动落在 CSS / seam / 运行时 / 契约，符合本仓布局改法。

**本轴汇总**：硬违规 0 · 判断项气味 5（最重：常量命名漂移）。

---

## Spec

### (a) 缺失 / 部分

1. **scrollTop 虚拟化未进新契约**  
   规格 Testing Decisions / US20 要求「纵向虚拟化仍由视口 scrollTop 驱动」。运行时 `onScroll` 仍读 `this.viewport.scrollTop`；新 `editor-viewport-scroll-contract` 未断言该路径。行为保留，契约缺口为 **部分**。

2. **壳固定滚动作用域偏文档级**  
   规格「仅 editor viewport 滚动」。以 `EDITOR_SCROLL_SCOPE.chromeFixed` + 既有 DOM（chrome 在视口外）覆盖；未结构断言 title/status 在 scroller 外。可接受。

Leader 清单其余项（1fr 满高、双轴 overflow、长行可达、软换行关、gutter 钉左且纵向随虚拟窗、Intent/Find/Recovery 未动）均由 CSS + `VirtualEditor` + 探针体现。

### (b) 范围蔓延

- `will-change: transform` — 规格未要求（无害）。
- `html, body { height: 100%; }` — 支撑满高填充，与「填满中间 1fr」一致。

未改动 Intent / Action / Find / Recovery / TitleChrome 行为。

### (c) 实现看起来对但可能错

未发现硬 Spec 错配。Gutter 在 `.editor-window` 内以 `translateX(scrollLeft)` 钉左，标签仍来自虚拟窗；spacer 扩宽以撑起视口 `scrollWidth`，符合「同一视口双轴 overflow」。

**本轴汇总**：规格基本满足；主要缺口是新契约未锁 scrollTop（行为已保留）。

---

## 收束说明

本票为 **单票**（`mt_branch_role=integration`，无 Work 子票）。实现直接落在集成分支 `feature/wuf-118-editor-viewport-scroll`（`9102d59`），**无工作分支需要合回**。
