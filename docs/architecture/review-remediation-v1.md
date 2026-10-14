# 智学 SaaS 架构修复设计补充稿 V1

> **历史版本，2026-10-11。** 现行规格是 [review-remediation-v2.md](review-remediation-v2.md)（ZX-DES-20261012-02）。本文件保留复验前的原文。其中“一律 MATCH FULL”、跨版本名单唯一、合并 schema `grading-result/1.0.0`、事件 `zhixue.event/1`，以及文末把未跑测试写成 G0 不满足的自检，都不再作为现行规则。

**文档编号：** ZX-DES-20261011-01  
**日期：** 2026-10-11  
**角色：** Cursor Development Agent  
**审查对象：** ZX-AR-20261011-01  
**文档状态：** 设计补充。方案均为 Proposed，项目负责人尚未接受。  
**不修改：** `docs/product/requirements-v1.0-original.md`、`docs/product/requirement-decisions-v0.1-v0.28.md`、`docs/architecture/architecture-v1.0-original.md`、`docs/quality-reports/architecture-review-report.md`。

本任务没有编写业务功能，没有部署，没有运行隔离、故障注入或 BullMQ 兼容测试。实现风险未关闭。G0 结论见第 11 节：规格已提交到可复验，**G0 不满足**。

已阅读：`AGENTS.md`、V0.1–V0.28 确认记录、产品需求 V1.0、架构初稿 V1.0、审查报告 F01–F28、`docs/references/review-evidence.md` 的定位约定。仓库中原先没有 Cursor Rules 目录，也没有 ADR。

每项决策只保留一份 Proposed ADR：

| 编号 | 文件 |
|---|---|
| 001 | [ADR-001-tenant-composite-fk-rls.md](../decisions/ADR-001-tenant-composite-fk-rls.md) |
| 002 | [ADR-002-module-ownership-uow.md](../decisions/ADR-002-module-ownership-uow.md) |
| 003 | [ADR-003-ai-result-acceptance.md](../decisions/ADR-003-ai-result-acceptance.md) |
| 004 | [ADR-004-bullmq-python-worker.md](../decisions/ADR-004-bullmq-python-worker.md) |
| 005 | [ADR-005-outbox-inbox-object-finalize.md](../decisions/ADR-005-outbox-inbox-object-finalize.md) |
| 006 | [ADR-006-freeze-and-score-versions.md](../decisions/ADR-006-freeze-and-score-versions.md) |
| 007 | [ADR-007-review-publish-absence.md](../decisions/ADR-007-review-publish-absence.md) |
| 008 | [ADR-008-postgres-knowledge-graph.md](../decisions/ADR-008-postgres-knowledge-graph.md) |
| 009 | [ADR-009-object-storage-auth.md](../decisions/ADR-009-object-storage-auth.md) |
| 010 | [ADR-010-env-backup-migration.md](../decisions/ADR-010-env-backup-migration.md) |
| 011 | [ADR-011-temporal-roster-snapshot.md](../decisions/ADR-011-temporal-roster-snapshot.md) |
| 012 | [ADR-012-quota-tenant-lifecycle.md](../decisions/ADR-012-quota-tenant-lifecycle.md) |
| 013 | [ADR-013-ai-schema-lineage-calibration.md](../decisions/ADR-013-ai-schema-lineage-calibration.md) |
| 014 | [ADR-014-data-duty-retention.md](../decisions/ADR-014-data-duty-retention.md) |
| 015 | [ADR-015-source-milestone-placement.md](../decisions/ADR-015-source-milestone-placement.md) |

已确认技术栈保持不变：React + TypeScript + Vite + Ant Design、NestJS 模块化单体、Python FastAPI、PostgreSQL、Redis + BullMQ + Python Worker、S3 兼容存储、Monorepo、Docker + 托管基础服务。官方 Python BullMQ 提供 Worker API（[文档](https://docs.bullmq.io/python/introduction)，查阅于 2026-10-11）。本仓库尚未锁定版本，也尚未做兼容测试，不能把“有 Worker API”写成“所选版本已验证”。

## 1. 需求追踪（R01–R28）

标记含义：

| 标记 | 含义 |
|---|---|
| 已确认 | 用户答复所接受的内容。后续只有明确更改才能取代 |
| 设计建议 | 助手、架构初稿或审查报告中的方案，用户没有单独接受 |
| 待验证 | 确认记录已标明尚不能当事实 |

V1.0 正文是需求基线初稿。它没有复述的已确认能力仍然有效，见第 1.2 节。

### 1.1 逐条

| ID | 已确认 | 设计建议（非决策） | 待验证 | 主要落位 |
|---|---|---|---|---|
| R01 | B2B SaaS；首批面向一所学校演示；客户为中小学和规模化教培机构；将来可扩展独立教师；多租户隔离从第一版建立 | 助手举例中的校区层级 | 首所学校实际名单 | ADR-001、M0 隔离、M7 不提前做独立教师端 |
| R02 | 四类角色；管理层看整体教学质量；小学三年级至初中三年级；规划学科含语文、数学、英语、物理、化学、生物、地理、历史、政治；第一阶段只做数学 | 三层架构叙述 | — | 学科代码进平台目录；业务表不把数学硬编码成唯一模型 |
| R03 | 第一阶段采集 A 试卷/答题数据 + B Excel；预留 C 在线答题与 D 第三方对接；统一学习数据层 | 助手流程草图 | 演示学校目前是纸卷还是电子阅卷，用户未再具体回答 | ADR-015。只有总分时不得伪造逐题证据 |
| R04 | 知识图谱选择 B：参考既有初中数学图谱内容与质量检查，为 SaaS 重做模型；平台标准 / 学校配置 / 学生状态分离；版本化 | 不合并旧项目代码 | 旧图谱内容与 Quality Report 未进入本仓库，未复验 | ADR-008，M2 |
| R05 | AI 能力选择 C：L1–L4 都在目标内，分阶段交付；支持上传标准答案供批改参考；教师审核；结果可解释 | 助手当时把阅卷流程展开为 PDF/图片/Word/手工。Word 与手工的明确列表写在随后被 R06 接受的确认表中 | 公式、图形识别质量 | 标准答案版本 + 教师确认后才可冻结 |
| R06 | B 标准化答题卡与 C 已批改卷为优先；A 整张手写卷逐步完善；标准答案支持 PDF、图片、Word 及手动录入；评分规则；Excel 总分和逐题得分；人工复核后入库 | 助手原表把 AI 辅助批改写成 P1。该优先级已被 R07 取代 | 复杂手写公式与几何 | ADR-015。已批改卷提取教师得分，不默认重评 |
| R07 | AI 辅助批改升为 P0；问题 7 选 A：无学生登录、无在线答题、无学生 AI 辅导；学生仍有档案；生成的练习由教师审核后下载或打印 | — | 全自动复杂题型不在 P0 承诺内 | 不建学生端。`students.user_id` 首期必须为空 |
| R08 | 三级题库 C；试卷入库、教师创建/导入、AI 生成都支持；AI 生成题必须审核后才能正式使用；学校上传默认不跨租户共享；题目版本 | 所有权、使用授权、共享权限分开，助手标明留到技术设计 | 商业题库采购条款 | ADR-006/008 与数据字典授权表，M2 |
| R09 | 掌握度采用可解释多因素模型 B，并预留 IRT/BKT 等；掌握度与可信度分开；证据不足时不给看似精确的结论；算法版本可追溯；核心数值不是 LLM 主观判断 | 具体权重 | 权重与效果 | M4。`as_of` 与算法版本写入快照 |
| R10 | 事件、周期、教师三种触发；去重、优先级、生命周期；教师决定是否采纳；管理层看汇总，不逐条审批建议 | 助手提出的内部“规则引擎再调 LLM”结构 | 周期的具体时刻未定 | M5。分析只消费已发布当前成绩 |
| R11 | 教学事件方案 C 的轻量第一阶段：可手工创建，也可从建议生成；记录执行；用后续数据做描述性验证；不断言因果 | 跨教师协作、复杂计划为后续 | — | M6。目标学生在创建时快照 |
| R12 | 管理视图方案 C；四角色数据范围；平台超级管理员不默认查看学生个人学习记录；服务端强制；关键操作审计 | 权限实现选 RBAC+范围，RLS 未在本轮确认 | — | 第 6 节、ADR-001 |
| R13 | 组织模型方案 C，分阶段。P0：学校、学年学期、年级、行政班、教师、学生、任课、转班/升班历史。教学班、教研组组织、多校区后续 | 班级究竟挂在学期下还是学年下，树形简图与“学年历史”需要建模澄清，见 ADR-011 | — | 第 3 节。历史成绩不因转班改归属 |
| R14 | 试卷与考试分离；单班与多班统一考试；参考/缺考；AI 建议经授权教师确认后才进入掌握度；成绩修正留痕；版本冻结，后续改题不影响历史考试 | 补考与复杂多版本流程为逐步完善，不是首期必做 | — | ADR-006/007。缺考不自动计零 |
| R15 | 复核工作台 C：按学生与按题目；低置信和异常必须人工；符合既定质量标准的高置信客观题可由授权教师批量确认；保留 AI 原建议与修改 | 智能抽检、多教师分工为 P1；快捷键是交互需求 | 质量标准的数值未定，未校准前不得批量放行 | 批量确认必须显式 ID+版本 |
| R16 | 上传方案 C。P0：Web 上传 PDF/JPG/PNG/ZIP、Excel 成绩/逐题/学生、异步、进度、失败只重试失败项、身份自动匹配与人工确认、原件留存。手机拍照与扫描设备直接集成为后续 | — | 扫描仪型号 | 第 5、7 节。部分成功不是部分正式成绩 |
| R17 | 多模型适配方案 C，预留学校级策略与私有化。P0：统一 AI 层、按任务配置、调用日志、成本、版本追溯。切换需质量验证 | 第一阶段不接入大量服务商 | 供应商未选定 | ADR-003/013。业务模块不直接调用厂商 SDK |
| R18 | 中国大陆优先；架构预留多区域，首期不建海外环境、不做完整多语言；学生数据优先境内；向模型少传身份信息 | 具体合法基础、备案与等保适用性助手已说明要专项评估 | 云厂商、跨境场景未发生 | ADR-014。本文件不是法律意见 |
| R19 | 混合架构 C：React/Vite/Ant Design、NestJS 模块化单体、Python FastAPI、PostgreSQL、Redis、BullMQ + Python Worker、S3 兼容存储、知识图谱 PostgreSQL 起步、Docker | RLS、Outbox、具体模块目录是后来的设计建议 | — | 不改栈。ADR-004 只安排兼容验证 |
| R20 | Monorepo、Cursor Rules、AGENTS.md、Migration、接口契约、阶段验收；未审核 AI 分不得成为正式成绩 | 仓库目录细节 | Rules 文件尚未编写，不在本任务伪造 | 本补充稿放在 `docs/`，不假装 `.cursor/rules` 已存在 |
| R21 | M0–M7 纵向闭环；每阶段验收后才进入下一阶段；M0 可做小型 AI 验证，不提前做完整阅卷 | 审查报告的 G0/G1/G2 是准入建议 | 工期与人数不足，不能估计完成日期 | 第 10 节 |
| R22 | 能获得真实试卷和标准答案；真实学生答卷、答题卡、教师批改结果尚需协调；异常样本可合成 | — | 真实答卷授权与样本数量 | M0 PoC 只用已授权试卷/答案 + 合成答卷。不宣称真实学生评分质量 |
| R23 | 最终覆盖小学至初中数学题型；第一阶段优先单选、多选、判断、填空、常见计算、解方程、应用题。几何证明、作图、复杂综合题后续。识别不可靠则人工复核 | 手写整卷识别仍受 R06 的逐步完善约束 | 各题型实测表现 | 题型支持 ≠ 手写识别已经可靠 |
| R24 | 分层质量基准；控制高置信度误判；不确定则人工；暂不承诺无实测的准确率；模型变更要回归 | 阈值数字 | 校准集与真实样本 | ADR-013。confidence 不是概率 |
| R25 | 人工开通 + 试用/套餐/师生与存储配额/AI 配额与成本；无在线支付；到期不删除历史 | 用量统计与限制分开，是助手在该轮提出并随“同意”进入确认表的原则，予以保留 | 合同保留期限、价格 | ADR-012 |
| R26 | 容量设计基准 500–2,000 名学生、30–150 名教师、单次 500–2,000 份答卷；架构上考虑更大规模与多租户公平；具体分钟数以后实测 | 用户同意的是这一规划，不是某一所学校的实际人数 | 首所学校实际规模仍待确认 | 不把设计基准写成已测吞吐 |
| R27 | Docker 应用 + 托管 PostgreSQL/对象存储；Redis 可托管或独立；开发/测试/生产分离；备份与恢复验证；预留 Kubernetes，首期不建 | RPO/RTO 数值未定 | 云厂商与恢复演练 | ADR-010 |
| R28 | Cursor 开发、独立 QA、关键里程碑架构审查、人工验收；未通过验收不进入下一阶段 | 审查报告本身的修复建议不是新的产品决策 | — | 本文件只完成 Prompt 1 |

### 1.2 汇总：遗漏与矛盾

下列各项按已确认记录执行。V1.0 正文或架构初稿的省略、冲突，不构成取消。

| 编号 | 情况 | 本补充稿的处理 |
|---|---|---|
| C01 | V1.0 未写 Word 标准答案与手工录入。R06 确认表写明 PDF、图片、Word、手动录入为 P0 | 保留。`answer_key_versions.source_kind` 含 `word` 与 `manual` |
| C02 | V1.0 未写 Excel。R03/R06/R16 写明总分、逐题得分、学生信息导入 | 保留三种 `import_batches.batch_kind`。总分导入不产生逐题或知识点证据 |
| C03 | V1.0 §8.2 提到已批改试卷，但没有写“提取已有得分、不默认重新评分”，也没有写 B/C 优先于整张手写卷 | 保留 R06/R07。已批改卷走 `extracted_teacher_mark` |
| C04 | V1.0 §6 把 AI 生成列为题目来源，没有写审核后门禁 | 保留 R08。未审核生成题不能进入可冻结试卷 |
| C05 | V1.0 角色表没有学生，但没有明文写“无学生端” | 保留 R07。首期不建学生登录、在线答题和学生辅导 |
| C06 | R06 曾把 AI 辅助批改列为 P1，R07 明确升为 P0 | 以 R07 为准 |
| C07 | 架构初稿 §6.2 把题目都画成 `REVIEW_REQUIRED`。R15 允许合格客观题批量确认 | 按 R15。未校准配置不得批量放行 |
| C08 | 架构初稿 §6.3 修订停在 `RECONFIRMED`，没有回到当前发布版 | 设计补齐 `RepublishRevision`。是否采纳见 ADR-007，现为 Proposed |
| C09 | 架构初稿 §3.2 的 `ExamScoresConfirmed` 与 §6.3“发布后才进入分析”不一致 | 新事件只用 `ScoreVersionPublished`。旧名不再使用 |
| C10 | 架构初稿 §4 先写库再直接入队。Outbox 在初稿中已标明不是已确认产品需求 | 推荐 Outbox，ADR-005 仍为 Proposed。不因此更换 Redis/BullMQ |
| C11 | 架构初稿 §2.5 写“正式考试开始后冻结”，存在开考与改卷竞争 | 推荐在接受首份学生答卷之前由冻结命令完成闭包。产品原则“已用于正式考试的版本不能覆盖”仍然有效 |
| C12 | 架构初稿 §10 把已确认技术栈和待决 RLS/Outbox 一起列为“建议” | 技术栈视为已确认。RLS、Outbox、状态名、确认/发布语义保持 Proposed |
| C13 | V1.0 §4.1 把行政班画在学期下面。R13 同时要求学年历史与转班后成绩不漂移 | 推荐班级属于学年+年级，学期用时间区间覆盖。备选“每学期重建班级”见 ADR-011，未改需求 |
| C14 | 审查报告中的表名、RLS、公平调度、确认按钮是否拆成两段 | 全部是设计建议。与 R07/R15/R19 冲突的地方按确认记录，不按审查建议降级 |
| C15 | BullMQ Pro 的 Python 支持，产品页在 2026-10-11 仍写 Coming soon | 不依赖 Pro 的分组公平，也不因此改用 Node Worker。公平性由数据库领取限额表达，待 M0 验证 |

没有发现用户明确答复与“保留 Word/Excel/已批改卷/生成题审核/无学生端”相冲突的后续更改。

## 2. 数据模型

完整 ERD、逐表 owner、分类、键、索引和删除策略在 [data-dictionary.md](data-dictionary.md)。这里固定分类和交叉不变量。

数据分三类：

- **全局身份：** `users` 与会话。学校角色必须经 `tenant_memberships`。
- **平台内容：** 学科、标准图谱、平台题库、套餐模板。这些表没有 `tenant_id`。
- **租户内容：** 组织、学校题、考试、答卷、成绩、任务、额度、派生数据。`tenant_id NOT NULL`。

租户父表 `UNIQUE (tenant_id, id)`，子表 `FOREIGN KEY (tenant_id, parent_id)`。答案修订同时复合引用 submission、考试冻结卷版本和 `paper_questions` 槽位，从而保证同租户、同考试、同一张固定卷。平台题不靠可空 `tenant_id` 混进租户表；考试引用的是租户内快照和内容哈希。

必须存在的链：名单快照、上传会话、存储对象、来源资产、答案 revision、AI proposal、人工 review、不可变 `score_version`、当前指针、修订请求、逻辑 job、执行尝试、模型 invocation、outbox、inbox、额度预留、用量账本。学生“作答”称为 `exam_participations`，任务的一次运行称为 `execution_attempts`。裸词 attempt 不进入新接口。

应用角色对已发布分数、答案修订、审计和用量账只有插入或只读。当前指针是少数允许更新的行，且只能把指针从旧版本移到新版本。

物理删除：被正式成绩引用的版本 `RESTRICT`。草稿且未被引用的上传会话可以过期清理。转班是关闭旧区间并插入新区间。依法删除走清除载荷的标记，不把“永久审计”写成拒绝删除的理由。

## 3. 时间、名单与历史访问

业务生效时间与系统记录时间分开。区间一律半开 `[valid_from, valid_to)`。`valid_to` 为空表示向未来开放。同一学生的行政入班禁止重叠。同一教师、同一班级、同一学科的任课禁止完全重叠；多名教师可以同时任课。

推荐的组织口径（ADR-011，未决议）：

- 学年包含若干互不重叠的学期。
- 年级实例属于一个学年。
- 行政班属于该学年的一个年级，跨本学年的学期，不在升学时修改原班级。
- 任课区间可以只覆盖一个学期，而不必把班级按学期复制。

考试名单在 `FreezeRoster` 时复制学生、班级、学号和考号。之后转班、升班不更新这些行。纠错是新的名单世代；若成绩已发布，归属纠正走成绩修订，并提升输入世代，使旧 Worker 结果失效。

教学事件目标在事件创建时复制学生与班级。评价引用当时的成绩版本。成绩被取代后，评价变为待重评，不改写当时的目标名单。

访问权与任课事实分开：

- `teaching_assignments` 不自动授权。
- `data_scope_grants` 才决定能不能看。
- 默认不包含历史：新任课教师看不到该班授权开始之前的考试。
- 离任后授权区间关闭，不再满足“现在有效”，因此不自动保留个人访问。
- 学校管理员按本校范围访问。教研负责人按学科/年级授权，且资源上的班级以快照为准，不以学生今天的班级为准。
- 若学校希望离任教师继续查看，必须另建一条明确授权。

补录允许业务时间早于记录时间，但补录入班不能改写已冻结名单。同日转班使用同一时刻作为旧区间的终点和新区间的起点，重叠插入应被排除约束拒绝。

这些查询语义还没有样例测试。

## 4. 模块、依赖与事务协调

目录沿用架构初稿的模块化单体，补上所有权。`common` 只有时钟、ID、事务句柄、日志和错误类型，没有业务表，也不是总编排器。

| 模块 | 唯一写入的表 | 公开命令（写入） | 公开查询 |
|---|---|---|---|
| auth | 用户、会话、角色分配、数据范围、平台个人数据授权 | 登录会话、授予/撤销范围 | 当前成员与范围版本 |
| tenant | 租户、成员 | 开通与状态迁移 | 租户状态 |
| subscription | 订阅、配额账户、预留、用量账 | `ReserveQuota`、`SettleInvocation`、`ReleaseReservation` | 余额与账本 |
| academic | 学年、学期、年级、班级 | 定义学年学期、开班 | 某时刻的组织 |
| student | 学生、标识、入班 | 入学、转班、接受学生导入 | 标识查找 |
| teacher | 教师、任课 | 任课开始/结束 | 任课历史 |
| knowledge | 平台图谱与学校覆盖 | 发布图谱版本、发布覆盖 | 按版本读节点与边 |
| question-bank | 平台题、学校/教师题、授权、题目审核 | 采用平台题、提交生成题、审核题目、授予使用 | 调用者可见的题 |
| paper | 试卷、槽位、标准答案、rubric | 确认答案与规则 | 按版本读卷 |
| exam | 考试、冻结、名单、应考 | `FreezeExamContent`、`FreezeRoster`、`RecordAbsence` | 快照与冻结哈希 |
| submission | 来源资产、导入、答卷、页、答案修订 | `FinalizeUpload`、`ResolveMatch`、`CorrectRecognition`、`AcceptImportRows` | 当前世代 |
| grading | proposal、复核、正式成绩、指针、修订 | 复核、批量确认、发布、再发布 | 当前成绩与原建议 |
| storage | 上传会话、存储对象元数据 | `StartUpload`、标记 finalized/quarantine | 经授权的对象引用 |
| ai-orchestration | job、执行尝试、invocation、outbox、inbox 结构 | `ScheduleJob`、`CompleteExecution`、`AppendOutbox` | 按 job id 读持久任务 |
| audit | 审计 | `Append` | 按资源读 |
| mastery / diagnosis / recommendation / teaching-event / analytics | 各自的派生表 | 仅消费事件的 `ApplyProjection` 或教学命令 | 只读当前指针与证据 |

依赖方向（箭头表示“可以调用对方公开命令”，不允许反向写库）：

```text
auth tenant subscription academic student teacher
        \        |          |         |       /
         knowledge -> question-bank -> paper -> exam
                                              |
storage -> submission ------------------------+
                                              v
                                           grading
                                              |
                              +---------------+----------------+
                              v                                v
                     ai-orchestration                    audit / subscription
                              |
                         （relay 只读 outbox，入队）
                              v
                     Python Worker -> FastAPI
                              |
                     Worker 调用 NestJS 内部接纳
                              v
                           grading.AcceptAIResult

grading --事件--> mastery --> diagnosis --> recommendation --> teaching-event
analytics 只依赖查询端口
```

编译依赖不允许环。`ai-orchestration` 不导入 grading 的内部代码。Worker 结果由组合根上的内部入口调用 `grading.AcceptAIResult`。grading 需要入队时调用 `ScheduleJob`，不写对方的 repository。

跨模块直接写内部 repository 是架构违规。内部命令同样检查成员、数据范围、租户状态和状态机，不能因为调用来自进程内部就跳过。

业务事务协调者：

| 用例 | 协调者 |
|---|---|
| 学生答卷 finalize | submission |
| Excel 接受 | submission |
| AI 结果接纳 | grading |
| 人工复核与批量确认 | grading |
| 首次发布与再发布 | grading |
| 额度预留 | subscription，由协调者在同一 Unit of Work 中调用 |
| 投影更新 | 对应派生模块 |

同一 Unit of Work 是一个 PostgreSQL 本地事务。参与者只把自己的公开写入登记进去。详见 [transaction-boundaries.md](transaction-boundaries.md)。

## 5. 事务、Outbox 与对象

详见事务文档。摘要如下。

必须和业务状态同一数据库事务的写入：

- finalize：资产摘要、submission 或导入批次、逻辑 job、额度预留、审计、outbox。
- 接纳 AI 结果：CAS 后的 proposal、执行完成、invocation、用量账、审计。正式分不在此事务。
- 复核：human_review 与审计。
- 发布：不可变成绩、逐题、指针、审计、outbox。
- 再发布：指针 CAS、新版本发布、审计、`ScoreVersionPublished` 与 `ScoreVersionSuperseded`。
- 投影：inbox 去重行与派生写入。

BullMQ 入队、对象字节上传、模型 HTTP 都在事务外。

Relay 用数据库行锁领取 outbox，ACK 后标记已投递；超时重投。消费端以 `consumer_name + event_id` 去重。事件携带 tenant、aggregate、aggregate_version、schema_version。重复投递不得产生第二份正式成绩。旧 aggregate_version 不得覆盖新的当前指针。

对象与数据库不是原子操作。校验在事务外完成；通过后的短事务才写 finalized 与业务行。没有对应 finalized 行的对象由清扫任务隔离并删除。已提交但对象丢失的任务进入可见失败，不评分。

Outbox 仍是 Proposed。在 ADR-005 被接受之前，不把这套协议当成已经批准的实现许可。

## 6. 权限

### 6.1 动作矩阵

数据范围维度是 tenant、subject、grade、class，必要时落到 student。角色只说明能做哪类动作。两位教师都可以“看成绩”，但只能看到各自授权范围。资源上的班级取考试名单或教学事件快照，不取学生当前班级。

跨租户或不在范围内的 ID 返回 404。资源在范围内但动作不允许返回 403。未登录返回 401。

| 动作 | 平台超级管理员 | 学校管理员 | 教研负责人 | 学科教师 | AI Worker |
|---|---|---|---|---|---|
| 开通租户、套餐、配额 | 允许 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| 看用量与租户状态 | 允许，不含答卷正文 | 本校 | 拒绝 | 拒绝 | 拒绝 |
| 看学生个人成绩、答卷、诊断 | 默认拒绝；限时书面授权且只读 | 本校范围 | 授权学科/年级，按快照班级 | 当前有效的班级/学科授权 | 拒绝直接读取 API；只按 job 取最小化输入 |
| 管学年、班级、师生 | 拒绝 | 本校 | 拒绝 | 拒绝 | 拒绝 |
| 建考试、上传、复核、发布 | 拒绝 | 本校 | 授权范围内可按学校政策只读或复核，默认只读分析 | 授权班级与学科 | 拒绝发布与复核 |
| 审核 AI 生成题 | 平台题 | 本校公开范围 | 授权学科 | 自己的题与被授予的题 | 拒绝 |
| 接受 AI 结果 | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 仅 `ai.result.accept` |
| 平台题库维护 | 允许 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |

教研负责人默认不逐条审批教学建议，这是 R10 已确认的。上表因此不给“审批建议”动作。

平台运营与个人记录：

- 日常运营使用单独数据库角色，只授予租户、订阅和用量账，不授予答卷与成绩表。
- 个人记录访问要有未过期、未撤销、写明理由的 `platform_personal_data_access`。
- 该授权在 RLS 中只进入 `USING` 读路径，`WITH CHECK` 仍要求学校成员模式，因此平台授权不能借此改分。
- 每次开启此类事务都写审计。

撤权：授权命令递增范围版本。请求内重新读取授权，不缓存“允许”决定。缓存角色目录可以，缓存允许结果不可以。撤销后的下一次请求必须失败。这一点尚未测试。

### 6.2 RLS 推荐方案

ADR-001 推荐：应用授权 + PostgreSQL RLS 租户边界 + 复合外键。这不是已接受决策。若不采用 RLS，必须另交同等级方案和漏过滤测试，本文件不把“以后再评估”当作关闭。

推荐的运行角色：

| 角色 | 用途 | RLS |
|---|---|---|
| `zhixue_owner` | 表所有者，运行时不使用 | 表上 `FORCE ROW LEVEL SECURITY` |
| `zhixue_migrator` | 唯一迁移身份，可 `BYPASSRLS` | 不在应用连接池中 |
| `zhixue_app` | 学校用户请求 | 无 `BYPASSRLS`，非 owner |
| `zhixue_ai_ingress` | 结果接纳 | 无 `BYPASSRLS`；可插入 proposal、job、invocation、用量账；对 `score_versions` 与指针无插入和更新 |
| `zhixue_platform_ops` | 运营 | 无 `BYPASSRLS`；无个人成绩与答卷表权限 |

租户表策略同时写 `USING` 与 `WITH CHECK`：`app.tenant_id` 必须存在且等于行的 `tenant_id`。设置缺失或空字符串时条件不成立，查询为空，写入失败。

连接池只在事务内 `set_config(..., true)`，也就是本地于当前事务。禁止会话级 `SET`。取出连接时先 `RESET` 这些变量。Worker 的租户来自持久 job 行，并与凭据一致后才设置。

RLS 不代替班级/学科范围，也不代替复合外键。官方文档说明表主与 `BYPASSRLS` 会绕过 RLS，外键检查不按 RLS 过滤可见行。所以迁移角色必须和应用角色分开，同租户约束必须写成外键。

班级与学科范围在每个命令和查询中由 `data_scope_grants` 执行，包括内部命令和导出。

## 7. 状态机

完整转换、守卫、错误码和 `expected_version` 在 [state-transitions.md](state-transitions.md)。

执行状态与业务状态分开。任务 `succeeded` 只表示这次执行已被接纳为 proposal 或已明确拒绝。正式发布只来自教师命令。

已补齐的路径：取消、最终失败、人工恢复（新世代，而不是把失败行改回运行中）、批量中的部分成功、重复提交、缺考、空白、缺页。空白和缺考不是自动 0 分。缺页不能进入评分就绪，也不能首次发布。

批量确认的请求体是 proposal ID、proposal 版本、答案修订号和策略快照 ID 的显式列表。筛选条件不是命令。列表中任一项变化，整条命令回滚。

首次发布是整场名单全部就绪才提交。某个队列项失败只保留该文件的处理结果，不产生半场正式成绩。已发布之后的修订按学生指针推进，其他学生保持原当前版本。

产品基线没有确认“成绩撤回”和“首次只发布一部分学生”。这两条命令不存在。

## 8. 冻结闭包与修订传播

冻结命令 `FreezeExamContent` 必须发生在该考试接受第一份学生答卷之前。闭包包含：

- paper version、每个槽位的 question version、选项与资产哈希、顺序、`max_score`
- answer key version 与逐槽答案
- rubric version 与评分点 ID、上限
- 图谱 version 与学校覆盖 version
- 授权 ID（证明冻结当时允许使用）
- 上述规范 JSON 的 `freeze_hash`

发布后的版本行不允许 `UPDATE`。改题、改答案、改规则或改图是新版本，并需要明确的重评方案。已发布成绩不会因新版本静默改分。

正式分是插入的 `score_version`。6 分改 8 分再改 7 分，是三个版本加两次指针移动，AI 的 6 分 proposal 行保持原样。

AI、Worker 和 FastAPI 都不能调用发布或再发布。数据库角色上，接纳身份没有正式分表的插入权限。

再发布协议：

1. 修订打开 vNext 草稿时，v1 仍是当前指针，分析仍读 v1。
2. `RepublishRevision` 在同一事务中检查指针仍是 v1，把 vNext 标为已发布，移动指针，写出发布与取代事件。
3. 派生数据绑定 score version、证据集版本、图谱版本、算法版本和固定 `as_of`。
4. 重算使用事件里的 `as_of`，不用重跑当天的时钟。
5. 若 revision 2 的投影先完成，revision 1 后到，当前分析指针保持 2。
6. 教师复核抬高答案或复核版本后，旧 AI 回写不能覆盖。
7. 引用被取代成绩的教学评价标为待重评。建议按问题键保留历史，不物理删除。
8. 只有总分的导入不进入掌握度证据。

失败的再发布回滚后，v1 仍然有效。

## 9. AI 输入、输出与接纳

### 9.1 输入

队列载荷只有 `job_id` 与环境。Worker 用服务身份向 NestJS 读取最小化包：冻结槽位、标准答案、评分点、页对象引用、匿名 participation id。包内不放学生姓名。答卷文本是不可信数据，不执行其中的指示或 URL。

FastAPI 只做推理，不持有业务终态，不连接正式成绩表。

### 9.2 输出 schema

草案：[schemas/grading-result-1.0.0.schema.json](schemas/grading-result-1.0.0.schema.json)，标识 `grading-result/1.0.0`。TypeScript 与 Python 使用同一份 schema。`additionalProperties` 为 false。模型若返回额外控制字段（包括自报 `reviewRequired`、满分、状态或租户），schema 失败，整包升级人工，不截断后照单全收。

分数用两位小数字符串，入库为 `NUMERIC`。schema 不接受 NaN 或裸浮点。

### 9.3 服务端语义校验

schema 通过之后，NestJS 还要核对：

- `paper_question_id` 与 `criterion_id` 都属于该 job 的冻结闭包
- 建议分在 0 与冻结满分之间
- 评分点得分在各自上限内，且不超过槽位满分
- 证据页属于该 submission，并带 bbox 或 OCR span
- `input_hash`、generation、fencing epoch、lease token 与持久 job 一致
- 载荷里的租户、考试、学生若出现，也不得被信任；这些身份只来自 job 行

未知题目、未知评分点、越界、非有限数、评分点矛盾、缺证据、截断 JSON、拒绝回答，都进入有预算的失败或人工异常，不补零，不写正式分。

客观题的确定性规则与主观题模型评分分开记录。等价表达式是否算对，要在题目版本上预先配置，不能由模型临时发明满分。

### 9.4 服务身份与重放

推荐路径（ADR-003，未决议）：Python Worker 消费 BullMQ，调用 FastAPI，再调用 NestJS 内部接纳接口。凭据受众是结果接纳，范围只有 `ai.result.accept`，寿命短，含 `jti`。过期、错误受众、错误 job、重复 `jti`、旧世代、旧租约、已取消任务都拒绝。

合法的完全相同重放返回已接纳结果，不插入第二份 proposal。

签名回调作为备选，不作为推荐。两条路径都不能由 FastAPI 直接发布成绩。

### 9.5 版本谱系与费用

每次 invocation 保存：provider、实际模型标识、能拿到的 revision、参数、prompt、schema、pipeline、OCR、预处理版本、答案/规则/图谱版本、输入输出哈希、调用 ID、代码版本。供应商只给别名、不给可锁定 revision 时，记录这个限制，不承诺逐位重现。

fallback 只能落到已经列入允许名单且通过该题型基准的配置，并重新计算复核等级。未验证配置默认人工复核。`confidence` 只存为信号，不作为概率，也不单独授予批量确认资格。

逻辑任务幂等不表示外部只收费一次。每次真实调用都入账。超时且费用不明时记 `unknown`，不对账前不把该次记为 0，也不盲目再付费重试。

批量确认资格来自平台校准策略快照，最后仍由教师对显式 ID 列表确认。M0 只证明契约能拒绝非法样例，不证明评分质量。

## 10. 数据、环境、迁移与里程碑

### 10.1 最小数据政策

本政策只覆盖设计与 M0，不是备案、等保或生成式 AI 的完整合规结论。

| 数据 | 目的 | M0 是否允许真实数据 | 发送给模型时 |
|---|---|---|---|
| 已授权试卷与标准答案 | AI PoC | 仅当授权记录写明允许进入选定环境与选定端点 | 可以发送题目与答案内容 |
| 真实学生答卷、姓名、学号、成绩 | 批改 | 不允许。样本尚需协调 | 不发送 |
| 合成答卷 | 流程与异常 | 允许 | 可不含真实身份 |
| 日志 | 排障 | 不含答卷正文、姓名、学号 | — |
| 用量账 | 成本 | 允许记页数、token、金额状态 | 不含答卷正文 |

去标识化不是匿名化。还能连回学生的编号仍按个人信息对待。M0 用合成学生，避免这个问题在 PoC 中出现。

处理责任、监护人告知、供应商再处理、保留期限和删除时限，在真实学生数据进入之前由 ADR-014 的专项项决议。未获准的模型端点与区域不得配置为默认。

删除请求的目标范围（主库、对象、派生、缓存、备份到期）已写入字典的 TOMBSTONE 策略，但没有实施，也没有备份样本。

### 10.2 环境

开发、测试、生产使用各自的数据库、桶、Redis、密钥、模型配额和网络出口。测试不写生产成绩。生产连接串不进入仓库。

本地 Docker Compose 是开发形态。生产是 Docker 应用加托管 PostgreSQL 与对象存储。Kubernetes 只保留为后续，不在 M0 引入。

备份要同时覆盖数据库与对象版本。恢复演练的目标是：已发布、修订中、处理中的考试在独立环境里，原件、哈希、审计和指针一致，恢复出来的旧队列不能改新分。RPO/RTO 不预设数字，等业务批准后再测。Redis 队列允许丢失，因为持久任务在 PostgreSQL，由协调者补投。

迁移采用 expand、回填、校验、contract。同时只允许一个迁移执行者。不假设 down migration 能找回已删除数据。应用、Worker、FastAPI 与事件 schema 需要兼容窗口。这些演练都还没有做。

### 10.3 M0 窄切片

M0 不是完整阅卷，也不是本任务要写的代码。设计上的 M0 范围：

- 仓库骨架、登录会话、两个租户的成员与数据范围
- 真实应用数据库角色、复合外键、以及若 ADR-001 接受 RLS 则包含失败关闭的租户策略
- 一个上传会话、私有对象、finalize、孤儿清理
- 同一事务中的业务行、持久 job、额度预留骨架、审计、outbox；relay 入 BullMQ；inbox 去重
- 固定版本的 NestJS 生产、Python BullMQ Worker 消费、FastAPI mock 或获授权 PoC、NestJS 接纳
- schema 双端校验样例、调用账的 estimated/unknown、服务身份拒绝旧世代
- 开发/测试/生产配置分离模板与一条可重复迁移

M0 明确不做：完整学校管理界面、三级题库、阅卷工作台、正式成绩发布、真实学生数据、在线支付、Kubernetes。

M0 可以用窄表验证协议，但生产表名以数据字典为准，不另造一套长期并行的业务模型。跨考试、跨卷版本的复合外键要包含在这条迁移里，否则 G1 无法证明 F01。

### 10.4 M0–M7 需求落位

| 阶段 | 需求 | 退出时要有的证据 | 现在的状态 |
|---|---|---|---|
| M0 | R01、R12 的隔离骨架，R19 Worker，R20 仓库，R22/R23/R24 的 PoC 与契约，R27 环境模板，R28 的阶段边界 | G1。兼容测试与故障注入真实跑过 | 只有本设计，测试未跑 |
| M1 | R13 组织与历史，R16 学生 Excel，R12 撤权，R25 人工开通基础 | 转班后历史班级不变；撤权立即生效 | 未实现 |
| M2 | R04、R08 图谱、三级题库、生成题审核、版本 | 私有题不可被同校他人读取；未审核生成题不能入卷 | 未实现 |
| M3 | R03/R05/R06/R07/R14/R15/R16 的卷、Word/手工答案、答题卡、已批改卷、Excel 总分与逐题、匹配、双视图、发布与修订；R17/R24 成本与基准 | 三种来源进入正式成绩的路径；并发与非法转换；真实质量另列 | 未实现 |
| M4 | R09 掌握度与修订重算 | 相同输入加 `as_of` 可复算；旧任务不覆盖新指针；总分导入不产生知识点证据 | 未实现 |
| M5 | R05 L4 材料、R10 建议 | 去重与权限；材料经人工审核后才导出 | 未实现 |
| M6 | R11 教学事件 | 目标快照；修订后再评价；无因果结论 | 未实现 |
| M7 | R02 管理视图、R25 配额策略、R26 公平与容量、R27 恢复、R18 专项合规、R28 试点验收 | G2。无实测不填准确率和分钟数 | 未实现 |

人员、页数、供应商速率都不足，本文不估计工期，也不承诺 2,000 份答卷的处理时间。

## 11. G0 自检

审查报告要求 G0 至少具备：F01/F08/F15 的可评审方案，ADR-001/002/003/005 的边界和 ADR-006/007 的契约已经决议，需求差异、M0 范围、Python Worker 路线和样本边界清楚。

| 项 | 结果 |
|---|---|
| 可评审规格已写入独立补充稿 | 已提交 |
| ADR-001、002、003、005、006、007 已由项目负责人决议 | **否，全部仍是 Proposed** |
| Python Worker 所选版本已兼容验证 | **否** |
| RLS 或同等隔离已在真实角色下测试 | **否** |
| Outbox 故障注入 | **否** |
| 因此 G0 | **不满足** |

可以开始的只有继续评审本文。在项目负责人接受相应 ADR 之前，不应把 RLS、Outbox 或“一次按钮发布”写成代码里的既定事实，也不应进入 Prompt 2 所要求的“已有 G0 通过证据”的实现。

F01–F28 的设计位置、未决项、未来测试和关闭证据见 [architecture-findings-tracker.md](../quality-reports/architecture-findings-tracker.md)。没有任何一项是 Verified，也没有任何一项的实现风险已关闭。
