## Problem Statement

WUF-118 之后，中间 `.editor-viewport` 的白底已经铺到 Intent 上方，但真正可编辑的表面（textarea + 行号 gutter）仍只占顶部很矮的一条。其下大块白色是视口背景：点击无法落光标，gutter 底色也不连续。用户体感仍是「编辑区显示不全 / 有一块用不了」。真机截图（约 680 行 Buffer）已证实：状态栏可显示光标在第 2 行（顶部矮条可编），下方白区不可用——不是「文件前面全是空行」。

## Solution

在继承 WUF-118 产品规则（壳层固定；仅 editor viewport 双轴滚动；软换行关闭；gutter 水平钉左）的前提下，把**可编辑表面几何**至少撑满视口 `clientHeight`：任意可见白区点击可落光标（disabled 时仍撑满几何），gutter 底色铺满可视列。用 `VirtualEditor` 按 `viewport.clientHeight` 与挂载行高（含垂直 padding）取 max，在 bind / syncWindow / ResizeObserver 时显式设置 window / textarea / gutter 最小高度；CSS 百分比仅作兜底。契约在同一 `editor-layout` 接缝上同时锁 CSS 字符串与 Node 可跑的几何探针，禁止再靠截图门禁。不改变 Intent / Action / Accept / Find / Recovery / TitleChrome 行为。

## User Stories

1. 作为普通用户，我希望点 Intent 上方任意白区都能落下光标，以便整块编辑区都真正可用。
2. 作为普通用户，我希望行号 gutter 的底色铺满可视列高度，以便不再出现「只有顶上几行有行号、下面一片空白」的假编辑区。
3. 作为打开长文档的用户，我希望 680 行级 Buffer 在首屏就具备满高可点表面，以便不用猜哪里能点。
4. 作为编辑短文档的用户，我希望只有几行字时表面仍然铺满中间带，以便不像一张贴在灰底上的小卡片。
5. 作为空 Untitled 用户，我希望尚未输入时表面几何仍然撑满（即便 textarea disabled），以便布局稳定、不塌成矮条。
6. 作为 Windows 桌面用户，我希望上述行为在 WebView 壳里成立，以便与产品预期一致。
7. 作为滚动阅读者，我希望滚到文件中部后，可见视口内的可点表面仍铺满，以便不会「一滚又出现点不中的白区」。
8. 作为调整窗口的用户，我希望最大化再还原、或改变窗口高度后表面仍撑满，以便布局跟随 1fr。
9. 作为打开 Intent 预览导致底栏变高的用户，我希望表面高度随 viewport `clientHeight` 重算，以便不被底栏挤出可点区。
10. 作为普通用户，我希望标题 / 菜单 / 标签在滚动时仍固定，以便壳层不跟着跑。
11. 作为普通用户，我希望 Intent / Actions / 状态栏在滚动时仍可见，以便预览与 Accept 不用翻找。
12. 作为产品负责人，我希望「仅 editor viewport 滚动」继续被当作预期而非回归，以便 QA 不误报。
13. 作为阅读长行的用户，我希望同一 viewport 仍可横向滚到行尾，以便 WUF-118 的长行可达不被破坏。
14. 作为阅读者，我希望本 Stage 仍关闭软换行，以便虚滚行高模型稳定。
15. 作为带行号的阅读者，我希望横向滚动时 gutter 仍钉在视口左侧，以便不丢行取向。
16. 作为带行号的阅读者，我希望纵向虚滚时 gutter 标签仍同步窗口，以便行号与正文对齐。
17. 作为键盘用户，我希望 Ctrl+G / 跳行行为不变，以便布局修复不打断跳转。
18. 作为 Find 用户，我希望查找对话框与命中跳转不变，以便搜索仍可用。
19. 作为重度用户，我希望 Intent 预览 / Accept / Reject 不变，以便 AI 回路不受扰。
20. 作为谨慎用户，我希望 RecoveryBuffer 退出恢复与关标签提示不变，以便数据安全习惯保留。
21. 作为短窗口用户，我希望 viewport 仍保留约 16rem 高度地板，以便编辑区不被压没。
22. 作为短窗口用户，我接受外壳可能需增高或裁切 chrome 也不破坏表面 ≥ clientHeight，以便编辑区优先可用。
23. 作为开发者，我希望在 `editor-layout` 接缝用几何探针断言 surfaceHeight ≥ viewportClientHeight，以便 CI 能红掉「CSS 绿、真机矮」。
24. 作为开发者，我希望探针能断言视口内点击坐标落在 textarea 命中盒内，以便锁住「白区可点」。
25. 作为开发者，我希望保留并合并 WUF-118 的 CSS 字符串断言与本票几何断言，以便一层接缝两道锁。
26. 作为开发者，我希望 VirtualEditor 仍用 viewport `scrollTop` 驱动纵向虚滚，以便行窗不错位。
27. 作为开发者，我希望 Intent / Action / Find / Recovery / TitleChrome / gutter 钉左 / 横向 scrollWidth 既有契约保持绿，以便布局补洞不破护城河。
28. 作为 QA，我希望手验：长文件点白区能落光标，以便复现本票主缺陷。
29. 作为 QA，我希望手验：空/短 Buffer 同样可点满高，以便覆盖空态。
30. 作为 QA，我希望手验：最大化再缩回后仍撑满，以便覆盖 resize。
31. 作为 QA，我希望手验：滚到文件中部再点白区仍可，以便覆盖虚滚中部。
32. 作为维护者，我希望不引入截图像素门禁，以便 CI 稳定、不绑皮肤。
33. 作为产品负责人，我希望不新增领域词（无 EditableSurface 等），以便 Buffer / Path 语言干净。
34. 作为后续 Stage 负责人，我希望 Intent/Actions 折叠与 caret 横向跟随仍不在本票范围，以便范围不膨胀。

## Implementation Decisions

- **领域**：不新增 CONTEXT 词，不写 ADR。布局补洞；Path / Buffer / FindBar / RecoveryBuffer / Accept 不变。
- **与 WUF-118 切割**：WUF-118 保证 viewport 白底与双轴滚动；本票保证**可编辑表面**（textarea + gutter）几何至少盖满 `viewport.clientHeight`，且白区可点、gutter 底色铺满可视列。
- **高度策略（主缝）**：`surfaceMinHeightPx = max(viewportClientHeightPx, mountedLineCount * LINE_HEIGHT_PX + 垂直 paddingPx)`；将结果应用到 editor-window / textarea / gutter 的最小高度。垂直 padding 与现有约 `0.85rem` 上下对齐。
- **重算时机**：`ResizeObserver` 观察 `.editor-viewport`；并在每次 `bind` / `syncWindow` 后重算。CSS `min-height: 100%` 仅兜底，不以之为唯一手段。
- **滚动中**：任意 `scrollTop` 下，可见命中面仍须满足 surface 高度 ≥ clientHeight（不只在 scrollTop≈0 时）。
- **disabled / 空 Untitled**：不能输入时仍撑满几何，禁止塌成矮条。
- **grid**：为 1fr 子项保留/加固 `min-height: 0`（或等价），保证滚动口高度稳定。
- **16rem 地板**：继续约束 viewport 本身；优先保证 surface ≥ viewportClientHeight。
- **软换行**：仍关闭。
- **滚动容器**：仍为单一 editor viewport 双轴 overflow；不引入嵌套横向 scroller。
- **Gutter**：仍为 display-only、`pointer-events: none`；水平钉左；纵向随虚滚窗。
- **不变**：TitleChrome、菜单、Intent、Actions、状态栏指标、Find、PathPicker、RecoveryBuffer、ClosePrompter、Accept。
- **交付**：单票落在集成分支实现，不强制拆 Work。
- **平台**：Windows-first 桌面壳；其它 OS best-effort。

决策形状（示意，非可运行 demo）：

```ts
type EditorSurfaceFillProbe = {
  viewportClientHeightPx: number;
  surfaceHeightPx: number; // textarea 或 editor-window 命中盒高度
  gutterHeightPx: number;
  clickInViewport: { x: number; y: number }; // 视口坐标，取中下部白区
  hitTargetIsTextarea: boolean;
};

// surfaceHeightPx >= viewportClientHeightPx（容差内）
// gutterHeightPx >= viewportClientHeightPx（容差内）
// hitTargetIsTextarea === true
```

## Testing Decisions

- **好测试**：只断言对外布局/命中行为——表面高度、gutter 高度、点击命中 textarea、既有 CSS 锁与横向/钉左回归；不测实现私有字段名，不测截图像素。
- **主缝**：`editor-layout`（扩展高度策略与探针；合并 WUF-118 CSS 断言与本票几何断言到同一契约套件）。
- **协作**：`VirtualEditor` 重算调用路径不破坏 `scrollTop` 虚滚；可用轻量集成/合同覆盖「重算后表面高度」。
- **回归**：Intent / Action / Find / Recovery / TitleChrome / gutter 钉左 / 长行 scrollWidth 既有契约保持绿。
- **先例如**：`editor-viewport-scroll-contract`、`editor-viewport-width-contract`、line-gutter 契约、virtual-editor 相关合同。
- **禁止**：Windows 滚动条/N++ 皮肤截图门禁。

## Out of Scope

- 软换行 / 重排导致虚滚行高模型变化
- 光标横向自动跟随
- 折叠或重做 Intent / Actions
- 整窗滚动 chrome
- TitleChrome / 标题按钮改动
- Encoding/EOL 状态段、N++ 皮肤
- 新领域词或 ADR
- 拆 Work 批次（除非实现中途证明必须拆）

## Further Notes

- Grill Q1–Q13 权威记录：`nova/.aidlc/issues/wuf-119-editor-surface-fill/grill.md`（Multica **WUF-119**）。
- 接缝已确认：主缝 `editor-layout`；`VirtualEditor` 为协作调用方而非新缝名。
- 单票交付分支：`feature/wuf-119-editor-surface-fill`。
