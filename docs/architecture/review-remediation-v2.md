# 智学 SaaS 架构修复设计补充稿 v2

**2026-10-12 后续：** ZX-AR-20261012-03 之后，现行补丁是 `review-remediation-v3.md`。本文件正文保留 v2 交付内容。必要关系的 `MATCH FULL` 仍然有效。job 守卫可空规则、fence 行锁定、发送许可和 `RecordSettlement` 以 v3 配套规格为准。

**包编号：** ZX-DES-20261012-02  
**日期：** 2026-10-12  
**对照：** ZX-AR-20261012-02 的 G0-01–G0-13  
**状态：** 设计交付，Proposed。作者不宣布 G0 通过，不把 ADR 标成 Accepted，不把 Findings 标成 Verified 或 Closed。  
**v1：** `review-remediation-v1.md` 保留为 2026-10-11 历史。与 v2 冲突时以本包为准。原需求、原架构和两份独立报告未改。

本轮没有业务实现、没有迁移执行、没有服务连接、没有付费模型、没有学生数据。SQL、签名和 schema 都是说明用草案。

已确认栈与来源保留：NestJS 模块化单体、FastAPI、PostgreSQL、Redis + BullMQ + Python Worker、Word/手工答案、Excel 学生/总分/逐题、已批改卷提取教师分、AI 生成题审核、无学生端。

## G0-01 可空外键与指针目标

- **修改：** `data-dictionary.md` 第 1、3 节；`sql/core-constraints-v2.sql`；ADR-001。
- **方案：** 必要关系列全部非空且 `MATCH FULL`，目标唯一键列集合与外键相同，`ON DELETE RESTRICT`。可选父引用 `MATCH SIMPLE`，另有 `tenant_id → tenants`。学校题的空 owner、学生导入的空 exam 因此可以插入；父 id 有值时仍校验同租户。全局 `subjects` / `grade_levels` 的外键不含 tenant。正式成绩只插入 `score_versions`。指针 `FULL` 指向 `(tenant_id, participation_id, id)`。草稿不在这张表里，所以指针不能指向 building。
- **假设：** 不使用部分唯一索引做外键目标。
- **待决：** ADR-001 是否接受 RLS 加这套键。键形本身是规格，不依赖“先跑 G1”。

## G0-02 后台如何得到 tenant

- **修改：** `authorization-matrix-v2.md`；ADR-001/003。
- **方案：** 无载荷的路由索引不启用 RLS。`zhixue_router` 无 `BYPASSRLS`，用 capability 哈希函数返回 tenant。不存在和密钥错误同一空结果。之后调用者 `set_config` 再读业务表。Worker 的 claim、read_input、renew、prepare_invocation、result.accept 是分开的 scope。Relay、reconciler、scheduler 各用自己的角色逐条建立 tenant。平台运营无个人表权限。限时只读走 `zhixue_app` + grant + `platform_grant`，且不能写。发布走 `zhixue_app`。migrator 不进后台连接池。
- **假设：** 路由索引只存 id、tenant、env、capability 哈希。
- **待决：** 接受这组角色，还是改成另一种同等级控制入口。未决前不要用 BYPASSRLS 临时接通。

## G0-03 草稿、事实、生命周期

- **修改：** 数据字典第 2、4 节；ADR-006/007/008。
- **方案：** 正文表只插入。审核、作废、指针和草稿状态在生命周期表或草稿表，并且列出每个命令的列、角色和 CAS。已发布 items 没有 UPDATE。ingress 不能插入正式分。生成题审核只改 `review_status`。6→8→7 是三次插入加两次指针移动。
- **假设：** 列权限加触发器，不只靠代码约定。
- **待决：** ADR-006/007 的表形。若拒绝草稿/事实分离，必须另给一种不会把已发布行改掉、又允许 building 编辑的写权限表。

## G0-04 名单、页、绑定

- **修改：** 数据字典第 5、7 节；ADR-011。
- **方案：** 名单版本内唯一学生；页集内唯一页码；binding 同时指向 generation 与 participation。旧行保留。发布前 `CorrectMatch`。发布后不改旧分数归属，甲得到新的 `attribution_corrected_away` 版本，乙走自己的确认发布。
- **假设：** 该 basis 是审计用的新版本，不是产品上的“撤回”按钮。
- **待决：** 若负责人拒绝这个 basis，发布后重绑定就没有写路径，命令保持拒绝。不能改回“更新旧名单”。

## G0-05 四种来源与缺考、空白

- **修改：** 数据字典第 6、7 节；状态文档第 4 节；ADR-007/015。
- **方案：** `itemized`、`total_only`、`absent`、`attribution_corrected_away`。总分有导入行和教师确认，无 items、无知识点证据，但可以成为正式总分。缺考 total 为 NULL。空白记零是 numeric 0.00，并保留原 blank revision。提取教师分的 job 若存在，stage 为 `mark_extraction`、`billable=false`、不得有 invocation。
- **假设：** 一场考试的不同学生可以有不同 basis，首次发布仍要求每个名单学生都有一种就绪依据。
- **待决：** ADR-007/015。不把“未写逐题”解释成不能发布总分。

## G0-06 恢复边

- **修改：** `state-transitions.md` 全文。
- **方案：** 提交后的上传状态从 `uploading` 开始。`AcceptValidation` 把 submission 送到 `validated`。`CorrectMatch` 用于已经 matched、尚未发布的纠错。`SupplyReplacementPage` 补页或换页并保留旧页集。`OpenManualScore` 在终败且没有合格 proposal 时人工录分。`RerouteAfterInvalidation` 在复核作废后重开路由。每边写了 actor、版本和写入。没有通用 PATCH。
- **假设：** 坏 JSON 不修成 proposal。
- **待决：** 状态名可改，这些边不能删。ADR-007。

## G0-07 接纳 CAS 与重放

- **修改：** 事务文档第 4、5 节；ADR-003/004。
- **方案：** CAS 同时核对 `current_attempt_id`、`current_fencing_epoch`、当前 generation、当前 binding 和 input hash。宽限仅在没有新领取、没有取消、世代未变时成立；M0 测试值是 0 秒。未认证和旧 attempt 不把当前 job 改失败，也不凭载荷记账。`jti` 防的是凭据重放；业务幂等是新 jti 加相同 body hash。异体幂等键返回 409。
- **假设：** 锁顺序在事务文档第 5 节。
- **待决：** ADR-003。生产宽限秒数不在本轮填写。

## G0-08 调用前意图与两条账

- **修改：** 事务文档第 2、3 节；ADR-012。
- **方案：** `PrepareInvocation` 提交后才发 HTTP。发送后崩溃把已有 intent 标为未知，不自动再付费。官方金额只累加 `include_in_total` 的 `confirm_delta`。未知标记 amount 为 NULL 且不进合计。确认 12.50 是一行新账，不是未知加上 12.50。
- **假设：** 外部收费做不到精确一次。
- **待决：** ADR-012 的账本与在途政策。升级等待的生产秒数未填；测试值 3600 只属于 M0 剖面。

## G0-09 多考试证据

- **修改：** 事务文档第 6 节；ADR-005/006。
- **方案：** 事件 `zhixue.event/2` 的聚合是 participation 指针，`score_version_id` 在载荷里，并带 `evidence_as_of`。证据集合哈希包含每场考试。A 的 v2 与 B 的 v1 都进入集合。发布时增加学生 fence。计算在事务外，提交时 CAS fence 与证据哈希。失败只归档并记 `needs_recompute`，然后才 ACK。
- **假设：** 不在本轮给出掌握度公式。
- **待决：** ADR-006/007 的分析资格。`as_of` 使用考试 `held_at`，不是重算当天。

## G0-10 公平与分阶段预留

- **修改：** 事务文档第 7 节；ADR-012。
- **方案：** 就绪集合上的租户轮转，然后再看并发上限。上限不是公平本身。不可领取的任务不在就绪集合。OCR 与评分分别预留。到期不启动下一 stage。测试配置与生产空值分开，生产缺键则启动失败。
- **假设：** PostgreSQL 游标可实现，不需要 BullMQ Pro。
- **待决：** ADR-012。生产 cap 未填。

## G0-11 双层输出

- **修改：** `schemas/model-grade-payload-1.0.0.schema.json`、`acceptance-envelope-1.0.0.schema.json`、`grading-contract-v2.md`；旧 `grading-result/1.0.0` 标为撤回；ADR-013。
- **方案：** 模型只产生不可信 payload。控制字段在信封，且不进入 prompt。元数据来自配置和供应商响应。`criterion_sum` 要求评分点集合一致且建议分等于合计。`atomic` 才允许空 awards。bbox 与 span 有顺序。结构测试和语义测试向量分开。
- **假设：** 两端注册同一 schema registry。本环境未安装校验库，未运行。
- **待决：** ADR-013 接受这两份 1.0.0，而不是撤回的合并草案。

## G0-12 门槛与追踪

- **修改：** 本文件第 4 节；`g0-design-response-v2.md`；`architecture-findings-tracker.md`。
- **方案：** 设计复验、ADR 决议、实现、运行验证四列分开。没有 G1 测试不再被写成 G0 失败原因。本轮也不宣称 G0 已通过。
- **待决：** 负责人对下面的决议清单作选择。独立审查复验规格是否闭合。

## G0-13 依赖方向

- **修改：** `module-adjacency-v2.md`；ADR-002。
- **方案：** 邻接矩阵的行是调用方。storage 不调用 submission，exam 不调用 grading。`AcceptValidation` 与 `AcceptRecognition` 由 submission 协调，`AcceptGradeResult` 由 grading 协调。组合根做路由，orchestration 不 import 这两处内部代码。
- **假设：** 未列出的编译边禁止。
- **待决：** ADR-002。

## 样例索引

| 要求 | 位置 |
|---|---|
| 两版名单、两版第 1 页 | 数据字典第 7 节 |
| 四来源、缺考、空白记零、6→8→7 | 数据字典第 7 节 |
| 核心 SQL | `sql/core-constraints-v2.sql` |
| 调用前/发送后/接纳前；A/B 租约；改输入竞争；两条账 | 事务文档第 2–5 节 |
| 多考试与乱序 | 事务文档第 6 节 |
| 结构/语义向量 | `schemas/grading-contract-v2.md` |

## 决议清单（仍全部 Proposed）

负责人可以按行接受推荐，或改选备选。未签字前维持 Proposed。

| ADR | 请裁决的选项 | 推荐 | 可以继续待定 |
|---|---|---|---|
| 001 | A 复合键区分 MATCH + RLS + router 函数；B 无 RLS 但要同等级说明；C 分库 | A | — |
| 002 | 公开命令 + v2 邻接 | 接受 v2 矩阵 | — |
| 003 | Worker 同步接纳 + 分列 scope | 接受 | 签名回调仅当 A 在 G1 证明不可用 |
| 005 | outbox + event/2 + fence | 接受方向 | 故障注入属 G1 |
| 006 | 草稿/正式分表 + 指针外键 + 证据集合 | 接受 | 掌握度公式到 M4 |
| 007 | 一次发布；total_only 可正式发布；发布后归属用新 basis | 接受 | 不增加撤回和部分首发 |
| 004 | 保持 Python Worker | 保持 | 版本号到 G1 锁定 |
| 008 | PostgreSQL 图谱；审核只改生命周期 | 保持 | M2 覆盖细节 |
| 009 | 私有对象、代理下载、page_set | 接受 M0 存储部分 | 生产 TTL 可调 |
| 010 | 三环境模板 + 单迁移者 | 接受 M0 计划 | RPO/RTO 数字 |
| 011 | 学年班级 + 版本内名单键 | 接受键形 | 若改选每学期重建班级，键形仍保留 |
| 012 | 意图账本 + 轮转 admission + 分 stage | 接受这一修订，不接受 v1 原文 | 生产 cap 与秒数 |
| 013 | 双 schema + 组合函数；默认人工 | 接受契约 | 准确率阈值 |
| 014 | M0 只用合成学生数据和已授权试卷 | 接受 M0 边界 | 保留年限、备案责任人 |
| 015 | 来源不减，总分走 total_only | 接受映射 | — |

## M0 最小范围（设计，未实施）

仍不做完整阅卷。窄切片要能验证角色、finalize、outbox、Python Worker、双 schema、意图账和合成数据开关。

| 项 | 具体规定 |
|---|---|
| 环境名 | `dev` / `staging` / `prod` 三套。数据库、Redis、桶、密钥、模型允许名单都带环境名 |
| 迁移 | 只允许 `zhixue_migrator`。咨询锁键 `zhixue_migrate` 同一时刻一个会话 |
| 端点 | 默认只允许 `mock://local`。真实 PoC 端点必须出现在该环境允许名单里才可配置。空名单时拒绝出站 |
| 学生数据 | 配置 `student_data=forbidden`。启动时若不是 forbidden 则拒绝启动。夹具姓名带前缀 `synthetic-` |
| 日志 | `correlation_id`、`job_id`、`tenant_id`。不记录答卷正文、姓名、学号、模型输出 |
| 指标 | `outbox_oldest_pending_seconds`、`job_oldest_running_seconds`、`invocation_unknown_count`。标签不含学生 id |
| 公平与重试 | 使用事务文档的测试剖面。生产剖面未填齐则不能当成生产启动 |

G1 才运行这些检查。本轮不把“还没跑”写成设计失败，也不把设计文本写成已经通过。

## 自检

| 检查 | 结果 |
|---|---|
| 每个核心外键有目标唯一键 | 数据字典第 3 节与 SQL 草案一致 |
| 合法 NULL 不被 MATCH FULL 拒绝 | owner、学生导入 exam、非 AI 的 invocation 使用 SIMPLE 或 CHECK |
| 每条新增状态边有写操作 | 状态文档各表的“写入”列 |
| 跨模块调用有邻接边 | 三个 Accept 命令都在邻接文件第 3 节 |
| 后台动作能建立 tenant | 授权矩阵第 2 节 |
| 四类来源能确认并发布 | 数据字典第 6 节。总分不构造题级证据 |
| 可能付费的调用在 HTTP 前有 intent | 事务文档第 2 节 |
| 旧 attempt 不推进当前业务 | 事务文档第 4 节拒绝表 |
| 多考试证据不靠单场版本排序 | 事务文档第 6 节 |
| schema / 事件 / ADR 版本 | 合并 schema 与 event/1 已撤回；ADR 页首与正文冲突处已改到 v2 |

残留：ADR 仍待负责人签署。`attribution_corrected_away` 若被拒绝，发布后换学生就没有替代方案，这是明确风险，不是留到实现时再决定。生产数值、保留年限、掌握度公式和真实质量阈值继续空白。
