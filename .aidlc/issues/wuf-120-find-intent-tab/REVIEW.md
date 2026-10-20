# 评审报告 — WUF-120 Find 对话框 Intent 标签

- **对照点（总览）**：`e864289` … 集成分支 tip（含 `cc04549` 初实现、`e356861` 补齐绘制）
- **对照点（第二轮）**：`3b5ca18` … `e356861`
- **规格**：本目录 `SPEC.md` / `grill.md`
- **结论**：通过（单票已在集成分支，无工作分支需合回）
- **本地契约**：`npx tsx --test tests/find-dialog-desktop-contract.test.ts tests/regex-draft-contract.test.ts` → 22 pass / 0 fail

---

## 第二轮复核（原阻塞项）

| 原阻塞项 | 判定 |
| --- | --- |
| 正文内全部命中区间高亮（US7 / grill Q4-A） | 已兑现：`planFindMarkRects` + `#find-mark-layer` 绘制挂载窗内重叠区间；滚动 remount 再绘 |
| 大 Buffer 按 VirtualEditor 可见/挂载窗降级 + 计数（US8） | 已兑现：`getVisibleRange` → `mountedAbsRange()`；文案「可见窗约 N 处命中」；降级仍 `applyMarks` |
| 合同：绘制 / 降级 / 空意图不扫 | 已兑现：三组非空转用例（US7 / US8 / US34） |

---

## Standards

### 文档化标准

无硬性违规。仓库无 `CODING_STANDARDS.md` / `CONTRIBUTING.md`。绘制规划抽到 `find-marks-paint.ts`、合同测 plan 不测像素，与既有接缝一致；`clearMarks` 死分支已去掉。

### 基线气味（均为判断项，非硬违规）

1. **Duplicated Code** — `clearMarks` 与 `repaintFindMarks` 空路径各自清层 / 去 class，未复用同一 helper。
2. **Speculative Generality** — `FindMarkRect` 含 paint 未用的 local/col 字段；`dataset.absStart/absEnd` 暂无消费者；`opts.lineHeightPx` 可选且合同未传。
3. **Mysterious Name** — rem→px 用裸 `* 16`；`FindHit as FindMarkHit` 别名略绕。
4. **Divergent Change**（轻）— `VirtualEditor` 增加 Find 用挂载窗访问器。
5. **Middle Man**（轻）— `clearFindMarkLayer` 单行包装。

**本轴汇总**：硬违规 0 · 判断项气味 5（最重：清除路径重复）。不阻塞收束。

---

## Spec

### (a) 缺失 / 部分

第二轮相对规格与 grill：**无阻塞缺口**。

初实现已齐：标签 `find|replace|intent`、pattern 同源、本机 RegexDraft、不写 Buffer、关窗/清除/编辑清标记、底栏 RegexDraft 落 Intent、Save as Action、replaceAccept 仍经 Accept、空意图拒绝生成。

挂载窗内绘制全部重叠命中；虚滚下随窗再绘，符合 Q13「虚滚下至少可见窗内正确」与 US8 降级语义。

### (b) 范围蔓延

无。未接云端写正则；未搬底栏 Patch Intent；无截图像素门禁。

### (c) 实现看起来对但可能错

未发现硬 Spec 错配。非降级时命中列表存绝对偏移、绘制当前挂载切片——与 VirtualEditor 模型一致。

### Leader 关注点（整体）

| 关注点 | 判定 |
| --- | --- |
| 标签与 pattern 同源 | 通过 |
| 标记不写 Buffer | 通过 |
| 关窗 / 清除 / 编辑 Buffer 后清除 | 通过 |
| 大 Buffer 降级与命中数 | 通过 |
| 底栏 RegexDraft 落 Intent 标签 | 通过 |
| 合同测试非空转 | 通过 |
| 正文内区间高亮 | 通过（第二轮补齐） |

**本轴汇总**：规格满足；原阻塞项 0 残留。

---

## 收束说明

本票为 **单票**（`mt_branch_role=integration`，无 Work 子票）。交付线即集成分支 `feature/wuf-120-find-intent-tab` 当前 tip（实现修复 `e356861`；本报告随后 commit）。**无需合回**工作分支。
