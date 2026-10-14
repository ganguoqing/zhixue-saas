# G0 决议记录（2026-10-13）

**记录日期：** 2026-10-13  
**责任人：** 项目负责人（本对话中的用户；未另提供姓名）  
**来源：** 本对话用户消息，时间戳 2026-10-13 23:59（UTC+8）  
**设计基线：** 审查报告 ZX-AR-20261013-01；v5 现行配套规格（`review-remediation-v5.md`、`g0-design-response-v5.md`、契约索引、状态、事务、授权、数据字典、`core-chain-v3.sql`）

本文件是批准记录。`g0-decision-sheet-v5.md` 第 5 节的引用块、交接 Prompt 和 Agent 转述都不是批准原文。

## 1. 批准原文

> 我作为项目负责人，批准《G0 核心决议清单 v5》第 2 节所列 M0 必需范围，并接受第 3 节的 v5 保守 unknown 恢复政策。
>
> 以审查报告 ZX-AR-20261013-01 和 v5 现行配套规格为设计基线。生产参数、真实学生数据专项、完整算法和发布后归属选项继续按阶段待决。
>
> 请执行 docs/prompts/cursor-g0-decision-recording-prompt-v5.md：先记录本次实际决议、修正 R6-01，并核对 G0 条件。条件完成后，开始原 Prompt 2 的 M0 窄切片。
>
> M0 结束时提交 G1 验证证据。本次不授权完整阅卷功能、真实学生数据接入或生产部署。

## 2. 接受范围

接受决议清单第 2 节表格的「建议批准」列，对应 ADR-001、002、003、004、005、006、007、009、010、011、012、013、014、015 中该列写明的 M0 条款。

接受第 3 节五条保守恢复政策：

1. `RecordSettlement` / `AbandonUnknownCost` 只改变费用事实，不把没有合格业务效果的 job 标为 succeeded，不造 proposal。
2. 有 `send_unknown` 时不做自动付费复跑，不把旧 invocation 改挂到新 attempt，不提供 `ResumeAfterSettlement` 或 `AdoptObservedResult`。
3. 无合格结果进入可见的 `exception_review` / `failed_final`，教师走 `OpenManualScore`；原账和来源谱系保留。
4. 普通未发送的执行可按租约和预算接管，epoch 递增，占用不双计；同体接纳重试、capability 补投，以及成功后的下一 stage 新 job 保留。
5. 以后新的付费重评需要另有授权命令、合法新 job / invocation 和成本记录。

状态规则：上述条款是 M0 范围已决。同一 ADR 里第 2 节「仍保留待定」列、尚未写进该列的未来细节，继续 Proposed。任何一份 ADR 的整体状态都不是 Accepted。

## 3. 明确未接受

- 生产 cap、截止时间、RPO/RTO、准确率、保留年限和其他生产数值。
- 真实学生数据专项，以及真实学生数据接入。
- 完整算法，以及完整阅卷功能。
- 发布后归属选项甲/乙。M0 两条都关闭。
- ADR-008 的完整图谱和学校覆盖方案。PostgreSQL 图谱方向仍只沿用此前需求确认，完整方案待 M2。
- 生产部署。
- 十五份 ADR 的全部未来细节。

本次批准没有改变 v5 保守恢复政策，因此不另开一轮设计复验再进入 M0。

## 4. R6-01

ZX-AR-20261013-01 要求：`AbandonUnknownCost` 的 From 不得写成 `cost_status=send_unknown`。费用列是 `unknown` / `confirmed` / `abandoned_unknown`；发送列是 `not_sent` / `send_unknown` / `observed`。未知金额保持 NULL，不写 0。

2026-10-13 批准前，现行 `state-transitions.md`、`transaction-boundaries.md`、`current-contract-index-v3.md`、`review-remediation-v5.md` 已经按此修正。本轮复核后无需再改这些句子。快照 `snapshots/zx-des-20261013-01/` 和独立报告保留修正前的文字，不回写。

## 5. G0 条件核对

| 条件 | 结果 |
|---|---|
| 负责人实际批准，而不是清单模板 | 满足。来源是上一节原文 |
| 接受范围与未决项已分开 | 满足。第 2、3 节 |
| 保守政策相对 v5 基线未改变 | 满足。不阻塞进入 M0 |
| R6-01 已清理 | 满足。见第 4 节 |
| 设计基线仍是 ZX-AR-20261013-01 与 v5 规格 | 满足 |
| M0 边界明确 | 满足。原 Prompt 2 窄切片；不包含完整阅卷、真实学生数据、生产部署 |
| 运行证据 | 不在本记录中宣称。见后续 G1 证据文件 |

条件已齐。其后实现限于该 M0 窄切片。
