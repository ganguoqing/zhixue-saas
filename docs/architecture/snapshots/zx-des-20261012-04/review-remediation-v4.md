# 智学 SaaS 架构补充 v4

**包编号：** ZX-DES-20261012-04  
**日期：** 2026-10-12  
**状态：** Proposed。作者不宣布 G0 通过。  
**对照：** ZX-AR-20261012-04 的 R4-01–R4-04。  
**保留：** v3 的接纳顺序、source fence、admission 计数、发送许可、observation、结算唯一键、format 注册和 `zx-des-20261012-02` 快照。  
**本轮快照：** `docs/architecture/snapshots/zx-des-20261012-03/`。没有 Git。独立报告和原需求、原架构未改。

样例是规格推演，不是数据库或 Redis 实测。

## R4-01 可插入的引用链

**精确修改位置：** `sql/core-chain-v3.sql`；`data-dictionary.md` 第 3、5、6 节；`state-transitions.md` 的 `MatchAutomatically`、`ResolveMatch`、`OpenManualScore`。

**约束与顺序：** 新增七列唯一键 `uq_binding_answer_target`。`fk_answer_binding` 引用这七列，不引用八列 `uq_binding_chain`。`fk_decision_submission` 指向 `submissions (tenant_id, id, exam_id, frozen_paper_version_id)`。名单链接的 `student_id` 同时进入 participation 与 entry 的外键。首次匹配先插入 `match_decisions`，再插入当前 generation 的 binding。`OpenManualScore` 先按槽插入 `answer_revisions.origin=manual`，再插入草稿；`human_reviews` 留到之后的 `CompleteReview`。

**合法例子：** submission S 属于考试 E、冻结卷 P，学生甲。`MatchAutomatically` 插入 decision（S、E、P、甲的 participation），再插入 generation 1 的 binding。`CorrectRecognition` 插入 generation 2 和 binding 2，答案引用 binding 2 的七列。OCR 终败且没有答案行时，`OpenManualScore` 为每个槽插入 `origin=manual` 的 revision，然后插入 draft item。

**拒绝反例：** S 属于 E1，decision 的 participation 属于 E2：`fk_decision_submission` 与 participation 外键不能同时成立。甲的 participation 链接乙的 roster entry：链接上的同一个 `student_id` 无法同时命中两侧唯一键。只插入 binding、不插入 decision，binding 的 decision 外键失败。在 manual revision 之前插入 review，`fk_review_answer` 失败。

**待决：** ADR-001/006/011 仍 Proposed。归属选项见 R4-04。

**未来测试：** G1/M3 在测试库执行这段说明 DDL。期望合法首次匹配、两代输入和无 OCR 人工发布成功；跨 submission、跨考试、跨学生失败；不出现 “no unique constraint matching given keys”。尚未执行迁移。

## R4-02 执行身份与入队断点

**精确修改位置：** `authorization-matrix-v2.md` 第 0 节；契约索引的 `capability_dispatches`。

**顺序：** 连接池不 `SET ROLE`。函数外 `current_user` 与 `session_user` 都是登录角色。`SECURITY DEFINER` 体内 `current_user` 是所有者 `zhixue_router`，所以函数内不靠它识别调用者，也不读取载荷里的角色。`EXECUTE` 只授予 `zhixue_ai_ingress` 和 `zhixue_reconciler`。`search_path = pg_catalog, pg_temp`，函数体使用限定名。数据库提交新哈希和 `pending_enqueue` 之后才入 Redis；ACK 是后一个事务。

**合法例子：** ingress 在函数外 `current_user=zhixue_ai_ingress`，进入函数后 `current_user=zhixue_router`，`session_user` 仍是 ingress，正确 capability 返回 tenant。reconciler 同样拥有 `EXECUTE`，错误 capability 返回空。

**拒绝与崩溃反例：** `zhixue_app` 没有 `EXECUTE`，语句在进入函数前失败。新哈希已提交、入队前进程死亡：恢复者看到 `pending_enqueue`，不能从哈希还原秘密，于是撤销该哈希并再次签发。若 Redis 已有旧秘密但 ACK 未提交，下一次撤销使旧秘密解析为空。

**待决：** 生产有效期未填。ADR-001/003/005 仍 Proposed。普通后台仍不使用 migrator。

**未来测试：** G1 用真实连接池验证两个有 `EXECUTE` 的角色和一个没有的角色，以及提交后、入队前、ACK 前的崩溃。本轮没有连接数据库或 Redis。

## R4-03 过期接管

**精确修改位置：** `state-transitions.md` 的 `TakeoverExpiredAttempt` 与 `ParkForUnknownCost`；`transaction-boundaries.md` 第 5、7 节。接纳顺序和未消耗 admission 的计数保留。

**选择的协议：** 原槽转移。`AdmitJob` 不接受 `running`。`ClaimJob` 不重复消费已消耗的 admission。接管确认租约过期且输入仍有效，epoch 加 1，占用不变。`queued_after_claim` 的 epoch 保持大于等于 1，不重置为 0。`ParkForUnknownCost` 只在 `occupancy_held` 为真时把占用减 1。

**合法例子：** cap=1。Admit 后 occupied=1、epoch=0。A Claim 后 attempt=A、admission=consumed、epoch=1、occupied=1。到期后 B 接管，attempt=B、epoch=2、occupied 仍是 1。A 的迟到回写看见当前 attempt 是 B，不写业务，也不再付费。

**拒绝反例：** 两个恢复者只有先提交的一方把 epoch 加到 2。取消先提交则接管回滚。已是 `send_unknown` 时停放把 occupied 从 1 减到 0；再执行一次停放不再减。恢复后续跑要重新 Admit，并且不调用 `IssueSendPermit`。

**待决：** 生产 cap 与宽限未填。ADR-004/012 仍 Proposed。

**未来测试：** G1 杀 Worker、等待租约、重复恢复、取消竞争、Redis 重启和 unknown 等待。本轮没有做这些实验。

## R4-04 残余对照

| 主题 | 现行句子 |
|---|---|
| 正式成绩 | 字典、状态、授权矩阵：`zhixue_app` 只有 `EXECUTE publish_score_version`。函数插入正式行。平台角色和 AI 角色没有这个 EXECUTE |
| 发送 | `PrepareInvocation` 只写 `not_sent`。HTTP 在 `IssueSendPermit` 提交之后。观察 scope 是 `ai.invocation.observe`，结算 scope 是 `ai.billing.settle` |
| 选项甲 | 乙已有 `score_current_pointers` 则 409。指针不指向草稿。未决议时命令也是 409。选项乙保持拒绝 |
| 证据字段 | 哈希使用 `evidence_held_at`。分析命令的 `as_of` 是窗口终点 |
| fence 读端口 | `LockAnalysisFence` 由 grading 拥有，`zhixue_mastery` 只 EXECUTE。函数不增加 epoch，不改成绩 |

**合法例子：** 教师发布调用函数成功，函数写入正式行和封存。消费角色锁到 fence 4/H4 后只写自己的投影。

**拒绝反例：** `zhixue_app` 直接 `INSERT` 正式表失败。未签发发送许可就发 HTTP，不符合事务文档。把投影 `as_of` 写入 `evidence_held_at` 的位置，哈希口径不一致。

**待决：** 负责人仍未在选项甲和选项乙之间选择。双层 schema、投影算法和账本表形未改。

**未来测试：** G1/M3 验证直接 INSERT 失败、EXECUTE 成功、未许可不能外发、哈希字段一致、消费角色不能改成绩。尚未运行。

## 对已通过设计的影响

ZX-AR-20261012-04 将 R3-03、R3-04、R3-06、R3-08 标为设计复验通过。decision、implementation、verification 仍是 proposed、not_started、not_run。

R4-03 给 R3-03 补了过期接管边，给 R3-05 补了已消耗槽的转移，这两处需要下次复验。R4-04 同步了 R3-04 的字段名和 R3-06 的 scope 表，算法与账本未改。R3-08 的 format 注册未改。
