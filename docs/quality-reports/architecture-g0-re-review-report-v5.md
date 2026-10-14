# Architecture Review Report — v5 设计复验与 G0 决议准入

**报告编号：** ZX-AR-20261013-01  
**审查日期：** 2026-10-13，Asia/Shanghai  
**被审包：** ZX-DES-20261012-05；答复 ZX-DES-20261012-05-RESPONSE  
**审查身份：** 独立 Architecture Review Agent  
**结论：** **Conditional Go。两项主要设计补丁通过复验；核心 ADR 尚待负责人决议，因此当前不能直接执行原 Prompt 2。**

## 1. 执行摘要

R5-01 与 R5-02 的主要设计缺陷已经闭合：费用确认不再使 job 自动 succeeded；无已接纳结果时转为可见人工异常；旧 invocation 不改挂新 attempt，也不放宽普通结果接纳。unknown 自动复跑与 ResumeAfterSettlement 在 M0 被明确撤回。初次评分 queued 的 binding 非空，attempt 为空、epoch=0，生命周期与 stage 空值规则已分开。

**本轮未发现未闭合的设计 Blocker/Critical/Major；仅有 1 项 Minor 术语修正。** 当前工作可以由架构补修转入负责人决议与 M0 验证准备，无需再重铺架构或做一轮完整补修。Minor 在 M0 使用该状态表之前同步清理即可，不单独阻断设计复验。

Conditional Go 的剩余条件是：负责人明确接受本次可实施的核心方案和 M0 使用范围，特别是 ADR-004/012/013 的保守 unknown 恢复政策；记录决议和当前文档基线；清理 Minor 术语。条件完成后，本报告可作为 G0 独立设计复验证据，按原 Prompt 2 开始 M0 窄切片。现在的 Proposed 文本不能被当作已经接受的实现许可。

**设计通过不是实现通过。** 原 F01–F28 等历史 Findings 的运行风险未 Closed，RLS、迁移、队列、函数权限、成本和质量均需 G1/后续验证。本轮没有测试这些服务，也没有代签任何 ADR。

## 2. 审查依据与证据

需求依据继续是 V0.1–V0.28 确认记录及 V1.0 original。当前用户授权的是独立复验；附带文档中“请负责人决议”等内容作为待审材料，不视为用户已经批准。

本轮读取 v5 补充/答复，逐项对照上次已审快照的字典、状态、事务、授权、契约索引、模块邻接、SQL、schema 和 ADR 差异；核心未变部分保持上轮设计结论。

| 缩写 | 文件 |
|---|---|
| A | [review-remediation-v5.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/review-remediation-v5.md) |
| S | [state-transitions.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/state-transitions.md) |
| T | [transaction-boundaries.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/transaction-boundaries.md) |
| D/Q | [data-dictionary.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/data-dictionary.md)、[core-chain-v3.sql](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/sql/core-chain-v3.sql) |
| U/I | [authorization-matrix-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/authorization-matrix-v2.md)、[current-contract-index-v3.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/current-contract-index-v3.md) |
| R/F | [g0-design-response-v5.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/g0-design-response-v5.md)、[architecture-findings-tracker.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/architecture-findings-tracker.md) |

ADR-004/012/013 的修改已对照，其他十二份 ADR 与上轮一致，十五份状态仍为 Proposed。输入摘要、历史快照核对和静态约束检查见 [证据清单](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/outputs/architecture-g0-evidence-manifest-v5.json)。

本次没有执行迁移、连接 PostgreSQL/Redis/对象存储、运行双端 schema 或故障注入、调用模型、导入学生数据、修改用户仓库或接受 ADR。所有业务反例是规格推演；本报告不宣称数据库安全、恢复可靠性或 AI 准确率已实测。

## 3. 两项补丁复验

| 原 Finding | design_review 建议 | 证据 | 结论与保留测试 |
|---|---|---|---|
| R5-01 Critical | design_passed_pending_decision | A:14–37；S:46–52；T:182–190；U 结算行；ADR-004/012/013 | 对账只写费用；无结果人工异常；旧 invocation 谱系不变；不提供自动 Resume/旧输出采用。负责人接受保守方案后，G1 验证并发、旧回写、占用和结算幂等 |
| R5-02 Major | design_passed_pending_decision | A:45–61；D 第 8 节；S:43–46；Q CHECK 注释；T:182 | stage 决定 binding，领取历史决定 attempt/epoch；两种初次 queued 合法；撤回 unknown 重排，同时保留接管/同体重试/capability 补投/下一 stage 新 job。G1 运行真实迁移与状态例子 |

复验推演：

- **费用已确认、没有结果：** Park 幂等释放占用；RecordSettlement 写确认账而不造 proposal；CloseUnprovenStage 转 exception_review；教师 OpenManualScore 创建 manual revision 与草稿。
- **旧 A 输出与当前 B：** 普通接纳仍核对当前 attempt；不把 A 的 invocation 改成 B；保守恢复不采用旧输出，转人工，而非假成功或永久挂 running。
- **输入在对账中变化：** 旧效果不进入新 generation，result_status 标 input_changed，原费用账保留，释放不重复。
- **初次 queued：** validate_asset 可为 NULL binding/NULL attempt/epoch 0；model_grade 带本代 binding/NULL attempt/epoch 0。

这些路径已足以指导 M0 窄切片的实现和测试。实际服务仍可能暴露实现缺陷，必须按 G1 收证据。原有引用链、EXECUTE 角色边界、普通原槽接管、发布事实/指针分离、source fence 和双层输出结论保持。

原 Fxx、G0/R3/R4 历史编号和严重度不改；可以依据本报告更新 design_review。implementation、verification 及未决 decision 继续保持真实状态，不能将设计复验通过写成 Closed/Verified/Accepted。

## 4. 本轮 Minor

### R6-01 — Minor — AbandonUnknownCost 的 From 字段混用了发送与费用状态

**证据位置：** S:51 写 `cost_status=send_unknown`。其他现行规格把 send_unknown 用于 invocation.send_state，而 cost_status 使用 unknown/confirmed/abandoned_unknown 等费用词汇。

**风险：** 实现者照表翻译会使用错误费用枚举或使放弃命令不可达。它不改变已明确的保守恢复方向，也不单独阻断 G0。

**修复建议：** 将 From 明确为费用未确认的合法状态，例如 `cost_status=unknown`；若还需要限制发送状态，另列 `send_state=send_unknown`，两列不能合并。同步费用状态枚举和 unknown/abandoned_unknown 展示口径，未知金额继续不能记为 0。费用状态的实际存放表和写入应走所属模块的公开端口，不能因为文档只写 cost_status 而跨模块直接改 repository。

**验收方法：** 在 M0 使用状态表之前做一次文档/枚举对照；G1 覆盖 unknown→abandoned_unknown 及重复调用，没有业务成功副作用、不覆盖账、不记 0。

**责任与关联：** Cursor 做术语同步，F28/ADR-012 后续项。无需再生成一套架构；若仅修这处词汇，不要求重新进行整包独立审查。若改变恢复策略或核心守卫，才需复验相关范围。

## 5. G0 剩余条件与决议范围

### 5.1 决议必须真实记录

十五份 ADR 仍 Proposed。独立审查可以认定方案可实施，但不能代项目负责人选择和签署。随附 [G0 决议清单](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/outputs/g0-decision-sheet-v5.md) 提供具体选项、M0 范围、未决事项和可复制确认文本。

进入依赖这些决策的 M0 实现前，需要：

1. 接受 ADR-001/002/003/005 的租户/FK/RLS、模块/UoW、服务接纳和 Outbox 核心边界。
2. 接受 ADR-006/007 的冻结、正式版本、发布资格和事件契约；M0 只固定/验证必要契约，不做正式阅卷发布。
3. 明确 ADR-004/012/013 的 M0 保守恢复提案：有 send_unknown 不自动付费复跑，账与结果分开，缺结果转人工，不采用旧 invocation 到新 attempt。
4. 对 M0 直接使用的 ADR-009/010/014/015 及 ADR-011 核心名单键做范围明确的决议。完整组织、图谱、真实质量、生产目标和归属纠正可以按对应阶段决议。
5. 记录基线为 v5 补充及现行配套文件、本报告和真实决议；清理 R6-01，再执行原 Prompt 2。

不要求现在一次签署所有十五份的全部未来细节。范围接受时应明确哪些条款已决定、哪些继续 Proposed；不能用“全部 Accepted”掩盖仍待样本和业务数据的数字。

### 5.2 继续待定的内容

保留年限、生产 cap/宽限/RPO/RTO、真实评分阈值、供应商具体能力、完整算法、完整组织班级政策和发布后归属纠正，不需要为启动 M0 编造。选项乙拒绝发布后换绑可作为后续决议，但本轮未代选。真实学生数据与真实学校质量专项保持闸门。

M0 范围为两租户/范围骨架、真实 DB 角色、核心约束、文件 finalize、持久 job/Outbox/Inbox、Python Worker 与 FastAPI mock/获授权 PoC、schema、租约/admission、unknown 保守恢复与账本。正式工作台、全套学校组织/题库/发布和真实学生数据不在 M0 范围。

## 6. 下一步与准入结论

**设计复验：通过，附 1 Minor 后续。完整 G0：Conditional Go，待负责人核心决议记录及术语清理。**

完成第 5 节条件后，可将本报告作为 G0 独立设计复验证据，由负责人记录准入并执行原 Prompt 2。此时仍不能宣布 G1 通过。M0 退出需要真实角色、迁移、队列故障、重发/接管/unknown、Python 互操作、schema、对象和账本证据，再交 QA/架构复验。

当前不用再交一轮完整架构补修 Prompt。随附 [Cursor 决议记录与 M0 交接 Prompt](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/outputs/cursor-g0-decision-recording-prompt-v5.md) 用于在真实用户决议之后整理记录、修 Minor、准备原 Prompt 2 的当前基线。它不能被当成已经批准的决议，也不在此轮启动实现。
