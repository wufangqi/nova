## Problem Statement

用户希望像 Notepad++ 查找对话框那样，在 Find 里用自然语言得到正则，并在编辑区看到命中标记。Nova 今天把 NL→正则放在底部 Intent 条（Preview → 填 Find），Find 本身无标签、无「意图 / 生成正则」两栏，也缺少 Buffer 内命中高亮。结果是：查找心智与「生成正则」割裂，用户难以对照 N++ 的「查找 + 正则 + 标记」工作流。

## Solution

在现有 modeless Find 对话框上增加标签页：`查找 | 替换 | Intent`。其中 **Intent** 标签两栏——左「意图识别」（自然语言/口令）、右「生成正则」（可手改）——点生成后用本机确定性 RegexDraft 规则产出模式，同步到「查找」标签的查找目标，并在编辑区对命中做高亮标记（大 Buffer 可降级为可见窗 + 计数）。提供清除标记与命中数展示；支持 Save as Action。底部 Intent 条仍只负责 Patch / Explanation / Accept；底栏若走出 RegexDraft，则打开 Find 并落到 Intent 标签。替换标签仅做现有能力的最小搬迁。不新接云端写正则，不要求像素级仿 N++ 绿色。

## User Stories

1. 作为普通用户，我希望在 Find 里看到 `查找 | 替换 | Intent` 标签，以便按 N++ 习惯切换能力。
2. 作为普通用户，我希望 Intent 标签左侧可输入意图（如「写正则 匹配邮箱」），以便用人话生成查找模式。
3. 作为普通用户，我希望右侧显示生成的正则，以便核对模式是否正确。
4. 作为普通用户，我希望可以手改右侧正则，以便模板不准时仍能微调。
5. 作为普通用户，我希望点「生成 / Preview」后再标记，以便控制何时扫 Buffer。
6. 作为普通用户，我希望手改正则后能「按此正则重新标记」，以便改完立刻看到新命中。
7. 作为阅读者，我希望命中在编辑区被高亮标出，以便一眼看到所有匹配位置。
8. 作为打开大文件的用户，我希望超大 Buffer 时标记可降级为可见窗高亮并给出计数说明，以便不卡死。
9. 作为普通用户，我希望 Intent 标签内看到「N 处命中」，以便知道匹配规模。
10. 作为普通用户，我希望生成或手改的正则自动写入「查找」标签的查找目标，以便「查找下一个」与标记用同一模式。
11. 作为普通用户，我希望用 Ctrl+F 打开 Find 后能切到 Intent 标签，以便从键盘进入。
12. 作为底栏用户，我希望底栏 RegexDraft Preview 打开 Find 并落到 Intent 标签，以便连续完成 NL→正则→标记。
13. 作为普通用户，我希望在 Intent 标签可 Save as Action，以便钉住可复用变换。
14. 作为普通用户，我希望关闭 Find、点清除标记、或编辑 Buffer 后高亮消失，以便标记不脏污正文观感。
15. 作为普通用户，我希望标记本身不修改 Buffer 文本，以便只有显式 Accept/替换才落笔。
16. 作为替换用户，我希望「替换」标签仍能做现有 Preview replace / Replace Accept，以便不丢替换路径。
17. 作为替换用户，我接受本 Stage 不重做批量替换 UX，只要能力从旧 Find 面搬进标签即可。
18. 作为改稿用户，我希望底部 Intent 条仍做 Patch / Explanation / Accept，以便改稿与查找分工清晰。
19. 作为产品负责人，我希望 Find 的 Intent 标签不承载整条底栏 Intent（无 Accept 改稿主路径），以免两套意图打架。
20. 作为开发者，我希望主缝仍是 FindDialog（扩展标签与标记端口），以便少开新模块名。
21. 作为开发者，我希望旧合同「Find 不承载 Intent」改为「不承载底栏 Patch Intent；允许 RegexDraft 用 Intent 标签」，以便契约与产品一致。
22. 作为开发者，我希望 regex-draft / Intent Preview 本机口令契约保持绿，以便 NL→草稿不回归。
23. 作为开发者，我希望 replaceAccept 仍只经 Accept 写 Buffer，以便安全落笔不变。
24. 作为 QA，我希望手验：Intent 输入口令 → 生成 → 编辑区出现高亮且命中数更新。
25. 作为 QA，我希望手验：改右侧正则 → 重新标记 → 高亮与查找目标一致。
26. 作为 QA，我希望手验：切换到查找标签，「查找下一个」使用同一 pattern。
27. 作为 QA，我希望手验：关 Find / 清除 / 打字后高亮清除。
28. 作为 QA，我希望手验：底栏 RegexDraft 打开 Find 落在 Intent 标签。
29. 作为维护者，我希望不引入截图像素门禁与 N++ 色值硬编码，以便 CI 稳定。
30. 作为产品负责人，我希望不新增 CONTEXT 词，口语「标记」即命中高亮，沿用 FindBar / RegexDraft / Intent。
31. 作为后续 Stage 负责人，我希望云端任意写正则、持久书签、文件中查找等不在本票，以便范围可控。
32. 作为 Windows 桌面用户，我希望上述行为在 WebView 壳可用，以便与产品预期一致。
33. 作为键盘用户，我希望 Esc/关闭钮仍能关掉 Find 并清标记，以便快捷退出。
34. 作为空意图用户，我希望未生成时不错误高亮全文，以便避免误扫。

## Implementation Decisions

- **领域**：不新增 CONTEXT 词与 ADR。沿用 FindBar、RegexDraft、Intent、Accept、Buffer。
- **分工**：Find Intent 标签 = NL→正则 + 标记 +（可选）Save as Action；底栏 Intent = Patch / Explanation / Accept；底栏 RegexDraft 入口改为打开 Find 并选中 Intent 标签。
- **UI**：Find 对话框标签 `查找 | 替换 | Intent`；Intent 两栏（意图 | 生成正则）；展示命中数；提供生成/重新标记/清除标记；替换标签 = 现有替换能力最小搬迁。
- **引擎**：本 Stage 仅本机确定性 `isRegexDraftUtterance` / `buildRegexDraft` 口令与模板；不新接云端模型写正则。
- **同步**：Intent 标签中的 pattern（生成或手改）与「查找」标签查找目标同一数据源。
- **标记**：对当前 pattern 在活动 Buffer 上高亮命中；不写 Buffer；大 Buffer 可降级可见窗高亮 + 计数说明；关窗 / 清除 / Buffer 内容变更清除。
- **主缝**：扩展 `FindDialog`（字段、标签、present/dismiss、applyRegexDraft 落点）；标记通过 FindDialog 可测端口或同缝薄协作面暴露（命中列表/计数/清除），测试不依赖 OS 截图。
- **契约修订**：原「FindDialog 不承载 Intent/Action」→「不承载底栏 Patch Intent / Action 列表；允许 RegexDraft 场景的 Intent 标签与 Save as Action」。
- **交付**：单票集成分支实现。
- **平台**：Windows-first；其它 OS best-effort。

决策形状（示意）：

```ts
type FindTab = "find" | "replace" | "intent";

type FindIntentTabState = {
  utterance: string;
  pattern: string; // shared with find tab
  hitCount: number; // may be approximate when degraded
  marksActive: boolean;
};

// generate() -> RegexDraft -> pattern sync -> mark()
// edit pattern -> remark()
// dismiss | clearMarks | bufferEdit -> marksActive=false
```

## Testing Decisions

- **好测试**：断言标签切换、pattern 同步、RegexDraft 落 Intent 标签、标记激活/清除、命中数、不写 Buffer、replaceAccept 仍经 Accept；不测像素色值与私有 DOM 结构细节。
- **主缝**：`FindDialog`（扩展；更新 find-dialog-desktop-contract）。
- **协作**：`regex-draft` 合同保持；Intent Preview → RegexDraft 路径更新落点断言。
- **标记**：经可注入端口/探针断言「有命中则 marksActive + count≥1」「清除条件」；可用假 Buffer 文本，无需 WebView 截图。
- **先例如**：`find-dialog-desktop-contract`、`regex-draft-contract`、Find 相关 IPC 合同。
- **禁止**：N++ 皮肤截图门禁。

## Out of Scope

- 云端/大模型任意自然语言写正则（Cloud path 增强另票）
- 持久书签 / 边注标记
- 文件中查找 / 项目中查找等 N++ 其它标签
- 重做批量替换 UX
- 把底栏 Patch Intent 整条搬进 Find
- 新领域词（FindMark / IntentTab）
- Soft wrap / 视口布局票（WUF-118/119）范围外的编辑器几何

## Further Notes

- Grill Q1–Q18：`nova/.aidlc/issues/wuf-120-find-intent-tab/grill.md`（Multica **WUF-120**）。
- 接缝已确认：主缝 FindDialog + 标记端口；regex-draft / 底栏 Intent 为协作边界。
- 单票分支：`feature/wuf-120-find-intent-tab`。
