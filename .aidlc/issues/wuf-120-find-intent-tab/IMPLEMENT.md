# 实现说明（WUF-120）

## 改动

- 扩展主缝 `desktop/src/find-dialog.ts`：标签 `find | replace | intent`；Intent 状态（utterance / 共享 pattern / hitCount / marksActive）；`generate`（本机 `buildRegexDraft`）→ `remark` 标记；`clearMarks` / `closeDialog` / `notifyBufferEdited` 清标记；`applyRegexDraft` 落到 Intent 标签；不承载底栏 Patch Intent / Action 列表。
- 可注入 `FindMarksSurface`：命中高亮端口，不写 Buffer；大 Buffer 可降级可见邻域扫描。
- 桌面壳：`index.html` / `styles.css` / `main.ts` 接标签 UI、Intent 两栏、生成/重标记/清除/Save as Action；底栏 RegexDraft Preview 打开 Find 并选中 Intent；编辑 Buffer 清标记。
- 协作：`src/regex-draft.ts` 口令/模板不变，由 FindDialog `draftEngine` 调用。

## 契约

- 更新 `tests/find-dialog-desktop-contract.test.ts`（允许 Intent 标签；标记激活/清除；pattern 同源；RegexDraft 落 Intent）。
- `tests/regex-draft-contract.test.ts` 保持绿。

## 分支

`feature/wuf-120-find-intent-tab`

## 验证

```text
npx tsx --test tests/find-dialog-desktop-contract.test.ts tests/regex-draft-contract.test.ts
```
