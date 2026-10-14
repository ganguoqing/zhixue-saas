# 授权矩阵 v2（含 v3 控制面，Proposed，2026-10-12）

包编号 ZX-DES-20261012-02，补丁 ZX-DES-20261012-03。ADR-001/003 仍为 Proposed。改前快照在 `docs/architecture/snapshots/zx-des-20261012-02/authorization-matrix-v2.md`。

## 0. 索引与 capability

`ScheduleJob` 与 `AppendOutbox` 在业务行提交的同一事务写入 `work_route_index` 或 `outbox_dispatch_index`。取消、过期和 `ReissueCapability` 也在同一事务把旧索引行 `revoked_at` 写上。事务回滚则索引与业务一起消失。

capability 是 32 字节 CSPRNG 秘密。索引只存 `sha256(env || job_id || secret)`。哈希不能还原秘密。秘密只随队列消息返回一次，不进日志。`env` 不同则哈希不同。`not_after` 到期或 `revoked_at` 非空则 `resolve_work_route` 返回空。

Redis 清空后，`zhixue_reconciler` 调用 `ReissueCapability`：锁定未终态 job，撤销旧哈希，签发新秘密并重新入队。旧秘密在撤销提交后失效。已 `succeeded` 或 `cancelled` 的 job 不重发。

函数在迁移事务内创建，`SET search_path = pg_catalog`，函数体使用限定名。同一事务 `REVOKE ALL ON FUNCTION ... FROM PUBLIC`，再 `GRANT EXECUTE` 给下表中的角色。临时 schema 不在 search_path 中。函数不读取 JWT；NestJS 先检查 scope，数据库再检查 `current_user` 与 capability 哈希。

`read_outbox_payload(event_id)` 由 `zhixue_relay` 在 `set_config('app.tenant_id')` 之后调用。它不是 BYPASSRLS。`zhixue_relay` 对 `outbox_events` 只有事件列的 SELECT，RLS 要求 tenant 匹配。没有学生正文表的 GRANT。

平台汇总不设置学校 tenant。`zhixue_platform_ops` 只被授予 `ops_usage_totals`。该视图在 `access_mode=platform_aggregate` 时按租户汇总金额，列只有 `tenant_id`、周期、资源类型和合计。个人表没有授予该角色。限时个人读仍走 `zhixue_app` 与 grant 行，并设置 `app.tenant_id`。

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
| Relay | 领取并投递 | relay 进程凭据 | `zhixue_relay` | `claim_outbox_ids`；`set_config` 后 `EXECUTE read_outbox_payload`；只 `UPDATE` 投递列 | 索引返回 `event_id, tenant_id`。载荷只在 tenant 建立后按 RLS 读取 |
| Reconciler | 过期租约与 unknown 调用 | reconciler 凭据 | `zhixue_reconciler` | 索引上的到期行；进入租户后只改 job/invocation 的恢复列 | 与 relay 相同，逐 job 建立上下文 |
| Scheduler | 公平领取 | scheduler 凭据 | `zhixue_scheduler` | `SELECT` 就绪索引；`UPDATE` admission 列 | 轮转选中的 tenant 写入 `set_config` 后再改 job |
| 平台运营 | 看租户与用量合计 | 平台角色 | `zhixue_platform_ops` | `EXECUTE` 不需要。`SELECT ops_usage_totals`。无个人表 GRANT | `access_mode=platform_aggregate`。不读租户 RLS 明细 |
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
