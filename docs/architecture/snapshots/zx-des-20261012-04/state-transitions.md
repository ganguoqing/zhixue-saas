# 状态转换 v2（含 v3 写入）

**包编号：** ZX-DES-20261012-02，补丁 ZX-DES-20261012-03  
**状态：** Proposed。  
**改前快照：** `docs/architecture/snapshots/zx-des-20261012-02/state-transitions.md`。  
**v3 改变：** 新 generation 同事务插入 binding；`AdmitJob` 占用执行槽；`ClaimJob` 消费该槽。  
**v4 改变：** 首次匹配先插入 `match_decisions`。过期 running 用 `TakeoverExpiredAttempt` 转移原槽。`OpenManualScore` 先插入 `origin=manual` 的答案行。  
**写列细节：** 数据字典 v2 第 4–6 节。禁止通用 `PATCH status`。

## 1. 上传与校验

v1 把 `created → uploading` 和“事务直接写 uploading”写成两套。v2 只有一个已提交状态：`StartUpload` 提交后就是 `uploading`。不存在需要客户端再推进的已提交 `created`。

| 命令 | Actor | From | Guard | To | 版本 | 写入 | 费用 | 错误 |
|---|---|---|---|---|---|---|---|---|
| `StartUpload` | 授权教师 | 无已提交行 | 租户允许新上传 | `uploading` | 新建 session | INSERT session=`uploading`，object=`pending` | 无 | 403/404/429 |
| `FinalizeUpload` | 同一教师；校验在事务外完成 | `uploading` | 对象大小与校验和一致；学生答卷则考试已冻结 | `finalized` | session.state_version | INSERT source_asset；学生答卷 INSERT submission=`awaiting_validation`、page_set 1、generation 1、validate job、预留、outbox | 预留，未外部调用 | 幂等：同一哈希返回原结果 |
| `CancelUpload` / `ExpireUpload` | 教师 / 系统 | `uploading` | 未 finalized | `cancelled` / `expired` | session.state_version | 会话终态；对象待清理 | 释放未使用预留 | 已 finalized 则 409 |
| `AcceptValidation` | ingress，`ai.result.accept` | submission `awaiting_validation` | 当前 validate attempt；文件规则通过或失败已分类 | `validated` 或 `rejected` | submission + job epoch | 见接纳矩阵。非法文件不建评分 job | 解析若未付费则无 invocation | 旧 attempt 不改当前 submission |

`AcceptValidation` 是 submission 从 `awaiting_validation` 到 `validated` 的唯一边。资产行同时标为 validated 或 quarantine。

## 2. 匹配、换页、识别

| 命令 | Actor | From | Guard | To | 版本 | 写入 | 费用 | 错误 |
|---|---|---|---|---|---|---|---|---|
| `MatchAutomatically` | 系统 | `validated` | 只在当前名单版本中找标识；submission 的冻结卷非空 | `matched` 或 `match_review_required` | submission.state_version | 成功时先 INSERT `match_decisions`，再 INSERT 当前 generation 的 binding，然后 CAS 指针 | 无 | 零个或多候选不猜测 |
| `ResolveMatch` | 范围内教师 | `match_review_required` | 所选学生在当前名单版本；冻结卷非空 | `matched` | submission + roster pointer | 同样先 decision 再 binding。不单独插入 binding | 无 | 名单外 422 |
| `CorrectMatch` | 范围内教师 | `matched`，且该 participation **尚未**有正式指针 | 新学生在当前或新名单版本；理由非空 | 仍 `matched`，绑定改为新人 | generation+1；binding 指针 CAS | INSERT 新 generation、新 `match_decisions`、新 `matching_bindings`；若名单换版则只 INSERT link 并 CAS roster pointer，不新建已存在的 participation；旧 binding 保留；旧 job `cancel_requested` | 已发生费用不删 | 已有正式指针则本命令 409。发布后路径见数据字典选项甲/乙，未决议 |
| `AcceptRecognition` | ingress | `matched` 且来源不是只提取教师分 | 当前 OCR attempt 与 generation | `parsed` 或 `ocr_review_required` | generation | INSERT answer_revisions。不写 proposal 分数 | 仅当本 stage 有 intent | 旧世代 409 且不改当前 job |
| `ExtractTeacherMarks` | 系统 | `matched` 且 source=`graded_script` | 不创建 model_grade job | `proposed` | generation | proposal `extracted_teacher_mark`；invocation 不插入。解析 job 若存在则 `stage=mark_extraction`，`billable=false` | 无模型费 | — |
| `SupplyReplacementPage` | 范围内教师 | `incomplete` 或 `parsed` 发现缺页 | 新页已 finalized | `awaiting_validation` | 新 page_set、generation+1 | INSERT page_set 与 generation，二者 `submission_id` 相同。若已有 match_decision，同一事务 INSERT 新 binding 指向该决定；未匹配则不建 binding。旧 page_set 不删。旧 job `cancel_requested` | 新的校验预留；不重复已结算的模型费 | 不覆盖旧页行 |
| `CorrectRecognition` | 范围内教师 | `ocr_review_required` 或 `parsed` | 当前 binding 存在 | `parsed` | generation+1 | 同一事务 INSERT 新 generation（可沿用 page_set）、INSERT 新 binding（同一 match_decision）、INSERT 新 answer_revision 指向新 binding；旧 review/proposal 生命周期作废；旧 job `cancel_requested` | 无，除非教师再要求模型 | 409 |
| `ValidateCoverage` | 系统 | `parsed` | 当前 page_set 页码连续；每槽有修订或显式 blank；binding 是当前指针 | `ready_for_grading` 或 `incomplete` | generation | 只写覆盖检查结果行 | 无 | 缺页停在 `incomplete`，不发布 |

## 3. 执行与人工恢复

执行状态仍在 job 上，不表示已发布。

| 命令 | Actor | From | Guard | To | 写入 | 费用 |
|---|---|---|---|---|---|---|
| `ScheduleJob` | 协调者 | 无此 logical_key | 本 stage 额度预留成功；租户允许**这一** stage；执行槽见事务文档 | `queued` | INSERT job，`current_attempt_id` NULL；同一事务 INSERT `work_route_index` | 额度预留与执行槽分开 |
| `AdmitJob` | scheduler | `queued` 且无未消耗 admission | `running + reserved < cap` | 仍 `queued` | 同一事务占用执行槽并写 `job_admissions` | 不产生供应商费用 |
| `ClaimJob` | Worker | 首次 `queued`，或 `queued_after_claim` | 消费本 job 当前未消耗的 admission | `running` | 首次领取把 attempt 从空改为非空，epoch 从 0 加到 1。再次排队后的领取不把 epoch 重置为 0，只加 1 | 无新的外部费 |
| `TakeoverExpiredAttempt` | Worker 或 reconciler | `running`，当前 attempt 的租约已过 grace | 输入、generation、binding 仍是当前；未取消 | 仍 `running` | 原占用转给新 attempt。不新建 admission，不改占用数。epoch 加 1 | 已有 `send_unknown` 不自动再付费 |
| `FailFinal` | NestJS，且调用者是当前 attempt | `running` | 不可重试或预算耗尽 | `failed_final` | 当前 job 终态。旧 attempt 的请求不能走这条边 | 按已有 intent 结算，不从载荷造账 |
| `OpenManualScore` | 范围内教师 | `failed_final` 或 `exception_review`，且没有合格 proposal | 冻结仍有效；当前 binding 存在 | 考试草稿 `building` | 每个冻结槽先 INSERT `answer_revisions.origin=manual`，再 INSERT draft 与 draft items。本命令不插入 `human_reviews`。不插入假的 AI proposal 或 invocation | 无 |
| `ParkForUnknownCost` | reconciler | `running` 且存在未结算的 `send_unknown` | 没有可继续的自动发送 | `awaiting_settlement` | 若 `occupancy_held` 仍为真，占用减 1 并改成假。epoch 与 attempt 保持原值 | 不自动再付费 |
| `RerouteAfterInvalidation` | 系统 | review 已作废 | 存在当前 generation 的合格 proposal，或教师已 `OpenManualScore` | proposal `review_required` 或草稿可复核 | INSERT 新的路由生命周期。旧 review 行不改正文 | 无 |

模型输出非法不会被修成合格 proposal。当前 attempt 进入 `exception_review` 后，发布路径是 `OpenManualScore`，不是把坏 JSON 的分数入库。

## 4. 复核与发布

| 命令 | Actor | From | Guard | To | 写入 |
|---|---|---|---|---|---|
| `RouteReview` | 策略 | 合格 proposal | 未校准不得标成可批量 | `review_required` 或 `batch_confirm_eligible` | 生命周期路由 + policy_snapshot |
| `CompleteReview` / `ConfirmSelected` | 教师 | 对应路由 | 显式 id+版本；分数符合冻结组合函数 | `review_completed` | INSERT review 事实。一组确认任一冲突则整组回滚 |
| `ScoreBlankAsZero` | 教师 | 当前 blank revision | 决定显式 | draft item numeric 0.00 | 见字典。原 blank 行不改 |
| `PublishScoreVersion` | 教师，app 角色 | 每个名单学生都有一种就绪依据 | itemized 槽位齐全；total_only 有确认；absent 已批准；冻结哈希未变；权限仍在 | 指针建立 | 只 `EXECUTE publish_score_version`。函数插入正式行后封存。total_only **不要求**逐题 review |
| `RequestRevision` | 教师 | 指针已存在 | 理由 | 新草稿 building | 旧正式行不更新 |
| `RepublishRevision` | 教师 | 草稿守卫通过 | 指针 CAS | 新正式行成为当前 | 只 `EXECUTE publish_score_version`。旧 total 不变 |
| `OpenAttributionCorrection` | 教师 | 仅当负责人书面选择选项甲 | 乙尚无 `score_current_pointers`。指针不指向草稿 | 同一事务移动甲的指针并建立乙的正式指针 | 乙已有正式指针、未决议、或选项乙：返回 409 |

首次发布仍是整场名单都有依据才提交。依据可以是 itemized、total_only 或 absent 的组合。这不是“只发布一部分学生”。

## 5. 拒绝边

未匹配就评分、未审核答案就冻结、旧 attempt 推进当前 generation、AI 角色发布、`UPDATE` 已发布 item、用当前班级改旧名单、总分导入写入 mastery_evidence、`mark_kind=blank` 且 score 0 进入正式 item、通用 PATCH status。

拒绝不写成功 outbox。未运行测试。
