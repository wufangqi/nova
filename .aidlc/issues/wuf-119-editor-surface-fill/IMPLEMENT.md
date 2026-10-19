# IMPLEMENT — WUF-119 editor surface fill

## 改动摘要

- 扩展 `desktop/src/editor-layout.ts`：表面最小高度公式、几何探针（surface/gutter ≥ clientHeight、白区点击命中）、合并进既有 CSS 断言（含 gutter `min-height: 100%`）。
- `VirtualEditor`：在 `bind` / `syncWindow` / `flushEdit` / `ResizeObserver(.editor-viewport)` 后显式设置 window / textarea / gutter 的 `minHeight` px；disabled / 空 Buffer 同样撑满。
- `styles.css`：中间轨改为 `minmax(0, 1fr)`，避免内容固有最小高度挤扁 1fr；CSS `min-height: 100%` 仍作兜底。
- 契约：`tests/editor-viewport-scroll-contract.test.ts` 合并 WUF-118 CSS 锁与 WUF-119 几何探针。

## 分支

`feature/wuf-119-editor-surface-fill`

## 验证

Node 下跑 `editor-viewport-scroll-contract`（含 WUF-118 + 本票）及 Intent / Action / Find / Recovery / TitleChrome / gutter / width 相关契约。
