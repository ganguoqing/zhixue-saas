# 事务边界 v2（含 v3 协议）

**包编号：** ZX-DES-20261012-02，补丁 ZX-DES-20261012-03  
**状态：** Proposed。静态说明，不是运行证据。  
**改前快照：** `docs/architecture/snapshots/zx-des-20261012-02/transaction-boundaries.md`。  
**v3 改变：** 接纳顺序、唯一锁序、发送许可、fence 行 CAS、admission 占用、事件信封含 `event_id`。  
**契约索引：** `current-contract-index-v3.md`。

持有行锁时不做模型 HTTP、不做对象拷贝。

## 1. 协调者

| 命令 | 协调者 | 参与 |
|---|---|---|
| `FinalizeUpload` | submission | storage、orchestration.`ScheduleJob`、subscription.`ReserveQuota`、audit |
| `AcceptValidation` | submission | storage、orchestration.`CompleteExecution`、audit |
| `AcceptRecognition` | submission | orchestration.`CompleteExecution`、audit |
| `AcceptGradeResult` | grading | orchestration.`CompleteExecution`、`RecordInvocationObservation`；subscription.`RecordSettlement`；audit |
| `PrepareInvocation` | orchestration | audit。只插入 intent，`send_state=not_sent` |
| `IssueSendPermit` | orchestration | 把 `send_state` 改为 `send_unknown` 并增加 `send_permit_epoch`。提交后才允许 HTTP |
| `RecordInvocationObservation` | orchestration | 绑定原 invocation。响应到达但本命令未提交时，状态仍是 `send_unknown` |
| `RecordSettlement` | subscription | 按结算唯一键插入账本一次 |
| `AdmitJob` | orchestration | 游标、占用计数、admission 同一事务 |
| `PublishScoreVersion` / `RepublishRevision` | grading，只通过 `publish_score_version` | exam 只读守卫、audit、`AppendOutbox`、锁定 `student_analysis_fences` |
| `ApplyProjection` | mastery | 先锁 fence 行，再 CAS 投影自己的版本 |

## 2. 发送许可与观察

付费 OCR 与评分共用这张表。`not_sent` 只表示还没有签发发送许可，不能证明外部没有收到请求。

| 时刻 | 已提交 | 恢复 |
|---|---|---|
| `PrepareInvocation` 前提交失败 | 无 intent | 可重新准备 |
| intent 已提交，许可未签发 | `send_state=not_sent`，`send_permit_epoch=0` | 可执行一次 `IssueSendPermit` |
| 许可事务已提交，HTTP 尚未返回 | `send_state=send_unknown` | 禁止再发。到期后账本插入 `unknown_marker`，不自动第二次付费 |
| HTTP 已返回，`RecordInvocationObservation` 未提交 | 仍是 `send_unknown`。不得声称 observation 已保存 | 人工或对账命令补 observation。自动路径不二次付费 |
| observation 已提交 | 金额来自供应商响应或对账单，不来自模型 JSON | `RecordSettlement` 按唯一键入账 |

`IssueSendPermit` 在 HTTP 之前把状态写成 `send_unknown`。因此“行上仍是 not_sent”不再被当作可重发证明。两个恢复者抢同一 intent：后锁到的一方看见 `send_unknown` 或已有 observation，不再发送。

`RecordInvocationObservation` 的 scope 是 `ai.invocation.observe`，角色 `zhixue_ai_ingress`，owner 是 orchestration。它只更新该 `invocation_id` 所属的 tenant、job、attempt。`RecordSettlement` 的 scope 是 `ai.billing.settle`，owner 是 subscription，角色在自动确认时是 ingress，在人工对账时是 `zhixue_reconciler`。

结算唯一键是 `(tenant_id, invocation_id, settlement_kind, settlement_key)`，另存 `body_hash`。相同键且相同 body 只返回原行。相同键不同 body 返回 409。另一次真实调用使用另一个 `invocation_id`。账单更正使用新的 `settlement_key`，插入一行差额。

| 步骤 | 账 |
|---|---|
| 许可已发、无 observation | `unknown_marker`，amount NULL，`include_in_total=false`。合计无数字 |
| 人工确认 12.50，键 `confirm:req-9` | 一行 `confirm_delta` 12.50。重试同键不再插入。合计 12.50 |
| 供应商贷项 `credit-2` 为 -0.20 | 新键，再插一行。合计 12.30 |
| 第二次真实调用 | 另一个 invocation，另一套账 |

## 3. 账本合计

账本只插入。官方金额 = `SUM(amount_delta) WHERE include_in_total`。未知标记不参与求和，界面显示未知，不是 0。确认行写确认值本身，不是在未知金额上再加一遍。不承诺供应商收费精确一次。本文件不实施付费调用。

对账等待超过配置 `unknown_cost.escalate_after_seconds` 后，只有人工命令可以插入 confirm 或声明放弃并保持未知。放弃也不写成 0。

## 4. 接纳顺序

所有接纳、改输入、取消、领取使用同一锁序，见第 5 节。决策顺序与锁序分开：

1. 认证、受众、`job_id` 与凭据一致。用过的 `jti` 在这一步拒绝。合法重试带新的 `jti`。
2. 按 `(tenant_id, job_id, idempotency_key)` 查找已保存结果。body hash 相同则返回已保存结果，即使 job 已经 `succeeded`。这一步不再要求 job 非终态。body hash 不同则 409，不写业务。
3. 只有没有已保存结果、需要产生新效果时，才要求 job 非终态，并同时检查：当前 attempt、当前 epoch、`lease_token` 哈希、`now() <= lease_until + grace`、当前 generation、当前 binding（该 stage 需要时）、`input_hash`、config、stage，以及 invocation 属于该 tenant、job、attempt、input 且 `send_state` 为 `send_unknown` 或 `observed`。

M0 测试 `grace_seconds=0`。租约已过且无人接管时，第 3 步失败。生产宽限未填。

信封按 stage 分开。`validate_asset` 与未匹配的身份 OCR 没有 `invocation_id`，也不使用评分 payload schema。`mark_extraction` 没有 invocation。只有 `model_grade` 使用 `acceptance-envelope/1.0.0`。付费 OCR 使用 `ocr-observation/1`，字段是页与文本，不是评分点。

评分新效果的题项集合必须与本 job 的冻结槽位集合相等。重复 `paper_question_id`、缺项、越界都拒绝整单，不建立当前效果。

| 情况 | 当前 job | 新效果 | 费用 |
|---|---|---|---|
| 未认证、错受众、错 job | 不变 | 无 | 无 |
| 已成功，新 jti，同 body | 不变 | 返回已保存结果 | 不第二笔 |
| 同幂等键，不同 body | 不变 | 无，409 | 无 |
| 租约过期且无人接管 | 不变 | 无 | 无 |
| 错误 lease token | 不变 | 无 | 无 |
| 另一任务的 invocation | 不变 | 无 | 无 |
| 重复题项 | 当前 attempt 进入 `exception_review` | 无合格 proposal | 只保留已有 intent，不从载荷加账 |
| 改输入已提交，旧回传后到 | 不变 | 无 | 无 |

## 5. 竞争时间线

### A 旧租约，B 新领取，A 迟到

1. A 的 attempt 是当前，lease 到期。
2. B `ClaimJob` 按第 5 节锁序提交：`current_attempt_id=B`，epoch 增加，并消费 B 自己的 admission。
3. A 的接纳在第 3 步看见当前 attempt 是 B，事务回滚。
4. A 的 invocation 若已是 `send_unknown`，保持未知，不把 B 标成失败。

### 教师改输入与回传同时

1. 两边都按第 5 节锁序锁定。
2. 先提交的一方增加 generation 并写入新 binding，或写入 proposal。
3. 后提交的一方 CAS 失败。旧 generation 的 proposal 不能指向新 binding。

### 锁序

执行类命令（接纳、改输入、取消、领取、admission）只有这一条顺序：

1. `global_execution_occupancy`
2. `tenant_execution_occupancy`（按 `tenant_id`）
3. `submissions`
4. `submission_binding_pointers`（行存在时）
5. `processing_jobs`
6. `model_invocations`（命令点名时）

发布类命令不取执行槽：`exams` → roster pointer → `exam_participations` → draft → score pointer → `student_analysis_fences`。执行类命令的第一把锁是全局占用行，然后才是 submission 与 job。

## 6. 事件 v2 与多考试证据

```json
{
  "event_id": "018f0a3e-7c21-7b2a-8c11-111111111111",
  "schema_version": "zhixue.event/2",
  "occurred_at": "2026-10-12T02:00:00Z",
  "correlation_id": "018f0a3e-7c21-7b2a-8c11-222222222222",
  "causation_id": "018f0a3e-7c21-7b2a-8c11-333333333333",
  "name": "ScorePointerAdvanced",
  "aggregate_type": "score_pointer",
  "aggregate_id": "participation-uuid",
  "aggregate_version": 3,
  "tenant_id": "uuid",
  "payload": {
    "score_version_id": "uuid",
    "exam_id": "uuid",
    "student_id": "uuid",
    "basis_mode": "itemized",
    "evidence_held_at": "2026-10-08T00:00:00Z",
    "fence_epoch": 4,
    "previous_score_version_id": "uuid"
  }
}
```

`event_id` 在信封顶层。inbox 主键 `(consumer_name, event_id)` 使用这个字段。`ScoreVersionPublished` 与 `ScoreVersionSuperseded` 不生产。`evidence_held_at` 复制考试 `held_at`。分析窗口终点 `as_of` 由调度写入投影命令，不是这个字段。

分析输入是集合，不是单场版本号：

- `evidence_set_hash` = 规范排序后的 `(exam_id, participation_id, score_version_id, evidence_as_of)` 哈希
- `analysis_generation` 只在一个学生、一个知识点和一个分析窗口内递增
- 窗口终点由调度命令写入投影，重算时原样传入

发布事务锁定 `student_analysis_fences` 这一行，把 `epoch` 加 1，并把 `evidence_head_hash` 改成新集合哈希。计算在事务外进行，并记下当时读到的 fence epoch 与 evidence hash。投影提交先锁定**同一 fence 行**：

```text
LOCK student_analysis_fences FOR UPDATE
IF fence.epoch <> captured_epoch OR fence.evidence_head_hash <> captured_hash THEN
  INSERT archive, inbox = needs_recompute, INSERT recompute job
ELSE IF analysis_current row is absent THEN
  INSERT analysis_current (projection_version = 1, applied_fence_epoch, applied_evidence_hash)
ELSE
  UPDATE analysis_current
    SET projection_version = projection_version + 1,
        applied_fence_epoch = fence.epoch,
        applied_evidence_hash = fence.evidence_head_hash
    WHERE projection_version = expected_projection_version
```

只检查 `analysis_current` 上的旧 epoch 或旧 hash，不算检查了 fence。新的 evidence hash 与旧投影 hash 不同是合法推进，只要它等于当前 fence 头。无证据时 fence 头是空集合哈希，投影可以插入 `support_status=insufficient`。另一知识点或窗口是另一行 `analysis_current`。重复 `event_id` 在 inbox 主键处空操作。ACK 只在上述分类提交之后。

交错：投影读到 fence 4/H4 后释放读锁。发布把 fence 改到 5/H5 并提交。旧投影再锁 fence，4≠5，必须失败。考试 B 的新计算若在发布之后读到 5/H5，提交时与 fence 一致，则按投影自己的 `projection_version` CAS 成功。旧投影行上的 H4 不阻止 H5。

| 时间线 | 当前投影 | inbox |
|---|---|---|
| 同场 pointer 3 先处理，pointer 2 后到 | 保持 3。2 只归档 | 2 为 `archived_only` |
| 考试 A 的 pointer 2 已进入集合，随后考试 B 的 pointer 1 到达 | B 的 1 是另一场证据，必须进入新的 evidence set。不得因为 1<2 丢弃 | 新 `analysis_generation`，`applied_current` 若 fence 仍匹配 |
| 计算读到 epoch=4，提交前发布把 epoch 改为 5 | 旧结果只归档 | `needs_recompute` |
| 同一 event_id 再次投递 | 不变 | 主键冲突，空事务后 ACK |

固定 `evidence_as_of` 与同一 evidence set 重跑，输入相同。不在 G0 定义掌握度公式。

## 7. 公平领取与阶段预留

就绪集合只包含 `status=queued` 且租户仍允许该 stage 的 job。不可领取的行不在集合里，避免空转重排。

占用 = 未消耗 admission + running。M0 测试 `tenant_cap=2`，`global_cap=4`。额度预留是另一张表，不计入这个占用。

`AdmitJob` 按第 5 节锁序锁定全局占用、租户占用和游标。`occupied + 1` 超过任一上限则不写 admission。`ClaimJob` 在同一锁序中把该 admission 从 `admitted` 改为 `consumed` 并把 job 改为 `running`，占用数不变。重复 Claim 看见已消耗则拒绝。完成、取消或过期未消耗时，占用减 1。

重启不从 Redis 重建占用；计数在 PostgreSQL。对账任务按同一锁序把过期未消耗 admission 释放。

| 步骤 | A 占用 | 全局占用 | 结果 |
|---|---|---|---|
| 起始 | 0 | 0 | — |
| scheduler 1 接纳 A1 | 1 | 1 | admitted，仍 queued |
| scheduler 2 接纳 A2 | 2 | 2 | admitted，仍 queued |
| 第三个 A3 | 2 | 2 | 拒绝。未消耗已占满租户槽 |
| Worker 迟迟才 Claim A1 | 2 | 2 | A1 running，A2 仍 reserved。不新增占用 |
| 再次 Claim A1 | 2 | 2 | 拒绝 |
| A1 完成 | 1 | 1 | 释放 1 |
| 租户已过期，A2 仍未消耗 | 1 | 1 | 允许 Claim 当前 stage。新 stage 的 Admit 拒绝 |
| 租户 suspended 或 closed | 释放未完成占用 | 随之下降 | 取消未完成 job，不删成绩 |

轮转仍用游标，避免租户 A 的积压独占挑选。上限是执行槽，不是公平本身。OCR 的额度预留不能支付评分 stage。

| 租户变成 | 已 admission 的当前 stage | 下一 stage |
|---|---|---|
| `expired` | 允许跑完 | 拒绝新的预留与 admission |
| `suspended` | 取消未完成的当前 stage；已发生费用保留 | 拒绝 |
| `closed` | 取消 | 拒绝。不立即删成绩 |

配置键必须存在，代码里不藏一套默认生产值。

| 键 | M0 测试值 | 出处 | 生产 |
|---|---|---|---|
| `retry.max_attempts` | 3 | 本文件测试剖面 | 待实测，未填 |
| `retry.deadline_seconds` | 900 | 同上 | 待实测，未填 |
| `lease.grace_seconds` | 0 | 同上 | 待实测，未填 |
| `unknown_cost.escalate_after_seconds` | 3600 | 同上 | 待业务，未填 |
| `unknown_cost.auto_retry` | false | 固定，不是待定 | 保持 false |
| `fairness.tenant_cap` | 2 | 测试剖面，为了能观察到轮转 | 待实测，未填 |
| `fairness.global_cap` | 4 | 同上 | 待实测，未填 |

生产剖面缺少这些键时启动失败，不得偷偷使用测试值。
