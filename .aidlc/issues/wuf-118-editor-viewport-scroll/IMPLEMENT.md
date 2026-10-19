# 实现说明（WUF-118）

## 改动

- 扩展 `desktop/src/editor-layout.ts`：满高填充、双轴 `overflow: auto`、长行水平可达、gutter 水平钉左（`translateX(scrollLeft)`）、软换行仍关闭。
- `styles.css`：`.app` 定高 `100vh`；`.editor-viewport` 填满中间 `1fr`（`height:100%` + `min-height:16rem`）；去掉 window 的 `right:0`/`width:100%` 双钉，保留 `min-width:100%` 以防半宽塌缩。
- `VirtualEditor`：按最长行扩展内容宽度；滚动时钉住 gutter。

## 契约

- 新增 `tests/editor-viewport-scroll-contract.test.ts`
- 既有 viewport-width / line-gutter / Intent·Action·Find·Recovery 相关契约保持通过

## 分支

`feature/wuf-118-editor-viewport-scroll`
