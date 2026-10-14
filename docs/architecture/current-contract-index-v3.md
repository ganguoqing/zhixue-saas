# 现行契约索引 v3

**包编号：** ZX-DES-20261012-03，端口补丁 ZX-DES-20261012-04  
**状态：** Proposed。本索引是事件、命令和表写端口的现行入口。与它冲突的旧事件名、旧命令名不实施。  
**v4 改变：** 增加接管、未知费用停放、fence 锁读和 capability 待投递行。事件名与 `evidence_held_at` 不变。  
**v5 改变：** 增加 `AbandonUnknownCost` 与 `CloseUnprovenStage`。`RecordSettlement` 不改 job 成功。没有 `ResumeAfterSettlement`。  
**静态说明：** 未运行 relay、inbox 或数据库。

## 1. 事件

只生产 `ScorePointerAdvanced`，schema `zhixue.event/2`。

| 位置 | 字段 |
|---|---|
| 信封 | `event_id`、`schema_version`、`occurred_at`、`correlation_id`、`causation_id`、`name`、`aggregate_type`、`aggregate_id`、`aggregate_version`、`tenant_id` |
| 载荷 | `score_version_id`、`exam_id`、`student_id`、`basis_mode`、`evidence_held_at`、`fence_epoch`、`previous_score_version_id` |

`aggregate_id` 是 participation。`aggregate_version` 是指针版本。inbox 去重键是 `(consumer_name, event_id)`。消费者是 mastery 的 `ApplyProjection`。`ScoreVersionPublished` 与 `ScoreVersionSuperseded` 不生产，也不是别名。

## 2. Schema

| 标识 | 用于 | 不用于 |
|---|---|---|
| `model-grade-payload/1.0.0` | 模型评分正文 | 服务令牌 |
| `acceptance-envelope/1.0.0` | `model_grade` 的 Worker 信封 | validate、身份 OCR、答案 OCR、提取教师分 |
| `ocr-observation/1` | 付费 OCR 的文本与页 | 评分点 |
| `grading-result/1.0.0` | 已撤回 | 任何实现 |

format 注册见 `schemas/grading-contract-v2.md`。`removeAdditional` 保持 false。

## 3. 命令与表 owner

| 命令 | owner | 角色 | 同一事务还写 |
|---|---|---|---|
| `ScheduleJob` | orchestration | `zhixue_app` 或调度入口 | `work_route_index` |
| `AdmitJob` / `ReleaseAdmission` | orchestration | `zhixue_scheduler` | 占用计数、游标 |
| `ClaimJob` | orchestration | `zhixue_ai_ingress` | 只消费未消耗的 admission |
| `TakeoverExpiredAttempt` | orchestration | `zhixue_ai_ingress` 或 `zhixue_reconciler` | 转移原占用，epoch 加 1 |
| `ParkForUnknownCost` | orchestration | `zhixue_reconciler` | 幂等释放占用，不发送 |
| `RecordSettlement` | subscription | ingress 或 `zhixue_reconciler` | 只写账本和 `cost_status` |
| `AbandonUnknownCost` | subscription | `zhixue_reconciler` | 只把 `cost_status` 从 `unknown` 写成 `abandoned_unknown`。不写 `send_state`，金额保持 NULL |
| `CloseUnprovenStage` | orchestration | `zhixue_reconciler` | 无已接纳效果时改为 `exception_review`。不调用 Accept |
| `ReissueCapability` | orchestration | `zhixue_reconciler` | 撤销旧哈希，写新索引 |
| `AppendOutbox` | orchestration | 发布协调者的 UoW | `outbox_events` 与 dispatch 索引 |
| `read_outbox_payload` | relay 只读 | `zhixue_relay` | 不写业务表 |
| `IssueSendPermit` | orchestration | `zhixue_ai_ingress` | invocation 发送状态 |
| `RecordInvocationObservation` | orchestration | `zhixue_ai_ingress` | observation 行 |
| `publish_score_version` | grading | `zhixue_app` 只有 EXECUTE。函数插入正式行 | 正式版本、item、封存、fence、outbox |
| `LockAnalysisFence` | grading | `zhixue_mastery` EXECUTE | 返回当前 epoch 与 evidence hash。不推进 fence |
| `ApplyProjection` | mastery | 消费角色 | inbox、`analysis_current` |
| `CompensateObject` | storage | submission 调用 | 补偿行，不覆盖旧字节 |
| `RevokeDataScope` | identity | `zhixue_app` | 授权行失效 |

执行类锁序和发布类锁序在事务文档第 5 节。

## 4. 仍有效、本索引可定位的恢复条款

| 条款 | 现行位置 |
|---|---|
| relay 领取、ACK、租约与重投 | 事务文档第 6 节：ACK 在 inbox 分类提交之后。投递列由 `zhixue_relay` 更新。租约过期后另一 relay 可领同一 `event_id`，inbox 主键使第二次为空操作 |
| 取消与重试 | 状态文档 `cancel_requested`；事务文档第 4 节不把旧 attempt 写成当前失败 |
| Redis 队列丢失 | 授权矩阵第 0 节 `ReissueCapability` |
| 对象补偿 | 上表 `CompensateObject` |
| 数据范围撤权 | 上表 `RevokeDataScope`。之后查询端口拒绝该成员 |

## 5. 历史快照

本仓库没有 Git 历史。2026-10-11 的数据字典、状态和事务正文已在 v2 时被替换，无法从本仓库恢复。改 v3 之前的 v2 磁盘原文在 `docs/architecture/snapshots/zx-des-20261012-02/`，摘要见该目录 `MANIFEST.md`。快照不是重构出来的旧稿。
