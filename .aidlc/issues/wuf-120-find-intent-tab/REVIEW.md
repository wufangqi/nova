# 评审报告 — WUF-120 Find 对话框 Intent 标签

- **对照点**：`e864289` … `cc04549`（集成分支 `feature/wuf-120-find-intent-tab`）
- **规格**：本目录 `SPEC.md` / `grill.md`
- **结论**：需改（主路径标签 / pattern 同源 / 清标记 / RegexDraft 落点已齐；编辑区「全部命中高亮」未兑现）
- **本地契约**：`npx tsx --test tests/find-dialog-desktop-contract.test.ts tests/regex-draft-contract.test.ts` → 19 pass / 0 fail

---

## Standards

### 文档化标准

无硬性违规。仓库无 `CODING_STANDARDS.md` / `CONTRIBUTING.md`。软约定（可注入 `FindMarksSurface` / `draftEngine`、合同探针、不测像素）与既有 FindDialog 接缝一致。

### 基线气味（均为判断项，非硬违规）

1. **Duplicated Code** — `find-dialog.ts` `clearMarks` 的 if/else 两支均调用 `this.marks?.clearMarks()`，条件无效。
2. **Speculative Generality** — `hasIntentTab` / `hostsBottomBarPatchIntent` / `hostsActionList` 恒真/恒假，主要为合同可测。
3. **Middle Man** — `notifyBufferEdited`、`hostsIntentOrAction` 近乎纯转发。
4. **Repeated Switches** — `main.ts` 中 `intent | replace | find` 三元在读字段与 focus 等处重复。
5. **Divergent Change**（轻）— `FindDialog` 同时承载标签、生成、标记降级、Save as Action；本票主缝可接受。

### 对齐良好

扩展落在 `FindDialog` + 薄标记端口；合同测试用假 Buffer / 录制 surface，无截图门禁。

**本轴汇总**：硬违规 0 · 判断项气味 5（最重：`clearMarks` 死分支重复）。

---

## Spec

### (a) 缺失 / 部分

1. **编辑区全部命中高亮（缺失，阻塞）**  
   规格 US7 / 标记决策：「对当前 pattern 在活动 Buffer 上高亮命中」；grill Q4 人答 A：「用生成正则在当前 Buffer 高亮全部命中」。  
   `FindDialog.remark` 虽把 `found.hits` 交给 `FindMarksSurface.applyMarks`，桌面实现仅给 `#editor-viewport` 加 `.find-marks-active` 描边，并对**首个** hit 调用 `revealRange`——未对命中区间做正文内高亮。命中列表式按钮（`.find-hit`）仍是查找结果条，不是编辑区标记。

2. **大 Buffer「可见窗」降级（部分）**  
   规格 US8 / grill Q7-C：超大 Buffer 降级为可见窗高亮 + 计数说明。  
   `degraded` 与「约 N 处命中」已有；`getVisibleRange` 用光标 ±32768，并非 VirtualEditor 可见窗。且因 (1)，降级后也仍无区间高亮。

3. **契约覆盖缺口（部分）**  
   Testing Decisions 要求标记激活/清除/命中数；现有合同对端口态非空转，但未锁「命中区间被绘制」、未锁大 Buffer `degraded`、未锁空意图拒绝生成且不扫（US34 行为在代码中有，合同未断言）。

### (b) 范围蔓延

无实质蔓延。未接云端写正则；未搬底栏 Patch Intent；替换为标签内最小搬迁；Save as Action / Esc·关窗清标记在范围内。

### (c) 实现看起来对但可能错

同 (a)(1)：`marksActive` / `hitCount` 与合同探针为真时，用户在编辑区仍看不到「全部命中」高亮——状态与产品语义脱节。

### Leader 关注点对照

| 关注点 | 判定 |
| --- | --- |
| 标签与 pattern 同源 | 通过 |
| 标记不写 Buffer | 通过 |
| 关窗 / 清除 / 编辑 Buffer 后清除 | 通过 |
| 大 Buffer 降级与命中数 | 部分（计数/约数有；可见窗与区间高亮不足） |
| 底栏 RegexDraft 落 Intent 标签 | 通过 |
| 合同测试非空转 | 通过（对已实现端口）；未覆盖真正绘制 |

**本轴汇总**：主缝骨架与同步/清除/落点满足；阻塞缺口是 grill Q4 / US7 要求的编辑区全部命中高亮未实现。

---

## 收束说明

本票为 **单票**（`mt_branch_role=integration`，无 Work 子票）。交付线即集成分支 `feature/wuf-120-find-intent-tab`（`cc04549`）。结论为需改，**不合回**（亦无工作分支）；请补齐编辑区命中高亮（及可见窗语义）后再交评审。
