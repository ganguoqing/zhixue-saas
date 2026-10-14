# 智学 SaaS 架构补充 v5

**包编号：** ZX-DES-20261012-05  
**日期：** 2026-10-12  
**状态：** Proposed。作者不宣布 G0 通过，也不代负责人接受 ADR。  
**对照：** ZX-AR-20261012-05 的 R5-01、R5-02。  
**保留：** v4 已复验通过的引用链、函数执行身份、capability 待投递、没有 `send_unknown` 时的原槽转移、发布 EXECUTE、fence 锁读和双层 schema。  
**改前快照：** `docs/architecture/snapshots/zx-des-20261012-04/`。没有 Git。原需求、原架构和独立报告未改。

样例是规格推演，不是迁移或服务测试。

## R5-01 费用确认不是业务成功

**选择：** 保守方案，提交决议，尚未接受。M0 停用 unknown 的自动付费复跑和 `ResumeAfterSettlement`。不新增 `AdoptObservedResult`。

**精确修改位置：** `state-transitions.md` 第 3 节；`transaction-boundaries.md` 第 7 节；`authorization-matrix-v2.md` 的结算行；`current-contract-index-v3.md`；ADR-004/012/013 的 Proposed 说明。

**命令顺序：**

| 命令 | actor | from | to | 副作用 | 拒绝 |
|---|---|---|---|---|---|
| `ParkForUnknownCost` | reconciler | `running` 且 `send_unknown` | `awaiting_settlement`，`result_status` 保持原值 | 占用只减一次。attempt 与 epoch 不变 | 不发送，不改 invocation 的 attempt |
| `RecordSettlement` | reconciler 或 ingress | 待确认 invocation | `cost_status=confirmed` | 只插入账本 | 不改 job 为 `succeeded`，不造 proposal |
| `AbandonUnknownCost` | reconciler | `send_unknown` | `cost_status=abandoned_unknown` | 金额不写 0 | 不改已接纳效果 |
| `CloseUnprovenStage` | reconciler | `awaiting_settlement` 且没有已接纳效果 | `exception_review` | 幂等键 `(tenant_id, job_id, close_unproven)` | 不调用普通接纳 |
| `OpenManualScore` | 范围内教师 | `exception_review` 或 `failed_final` | 草稿 `building` | 先写 manual revision | 不伪造 AI proposal |
| `TakeoverExpiredAttempt` | Worker | `running` 且没有 `send_unknown` | 仍 `running`，epoch+1 | 原槽转移 | 有 `send_unknown` 时拒绝 |

普通 `AcceptGradeResult` 仍要求 invocation 属于当前 attempt。恢复不把旧 invocation 的 attempt 改成新 attempt，也不放宽这条守卫。

**样例 1：费用已确认，没有 OCR 或评分结果。** A 已 `IssueSendPermit`，响应未形成合格 observation。`ParkForUnknownCost` 后 occupied 从 1 到 0，job 仍不是 `succeeded`，没有 proposal。`RecordSettlement` 写入 12.50，`cost_status=confirmed`，`result_status` 仍是 `pending`。`CloseUnprovenStage` 把 job 改成 `exception_review`。教师可以 `OpenManualScore`。

**样例 2：A 有合法输出，恢复发生在 B 已经接管之后。** 若当时已是 `send_unknown`，接管应被拒绝，当前 attempt 保持 A。若竞争中 B 已经成为当前 attempt，A 的 invocation 仍指向 A。A 的迟到接纳因当前 attempt 守卫失败，不写 proposal。`CloseUnprovenStage` 不调用接纳，job 进入 `exception_review`。教师走人工。这条路径不把 invocation 改挂到 B，也不把 job 留在无法关闭的 `running`。

**样例 3：结算期间 generation 已变化。** 账本行已经插入。`CorrectRecognition` 提交了新 generation。`CloseUnprovenStage` 看见 generation 不一致，`result_status=input_changed`，旧输出不进入当前 generation。原账保留。`occupancy_held` 已是假，再次释放不减占用。

**待决：** ADR-004/012/013 仍是 Proposed。新的付费重评不在自动恢复里；若以后需要，必须另有授权、新 job 和新 invocation。本轮不调用模型。

**未来测试：** G1 验证对账不造 proposal、旧输出不进入新 generation、同一结算键不双计、unknown 与放弃都有可见业务状态、占用不第二次释放。尚未运行。

## R5-02 空值与重排

**精确修改位置：** `data-dictionary.md` 第 8 节；`sql/core-chain-v3.sql` 的 CHECK 注释；`state-transitions.md` 的 `ScheduleJob`、`AdmitJob`、`ClaimJob`。

**约束：** attempt 与 epoch 只表示是否曾 Claim。binding 只由 stage 决定。撤回范围仅是 unknown 自动复跑用的 `queued_after_claim` 和 `ResumeAfterSettlement`。

**合法行：**

| 行 | binding | attempt | epoch |
|---|---|---|---|
| 初次 `validate_asset`，`queued` | NULL | NULL | 0 |
| 初次已匹配 `model_grade`，`queued` | 本代 binding | NULL | 0 |
| 没有 `send_unknown` 时接管后的 `running` | 创建时的 binding | 新 attempt | 原 epoch+1 |

**拒绝行：** `model_grade` 且 `binding_id` 为空。阶段 CHECK 拒绝。`AdmitJob` 不接受非初次 queued，也不消费已经 consumed 的 admission。

**仍保留的重试：** 初次 Admit/Claim；无 `send_unknown` 的原槽接管，次数受 M0 测试 `max_attempts` 限制；同体接纳返回已保存结果；capability 的 `pending_enqueue` 再签发；上一 stage 已接纳成功后，下一 stage 新建 job。新建 job 重新从 epoch 0 开始，并按自己的 stage 写 binding。

**待决：** 无新产品选择。上项保守政策仍待 ADR 决议。

**未来测试：** G1 创建两类初次 job；空 binding 的评分 job 失败；接管不把 epoch 重置为 0，也不第二次消耗旧 admission。本表不是迁移执行结果。

## 对照

| 文件 | 现行口径 |
|---|---|
| 状态、事务、契约索引 | 无 `ResumeAfterSettlement`。结算不写 `succeeded` |
| 字典、SQL、状态 | 初次评分 queued 的 binding 非空，attempt 为空，epoch 为 0 |
| ADR-004/012/013 | 写明上述提案，状态仍是 Proposed |
