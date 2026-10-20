## Problem Statement

Find 弹框仍钉在窗口右下、不可拖动，也不居中；同时主壳底部常驻 Intent 条与 Actions 面板，占用编辑区高度，并与 Find 内 Intent 标签（WUF-120）形成双入口。用户希望：工作台能力集中在一个**居中、可拖拽**的弹框里，主壳底部只保留状态栏，编辑区尽量拉高。

## Solution

将 Find 对话框升级为**可拖工作台**：打开时默认居中；拖标题栏改位置；同一应用会话内记住位置，进程重启后恢复居中；位置夹紧在应用客户区内（至少标题栏可拖回）。标签保持 `查找 | 替换 | Intent`；在 **Intent** 页集成原底栏能力——NL→正则与标记、改稿 Preview/Accept/Reject/Undo、Cloud path / Suggestions、Save as Action，以及页下半区的 **Actions** 列表与 Refresh。主壳**剔除** `.intent-panel` 与 `.action-panel`；编辑区下方直接接状态栏。入口：Ctrl+F / 菜单 Find，以及原底栏触发改挂的菜单或工具按钮（如 Intent…）。RegexDraft / 替换 Accept 语义不变（仍不静默写 Buffer）。不新接云端写正则引擎，不要求像素级仿 N++。

## User Stories

1. 作为普通用户，我希望打开 Find 工作台时默认居中，以便立刻看到完整面板。
2. 作为普通用户，我希望拖标题栏移动工作台，以便躲开正在看的正文。
3. 作为普通用户，我希望同一次运行里再次打开时还在上次位置，以便少重复拖动。
4. 作为普通用户，我希望重启应用后位置重置为居中，以便不出现「上次拖丢了」的残留。
5. 作为普通用户，我希望拖到边缘时被夹紧且标题栏仍可点，以便不会把窗拖没。
6. 作为普通用户，我希望主壳底部不再出现 Intent 输入条，以便编辑区更高。
7. 作为普通用户，我希望主壳底部不再出现 Actions 面板，以便减少常驻噪音。
8. 作为普通用户，我希望状态栏仍在最底显示长度/行列等，以便不丢缓冲指标。
9. 作为普通用户，我希望在工作台 Intent 页输入意图并 Preview，以便继续改稿回路。
10. 作为普通用户，我希望在同一页 Accept / Reject / Undo，以便不必回到已删除的底栏。
11. 作为普通用户，我希望 Cloud path / Suggestions 开关仍在 Intent 页，以便控制出网与建议。
12. 作为普通用户，我希望 Save as Action 仍在 Intent 页，以便从 RegexDraft 钉住动作。
13. 作为普通用户，我希望 Actions 列表与 Refresh 在 Intent 页下半区，以便与存 Action 同屏。
14. 作为普通用户，我希望仍有查找 / 替换标签，以便 N++ 式查找不丢。
15. 作为普通用户，我希望 NL→正则与命中标记仍在 Intent 页可用（WUF-120），以便生成正则后能看见高亮。
16. 作为键盘用户，我希望 Ctrl+F 打开工作台，以便快捷进入。
17. 作为菜单用户，我希望 File/Help 或等价菜单有 Find / Intent 入口，以便无快捷键也能开。
18. 作为底栏迁移用户，我希望原「打开即用 Intent」不消失，只是改到工作台入口，以便习惯可迁移。
19. 作为阅读者，我希望工作台为 modeless（不挡住编辑），以便边看正文边操作。
20. 作为开发者，我希望主缝仍是 FindDialog（扩展为工作台：几何、拖拽、承载 Intent/Actions UI），以便少开模块名。
21. 作为开发者，我希望壳布局合同断言无底栏两面板且编辑区邻接状态栏，以便防回归「底栏又回来了」。
22. 作为开发者，我希望 replaceAccept / Intent Accept 仍只经 Accept 写 Buffer，以便安全落笔不变。
23. 作为开发者，我希望会话位置记忆可测（present → drag → dismiss → present 同坐标），重启重置可文档化或测「无持久化键」。
24. 作为 QA，我希望手验：无底栏 Intent/Actions；开工作台居中；拖标题栏移动；夹紧边缘。
25. 作为 QA，我希望手验：Intent 页 Preview→Accept 改 Buffer；Actions 列表可 Refresh。
26. 作为 QA，我希望手验：查找/替换标签仍可用；标记规则仍在。
27. 作为维护者，我希望不引入安装级位置文件与截图门禁，以便范围小、CI 稳。
28. 作为产品负责人，我希望不新增领域词，沿用 FindBar / Intent / Action / RegexDraft / Accept。
29. 作为后续 Stage 负责人，我希望入口合并文案润色、云端写正则增强不在本票强制范围。
30. 作为短窗口用户，我希望去掉底栏后编辑区明显变高，以便小屏更可用。
31. 作为拖拽用户，我希望在内容区点击/选文字不会启动拖拽，以便只拖标题栏。
32. 作为关闭用户，我希望关工作台后标记按既有规则清除，以便不留脏高亮。

## Implementation Decisions

- **领域**：不新增 CONTEXT 词、不写 ADR。
- **范围（相对最初「只拖拽」）**：本票一并完成居中可拖 + 剔除主壳 Intent/Actions + 能力迁入工作台 Intent 页。
- **工作台**：扩展现有 Find 对话框为可拖工作台；标签 `查找 | 替换 | Intent`；Actions 嵌在 Intent 页下半，不另开 Actions 标签。
- **几何**：默认居中；`position` 用 left/top（或等价）；去掉右下角固定锚点；标题栏指针拖拽；客户区夹紧；会话记忆（内存），非安装级持久化。
- **壳**：删除主壳 Intent/Actions 常驻区；grid 行收敛为 chrome + 编辑 1fr + 状态栏（外加绝对定位工作台）；状态栏保留。
- **入口**：Ctrl+F / 菜单 Find；补充 Intent…（或等价）以免底栏删除后无入口；RegexDraft 仍打开工作台并落到 Intent 标签。
- **行为不变**：Accept 才写 Buffer；RegexDraft 不静默改文；WUF-120 标记清除规则保留。
- **主缝**：`FindDialog`（几何 + 拖拽 + 工作台内容承载）；壳布局薄断言为协作。
- **交付**：单票集成。
- **平台**：Windows-first。

决策形状（示意）：

```ts
type WorkbenchTab = "find" | "replace" | "intent";

type WorkbenchGeometry = {
  leftPx: number;
  topPx: number;
  // sessionMemory?: { leftPx, topPx } — cleared on process restart
};

// present(): if sessionMemory then restore else centerInClient()
// dragTitleBar → clampToClient → sessionMemory = {left,top}
// shell: no intent-panel / action-panel; editor above status-bar only
```

## Testing Decisions

- **好测试**：断言居中/拖拽/夹紧/会话记忆；主壳无底栏两面板；工作台 Intent 页可 Preview/Accept；Actions 列表存在；查找标签与标记回归；不测像素皮肤。
- **主缝**：`FindDialog`（扩展 find-dialog-desktop-contract 或并列 workbench 合同）。
- **壳**：样式/标记合同或 DOM 合同断言无常驻 intent/action 面板选择器。
- **先例如**：`find-dialog-desktop-contract`、regex-draft / action-panel 既有合同（入口改到工作台后更新断言位置）。
- **禁止**：截图门禁、安装级路径断言。

## Out of Scope

- 安装级记住弹框位置
- 云端/大模型任意写正则增强
- 像素级仿 N++ 对话框
- 文件中查找等更多标签
- 重做批量替换 UX
- 把状态栏也塞进工作台
- 新领域词

## Further Notes

- Grill：`nova/.aidlc/issues/wuf-121-find-dialog-drag/grill.md`（含 Q3′ 范围修订与 Q8–Q11）。
- 接缝已确认：主缝 FindDialog 工作台 + 壳布局薄协作。
- 分支：`feature/wuf-121-find-dialog-drag`。
- 票名可理解为「Find 工作台：居中可拖 + 底栏迁入」；实现以本 SPEC 为准。
