# Grill log — WUF-119

过程记录，非权威结论。权威以后续 SPEC / ADR 为准。

## 2026-10-19 · Round 1

### Q1 — 「撑满」的验收标准是什么？

**问**：中间白区怎样才算「可编辑表面撑满」？

**选项**：
- A. 中间白区任意点击都能落光标（textarea/gutter 几何至少盖满视口 clientHeight）
- B. 只要看起来白底铺满即可，不要求下方白区可点
- C. A，且还要求 gutter 底色铺满整列可视高度（不能只剩顶上一小段行号）

**建议答**：C

**人答**：C

### Q2 — 和 WUF-118「满高填充」怎么切割？

**问**：本票与已 done 的 WUF-118 如何划分？

**选项**：
- A. WUF-118 只保证 viewport 白底；本票专门修「可编辑表面」几何（明确补洞）
- B. 视为 WUF-118 未完成，本票重写其满高定义并废掉旧契约
- C. 合并回 WUF-118 重开，不建独立 Stage

**建议答**：A

**人答**：A

### Q3 — 高度怎么撑？

**问**：用什么手段把可编辑表面撑到至少一屏高？

**选项**：
- A. `VirtualEditor` 用 `viewport.clientHeight`（与挂载行高取 max）显式设 window/textarea/gutter 最小高度；CSS 百分比只作兜底
- B. 只改 CSS（grid `min-height:0`、绝对定位链等），不改 JS
- C. A + 窗口 resize 时重算

**建议答**：C

**人答**：C

### Q4 — 契约怎样才算能红？

**问**：如何防止再出现「CSS 字符串绿、真机仍矮」？

**选项**：
- A. 纯函数探针 + CSS 字符串（与 WUF-118 同级）即可
- B. 必须有可在 Node 里跑的几何断言：surfaceHeight ≥ viewportClientHeight；点击坐标落在 textarea 命中盒内（jsdom/happy-dom 或现有 harness）
- C. B，且另加「人工截图像素」门禁

**建议答**：B

**人答**：B

### Q5 — 虚滚滚到文件中部时，矮窗还要不要「至少一屏高」？

**问**：`scrollTop` 非零时，可见视口内的可编辑命中面是否仍须铺满？

**选项**：
- A. 要：任意 `scrollTop` 下，可见视口内的可编辑命中面仍铺满（window 高度 ≥ clientHeight，不只跟挂载文本收缩）
- B. 不要：只有 `scrollTop≈0` / 短文档时要撑满；中部只要虚滚窗口够用
- C. 仅空 Buffer / 少于一屏行数时强制撑满

**建议答**：A

**人答**：A

## 2026-10-19 · Round 2

### Q6 — 交付形态？

**问**：本 Stage 如何交付？

**选项**：
- A. 单票在集成分支实现（与 WUF-118 同）
- B. 先 `to-tickets` 拆 Work（例如：JS 撑高 / 契约几何 / grid 加固）
- C. 先 prototype 再决定是否拆票

**建议答**：A

**人答**：A

### Q7 — 高度重算触发点？

**问**：何时重算可编辑表面最小高度？

**选项**：
- A. 仅 `window.resize`
- B. `ResizeObserver` 盯 `.editor-viewport`（含最大化、分屏、Intent 面板显隐导致的 1fr 变化）
- C. B，再加上每次 `bind` / `syncWindow` 后各算一次

**建议答**：C

**人答**：C

### Q8 — 最小高度公式怎么算 padding？

**问**：minHeight 是否计入 textarea/gutter 垂直 padding？

**选项**：
- A. `max(clientHeight, mountedLines * LINE_HEIGHT_PX)`，忽略 textarea/gutter padding
- B. `max(clientHeight, mountedLines * LINE_HEIGHT_PX + 垂直 padding)`，与现有 `0.85rem` 上下 padding 对齐
- C. 不手算：量 textarea `getBoundingClientRect` / `scrollHeight` 再回写 minHeight

**建议答**：B

**人答**：B

### Q9 — WUF-118 的 CSS 字符串契约怎么处理？

**问**：旧 CSS 断言与新几何契约如何共存？

**选项**：
- A. 保留作回归，另加本票几何契约
- B. 删掉满高相关 CSS 断言，只留几何契约
- C. 合并进同一套 editor-layout 契约文件，CSS + 几何都要绿

**建议答**：C

**人答**：C

### Q10 — 短窗口 ~16rem 地板还要吗？

**问**：WUF-118 的 ~16rem 最小高度如何处理？

**选项**：
- A. 保留（与 WUF-118 一致）
- B. 取消，只保证「等于当前 1fr」
- C. 保留，但优先保证 surface ≥ viewportClientHeight；16rem 只约束 viewport 本身

**建议答**：C

**人答**：C

## 2026-10-19 · Round 3

### Q11 — 未绑定 / disabled 的 Untitled 是否也要撑满？

**问**：无 Buffer / textarea disabled 时，可编辑表面几何是否仍须铺满？

**选项**：
- A. 要：表面几何仍铺满；不能输入只是 disabled，白区与 gutter 不能塌成矮条
- B. 不要：无 Buffer 时允许矮条
- C. 仅视觉撑满 viewport 白底，可不撑 textarea（与本票目标冲突，不推荐）

**建议答**：A

**人答**：A

### Q12 — 领域词 / ADR？

**问**：本票是否新增 CONTEXT 词或写 ADR？

**选项**：
- A. 不新增 CONTEXT 词、不写 ADR（布局补洞，沿用 Buffer / 虚滚用语）
- B. 新增术语如 EditableSurface
- C. 写一篇 ADR 记录「JS 显式高度 vs CSS %」

**建议答**：A

**人答**：A

### Q13 — 验收手工检查最少几条？

**问**：QA / 人验最少覆盖哪些？

**选项**：
- A. （1）打开 680 行文件 → 点 Intent 上方白区能落光标；（2）空/短 Buffer 同样；（3）最大化后再缩回仍撑满；（4）滚到文件中部再点白区仍可
- B. 只做（1）
- C. A + 截图像素对比门禁

**建议答**：A

**人答**：A
