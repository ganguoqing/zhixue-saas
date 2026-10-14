# 模块邻接 v2（Proposed，2026-10-12）

包编号 ZX-DES-20261012-02。规范是**调用方 → 被调用方**。未列出的编译边一律禁止。v1 修复稿里的箭头图作废，不再作为依赖依据。

## 1. 有争议模块的编译邻接

`Y` 表示可以 import 对方的公开端口。`—` 表示禁止。

| 调用方 ↓ \ 被调用方 → | storage | exam | submission | grading | orchestration | audit | subscription |
|---|---|---|---|---|---|---|---|
| submission | Y | Y 只读端口 | — | — | Y `ScheduleJob` | Y | Y |
| grading | — | Y 只读端口 | Y 只读端口 | — | Y `ScheduleJob` / `AppendOutbox` | Y | Y |
| orchestration | Y 对象引用只读 | — | — | — | — | Y | — |
| storage | — | — | — | — | — | — | — |
| exam | — | — | — | — | — | Y | — |
| composition root | 装配 | 装配 | 装配 | 装配 | 装配 | 装配 | 装配 |

composition root 不是业务表 owner。它把 HTTP 内部入口转到下面三个命令，因此 orchestration **不** import submission 或 grading。

没有从 storage 指向 submission、也没有从 exam 指向 grading 的编译边。v1 图上的那两条方向作废。

## 2. 边的种类

| 种类 | 含义 | 不构成 |
|---|---|---|
| 编译依赖 | 源码 import 公开端口 | 写对方的 repository |
| 查询端口 | 只读函数，返回冻结哈希、名单指针、守卫所需版本 | 在查询里 `UPDATE` |
| UoW 参与 | 协调者的事务里调用对方公开写入命令 | 对方再 `commit` |
| 事件 | outbox 投递后由消费模块处理 | 编译依赖 |

事件边：grading 经 `AppendOutbox` 发布 `ScorePointerAdvanced`（`zhixue.event/2`）。mastery 消费。grading 不 import mastery。`ScoreVersionPublished` 与 `ScoreVersionSuperseded` 不是现行事件名。

## 2.1 表的唯一写 owner

| 表 | owner | 公开写入端口 | 其他模块 |
|---|---|---|---|
| `work_route_index` | orchestration | `ScheduleJob` / `ReissueCapability` / `CancelJob` | 无直接 UPDATE |
| `outbox_dispatch_index` / `outbox_events` | orchestration | `AppendOutbox`；relay 只更新投递列 | grading 调用 `AppendOutbox` |
| `job_admissions` / 占用计数 | orchestration | `AdmitJob` / `ClaimJob` / `ReleaseAdmission` | scheduler 调用这些命令 |
| `student_analysis_fences` | grading | `publish_score_version` | mastery 只锁行并读取，不增加 epoch |
| `analysis_current` | mastery | `ApplyProjection` | grading 不写投影 |
| `invocation_observations` | orchestration | `RecordInvocationObservation` | subscription 不改 observation 正文 |
| `usage_ledger_entries` | subscription | `RecordSettlement` | 接纳协调者调用该命令 |
| `score_versions` | grading | `publish_score_version` | 应用角色无表 INSERT |

relay 的 ACK、租约和重投在 `current-contract-index-v3.md`。inbox 由消费方在 `ApplyProjection` 里写入。对象补偿由 storage 的 `CompensateObject` 执行，submission 只调用该端口。数据范围撤权由 identity 的 `RevokeDataScope` 执行，之后查询端口拒绝该成员。

## 3. 三个接纳命令

| 命令 | 协调者 | 同一 UoW 的参与命令 | 不参与 |
|---|---|---|---|
| `AcceptValidation` | submission | storage.`MarkAssetValidated`；orchestration.`CompleteExecution`；audit | grading 不写 proposal |
| `AcceptRecognition` | submission | orchestration.`CompleteExecution`；若该 OCR stage 有 invocation，则 orchestration.`RecordInvocationObservation` 与 subscription.`RecordSettlement`；audit。写入 `answer_revisions` | 不写正式分，不写 AI proposal |
| `AcceptGradeResult` | grading | orchestration.`CompleteExecution` 与 `RecordInvocationObservation`；subscription.`RecordSettlement`；audit。写入 proposal 事实 | 不写 `score_versions`。orchestration 不因此 import grading |

文件校验的协调者是 submission。评分结果的协调者是 grading。OCR 文本的协调者是 submission。

内部命令仍然检查服务 scope、租户上下文和 CAS。组合根只做路由。
