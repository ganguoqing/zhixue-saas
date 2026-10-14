# Architecture Review Report — v4 独立复验

**报告编号：** ZX-AR-20261012-05  
**日期：** 2026-10-12  
**被审包：** ZX-DES-20261012-04；答复 ZX-DES-20261012-04-RESPONSE  
**审查身份：** 独立 Architecture Review Agent  
**结论：** **完整 G0 仍为 No-Go；当前未发现新的设计 Blocker，剩 1 Critical、1 Major。** 原有受限骨架、合成实验和已授权试卷/答案隔离 PoC 许可不变；原 Prompt 2 暂不执行。

## 1. 执行摘要

v4 已修复上轮最明确的约束错误：答案 FK 有精确七列 UNIQUE 目标，match decision 同时关联 submission 的考试/冻结卷，名单 link 的 student_id 同时命中两侧父键；首次匹配和纯人工评分有合法插入顺序。路由函数明确固定登录角色、EXECUTE 边界和 definer 身份；capability 有持久 pending_enqueue 及再次签发恢复路径。普通 running 过期接管采用原槽转移，解决了“新 admission 不可创建”的死路。

本轮静态抽取说明 SQL 中 **13 条 FK，全部找到列集合匹配的显式 UNIQUE 目标**。这只证明列组对照，不是 PostgreSQL 迁移执行通过。原源 fence、接纳幂等、发送许可、账本唯一键和双层 schema 的既有设计认可保持。

剩余集中在本轮新增的 unknown 费用恢复：结算与业务成功的关系未闭合，重新 Claim 后如何使用旧 attempt 的 invocation/结果也未定义。另有 queued 的 binding 可空表和 queued_after_claim 的状态表不一致。本轮提出 **R5-01 Critical、R5-02 Major，0 Blocker、0 Minor**；这些是原恢复/契约问题的残留，不与 F/G0/R3/R4 相加计算独立缺陷总数。

**不要求再重写架构。** 可以选择保守收尾方案：M0 禁用付费自动复跑，费用对账独立，缺结果的任务进入可见人工异常；或提交严格受控的旧结果采用协议。两种都可评审，不能用支付确认代替业务结果确认。相关 ADR 决议仍是 G0 前提；无 G1 运行测试不是本次 No-Go 理由。

## 2. 范围与检查证据

用户“再来”授权独立审查。文档中的答复和请求是待审材料，不授权接受 ADR、写业务实现或发布。确认记录、V1.0 original、原架构和原技术路线继续作为依据。

本轮全文核对以下现行补丁与配套规格：

| 缩写 | 文件 |
|---|---|
| A | [review-remediation-v4.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/review-remediation-v4.md) |
| Q | [core-chain-v3.sql](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/sql/core-chain-v3.sql)，含 v4 补丁 |
| D | [data-dictionary.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/data-dictionary.md) |
| S | [state-transitions.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/state-transitions.md) |
| T | [transaction-boundaries.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/transaction-boundaries.md) |
| U | [authorization-matrix-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/authorization-matrix-v2.md) |
| I/M | [current-contract-index-v3.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/current-contract-index-v3.md)、[module-adjacency-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/module-adjacency-v2.md) |
| R/F | [g0-design-response-v4.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/g0-design-response-v4.md)、[architecture-findings-tracker.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/architecture-findings-tracker.md) |

ADR-001/004/012 的变更全文差异已读；其余十二份与上轮已审文本一致，15 份均 Proposed。三份 JSON 与上轮字节一致，解析和 `$ref` 静态对照正常。原确认记录、需求 original、架构 original、初次报告摘要未变。用户提供的 15 份 v3 改前快照同时匹配 MANIFEST 与上轮独立证据摘要。

执行了静态列组索引、差异/状态对照和文件摘要，并对照 PostgreSQL 官方规则：复合 FK 必须有适用唯一目标；SECURITY DEFINER 的执行 current_user 与外部调用者身份有区别。[外键规则](https://www.postgresql.org/docs/16/ddl-constraints.html)、[执行身份规则](https://www.postgresql.org/docs/16/functions-info.html)。

没有连接数据库、Redis、对象存储或供应商，没有运行迁移、双端 schema、故障注入或学校样本测试，没有修改用户仓库或代签 ADR。反例是**规格推演**。输入快照和机械检查见 [证据清单](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/outputs/architecture-g0-evidence-manifest-v4.json)。

## 3. 上轮四项的设计处置

| 原 ID | 本轮建议 design_review | 已认可 | 残留 |
|---|---|---|---|
| R4-01 Blocker | design_passed_pending_decision | 七列目标、同 submission/exam/student、首次 decision→binding、manual revision→draft→review | queued binding 表格随 R5-02 同步；真实迁移 G1/M3 |
| R4-02 Critical | design_passed_pending_decision | 固定登录角色、EXECUTE/capability 边界、正确 definer 身份、pending_enqueue 恢复 | 真实函数与重发故障验证 G1 |
| R4-03 Critical | partially_addressed | 普通过期原槽转移、epoch 保持、unknown 停放幂等释放 | R5-01：结算/旧结果/新 attempt；R5-02：重排状态 |
| R4-04 Major | design_passed_with_followups | 发布 EXECUTE、发送 scope、归属选项、evidence_held_at 和 fence 端口一致 | R5-02 小范围表格同步；依赖/真实权限 G1 |

普通接管的 cap=1 时间线可实施；账本、费用状态与业务状态在 unknown 分支上的关系仍需补充。设计通过不代表 implementation/verification 完成，也不自动关闭原 Fxx。历史严重度保留，本轮残留计数仅描述当前待补范围。

## 4. Findings

### R5-01 — Critical — Unknown 结算后的业务恢复与调用归属仍不闭合

**证据位置：** T:65、69、88–91、183–185；S:44–48、58；A:44–48。

**风险与反例：** T:185 规定 RecordSettlement 后，若“stage 已结束”则 job 进入 succeeded；但没有定义 stage 结束必须有已合法接纳的业务结果，还是只指供应商调用/费用已经结束。仅确认金额不能证明 OCR/评分结果有效，也不能产出 proposal。缺少合法结果时进入 succeeded，会绕过 failed_final/exception_review 的人工恢复入口。这里不是认定实现已经如此，而是规格缺少可判定的成功守卫。

另一个具体断点：A 的 invocation 属于 attempt A；A 超时停放或被 B 接管。结算后 ResumeAfterSettlement→新 Claim B，T:65 又要求接纳 invocation 属于当前 attempt B，旧 invocation A 的结果不能按该守卫通过。该恢复分支同时规定不得再次 IssueSendPermit，却没有采用旧 observation/result 的命令与权限。如果没有旧结果，更不能从账单金额推导业务结果。新 attempt、原 invocation 和旧 artifact 的关系需要明确。

**修复建议：** 将 cost_status/settlement 与业务 result_status/job 成功守卫分开，RecordSettlement 只更新费用事实。成功必须引用该 stage 已验证并已接纳的效果；无结果、输出非法或输入已变均保持明确异常/失败/人工状态。选择以下一条收尾路径：

- **保守路径：** M0 禁用 unknown 的自动付费复跑及自动 ResumeAfterSettlement。对账完成不自动 succeeded；无合格结果进入 exception_review/failed_final，教师经 OpenManualScore 恢复。已有合格效果的任务不因费用重试重复产生业务效果。
- **受控结果采用：** 明确 AdoptObservedResult 等可信命令，引用原 invocation/attempt/artifact、当前恢复 attempt 和当前 input/config/generation；来源谱系不改写，租户/任务一致，输出仍过 schema/语义及当前输入守卫；一个 invocation 的效果只采用一次。费用确认但无结果的情况仍人工异常，不伪造新 invocation 或放松普通接纳规则。

若新一次真实付费重评需要人工授权，应另外创建合法调用和账，不能把恢复等同于自动重发。恢复命令需列 actor、from/to、占用、epoch、幂等键、费用和业务副作用。

**G0 验收：** 三个必需样例：有费用确认但没有结果；原 A 的合法结果在 B 恢复时采用或转人工；结算前后 generation 已变化。每一步能说明谁写了业务效果、何凭据/版本允许、不允许什么，费用更新本身不触发成功。可选择保守路径，不要求现在设计完整供应商对账平台。

**G1/M3 验收：** 对账不造 proposal；旧输入结果不进入当前；同一结果重复恢复不双写、不双计费用；unknown 等待/放弃都有可见业务终态和无槽泄漏；费用确认没有输出时人工流程可达。

**关联/责任：** R4-03、R3-05/06；F11/F12/F14/F19。Cursor 补协议，负责人决议 ADR-004/012/013，独立审查复验。

### R5-02 — Major — Queued、binding 和重排状态的表格仍不一致

**证据位置：** D:213–217；Q:195–219；S:42–44；T:181、185。

**冲突：** D 的“queued 且未 Claim”列将 binding_id 固定为 NULL；Q 的阶段 CHECK 要求 answer_ocr/mark_extraction/model_grade 的 binding_id 非空。匹配后新建的评分 job 已经 queued，但仍必须引用现有 binding，不能照表格插 NULL。epoch=0 仅适用于从未 Claim 的初次 queued；已 Claim 后重排保持非零。T 允许 Admit queued_after_claim，S 的 AdmitJob 行却仍只有 queued，缺少一致的重排边。

**修复建议：** 分开“领取生命周期”与“业务 stage”两个维度：attempt 可空取决于是否领取，binding 可空取决于是否需要已匹配身份；绑定必须在匹配后 job 创建时写入，不等 Claim。状态表与 CHECK 明确 first queued、queued_after_claim、running、awaiting_settlement 的合法列组合。若按 R5-01 的保守方案禁用 unknown Resume，可从当前实现范围撤回对应重排边并写明；其他仍保留的 retry/requeue 路径必须一致。

**G0 验收：** 给两个正常初始行：未匹配 validate job（NULL binding、epoch=0），匹配后 model_grade job（非空 binding、epoch=0）。如保留重排，再给保持旧 epoch 的重排/再次 Claim 行；D/Q/S/T 无冲突。

**G1 验收：** 两类初始 job 可合法创建；错误空 binding 被拒；重排不重置 fencing、不再重复消耗旧 admission。机械列组对照通过不替代这些迁移/状态实测。

**关联/责任：** R4-01/03/04 的同步后续；F11/F19/F28。Cursor 同步规格，不需要新增产品决策。

## 5. 决议与验收边界

15 份 ADR 仍 Proposed，本轮不接受任何一份。修订后需优先明确 ADR-001/002/003/005 的模型/权限/事务边界，ADR-006/007 的版本/发布/分析资格，以及 M0 直接使用的存储、环境、用量、schema、样本边界。R5-01 选定的费用/业务恢复政策纳入 ADR-004/012/013，不由执行者暗自决定。

发布后归属纠正的选项甲/乙仍待负责人，选乙保持拒绝可以通过 G0。M0 不实施正式成绩发布，因此不必先实现该功能；但它不能在设计里默认为已批准。生产 cap、RPO/RTO、准确率、保留期限和完整算法继续在对应阶段决议。

G0 只需要这两处规格闭合及相关决议，不要求先跑 G1。G1 再验证实际角色、外键、Outbox、capability 重发、接管/取消/unknown、Python 互操作、双端 schema、对象和账本。真实数据政策和试点质量仍有后续闸门。

## 6. 下一步与准入结论

下一轮只需提交 R5-01 的一条明确恢复政策及三种反例时间线，以及 R5-02 的状态/空值对照补丁。保留本轮通过的引用链、函数身份、普通接管、权限/字段同步。执行修补交给 Cursor，决议交给负责人，设计复验和 QA 运行验证分开记录。

附 [Cursor 两处收尾 Prompt](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/outputs/cursor-g0-remediation-prompt-v5.md)。没有修改用户仓库、代签 ADR、安装运行时或实施原 Prompt 2。

**完整 G0：No-Go。** 依据是 unknown 分支的业务成功/恢复守卫未闭合、queued 契约不同步和核心 ADR 未决；没有 G1 测试不是失败理由。当前零新增 Blocker，不等于原 F01/F08/F15 的实现风险已经关闭。两处补齐后即可申请设计再复验与负责人决议，无需重铺架构；再通过后才能按原 Prompt 2 执行 M0 窄切片。
