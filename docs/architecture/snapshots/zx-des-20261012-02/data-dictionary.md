# 智学 SaaS 数据字典 v2

**包编号：** ZX-DES-20261012-02  
**状态：** Proposed。不是已执行 DDL，也不是运行证据。  
**日期：** 2026-10-12  
**v1 来源：** 同文件 2026-10-11 文本（ZX-DES-20261011-01）。v1 历史叙述在 `review-remediation-v1.md`。本文件从本日起以 v2 规则为准。

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
| `exam_participations.(tenant_id, roster_version_id, roster_entry_id)` | NOT NULL | FULL | `exam_roster_entries(tenant_id, roster_version_id, id)` | 同时 `FULL` 引用版本上的 exam_id |
| `exam_participations.(tenant_id, exam_id, paper_version_id)` | NOT NULL | FULL | `exams(tenant_id, id, frozen_paper_version_id)` | 与冻结卷相同 |
| `submission_page_sets.(tenant_id, submission_id)` | NOT NULL | FULL | `submissions(tenant_id, id)` | `UNIQUE(tenant_id, submission_id, page_set_no)` |
| `submission_pages.(tenant_id, page_set_id)` | NOT NULL | FULL | `submission_page_sets(tenant_id, id)` | `UNIQUE(tenant_id, page_set_id, page_index)` |
| `submission_pages.(tenant_id, source_asset_id)` | NOT NULL | FULL | `source_assets(tenant_id, id)` | 页字节不覆盖旧 asset |
| `submission_generations.(tenant_id, page_set_id)` | NOT NULL | FULL | `submission_page_sets(tenant_id, id)` | 一代对应一套页 |
| `matching_bindings.(tenant_id, generation_id)` | NOT NULL | FULL | `submission_generations(tenant_id, id)` | — |
| `matching_bindings.(tenant_id, participation_id, roster_entry_id)` | NOT NULL | FULL | `exam_participations` 与 entry 的复合唯一键 | 答案不能只靠“当前世代”推断学生 |
| `answer_revisions.(tenant_id, generation_id, binding_id)` | NOT NULL | FULL | `matching_bindings(tenant_id, generation_id, id)` | 答案属于该次绑定 |
| `answer_revisions.(tenant_id, paper_version_id, paper_question_id)` | 逐题来源 NOT NULL；总分来源不建答案行 | FULL | `paper_questions(tenant_id, paper_version_id, id)` | 同卷槽位 |
| `grading_proposal_facts` 见第 6 节 | 按来源 | SIMPLE 仅用于该来源禁止的列 | 见第 6 节 | CHECK 而不是一条通用 FULL |
| `score_versions.(tenant_id, participation_id)` | NOT NULL | FULL | `exam_participations(tenant_id, id)` | 仅发布时插入 |
| `score_version_items.(tenant_id, score_version_id, paper_question_id)` | itemized 时 NOT NULL | FULL | 版本与 `paper_questions` | `total_only` / `absent` 禁止插入 items |
| `score_version_items.(tenant_id, review_id)` | numeric 人工决定时 NOT NULL | FULL | `human_reviews(tenant_id, id)` | 见空白记零 |
| `score_current_pointers.(tenant_id, participation_id, score_version_id)` | 三列 NOT NULL | FULL | `score_versions(tenant_id, participation_id, id)` | 草稿不在目标表，故不能指向 building |
| `human_reviews.(tenant_id, proposal_id)` | 纯人工可空 | SIMPLE | `grading_proposal_facts(tenant_id, id)` | 纯人工走 `score_drafts.origin=manual`，review 指向 draft item |
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
| `PublishScoreVersion` | app | `score_versions`、`score_version_items`（itemized）、`score_pointer_events`、确认行 | `score_current_pointers` 从空到该版本，`pointer_version` 1；`score_drafts.status`：`building → published_from`（不再可编辑） | ingress；更新已存在的正式 item |
| `RepublishRevision` | app | 新的 `score_versions` 行（新 id、新 version_no）及其 items 或总分列 | 指针 `score_version_id` 与 `pointer_version+1`，CAS 旧指针版本 | `UPDATE` 旧 score_version 的分数列。旧行保持原样 |
| `RecordAbsence` | app | `score_drafts` basis `absent` | participation.disposition，CAS | 写 `total_score=0` |
| `ScoreBlankAsZero` | app | `human_reviews` 决定行 | draft item：`mark_kind=numeric`，`score=0.00`，链到原 blank `answer_revision` | 把 `mark_kind=blank` 的 NULL 当成 0 |

`question_version_bodies`、`answer_revisions`、`grading_proposal_facts`、`score_versions`、`score_version_items`、`usage_ledger_entries`：应用与 ingress 均无内容列 `UPDATE`。生命周期表才有状态列 `UPDATE`。

## 5. 名单、页、绑定

一场考试可以有多版名单。`exam_roster_versions.version_no` 在考试内递增。`exam_roster_entries` 复制学生、班级、学号，之后不 `UPDATE`。当前名单是 `exam_roster_pointers`。

同一 submission 的换页是新的 `submission_page_sets`。旧页行保留，旧 asset 保留。`submission_generations.page_set_id` 指明哪一套字节参与这一代。

`matching_bindings` 是不可变绑定：generation + participation + roster entry。当前绑定是 `submission_binding_pointers`，CAS 更新。

发布前把答卷从学生甲改到乙：新 binding 指向乙的 participation，generation+1，旧 job 取消，旧 proposal 生命周期作废。甲的 participation 上没有已发布成绩，所以不改历史成绩。旧名单行不改。

发布后发现绑错了人：

- 不 `UPDATE` 甲已经发布的 `score_versions` 和学生、班级列。
- 不把甲的正式分 `UPDATE` 成乙。
- `OpenAttributionCorrection` 为甲插入新正式版本，`basis_mode=attribution_corrected_away`，`total_score NULL`。指针移到该版本。甲的旧分仍在旧行。
- 为乙新建或使用名单新版本上的 entry 与 participation，经教师重新确认后发布乙自己的 `itemized` 或 `total_only`。证据 asset 可以相同，score_version 不同。
- 这不是成绩撤回命令，也不是首次部分发布。分析对甲消费“归属已纠正”的当前版本（无题级证据），对乙消费乙的新版本。

若项目负责人拒绝 `attribution_corrected_away`，发布后的重绑定就没有替代写路径，命令保持拒绝，直到另有产品决定。推荐保留该模式，因为它不改历史行。

## 6. 成绩依据与 proposal 引用

`score_versions.basis_mode`：

| 模式 | 真实来源 | 教师确认 | total 与 items | NULL 的含义 | 能否发布 | 能否进入题级分析 |
|---|---|---|---|---|---|---|
| `itemized` | 逐槽 `answer_revisions` + proposal 或纯人工 draft | 每槽 `human_reviews` 或显式批量接受 | `total_score` = 各 numeric 之和。缺任一槽不能发布 | 不用于总分。blank 未决的 score 是 NULL，且不能留在已发布 item 上 | 能，作为正式分 | 能，仅 numeric item，且题目有知识链接 |
| `total_only` | `import_rows` 且 `batch_kind=score_total`，行已被显式接受 | `score_confirmations` 指向该 import_row | **无 items**。总分就是确认过的导入值 | 没有逐题分，不是 0 | 能，作为正式总成绩 | 否。禁止 `mastery_evidence` |
| `absent` | `RecordAbsence` | 确认行 | 无 items | `total_score` 必须为 NULL，展示为缺考 | 能，计入名单覆盖 | 否 |
| `attribution_corrected_away` | 发布后的归属纠正命令 | 确认行写明原 participation 与新 participation | 无 items | NULL 表示这份当前成绩不再属于该学生，不是 0 分 | 能，只作为甲的当前指针 | 否 |

缺考与空白未决都不得被空 items 求和成 0。

proposal 事实的引用组合（CHECK）：

| `author_kind` | answer_revision | job | model_invocation | import_row |
|---|---|---|---|---|
| `ai` | NOT NULL | NOT NULL，`stage=model_grade` 且 `billable=true` | NOT NULL | NULL |
| `extracted_teacher_mark` | NOT NULL | 可空。若有，`stage=mark_extraction` 且 `billable=false` | **必须 NULL** | NULL |
| `excel_item` | NOT NULL | NULL | NULL | NOT NULL |
| `excel_total` | **不建 proposal** | NULL | NULL | 确认行直接引用 |
| `manual` | 可指向 blank 或教师录入的 revision；也可无 OCR | NULL | NULL | NULL |

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
- 页集 1：第 1 页 asset A。generation 1 → 页集 1。
- 页集 2：第 1 页 asset B，第 2 页仍引用原来的 asset。generation 2 → 页集 2。asset A 仍被页集 1 引用。

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

`processing_jobs` 增加非空业务守卫列：`current_attempt_id`、`current_fencing_epoch`、`input_generation`、`binding_id`（匹配完成后非空）、`input_hash`、`stage`、`billable`。这些列的更新规则在事务文档，不在模型 JSON 里。
