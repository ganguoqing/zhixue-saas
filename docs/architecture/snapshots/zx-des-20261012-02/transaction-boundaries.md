# 事务边界 v2

**包编号：** ZX-DES-20261012-02  
**状态：** Proposed。  
**v1 来源：** 2026-10-11 同文件。事件 `zhixue.event/1` 撤回。现行事件是 `zhixue.event/2`。  
**身份路径：** `authorization-matrix-v2.md`。**依赖：** `module-adjacency-v2.md`。

持有行锁时不做模型 HTTP、不做对象拷贝。

## 1. 协调者

| 命令 | 协调者 | 参与 |
|---|---|---|
| `FinalizeUpload` | submission | storage、orchestration.`ScheduleJob`、subscription.`ReserveQuota`、audit |
| `AcceptValidation` | submission | storage、orchestration.`CompleteExecution`、audit |
| `AcceptRecognition` | submission | orchestration.`CompleteExecution`、audit |
| `AcceptGradeResult` | grading | orchestration.`CompleteExecution`、subscription.`SettleFromIntent`、audit |
| `PrepareInvocation` | orchestration 公开命令，由 Worker 入口调用 | audit。提交后调用方才发 HTTP |
| `PublishScoreVersion` / `RepublishRevision` | grading | exam 只读守卫、audit、`AppendOutbox`、学生 fence `UPDATE epoch` |
| `ApplyProjection` | mastery 等消费方 | inbox 与投影同一事务 |

## 2. 调用三段崩溃

付费调用的持久身份是 `model_invocations` 意图行，不是接纳事务。

| 时刻 | 已提交的事实 | 恢复 |
|---|---|---|
| `PrepareInvocation` 提交前崩溃 | 无 intent | 可重新准备。没有外部请求 |
| 意图已提交、HTTP 发送前崩溃 | intent `observed=not_sent` | reconciler 若进程确认未送出，可沿用同一 invocation id 发送一次。不第二笔预留 |
| 发送后、响应前崩溃 | intent 仍在。协调者不能证明供应商没计费 | 标 `cost_status=unknown`，`include_in_total=false`，amount NULL。不自动第二次付费 |
| 响应已到、`AcceptGradeResult` 前崩溃 | intent + observation | 可以重试接纳。业务幂等不另开 invocation |
| 接纳提交 | proposal（若合法）与账本确认行 | 正式分仍不在此事务 |

`SettleFromIntent` 只引用已存在的 `invocation_id`。载荷里的金额不能插入账本。

## 3. unknown → confirmed 的两条账

账本 `usage_ledger_entries` 只插入。官方金额 = `SUM(amount_delta) WHERE include_in_total`。未知标记不参与求和。

| seq | kind | amount_delta | include_in_total | 官方合计 |
|---|---|---|---|---|
| 1 | `unknown_marker` | NULL | false | 无数字，界面显示未知，不是 0 |
| 2 | `confirm_delta` | 12.50 | true | 12.50 |

第二行是确认值本身，不是在未知金额上再加 12.50。若以后更正供应商账单，再插入一行 `confirm_delta`，其 `amount_delta` 为差额（例如 -0.20），合计 12.30。不更新第 2 行。

两次真实 HTTP 是两个 invocation id，两套账，不因一个 proposal 合并。

货币、价格版本、用量和供应商 request id 写在 observation 行，来源是准备时的配置和供应商响应，不是模型 JSON。

对账等待超过配置 `unknown_cost.escalate_after_seconds` 后，只有人工命令可以插入 confirm 或声明放弃并保持未知。放弃也不写成 0。

## 4. 租约、旧 attempt、幂等

`ClaimJob` 在同一事务：

1. 锁定 job。
2. 若状态是 `running` 且 `current_attempt_id` 仍是过期的那一次，且未取消、generation 未变，才允许接管。
3. `current_fencing_epoch` 加 1，`current_attempt_id` 改为新 attempt。

宽限只存在于：**没有新的领取、没有取消、generation 与 binding 都没变**，并且现在仍早于 `lease_until + grace`。宽限不让已经被替换的 attempt 通过。推荐 M0 测试配置 `grace_seconds=0`，生产值待定，不把 0 写成生产承诺。测试配置出处：本文件，供 G1 观察接管，不是学校 SLA。

`AcceptGradeResult` 锁定 job 后必须同时成立：

- 凭据 scope 是 `ai.result.accept`，受众正确，`jti` 未使用
- `attempt_id` = `job.current_attempt_id`
- `fencing_epoch` = `job.current_fencing_epoch`
- `generation` = `job.input_generation` = 当前 binding 的 generation
- `binding_id` = `job.binding_id` = 当前 binding 指针
- `input_hash` 与 job 一致
- job 不是 cancelled / failed_final / succeeded

缺一则回滚业务写入。

| 情况 | 当前 job | proposal | 从载荷造费用 |
|---|---|---|---|
| 未认证、错受众、错 job | 不变 | 无 | 无 |
| 旧世代、旧 attempt、已取消 | 不变 | 无 | 无。旧 intent 若真实存在，仍留在那个 invocation 上 |
| 当前 attempt，输出非法 | 该 job → `exception_review` | 无合格 proposal；存 artifact | 只结算已有 intent |
| 合法成功 | `succeeded` | INSERT | `confirm_delta` 或未知标记，来自 intent |
| 新的 `jti`，相同幂等键，相同 body hash | 不变 | 不第二插 | 不第二笔 |
| 相同幂等键，不同 body hash | 不变 | 无 | 无，409 |

`jti` 是凭据一次性随机数。用过的 `jti` 再来，即使 body 相同，也在认证层拒绝。合法重试使用**新凭据（新 jti）**加上相同幂等键和相同 body hash，并且仍然检查调用者、受众和 job。业务幂等返回第一次的接纳结果。

## 5. 竞争时间线

### A 旧租约，B 新领取，A 迟到

1. A 的 attempt 是当前，lease 到期。
2. B `ClaimJob` 提交：`current_attempt_id=B`，epoch 增加。
3. A 的接纳读到当前 attempt 是 B，事务回滚。B 的 job 状态保持 B 领取后的 `running`。
4. A 若曾 `PrepareInvocation`，该 invocation 保留 unknown 或 not_sent，不把 B 标成失败。

### 教师改输入与回传同时

1. 接纳事务要锁定 submission binding 指针和 job。
2. `CorrectRecognition` 也锁定同一对行。
3. 先提交的一方增加 generation 或写入 proposal。
4. 后提交的一方 CAS 失败。旧 generation 的成功 proposal 不能指向新 binding。

锁顺序：submission 绑定指针 → job → draft 或 proposal。发布事务则是 exam → roster pointer → participation → draft → score pointer → fence。

## 6. 事件 v2 与多考试证据

```json
{
  "schema_version": "zhixue.event/2",
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
    "evidence_as_of": "2026-10-08T00:00:00Z",
    "fence_epoch": 4,
    "previous_score_version_id": "uuid"
  }
}
```

`aggregate_id` 是稳定的 participation。`aggregate_version` 是指针版本。`score_version_id` 是事实，不拿来跟另一场考试的 version_no 比较。`evidence_as_of` 复制考试 `held_at`，不是投影运行当天。

分析输入是集合，不是单场版本号：

- `evidence_set_hash` = 规范排序后的 `(exam_id, participation_id, score_version_id, evidence_as_of)` 哈希
- `analysis_generation` 只在一个学生、一个知识点和一个分析窗口内递增
- 窗口终点由调度命令写入投影，重算时原样传入

发布事务里把该学生 `student_analysis_fences.epoch` 加 1。计算在事务外进行。提交投影时：

`UPDATE analysis_current SET ... WHERE epoch=:read AND evidence_set_hash=:hash`

失败则只 INSERT 历史归档，inbox 记 `needs_recompute`，并在同一事务插入重算工作行。然后才允许 ACK。不把“已 ACK”当成“已变成当前”。

| 时间线 | 当前投影 | inbox |
|---|---|---|
| 同场 pointer 3 先处理，pointer 2 后到 | 保持 3。2 只归档 | 2 为 `archived_only` |
| 考试 A 的 pointer 2 已进入集合，随后考试 B 的 pointer 1 到达 | B 的 1 是另一场证据，必须进入新的 evidence set。不得因为 1<2 丢弃 | 新 `analysis_generation`，`applied_current` 若 fence 仍匹配 |
| 计算读到 epoch=4，提交前发布把 epoch 改为 5 | 旧结果只归档 | `needs_recompute` |
| 同一 event_id 再次投递 | 不变 | 主键冲突，空事务后 ACK |

固定 `evidence_as_of` 与同一 evidence set 重跑，输入相同。不在 G0 定义掌握度公式。

## 7. 公平领取与阶段预留

就绪集合只包含 `status=queued` 且租户仍允许该 stage 的 job。不可领取的行不在集合里，避免空转重排。

挑选算法（开源 PostgreSQL 可做，不使用 BullMQ Pro）：

1. 读取 `schedule_cursor`。
2. 选择 `tenant_id` 大于游标、有就绪 job、`running < tenant_cap`、全局 running 未满的最小租户；没有则从最小租户回头。
3. 同一事务把游标移到该租户，给一个 job 写 `admission_until`。
4. Worker 在 admission 过期前 `ClaimJob`。

这不是“每租户一个并发上限”本身。上限只决定选中后能否 admission。轮转决定 A 的积压不能一直占住挑选。

预留按 stage，不按整条链路。OCR 预留不能支付评分 stage。评分开始前要新的 `ReserveQuota`。

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
