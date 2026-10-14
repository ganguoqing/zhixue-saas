# 授权矩阵 v2（Proposed，2026-10-12）

包编号 ZX-DES-20261012-02。替代修复稿 v1 里未闭合的后台身份循环。ADR-001/003 仍为 Proposed。

## 1. 循环怎么解开

队列载荷只有 `job_id`、`env` 和 `capability`（随机秘密，不是租户）。租户业务表开启 RLS 且无上下文时不可读。

控制表 `work_route_index`、`outbox_dispatch_index` **不放答卷、姓名或分数**。它们不启用 RLS。`zhixue_app` 与 Worker 角色没有这两张表的 `SELECT`。

`zhixue_router` 拥有这两张表，**没有** `BYPASSRLS`，也不是 migrator。它只通过 `SECURITY DEFINER` 函数向外提供最小结果。函数固定 `search_path`。

`resolve_work_route(job_id, capability)`：

1. 调用者已经通过服务凭据认证，且本请求的 scope 允许解析。
2. 仅当 `capability` 的哈希与索引行一致时返回 `tenant_id`。
3. job 不存在和 capability 错误返回同一种空结果，避免枚举。
4. 写一条不含载荷的拒绝或成功审计。
5. 调用者然后在**自己的**事务里 `set_config('app.tenant_id', ..., true)`，再以 RLS 读取业务行。

常规后台不得使用 `zhixue_migrator`。

## 2. 身份路径

| 身份 | 内部动作 | 能力 / scope | 数据库角色 | 可写或可读 | tenant 如何建立 |
|---|---|---|---|---|---|
| 学校用户会话 | 业务命令，含发布 | 成员 + 数据范围 | `zhixue_app` | 该命令允许的业务表；可 `INSERT` 正式成绩；不可改已发布内容列 | 会话里的 membership。先认证再 `set_config`，然后才查业务表 |
| Worker | `ClaimJob` | `ai.job.claim` + capability | `zhixue_ai_ingress` | `UPDATE` 当前 job 的租约列；`INSERT` execution_attempt | 先 `resolve_work_route`，再 `set_config` |
| Worker | `ReadJobInput` | `ai.job.read_input` | 同上 | `SELECT` 冻结槽位、页、标准答案。无学生姓名列权限 | 同上，且 job 已是该 attempt 当前租约 |
| Worker | `RenewLease` | `ai.job.renew` | 同上 | `UPDATE` 自己的 `lease_until` | 同上 |
| Worker | `PrepareInvocation` | `ai.job.prepare_invocation` | 同上 | `INSERT` invocation intent | 同上。提交后才允许外部 HTTP |
| Worker | `AcceptGradeResult` / `AcceptRecognition` / `AcceptValidation` | `ai.result.accept` | 同上 | 按协调者插入 proposal 或答案修订、完成 attempt。**无** `score_versions` / `score_drafts` 的 `INSERT` 与 `UPDATE` | 同上 |
| Relay | 领取 outbox | relay 进程凭据 | `zhixue_relay` | 执行 `claim_outbox_ids`；随后按返回的 tenant `set_config`，只 `UPDATE` 该租户 outbox 的投递列 | 索引函数返回 `event_id, tenant_id`，不含 payload |
| Reconciler | 过期租约与 unknown 调用 | reconciler 凭据 | `zhixue_reconciler` | 索引上的到期行；进入租户后只改 job/invocation 的恢复列 | 与 relay 相同，逐 job 建立上下文 |
| Scheduler | 公平领取 | scheduler 凭据 | `zhixue_scheduler` | `SELECT` 就绪索引；`UPDATE` admission 列 | 轮转选中的 tenant 写入 `set_config` 后再改 job |
| 平台运营 | 看租户与用量 | 平台角色 | `zhixue_platform_ops` | `tenants`、订阅、用量汇总列。无答卷与成绩表的任何权限 | 不设置学校 tenant。没有个人表 GRANT，RLS 策略也帮不上越权读 |
| 限时个人只读 | 读一所学校的个人记录 | 未过期 `platform_personal_data_access` | `zhixue_app`，`access_mode=platform_grant` | 个人表 `SELECT`。`WITH CHECK` 仍要求 `access_mode=member`，故不能发布或改分 | 应用先校验授权行，再把 `app.tenant_id` 设为 `target_tenant_id` |
| 发布 | `PublishScoreVersion` / `RepublishRevision` | 教师数据范围仍有效 | `zhixue_app` | `INSERT` 正式成绩与指针事件；`UPDATE` 仅指针列与草稿状态 | 成员 tenant。AI 角色调用在入口拒绝，数据库层也无插入权 |
| 迁移 | DDL | 运维身份 | `zhixue_migrator` | DDL，`BYPASSRLS` | 不在应用、Worker、relay、reconciler、scheduler 的连接池中 |

`FORCE ROW LEVEL SECURITY` 仍加在租户业务表上。控制索引表不用 RLS，用函数与列级/表级权限代替，因为它们的风险是枚举路由而不是混读答卷。

## 3. 无上下文推演

| 场景 | 结果 |
|---|---|
| Worker 只有 job UUID、没有 capability | `resolve_work_route` 空结果；不 `set_config`；业务查询无行；job 状态不变 |
| Worker capability 正确 | 得到 tenant；后续 RLS 只看见该租户 |
| Relay 一次搬运两个租户 | 每个 event 单独事务、单独 `set_config`；不在一个事务里关掉 RLS |
| 平台运营日常请求学生成绩 | 角色无表权限，失败。不是只靠策略 |
| 限时授权读 | `zhixue_app` + grant 行 + `platform_grant` 可读不可写 |
| AI 角色执行发布 | 无 `score_versions` 插入权限，语句失败 |
| 后台借用 migrator | 连接配置不允许；设计上没有这条路径 |

这些是设计推演，不是已运行测试。
