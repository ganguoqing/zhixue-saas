# 智学 SaaS 架构补充 v3

**2026-10-12 后续：** R4 补丁在 `review-remediation-v4.md`。本文件保留 v3 正文。答案外键的七列目标、调用者身份、过期接管和权限文字以 v4 为准。接纳顺序、source fence、admission 计数、发送许可和 format 注册仍然有效。

**包编号：** ZX-DES-20261012-03  
**日期：** 2026-10-12  
**状态：** Proposed。作者不宣布 G0 通过。ADR 仍为 Proposed。没有实现，也没有运行测试。  
**对照报告：** ZX-AR-20261012-03。本轮只补 R3-01–R3-08。  
**不改：** 原需求、原架构、两份独立报告、`review-remediation-v1.md`、`review-remediation-v2.md`。  
**改前快照：** `docs/architecture/snapshots/zx-des-20261012-02/`。仓库没有 Git。2026-10-11 被 v2 覆盖的字典/状态/事务正文无法恢复，本轮没有重写它们来冒充原文。

下列每项的样例都是规格推演。数据库、Redis、Ajv 和供应商都没有运行。

## R3-01 引用链

**精确修改位置：** `data-dictionary.md` 第 3、5、7、8 节；`state-transitions.md` 的 `CorrectMatch`、`CorrectRecognition`、`SupplyReplacementPage`；`sql/core-chain-v3.sql`。

**约束变化：** generation 的外键包含 `submission_id`。binding 外键包含同一 submission 的 match decision，以及该考试的 participation 与冻结卷。答案、review、正式 item 引用这条链上的同一 participation、卷和槽位。新 generation 必须插入新 binding；只增加 generation 编号不够。`current_attempt_id` 在 Claim 前为空。`validate_asset` 与 `identity_ocr` 的 `binding_id` 为空。同一考试同一学生只有一行 participation。正式 item 只能由 `publish_score_version` 在封存前插入。

**合法样例：** submission S、考试 E、学生甲。generation 1 指向 S 的页集 1，binding 1 指向 match decision D 与甲的 participation。`CorrectRecognition` 插入 generation 2 和 binding 2，binding 2 仍指向 D。答案只挂 binding 2。名单 v2 只增加 roster link，不增加第二行 participation。

**拒绝反例：** S 的 generation 指向另一份 submission 的页集；binding 指向另一场考试的 participation；答案使用另一份卷的槽位；review 指向另一个学生的 revision。这些组合在 `core-chain-v3.sql` 的复合外键上不成立。本轮未执行该 SQL。

**待决：** `attribution_corrected_away` 见文末选项甲/乙。ADR-001/006/011 仍 Proposed。

**G1/M3 测试计划：** 在测试库执行说明 DDL 后，插入合法两代；再插入四个反例并期望语句失败。封存后的补插 item 应失败。这些测试尚未运行。

## R3-02 控制索引与权限

**精确修改位置：** `authorization-matrix-v2.md` 第 0 节与 relay、平台运营行。

**约束变化：** job/outbox 与 route/dispatch 索引同事务写入和撤销。capability 只存哈希，并绑定 `env`。Redis 清空后走 `ReissueCapability`，旧秘密在撤销提交后不能解析。relay 在 `set_config` 之后 `EXECUTE read_outbox_payload`，有事件列 SELECT，没有学生正文 GRANT，也不使用 migrator。函数 `search_path=pg_catalog`，迁移事务内撤销 PUBLIC EXECUTE。平台汇总只读 `ops_usage_totals`，个人读仍设置目标 tenant。

**合法样例：** 两个租户各有一条已提交 outbox。relay 对事件 1 设置租户 A 后读到 A 的载荷，对事件 2 另开事务设置租户 B。Redis 清空后，reconciler 撤销旧哈希并签发新 capability，新 Worker 可以解析。

**拒绝反例：** 索引写入在业务提交之后单独失败时，整个事务回滚，不留下找不到的已提交 job。错误 `env` 的 capability 与过期哈希解析为空。平台角色查询学生表没有 GRANT。普通后台连接没有 `BYPASSRLS`。

**待决：** capability 的生产有效期未填。ADR-001/003/005 仍 Proposed。

**G1 测试计划：** 提交前崩溃、提交后索引不可见、清空 Redis、两租户 relay、错误环境 capability、平台汇总与个人读。尚未运行。

## R3-03 接纳顺序与锁序

**精确修改位置：** `transaction-boundaries.md` 第 4–5 节。评分信封 JSON 未改。

**顺序变化：** 先认证和未使用的 `jti`；再按幂等键返回已保存结果，job 已是 `succeeded` 也返回。只有新效果才检查非终态、租约 token、`lease_until+grace`、当前 attempt/epoch/generation/binding/input/config/stage，以及 invocation 属于该 job。执行类锁序是全局占用、租户占用、submission、binding 指针、job、invocation。

**合法样例：** 接纳已经成功。新的 `jti` 带着相同幂等键和相同 body，返回第一次的结果，不要求 job 仍在运行。

**拒绝反例：** 租约已过且无人接管；token 不匹配；invocation 属于另一个 job；重复 `paper_question_id`。前三种不改当前 job，也不新增费用。重复题项把当前 attempt 送入 `exception_review`，不插入合格 proposal。validate 阶段不得伪造评分 invocation 来通过 `acceptance-envelope/1.0.0`。

**待决：** 生产 `grace_seconds` 未填。M0 测试值仍是 0。ADR-003/004/013 仍 Proposed。

**G1 测试计划：** 过期、错误 token、跨任务 invocation、同体成功重试、不同 body、改输入竞争、锁等待顺序。尚未运行。

## R3-04 源 fence 与投影

**精确修改位置：** `transaction-boundaries.md` 第 6 节；邻接表中 fence 的 owner。

**约束变化：** 三个数分开：fence 行的 `epoch`、计算时读到的 evidence hash、投影行自己的 `projection_version`。发布和投影都锁定 `student_analysis_fences`。投影先核对 fence，再 CAS 投影版本。`evidence_held_at` 是考试时间。窗口终点 `as_of` 在投影命令上。

**合法样例：** 没有 current 行时，fence 仍等于捕获值，则插入 projection_version=1。考试 B 的新证据使 fence 变为 5/H5，按 H5 计算的提交可以成功。

**拒绝反例：** 投影读到 4/H4，发布把 fence 提交为 5，旧投影再提交时锁到 fence 发现 4≠5，只归档并记 `needs_recompute`。旧投影上的 H4 不能用来拒绝一份已经写入 fence 头的 H5。

**待决：** 掌握度算法不在本轮。ADR-005/006/007 仍 Proposed。

**G1/M4 测试计划：** 上述交错、空证据、另一知识点、重复 event_id。尚未运行。

## R3-05 admission 占用

**精确修改位置：** `transaction-boundaries.md` 第 7 节；`state-transitions.md` 的 `AdmitJob` 与 `ClaimJob`。

**约束变化：** 占用 = 未消耗 admission + running。游标、占用和 admission 同事务，锁序见第 5 节。Claim 消费当前 admission，不第二次加占用。执行槽与付费额度分表。expired 允许领走已 admission 的当前 stage，拒绝新 stage。suspended 与 closed 取消未完成 job，不删成绩。

**合法样例：** M0 cap 为租户 2、全局 4。A1、A2 在 Worker 领取前占用已是 2。Claim A1 后占用仍是 2，其中 1 个 running、1 个 reserved。

**拒绝反例：** 第三个尚未 running 的 A3 被拒绝。重复 Claim A1 被拒绝。两个 scheduler 串行锁同一占用行，不能都把占用加到 3。

**待决：** 生产 cap 未填。ADR-012 仍 Proposed。

**G1 测试计划：** 多 scheduler、迟到 Worker、重复 Claim、过期释放、suspended。尚未运行。

## R3-06 发送、观察与结算

**精确修改位置：** `transaction-boundaries.md` 第 2–3 节；邻接表中 OCR 与评分的结算参与者。

**约束变化：** `IssueSendPermit` 在 HTTP 前把 `send_state` 写成 `send_unknown`。`not_sent` 不能证明外部未收到请求。观察未提交时不得声称已保存。结算唯一键是 `(tenant_id, invocation_id, settlement_kind, settlement_key)` 加 body hash。付费 OCR 使用同一观察和结算命令。

**合法样例：** 人工确认键 `confirm:req-9`、body hash 相同，重试两次仍只有一行 12.50。随后贷项键 `credit-2` 再插入 -0.20，合计 12.30。

**拒绝反例：** 两个恢复者中的后到者看见 `send_unknown`，不得再发。响应已到但观察事务未提交，状态保持未知，不自动再付费。同一确认键配不同 body 返回 409。

**待决：** 不承诺供应商精确一次。不在本轮调用付费模型。ADR-012/013 仍 Proposed。

**G1 测试计划：** 双恢复者、发送后崩溃、同一确认重试、unknown 后人工确认再重试、两次真实调用。使用 mock，尚未运行。

## R3-07 一个现行规范

**精确修改位置：** `current-contract-index-v3.md`；ADR-002/004/005/006/007 正文中的命令名、事件名和公平句子；邻接表第 2.1 节。

**约束变化：** 生产与消费只有 `ScorePointerAdvanced`。`event_id` 在信封顶层。route、dispatch、admission、fence、observation、账本和正式成绩各有一个写 owner。

**合法样例：** 事务文档第 6 节的 JSON 含 `event_id`。inbox 使用该字段。

**拒绝反例：** 按 ADR 旧句去订阅 `ScoreVersionPublished` 不会收到现行事件。那两句已改。快照目录里的副本仍是改前原文，不作为现行契约。

**待决：** ADR 仍 Proposed。历史 v1 配套正文无法从本仓库恢复，见契约索引第 5 节。

**G1 测试计划：** 序列化含 `event_id`；依赖检查拒绝跨模块写 repository。尚未运行。

## R3-08 format

**精确修改位置：** `schemas/grading-contract-v2.md` 校验器配置。两份现行 JSON 未改。

**约束变化：** 先 `addFormats`，再注册 payload，再注册 envelope。`strict: true`，`removeAdditional: false`。

**合法样例：** UUID `018f0a3e-7c21-7b2a-8c11-111111111111`。

**拒绝反例：** `not-a-uuid`。这是文档中的预期，不是已运行的 Ajv 结果。

**待决：** 无产品决议。此项 Minor，不单独作为 G0 结论。

**G1/M0 测试计划：** 固定 Ajv 与 jsonschema 版本后编译两份 schema 并跑 UUID 正反例。尚未安装，尚未运行。

## 归属纠正的两个选项

两者都未确认。称它不是撤回，不等于已经选择选项甲。

选项甲：支持受控归属纠正。甲和乙都已有当前正式分时，命令拒绝，避免两份当前分共享同一答卷。只有乙还没有当前正式分时，一个事务把甲的指针移到无 item、total 为 NULL 的新版本，并在同一事务发布乙的新版本。权限是范围内教师，审计行记录两侧 participation。排名、统计和导出读当前指针，甲不再以 0 分出现。分析使甲的旧题级证据失效，同一 asset 不能同时算给两人。

选项乙：本版拒绝发布后换绑。命令返回 409。学校在产品写路径之外做人工处置。不插入 NULL 成绩版本。

作者不代选。在书面决议前不实现其中任何一条。

## 对 G0-03/05/11/12 的影响

ZX-AR-20261012-03 把这四项的设计复验写成：03 与 05 是 `design_passed_pending_decision`，11 是 `design_passed_with_followups`，12 是 `design_passed_pending_decision`。decision、implementation、verification 仍是 `proposed`、`not_started`、`not_run`。

本轮 R3-01 改了正式 item 的写入端口，所以 03 与 05 的表形结论保留，引用链需要下次独立复验。R3-03 与 R3-08 是 11 的后续项。12 的四状态列没有改成通过或关闭。

## 自检

保留 NestJS 模块化单体、FastAPI、PostgreSQL、Redis、BullMQ 与 Python Worker。Word、手工、Excel 三类、已批改卷提取教师分、AI 出题审核和无学生端未改。草稿、正式事实和生命周期仍分开。`total_only`、双层评分 schema、默认人工以及 G0/G1 区分仍保留。生产 cap、RPO/RTO、准确率和保留年限未填。M0 测试配置仍标明是测试值。未执行 Prompt 2。
