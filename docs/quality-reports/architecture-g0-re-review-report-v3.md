# Architecture Review Report — v3 独立复验

**报告编号：** ZX-AR-20261012-04  
**日期：** 2026-10-12  
**被审包：** ZX-DES-20261012-03；答复 ZX-DES-20261012-03-RESPONSE  
**审查身份：** 独立 Architecture Review Agent  
**对照：** ZX-AR-20261012-03 的 R3-01–R3-08  
**结论：** **G0 No-Go，原 Prompt 2 暂不放行。** 原有仓库骨架、合成数据实验与已授权试卷/答案隔离 PoC 的受限许可维持。

## 1. 执行摘要

v3 有实质进展。接纳现在先认证、再处理同体幂等、最后检查新效果；租约 token/截止、invocation 归属和题项集合已有守卫。发布和投影锁同一 source fence，投影自身版本独立 CAS。admission 计入占用，发送许可、observation 和结算幂等也有具体协议。现行事件已统一，format 注册和真实历史快照已补。

上轮 **R3-03、R3-04、R3-06、R3-08 的主要设计缺陷可标为设计复验通过，仍待决议与运行验证**。R3-01、R3-02、R3-05、R3-07 局部未闭合，本轮归并为 **4 项残留：1 Blocker、2 Critical、1 Major、0 Minor**，编号 R4-01–R4-04。不与原 F、G0 或 R3 编号相加计算独立缺陷数量。

最明确的问题是说明 SQL 的目标键与 FK 不相容：`uq_binding_chain` 有八列，答案 FK 引用其中七列，当前稿没有提供该七列的适用唯一键。另有 `SECURITY DEFINER` 下如何识别调用者的语义问题，以及已消耗 admission 的过期 running job 怎样取得新接管资格的流程缺口。

本轮仍不是“只差签字”，但已无需再次重写架构。下一轮只需补这四个具体接口/约束/状态衔接点。没有 G1 运行证据不是本次 G0 No-Go 的理由；没有真实学生数据或生产参数也不要求现在虚构。15 份 ADR 仍 Proposed，审查者不代签。

## 2. 范围、来源与检查

用户“再来”授权独立复验。附带文档的答复、自检和请求按审查材料处理，不作为接受 ADR、写业务代码或发布的指令。需求依据继续是 V0.1–V0.28 确认记录及 V1.0 original，技术栈与输入范围不改变。

| 缩写 | 本次证据文件 |
|---|---|
| A | [review-remediation-v3.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/review-remediation-v3.md) |
| I | [current-contract-index-v3.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/current-contract-index-v3.md) |
| D | [data-dictionary.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/data-dictionary.md)，含 v3 引用链 |
| Q | [core-chain-v3.sql](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/sql/core-chain-v3.sql)，说明性 DDL，未执行 |
| S | [state-transitions.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/state-transitions.md) |
| T | [transaction-boundaries.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/transaction-boundaries.md) |
| U | [authorization-matrix-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/authorization-matrix-v2.md)，含 v3 控制面 |
| M | [module-adjacency-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/module-adjacency-v2.md)，含新表 owner |
| C | [grading-contract-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/schemas/grading-contract-v2.md) |
| R/F | [g0-design-response-v3.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/g0-design-response-v3.md)、[architecture-findings-tracker.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/architecture-findings-tracker.md) |

对照了所有 ADR：五份修改的 ADR-002/004/005/006/007 检查完整变更；其余十份与上轮已全文审查的快照字节一致。现行三份 JSON 未变，仍区分模型正文、评分接纳信封和撤回草案。

原需求确认、需求 original、架构 original、初次报告摘要均与上轮一致。v2 主补充稿仅增加后续版本提示，去掉提示后正文与上轮一致。用户提供的 16 份改前快照同时与 MANIFEST 和上轮独立证据摘要一致，不是重构历史。未恢复的 2026-10-11 配套原文已如实标明。

执行了静态文本/约束/变更核对、源文件摘要、schema 解析与 SQL 列组抽取，对照 PostgreSQL 16 官方资料。**没有执行 PostgreSQL 迁移或服务测试**，没有安装依赖、调用模型、导入学生数据或修改仓库。下文数据库行为为依据官方规则的推演，不冒充实测。证据与本轮输入快照见 [证据清单](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/outputs/architecture-g0-evidence-manifest-v3.json)。

## 3. 上轮八项的处置

| 原 ID | 本次 design_review | 已解决 | 剩余 |
|---|---|---|---|
| R3-01 | partially_addressed | generation/page_set 同 submission、新代 binding、稳定 participation、初始可空守卫和封存发布方向 | R4-01：目标 UNIQUE、match decision 与 submission、名单学生一致、人工复核引用 |
| R3-02 | partially_addressed | 索引同事务、撤销/重发方案、relay 读路径、PUBLIC EXECUTE 撤销和平台汇总入口 | R4-02：函数执行身份；capability 重发后的入队断点；R4-04 权限文字 |
| R3-03 | design_passed_pending_decision | 幂等优先、新效果租约/调用/题项守卫、统一执行锁序和按 stage 区分 | R4-03 的过期接管路径须一起验证；R4-04 的 stage 小范围澄清 |
| R3-04 | design_passed_pending_decision | source fence 与投影 CAS 分离、首次投影、新 hash、空证据和重排路径 | R4-04 字段/读取端口同步；算法和真实并发验证留后续 |
| R3-05 | partially_addressed | reserved+running 计数、原子 admission/Claim、取消/未消耗过期释放 | R4-03：已 consumed 的过期 running attempt 接管 |
| R3-06 | design_passed_pending_decision | HTTP 前许可、观察持久化窗口、结算唯一键、差额/付费 OCR 方向 | 发送许可/观察/账本故障测试 G1；stage 能力表随 R4-04 同步 |
| R3-07 | partially_addressed | 事件统一、event_id、owner 表、真实历史快照、旧 ADR 名称同步 | R4-04：现行权限、basis、字段名和端口仍有冲突 |
| R3-08 | design_passed_pending_verification | Ajv format 注册与 registry 顺序、UUID 正反例 | 固定版本双端校验属于 G1 |

这些是设计层面的处置。原 Fxx 未 Closed，implementation/verification 仍 not_started/not_run，decision 仍 Proposed。原已认可的草稿/正式事实、total_only、双层输出与 G0/G1 区分保持，不重复推翻。

## 4. Findings

### R4-01 — Blocker — 外键目标仍不成立，部分归属链没有落到约束

**证据：** Q:68–73、102–113；D:76；Q:55–65；D:67–68、78、149；S:26–27、45。

**明确冲突：** `uq_binding_chain` 是八列：

```text
tenant_id, id, generation_id, submission_id, match_decision_id,
exam_id, participation_id, paper_version_id
```

`fk_answer_binding` 的 REFERENCES 是七列，缺少 match_decision_id。D:76 却称这七列的目标“即 uq_binding_chain”。多一列的 UNIQUE 不是七列 FK 的目标；即使存在单列 id 主键，也不能直接替代这一复合引用所需的键。PostgreSQL 要求 FK 的引用列对应适用的主键/唯一约束或非部分唯一索引。[PostgreSQL 外键规则](https://www.postgresql.org/docs/16/ddl-constraints.html)。本轮列组抽取确认不一致，未执行 SQL。

**其余反例：** match_decisions 对 participation 的 exam/paper 有 FK，但没有精确关联其 submission 的 exam/paper。S 属于考试 E1，decision 的 submission_id=S，而 participation/exam 指向 E2，仍可能满足目前展示的各条约束。participation_roster_links 同时约束考试，却没有将 entry.student_id 与 participation.student_id 相等落到 FK/受控守卫；同考试甲的 participation 可以链到乙的名单 entry，影响历史班级、范围权限和统计。

**合法路径缺口：** 新复核 FK 要求 answer_revision，而 OpenManualScore 在 OCR 终败且没有合法答案修订时只列出插入 draft/items。必须说明纯人工如何创建合法 teacher/manual answer revision，或采用明示的人工复核引用分支。首次 MatchAutomatically/ResolveMatch 的实际写入也应包括非空绑定所需的 match_decision，而不是只写 binding。

**修复建议：** 在保留现有表形的前提下，新增/改正精确七列目标 UNIQUE，或让答案 FK 包含对应的第八列；同步 D/Q。补 decision→submission 的同考试同冻结卷 FK；名单 link 加学生同一性键或明确受控原子检查。人工无 OCR 与首次匹配给出真实、按顺序可插入的依赖行。检查整个核心片段中每个 FK 的目标列组与可空初始状态，不要求写全产品 DDL。

**G0 验收：** 提交最小建表前提与说明 SQL，不含缺失目标键；合法首次匹配、两代 OCR 修正、纯人工终败恢复能逐行推演。跨 submission/exam/student 的反例被明确约束或守卫拒绝。

**G1/M3 验收：** 执行实际迁移与正反例；不得出现“no unique constraint matching given keys”；无 OCR 人工评分可以确认发布；同考试跨学生名单链失败。正式封存的补插/删改 item 与非授权发布仍失败。

**关联/责任：** R3-01、G0-01/04/06；F01/F18/F19。Cursor 修约束/命令，负责人决议 ADR-001/006/011，独立审查复验。

### R4-02 — Critical — SECURITY DEFINER 的调用者检查语义不清，重发仍缺少入队断点

**证据：** U:9–13、25、27–33；I:36；U:48。

**风险：** U:13 写“数据库再检查 current_user 与 capability 哈希”，但路由函数是 SECURITY DEFINER。若检查放在该函数体内，current_user 是函数所有者的执行身份，不是原调用角色。它可能让所有合法调用都失败，或把所有调用视为同一个 router 身份。若原意是在 invoker 入口检查，则必须写出检查位置与不可绕过的调用路径。PostgreSQL 明确 current_user 在 SECURITY DEFINER 执行时改变；session_user 是连接身份，SET ROLE 又可能使两者不同。[PostgreSQL 会话身份语义](https://www.postgresql.org/docs/16/functions-info.html)。不能简单把 current_user 换成 session_user 就假定任意连接池模式都正确。

另外，ReissueCapability 说撤销旧哈希、签发新秘密、重新入队；仍未定义“数据库已提交新哈希，进程在入 Redis 前死亡”的恢复身份/投递路径。只存秘密哈希无法恢复原秘密。通过再次重新签发也可解决，但须明确持久待投递状态、可发现条件、入队 ACK 与下一次签发/撤销的事务关系，不能用一句“重新入队”留下双写窗口。

**修复建议：** 明确连接身份、SET ROLE、invoker 和 definer 执行角色，选择可核验的边界：例如基于精确 EXECUTE GRANT 的受控入口，再由 capability/env/期限限制工作；若需要额外调用者断言，明确可信来源和不可伪造性。提供函数 owner/调用角色/授权的说明片段。search_path 与限定名方案按官方安全规则说明，不能声称只写 pg_catalog 就自动排除了隐式临时 schema。[安全函数规则](https://www.postgresql.org/docs/16/sql-createfunction.html)。

为 capability 重发给出 durable dispatch 或可重入重新签发方案，保留仅哈希存储和不进日志的约束；禁止常规后台借用 migrator。scope、角色、环境与 job/attempt 的关系一致。

**G0 验收：** 两个合法调用角色、一个无 EXECUTE 角色、正确/错误 capability 的身份时间线；分别说明 current_user/session_user 在函数外/内的值。新哈希提交后进程死亡，下一次恢复仍有明确可完成的路径。

**G1 验收：** 真实函数与连接池/SET ROLE 测试，正确角色可解析而错误角色/环境/秘密拒绝；重发 DB 提交后、入队前、入队 ACK 后崩溃不丢待处理工作，也不扩大旧秘密权限。

**关联/责任：** R3-02；F08/F13/F15。Cursor，ADR-001/003/005。

### R4-03 — Critical — 过期 running job 没有合法的新 admission/接管路径

**证据：** S:42–43；T:87–90、176、180–182；D:214–221、Q:163–169。

**风险/反例：** A 已 Claim，admission 已 consumed，job 是 running，占用为 1。A 租约到期后，T:88 要求 B 消费自己的 admission 才能接管；S:42 的 AdmitJob 又只允许 queued，不能为这条 running job 创建新 admission。若直接重用 A 的 admission，T:180 明确“已消耗则重复 Claim 拒绝”。三个规则合起来，没有一条可执行的 B 接管边，持久 running job 和占用可能一直挂起。给未消耗 admission 过期减 1 并不能处理已 consumed 的旧 attempt。

**修复建议：** 选择并写完其中一种协议：

- **原槽转移：** 在统一锁序下确认当前 attempt 租约过期、输入仍有效，原占用只转移给新 attempt，递增 fencing，计数不增不减；无需伪造一个尚未消耗的新 admission。
- **释放后重排：** 原子终结旧 attempt、一次性释放原占用，把 job 转入明示的等待/queued 状态；之后重新 Admit/Claim。旧回写失败，重排不双计费用。

若选择重排，初次 queued 的 epoch=0 与曾领取后 queued 的状态必须区分，不能为满足 CHECK 而把 fencing epoch 重置。若已有 send_unknown invocation，执行恢复不得自动再次付费；明确等待对账/人工时是否释放执行槽、如何恢复，避免未知费用占满运行名额。

**G0 验收：** A running→租约到期→B 接管→A 迟到回写的逐步状态/占用/epoch 表；cap=1 的场景也能恢复。给双恢复者、取消与接管竞争、send_unknown 的等待/恢复样例，所有减占用动作幂等。

**G1 验收：** 杀 Worker、租约过期、Redis 丢失、重复恢复和 unknown 等待后，任务均有可见恢复或受控终态，无永久槽泄漏、重复消耗、旧回写或自动二次付费。

**关联/责任：** R3-05，R3-03 的运行后续；F11/F12/F17。Cursor，ADR-004/012。

### R4-04 — Major — 配套权限和字段仍有小范围实质冲突

**证据：** D:102–103、119、123；U:41、45、52；A:128；T:141、172；I:14、M:40。

**冲突清单：**

1. D 定义 app 只有 EXECUTE publish_score_version、无正式表 INSERT；U 仍写学校用户和发布可 INSERT 正式成绩。U 的 PrepareInvocation 行仍称提交后可 HTTP，而 T 已要求 IssueSendPermit。应区分函数的业务副作用与调用者的实际 SQL 权限。
2. D:123 开头说甲乙都已有正式分，随后又要求乙没有另一份当前正式分/“当前指针仍是待确认草稿”。当前指针 FK 只指向正式事实，不能指向草稿。A:128 的选项甲条件较清楚，应成为一致的规范；选项乙继续可选，不能默认增加功能。
3. 现行事件已改 evidence_held_at，T 的 evidence_set_hash 和重跑句子仍写 evidence_as_of。应使用一个字段名，并继续区分分析命令 as_of。
4. mastery 需锁定 grading-owned fence，M 说它只锁读，却未列公开查询/锁端口与具体消费角色；观察和结算 scope 在 T 已定义，U 未同步。可在 M0 角色/端口设计中补全，不要求算法实现。

**修复建议：** 提交一个小型一致性补丁，把 U 的权限改成实际 GRANT/EXECUTE，HTTP 发送入口只按许可；统一字段；选项甲/乙条件跨 A/D/S/ADR 一致；新读取/锁端口和 observe/settle 能力明确。不用重新设计正确的双层 schema、投影 fence 或账本表形。

**G0 验收：** 跨文件对照表无上述相互矛盾的现行句子。归属纠正仍在负责人决议之前保持关闭；M0 方案能区分只读成员、发布入口、Worker、消费角色。

**G1/M3 验收：** app 直接 INSERT 正式事实失败但授权发布 EXECUTE 成功；平台只读不能调用发布；未获发送许可不能发外部请求；事件 hash 计算使用相同字段；projection 角色可完成必要锁读而不能改成绩。

**关联/责任：** R3-07；G0-03/05/11/13 的一致性后续；F07/F15/F28。Cursor 同步文档与 Proposed ADR，负责人裁决归属选项。

## 5. 已认可部分与未决事项

本轮设计复验认可接纳顺序、真实 fence 冲突对象、发送许可/observation/结算唯一键、format 注册、事件名称统一及真实快照。设计认可不说明真实角色、数据库函数或队列已经验证，也不自动把任一 ADR 标为 Accepted。

保持 15 份 ADR 的实际 Proposed 状态。需要优先准备修订后的 ADR-001/003/005 的角色/控制面，ADR-004/012 的接管恢复，ADR-006/011 的引用链，以及 ADR-002/007/013 的端口与契约同步。既定 Python Worker 技术路线不重新选择；固定版本与实测仍在 M0/G1。

发布后归属纠正选择甲或乙由项目负责人决定。**选项乙保持拒绝写入也可以通过 G0**；无需为通过技术审查被迫增加原基线未确认的功能。若选甲，应消除 R4-04 条件冲突，并在 M3 验证两侧原子发布、范围权限、统计和分析失效。

生产 cap、宽限、RPO/RTO、质量阈值、保留年限和算法不要求本轮填写。M0 使用测试剖面、合成学生数据和已授权试卷/答案；真实数据与学校质量专项没有通过，不能据本报告改变闸门。

## 6. 精确修复路线与下次验收

| 顺序 | 交给 Cursor 的补丁 | 需要返回的可审材料 |
|---|---|---|
| 1 | R4-01 FK/归属/人工路径 | 匹配的列组、最小前提、合法插入顺序、跨考试/学生反例 |
| 2 | R4-02 执行身份/重发断点 | invoker/definer 角色表，函数授权片段，入队崩溃时间线 |
| 3 | R4-03 过期接管 | 一种完整接管协议、cap=1 状态计数表、费用未知与取消处理 |
| 4 | R4-04 小范围同步 | 权限/字段/归属条件/端口跨文件对照，保留已正确方案 |
| 5 | 决议与独立复验 | 四项回应及负责人核心方案决议；未运行栏保持实际状态 |

本轮仅新增独立报告、证据和 [Cursor 第四轮精确补修 Prompt](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/outputs/cursor-g0-remediation-prompt-v4.md)，没有修改用户仓库。执行者修补、负责人决议、独立审查复验、QA 运行验收的职责保持。

**当前：G0 No-Go。** R4-01–03 的核心设计及 R4-04 实质冲突修复后，再提交独立 G0 复验和相关决议；不要求先运行 G1 才允许开始 M0。通过后原 Prompt 2 才有前置证据。整个项目前置的受限 Conditional Go 不变，不能扩展成正式安全/数据/任务模型已获批准。
