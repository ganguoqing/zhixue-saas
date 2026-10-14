# 智学 SaaS 数据字典 v2（含 v3 引用链）

**包编号：** ZX-DES-20261012-02；引用链 v3 为 ZX-DES-20261012-03；列组补丁 ZX-DES-20261012-04  
**状态：** Proposed。不是已执行 DDL，也不是运行证据。  
**日期：** 2026-10-12  
**改前快照：** v4 编辑前的正文在 `docs/architecture/snapshots/zx-des-20261012-03/data-dictionary.md`。更早的 v2 快照仍在 `zx-des-20261012-02`。  
**v4 改变：** 答案外键的目标是七列 `uq_binding_answer_target`。`match_decisions` 同时引用 submission 的考试与冻结卷。名单链接的 `student_id` 同时命中 participation 与 entry。  
**v5 改变：** 第 8 节按行区分初次校验与初次评分。binding 不因为 queued 而一律为空。v5 改前快照在 `docs/architecture/snapshots/zx-des-20261012-04/`。

## 0. 相对 v1 撤回的句子

下列 v1 规则作废，实施时不得再引用：

1. “子表一律 `MATCH FULL`”。必要关系才用 `MATCH FULL`。可选父引用用 `MATCH SIMPLE`，`tenant_id` 另有指向 `tenants` 的非空外键。
2. `UNIQUE (tenant_id, exam_id, student_id)` 跨名单版本唯一。唯一性只在一个 `roster_version_id` 内。
3. `UNIQUE (tenant_id, submission_id, page_index)`。唯一性只在一个 `page_set_id` 内。
4. 用一个 `INSERT_ONLY` 标签覆盖审核状态、草稿编辑和作废。内容事实与生命周期分开。
5. 成绩指针外键指向不存在的 `(tenant_id, score_version_id, participation_id)`。目标是 `score_versions (tenant_id, participation_id, id)`，且该表只有已发布行。
6. 总分导入没有正式 `score_version`。v2 用 `basis_mode=total_only`。

三类数据、半开区间、Word/Excel/已批改卷/无学生端、平台内容不使用可空 `tenant_id`，这些 v1 决定保留。

说明用 SQL：`sql/core-constraints-v2.sql`。

## 1. 外键规则

| 关系 | 列空值 | MATCH | 另外的守卫 |
|---|---|---|---|
| 必要 | 引用列全部 `NOT NULL` | `FULL` | `ON DELETE RESTRICT`。目标唯一约束的列集合与外键列集合相同 |
| 可选单父 | `tenant_id NOT NULL`，父 id 可空 | `SIMPLE` | 父 id 非空时检查同租户。另加 CHECK 规定何时必须非空 |
| 全局目录 | 目录 id 按业务 `NOT NULL` 或可空 | `SIMPLE` | 外键里**不出现** `tenant_id`。例：`grade_level_id → grade_levels(id)`，`subject_id → subjects(id)` |

`MATCH SIMPLE` 在任一引用列为空时跳过该条外键。所以可选复合键 `(tenant_id, parent_id)` 在 parent 为空时不能代替租户归属。每一张租户表还必须有：

`FOREIGN KEY (tenant_id) REFERENCES tenants(id)`，`tenant_id NOT NULL`。

学校公共题 `owner_membership_id IS NULL` 可以插入。教师私有题 owner 非空，且与 `tenant_id` 一起命中 `tenant_memberships`。学生导入批次 `exam_id IS NULL` 可以插入。总分或逐题导入 `exam_id` 必须非空，由 CHECK 而不是由 `MATCH FULL` 表达。

## 2. 三种表形

| 表形 | 谁写入 | 可更新的列 | 禁止 |
|---|---|---|---|
| 草稿 | `zhixue_app` | 内容列，且仅当 `status='building'` | 已发布后还改草稿来影响正式行 |
| 不可变正式事实 | 发布命令 `INSERT` | 无内容更新权限 | `UPDATE` 分数、槽位、答案正文、已发布 items |
| 生命周期 / 指针 | 指定命令 | 状态、指针、`state_version`、写一次的 `superseded_at` | 用状态更新改写事实正文 |

AI 接纳角色 `zhixue_ai_ingress` 可以插入 proposal 事实和答案修订，不能插入或更新 `score_drafts`、`score_versions`、`score_version_items`、`score_current_pointers`。

已发布内容不可变不靠“应用记得不要 UPDATE”，而靠：正式行在独立表、角色无 `UPDATE`、触发器拒绝任何内容列变化。

## 3. 核心外键矩阵

`ON DELETE` 全部为 `RESTRICT`，除非表中另写。`DEFERRABLE` 不使用。

| 源表.列 | 空值 | MATCH | 目标唯一键 | 守卫 |
|---|---|---|---|---|
| 每张租户表.`tenant_id` | NOT NULL | SIMPLE | `tenants(id)` | — |
| `questions.(tenant_id, owner_membership_id)` | owner 可空 | SIMPLE | `tenant_memberships(tenant_id, id)` | CHECK：school 则 owner 空；teacher 则 owner 非空 |
| `grades.grade_level_id` | NOT NULL | SIMPLE | `grade_levels(id)` | 全局目录，键中无 tenant |
| `teaching_assignments.subject_id` | NOT NULL | SIMPLE | `subjects(id)` | 同上 |
| `import_batches.(tenant_id, exam_id)` | exam 可空 | SIMPLE | `exams(tenant_id, id)` | CHECK：`students` 则 exam 空；两种成绩导入则 exam 非空 |
| `exams.(tenant_id, id, frozen_paper_version_id)` | 冻结前 frozen 可空，不作为子表目标 | — | 冻结后 `UNIQUE` 三列，且 frozen NOT NULL | 学生答卷子表只引用已冻结三列 |
| `exam_roster_versions.(tenant_id, exam_id)` | NOT NULL | FULL | `exams(tenant_id, id)` | — |
| `exam_roster_entries.(tenant_id, roster_version_id, exam_id)` | NOT NULL | FULL | `exam_roster_versions(tenant_id, id, exam_id)` | 版本内 `UNIQUE(tenant_id, roster_version_id, student_id)` |
| `exam_roster_pointers.(tenant_id, exam_id, roster_version_id)` | NOT NULL | FULL | `exam_roster_versions(tenant_id, exam_id, id)` | 每场考试一行指针 |
| `exam_participations.(tenant_id, exam_id, student_id)` | 三列 NOT NULL | FULL | `exams(tenant_id, id)` 与 `students(tenant_id, id)` 分别引用 | 自身 `UNIQUE(tenant_id, exam_id, student_id)`。名单换版不新建 participation |
| `exam_participations.(tenant_id, exam_id, paper_version_id)` | 三列 NOT NULL | FULL | `exams(tenant_id, id, frozen_paper_version_id)`，目标 `UNIQUE` 同三列 | 自身 `UNIQUE(tenant_id, id, exam_id, paper_version_id)` |
| `participation_roster_links.(tenant_id, participation_id, exam_id, student_id)` | 四列 NOT NULL | FULL | `exam_participations(tenant_id, id, exam_id, student_id)`，目标 `uq_participation_id_exam_student` | 链接上的 `student_id` 必须等于 participation |
| `participation_roster_links.(tenant_id, roster_version_id, roster_entry_id, exam_id, student_id)` | 五列 NOT NULL | FULL | `exam_roster_entries(tenant_id, roster_version_id, id, exam_id, student_id)`，目标 `uq_roster_entry_student` | 同一列还要等于 entry。同考不同学生不能互链 |
| `submission_page_sets.(tenant_id, submission_id)` | NOT NULL | FULL | `submissions(tenant_id, id)` | 自身 `UNIQUE(tenant_id, submission_id, id)` |
| `submission_pages.(tenant_id, page_set_id, submission_id)` | NOT NULL | FULL | `submission_page_sets(tenant_id, id, submission_id)` | `UNIQUE(tenant_id, page_set_id, page_index)` |
| `submission_pages.(tenant_id, source_asset_id)` | NOT NULL | FULL | `source_assets(tenant_id, id)` | 页字节不覆盖旧 asset |
| `submission_generations.(tenant_id, submission_id, page_set_id)` | 三列 NOT NULL | FULL | `submission_page_sets(tenant_id, submission_id, id)` | 页集必须属于同一 submission。自身 `UNIQUE(tenant_id, id, submission_id)` |
| `match_decisions.(tenant_id, participation_id, exam_id, paper_version_id)` | NOT NULL | FULL | `exam_participations(tenant_id, id, exam_id, paper_version_id)`，目标 `uq_participation_paper` | 决定可被多代 binding 引用 |
| `match_decisions.(tenant_id, submission_id, exam_id, paper_version_id)` | NOT NULL | FULL | `submissions(tenant_id, id, exam_id, frozen_paper_version_id)`，目标 `uq_submission_frozen` | submission 属于 E1 时，决定不能指向 E2。自身 `uq_match_decision` 为六列 |
| `matching_bindings.(tenant_id, generation_id, submission_id)` | NOT NULL | FULL | `submission_generations(tenant_id, id, submission_id)` | 每代恰好一行：`UNIQUE(tenant_id, generation_id)` |
| `matching_bindings.(tenant_id, match_decision_id, submission_id, exam_id, participation_id, paper_version_id)` | 匹配完成后 NOT NULL；未匹配的 validate/身份 OCR 不建 binding | FULL | `match_decisions` 的六列 UNIQUE | 绑定不能指向另一场考试的 participation |
| `answer_revisions.(tenant_id, binding_id, generation_id, submission_id, exam_id, participation_id, paper_version_id)` | 逐题来源 NOT NULL；总分来源不建答案行 | FULL | `matching_bindings` 的同七列，目标 `uq_binding_answer_target` | 八列 `uq_binding_chain` 不是这条外键的目标 |
| `answer_revisions.(tenant_id, paper_version_id, paper_question_id)` | 逐题来源 NOT NULL | FULL | `paper_questions(tenant_id, paper_version_id, id)` | 槽位必须属于 binding 上的那份冻结卷 |
| `human_reviews.(tenant_id, answer_revision_id, participation_id, paper_version_id, paper_question_id)` | 逐题复核 NOT NULL | FULL | `answer_revisions` 的同五列 UNIQUE | 不能复核另一个学生的槽位 |
| `grading_proposal_facts` 见第 6 节 | 按来源 | SIMPLE 仅用于该来源禁止的列 | 见第 6 节 | CHECK 而不是一条通用 FULL |
| `score_versions.(tenant_id, participation_id, exam_id, paper_version_id)` | NOT NULL | FULL | `exam_participations(tenant_id, id, exam_id, paper_version_id)` | 仅 `publish_score_version` 插入。自身 `UNIQUE(tenant_id, id, participation_id, exam_id, paper_version_id)` |
| `score_version_items.(tenant_id, score_version_id, participation_id, exam_id, paper_version_id)` | itemized 时 NOT NULL | FULL | `score_versions` 的同五列 UNIQUE | `total_only` / `absent` 禁止插入 items |
| `score_version_items.(tenant_id, paper_version_id, paper_question_id)` | itemized 时 NOT NULL | FULL | `paper_questions(tenant_id, paper_version_id, id)` | 与版本上的 paper_version 相同 |
| `score_version_items.(tenant_id, review_id, participation_id, paper_version_id, paper_question_id)` | numeric 时 NOT NULL | FULL | `human_reviews` 的同五列 UNIQUE | 见空白记零 |
| `score_current_pointers.(tenant_id, participation_id, score_version_id)` | 三列 NOT NULL | FULL | `score_versions(tenant_id, participation_id, id)`，目标 `uq_score_version_pointer` | 草稿不在目标表。指针不能指向 building 草稿 |
| `human_reviews.(tenant_id, proposal_id)` | 纯人工可空 | SIMPLE | `grading_proposal_facts(tenant_id, id)` | 纯人工走草稿，不伪造 proposal |
| `mastery_evidence.(tenant_id, score_version_item_id)` | NOT NULL | FULL | `score_version_items(tenant_id, id)` | 没有 item 的 `total_only` / `absent` 无法插入 |

发布事实表没有 `status='building'` 行。指针外键因此等价于“只指向已发布”。不使用部分唯一索引充当外键目标（PostgreSQL 外键不能引用部分唯一索引）。

## 4. 命令与列写权限

角色列里的 app 指 `zhixue_app`。ingress 指 `zhixue_ai_ingress`。

| 命令 | 角色 | INSERT | UPDATE 列与 CAS | 禁止 |
|---|---|---|---|---|
| `ApproveQuestion` | app | `question_review_decisions` | `question_version_lifecycles.review_status`：仅 `pending_review → approved/rejected`，`state_version` | 更新 `question_version_bodies` 任一内容列 |
| `EditScoreDraft` | app | 新 draft item 行 | `score_drafts` / `score_draft_items` 内容列，仅 `status=building` 且 `state_version` 相符 | 任何 `score_versions` / `score_version_items` |
| `AbandonDraft` | app | — | `score_drafts.status`：`building → abandoned` | 改指针；改已发布行 |
| `SupersedeProposal` | app 或系统命令 | — | `grading_proposal_lifecycles.superseded_at` 仅当原值为空；`state_version` | 改 proposal 分数正文 |
| `SupersedeReview` | 系统命令 | — | `human_review_lifecycles.superseded_at` 写一次 | 改复核分数正文 |
| `AcceptGradeResult` | ingress | proposal **事实**、生命周期初始行、artifact | job：仅当 CAS 证明它是当前 attempt，见事务文档 | `score_*`；凭非法输出把别的 attempt 标失败 |
| `PublishScoreVersion` | app 只 `EXECUTE publish_score_version` | 函数插入 `score_versions`、itemized 的 items、封存行、指针事件 | 指针从空到该版本；草稿 `building → published_from` | 表级 INSERT；ingress；封存后补插或删改 item |
| `RepublishRevision` | app 只 `EXECUTE` 同一函数 | 新的 `score_versions` 行及其 items 或总分列 | 指针 CAS，`pointer_version+1` | `UPDATE` 旧分数列。旧行保持原样 |
| `RecordAbsence` | app | `score_drafts` basis `absent` | participation.disposition，CAS | 写 `total_score=0` |
| `ScoreBlankAsZero` | app | `human_reviews` 决定行 | draft item：`mark_kind=numeric`，`score=0.00`，链到原 blank `answer_revision` | 把 `mark_kind=blank` 的 NULL 当成 0 |

`question_version_bodies`、`answer_revisions`、`grading_proposal_facts`、`score_versions`、`score_version_items`、`usage_ledger_entries`：应用与 ingress 均无内容列 `UPDATE`。生命周期表才有状态列 `UPDATE`。

## 5. 名单、页、绑定

一场考试可以有多版名单。`exam_roster_versions.version_no` 在考试内递增。`exam_roster_entries` 复制学生、班级、学号，之后不 `UPDATE`。当前名单是 `exam_roster_pointers`。

同一 submission 的换页是新的 `submission_page_sets`。旧页行保留，旧 asset 保留。`submission_generations.page_set_id` 指明哪一套字节参与这一代。

`match_decisions` 在首次匹配时插入，之后不改列。`CorrectRecognition` 与 `SupplyReplacementPage` 插入新 generation，并插入新的 `matching_bindings` 指向**同一个** match_decision。只写 generation+1、不插入该代 binding，答案外键无法成立。`CorrectMatch` 在发布前插入新的 match_decision（新 participation）和新 binding，并把旧 job 标 `cancel_requested`。旧 binding 行保留，指针 CAS 到新 binding。

同一考试同一学生只有一行 `exam_participations`。名单 v2 只新增 `participation_roster_links` 并移动 `participation_roster_pointers`。分析读取当前成绩指针，不把两版名单上的同一学生加成两份当前成绩。

发布完整性不靠跨表 CHECK。`zhixue_app` 没有 `score_versions` / `score_version_items` 的 INSERT。唯一写入端口是 `publish_score_version`。函数在同一事务插入全部必需 item，再插入 `score_version_seals`。已封存版本上的 INSERT 被触发器拒绝；item 的 UPDATE 与 DELETE 对所有应用角色拒绝。`total_only` 与 `absent` 的函数路径不插入 item。

发布后换绑仍是两个待决选项，都未 Accepted：

- 选项甲：若乙已经有 `score_current_pointers` 行，命令返回 409。该指针只指向已发布的 `score_versions`，不能指向草稿。若乙没有当前正式指针，一个事务插入甲的新版本（`attribution_corrected_away`，total NULL，无 item）并移动甲的指针，同时插入乙的新正式版本并建立乙的指针。权限是范围内教师，审计记录两侧 participation。排名、统计、导出读当前指针，甲不以 0 分留在排名里。分析使甲的旧题级证据失效，同一 asset 不能同时算给甲和乙。
- 选项乙：本版拒绝发布后换绑。`OpenAttributionCorrection` 返回 409。不插入新的 NULL 成绩版本。学校在系统外登记人工处置。选项乙也可以作为通过 G0 的选择。

在负责人书面选择前，两条路径都不得编码成已确认行为。

## 6. 成绩依据与 proposal 引用

`score_versions.basis_mode`：

| 模式 | 真实来源 | 教师确认 | total 与 items | NULL 的含义 | 能否发布 | 能否进入题级分析 |
|---|---|---|---|---|---|---|
| `itemized` | 逐槽 `answer_revisions` + proposal 或纯人工 draft | 每槽 `human_reviews` 或显式批量接受 | `total_score` = 各 numeric 之和。缺任一槽不能发布 | 不用于总分。blank 未决的 score 是 NULL，且不能留在已发布 item 上 | 能，作为正式分 | 能，仅 numeric item，且题目有知识链接 |
| `total_only` | `import_rows` 且 `batch_kind=score_total`，行已被显式接受 | `score_confirmations` 指向该 import_row | **无 items**。总分就是确认过的导入值 | 没有逐题分，不是 0 | 能，作为正式总成绩 | 否。禁止 `mastery_evidence` |
| `absent` | `RecordAbsence` | 确认行 | 无 items | `total_score` 必须为 NULL，展示为缺考 | 能，计入名单覆盖 | 否 |
| `attribution_corrected_away` | 仅选项甲，且负责人已书面选择 | 确认行写明两侧 participation | 无 items | NULL 表示这份当前成绩不再属于该学生，不是 0 分 | 仅此时能成为甲的当前指针。未决议或选项乙时不插入 | 否 |

缺考与空白未决都不得被空 items 求和成 0。

proposal 事实的引用组合（CHECK）：

| `author_kind` | answer_revision | job | model_invocation | import_row |
|---|---|---|---|---|
| `ai` | NOT NULL | NOT NULL，`stage=model_grade` 且 `billable=true` | NOT NULL | NULL |
| `extracted_teacher_mark` | NOT NULL | 可空。若有，`stage=mark_extraction` 且 `billable=false` | **必须 NULL** | NULL |
| `excel_item` | NOT NULL | NULL | NULL | NOT NULL |
| `excel_total` | **不建 proposal** | NULL | NULL | 确认行直接引用 |
| `manual` | NOT NULL，且 `origin=manual`。由 `OpenManualScore` 在 review 之前插入 | NULL | NULL | NULL |

提取教师分的解析 job 只产生提取到的分数草稿，不创建 `model_invocations`，不调用评分模型。触发器：`stage=mark_extraction` 的 job 拒绝插入 invocation。

空白被教师记为 0：

1. 原 `answer_revisions.origin=blank` 保留，分数列仍空。
2. `ScoreBlankAsZero` 插入 review，`decision=score_blank_as_zero`。
3. 草稿 item 与后来的正式 item 为 `mark_kind=numeric`，`score=0.00`，`source_answer_revision_id` 指向那条 blank，`review_id` 指向该决定。
4. 不存在 `mark_kind=blank AND score=0`。`mark_kind=blank` 时 score 必须为 NULL，且这种行不能进入 `score_version_items`。

## 7. 样例

### 两版名单、两版第 1 页

考试 E，学生甲、乙。

- 名单 v1：entry 甲/班 1，entry 乙/班 1。指针 → v1。
- 名单 v2：新增纠错 entry，不删除 v1 的行。同一学生可以同时出现在 v1 与 v2。指针 CAS 到 v2。
- 页集 1：第 1 页 asset A。generation 1 的 `submission_id` 与页集 1 相同。
- 页集 2：第 1 页 asset B。generation 2 仍属同一 submission，并插入 binding 2，指向 generation 1 的同一 `match_decision`。答案行只引用 binding 2。
- 学生甲在名单 v1、v2 各有 entry，但 `exam_participations` 只有一行。分析只读当前指针上的一份成绩。

反例（外键应拒绝，本轮未在数据库执行）：generation 引用另一 submission 的 page_set；binding 引用另一场考试的 participation；answer 引用另一份卷的 `paper_question_id`；review 引用另一学生的 revision。

### 四来源到正式成绩

```text
新答卷: asset → generation → binding → answer_revision(ocr)
        → proposal(ai, invocation) → review → score_version(itemized) → pointer

已批改卷: asset → answer_revision(extracted)
        → proposal(extracted, invocation 为空, 可选 mark_extraction job)
        → review → score_version(itemized) → pointer

逐题 Excel: import_row → answer_revision(excel_item)
        → proposal(excel_item) → review → score_version(itemized) → pointer

总分 Excel: import_row(score_total) → confirmation
        → score_version(total_only, 无 items) → pointer
        无 answer_revision，无 proposal，无 mastery_evidence
```

缺考：`score_version(absent, total NULL)` → pointer。界面不显示 0。

空白记零：blank revision 仍在；正式 item 为 numeric 0.00，并引用该 revision 与 review。

### 6 → 8 → 7

| 步骤 | 正式行 | 指针 |
|---|---|---|
| 发布 AI 建议确认结果 | score_version id=V1 total=6.00 插入后不再更新。proposal 行仍是 6 | participation P → V1，pointer_version=1 |
| 修订为 8 | 只 UPDATE building 草稿；再发布时 INSERT V2 total=8.00 | CAS 1→2，指针改为 V2。V1 行仍是 6 |
| 再修订为 7 | INSERT V3 total=7.00 | CAS 2→3，指针改为 V3。V1、V2 内容不变 |

三次变化是三行正式事实加两次指针更新。直接 `UPDATE V1.total_score` 没有权限。

## 8. 仍保留的外围对象

用户、成员、授权、学年班级半开区间、平台图谱、三级题库、冻结闭包、额度预留、outbox/inbox、教学事件快照，继续沿用 v1 的业务含义。凡与本节外键、唯一键或 `INSERT_ONLY` 笼统说法冲突的，以本 v2 为准。

`processing_jobs` 把领取和业务 stage 分开。attempt 与 epoch 只看是否曾 Claim。binding 只看 stage。

| 行 | stage | status | binding_id | current_attempt_id | epoch |
|---|---|---|---|---|---|
| 初次校验 | `validate_asset` | `queued` | NULL | NULL | 0 |
| 初次已匹配评分 | `model_grade` | `queued` | 当前 generation 的 binding | NULL | 0 |
| 已领取 | 需要绑定的 stage | `running` | 与创建时相同，非空 | 非空 | ≥ 1 |
| 费用未知停放 | 同上 | `awaiting_settlement` | 非空 | 非空 | ≥ 1 |

`ScheduleJob` 创建已匹配评分 job 时就写入 binding，不等 Claim。错误行是：`model_grade` 且 `binding_id` 为空。阶段 CHECK 拒绝它。说明约束在 `sql/core-chain-v3.sql`。这些行是规格样例，不是已执行的迁移结果。

M0 撤回 `ResumeAfterSettlement` 和 `queued_after_claim`。撤回范围只包括 unknown 的自动复跑。仍保留：初次 Admit/Claim、没有 `send_unknown` 时的 `TakeoverExpiredAttempt`、同体接纳重试、capability 再签发，以及上一 stage 真正成功后为下一 stage 新建 job。新建 job 又是 epoch 0 的初次 queued，并按 stage 写 binding。
