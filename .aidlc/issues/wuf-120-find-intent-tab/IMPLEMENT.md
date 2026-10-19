# 实现说明（WUF-120）

## 改动

- 扩展主缝 `desktop/src/find-dialog.ts`：标签 `find | replace | intent`；Intent 状态（utterance / 共享 pattern / hitCount / marksActive）；`generate`（本机 `buildRegexDraft`）→ `remark` 标记；`clearMarks` / `closeDialog` / `notifyBufferEdited` 清标记；`applyRegexDraft` 落到 Intent 标签；不承载底栏 Patch Intent / Action 列表。
- 可注入 `FindMarksSurface`：命中高亮端口，不写 Buffer。
- `desktop/src/find-marks-paint.ts`：把命中区间规划为正文下矩形并绘制到 `#find-mark-layer`（全部重叠命中，非仅描边/跳首命中）。
- 大 Buffer：`getVisibleRange` 使用 `VirtualEditor.mountedAbsRange()`（实际挂载窗）；降级时仍绘制窗内命中，计数显示「可见窗约 N 处命中」。
- 桌面壳：`index.html` / `styles.css` / `main.ts` 接标签 UI、Intent 两栏、标记层、滚动重绘；底栏 RegexDraft 落 Intent。
- 协作：`src/regex-draft.ts` 口令/模板不变，由 FindDialog `draftEngine` 调用。

## 契约

- `tests/find-dialog-desktop-contract.test.ts`：标签 / 同源 / 清标记 / RegexDraft 落点；**命中区间绘制计划**、**大 Buffer 降级**、**空意图不生成不扫**。
- `tests/regex-draft-contract.test.ts` 保持绿。

## 分支

`feature/wuf-120-find-intent-tab`

## 验证

```text
npx tsx --test tests/find-dialog-desktop-contract.test.ts tests/regex-draft-contract.test.ts
```
