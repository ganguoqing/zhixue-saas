# 授权矩阵 v2（含 v3 控制面，Proposed，2026-10-12）

包编号 ZX-DES-20261012-02。v3 补丁 ZX-DES-20261012-03。v4 补丁 ZX-DES-20261012-04：执行身份、待投递行、发布 EXECUTE。ADR 仍为 Proposed。v4 改前快照在 `docs/architecture/snapshots/zx-des-20261012-03/`。

## 0. 索引与 capability

`ScheduleJob` 与 `AppendOutbox` 在业务行提交的同一事务写入 `work_route_index` 或 `outbox_dispatch_index`。取消、过期和 `ReissueCapability` 也在同一事务把旧索引行 `revoked_at` 写上。事务回滚则索引与业务一起消失。

capability 是 32 字节 CSPRNG 秘密。索引只存 `sha256(env || job_id || secret)`。哈希不能还原秘密。秘密只随队列消息返回一次，不进日志。`env` 不同则哈希不同。`not_after` 到期或 `revoked_at` 非空则 `resolve_work_route` 返回空。

连接池按服务使用固定登录角色，不执行 `SET ROLE`。因此函数外 `session_user` 与 `current_user` 都是该登录角色。`resolve_work_route` 是 `SECURITY DEFINER`，所有者是 `zhixue_router`。函数体内的 `current_user` 是 `zhixue_router`，不能用来识别调用者。数据库不读取载荷里的角色名。访问边界是 `EXECUTE` 授权，加上函数体内对 capability 哈希、`env`、`not_after` 和 `revoked_at` 的检查。NestJS 在发起 SQL 之前检查 scope。

`zhixue_ai_ingress` 与 `zhixue_reconciler` 有 `EXECUTE`。`zhixue_app` 没有，调用在进入函数前失败，函数内身份不会出现。

PostgreSQL 在 `search_path` 没有点名 `pg_temp` 时，仍会把会话临时 schema 放在查找最前。因此函数配置是 `search_path = pg_catalog, pg_temp`，临时 schema 显式排在最后。函数体只写 `zhixue_ctl.work_route_index` 这类限定名，限定名不走 `search_path`。创建函数的同一迁移事务执行 `REVOKE ALL ON FUNCTION resolve_work_route(uuid, text) FROM PUBLIC`，再授予上面两个角色。函数所有者没有 `BYPASSRLS`。普通后台不使用 `zhixue_migrator`。

`ReissueCapability` 的数据库提交和 Redis 入队不是一个事务。数据库事务撤销旧哈希，写入新哈希，并插入 `capability_dispatches.state=pending_enqueue`。秘密只留在进程内存，不入库、不进日志。入队成功后的另一个事务把该行改为 `acked`。进程在入队前死亡时，恢复者只能看见 `pending_enqueue`，不能从哈希还原秘密。它再次执行 `ReissueCapability`：撤销尚未投递的哈希，签发新秘密，留下新的待投递行。Redis 里若已有旧秘密但 ACK 未提交，该哈希会在下一次签发时被撤销，旧秘密解析为空。已 `succeeded` 或 `cancelled` 的 job 不重发。

`read_outbox_payload(event_id)` 由 `zhixue_relay` 在 `set_config('app.tenant_id')` 之后调用。它不是 BYPASSRLS。`zhixue_relay` 对 `outbox_events` 只有事件列的 SELECT，RLS 要求 tenant 匹配。没有学生正文表的 GRANT。

平台汇总不设置学校 tenant。`zhixue_platform_ops` 只被授予 `ops_usage_totals`。该视图在 `access_mode=platform_aggregate` 时按租户汇总金额，列只有 `tenant_id`、周期、资源类型和合计。个人表没有授予该角色。限时个人读仍走 `zhixue_app` 与 grant 行，并设置 `app.tenant_id`。

## 1. 循环怎么解开

队列载荷只有 `job_id`、`env` 和 `capability`（随机秘密，不是租户）。租户业务表开启 RLS 且无上下文时不可读。

控制表 `work_route_index`、`outbox_dispatch_index` **不放答卷、姓名或分数**。它们不启用 RLS。`zhixue_app` 与 Worker 角色没有这两张表的 `SELECT`。

`zhixue_router` 拥有这两张表，**没有** `BYPASSRLS`，也不是 migrator。它只通过 `SECURITY DEFINER` 函数向外提供最小结果。函数固定 `search_path`。

`resolve_work_route(job_id, capability)`：

1. 调用者已经通过服务凭据认证，且本请求的 scope 允许解析。
2. 调用能进入函数，只说明登录角色拥有 `EXECUTE`。函数内的 `current_user` 是 `zhixue_router`。返回 tenant 还要求 capability 哈希、环境与期限匹配。
3. job 不存在和 capability 错误返回同一种空结果，避免枚举。
4. 写一条不含载荷的拒绝或成功审计。
5. 调用者然后在**自己的**事务里 `set_config('app.tenant_id', ..., true)`，再以 RLS 读取业务行。

常规后台不得使用 `zhixue_migrator`。

## 2. 身份路径

| 身份 | 内部动作 | 能力 / scope | 数据库角色 | 可写或可读 | tenant 如何建立 |
|---|---|---|---|---|---|
| 学校用户会话 | 业务命令 | 成员 + 数据范围 | `zhixue_app` | 该命令允许的业务表。对 `score_versions` 与 `score_version_items` 没有 INSERT | 会话里的 membership。先认证再 `set_config` |
| Worker | `ClaimJob` | `ai.job.claim` + capability | `zhixue_ai_ingress` | `UPDATE` 当前 job 的租约列；`INSERT` execution_attempt | 先 `resolve_work_route`，再 `set_config` |
| Worker | `ReadJobInput` | `ai.job.read_input` | 同上 | `SELECT` 冻结槽位、页、标准答案。无学生姓名列权限 | 同上，且 job 已是该 attempt 当前租约 |
| Worker | `RenewLease` | `ai.job.renew` | 同上 | `UPDATE` 自己的 `lease_until` | 同上 |
| Worker | `PrepareInvocation` | `ai.job.prepare_invocation` | 同上 | `INSERT` invocation，`send_state=not_sent` | 同上。此命令提交后仍不能发 HTTP |
| Worker | `IssueSendPermit` | `ai.job.issue_send_permit` | 同上 | 把 `send_state` 改为 `send_unknown` | 只有这个命令提交后才允许 HTTP |
| Worker | `RecordInvocationObservation` | `ai.invocation.observe` | 同上 | `INSERT` observation，绑定原 invocation | 响应已到但本命令未提交时，状态仍是 `send_unknown` |
| Worker 或 reconciler | `RecordSettlement` | `ai.billing.settle` | ingress 自动确认；`zhixue_reconciler` 人工对账 | 按结算唯一键插入账本。不改 `job.status`，不插入 proposal | 相同键与 body 不第二次插入 |
| Worker | `AcceptGradeResult` / `AcceptRecognition` / `AcceptValidation` | `ai.result.accept` | 同上 | 按协调者插入 proposal 或答案修订、完成 attempt。**无** `score_versions` / `score_drafts` 的 `INSERT` 与 `UPDATE` | 同上 |
| Relay | 领取并投递 | relay 进程凭据 | `zhixue_relay` | `claim_outbox_ids`；`set_config` 后 `EXECUTE read_outbox_payload`；只 `UPDATE` 投递列 | 索引返回 `event_id, tenant_id`。载荷只在 tenant 建立后按 RLS 读取 |
| Reconciler | 过期租约与 unknown 调用 | reconciler 凭据 | `zhixue_reconciler` | 索引上的到期行；进入租户后只改 job/invocation 的恢复列 | 与 relay 相同，逐 job 建立上下文 |
| Scheduler | 公平领取 | scheduler 凭据 | `zhixue_scheduler` | `SELECT` 就绪索引；`UPDATE` admission 列 | 轮转选中的 tenant 写入 `set_config` 后再改 job |
| 平台运营 | 看租户与用量合计 | 平台角色 | `zhixue_platform_ops` | `EXECUTE` 不需要。`SELECT ops_usage_totals`。无个人表 GRANT | `access_mode=platform_aggregate`。不读租户 RLS 明细 |
| 限时个人只读 | 读一所学校的个人记录 | 未过期 `platform_personal_data_access` | `zhixue_app`，`access_mode=platform_grant` | 个人表 `SELECT`。`WITH CHECK` 仍要求 `access_mode=member`，故不能发布或改分 | 应用先校验授权行，再把 `app.tenant_id` 设为 `target_tenant_id` |
| 发布 | `PublishScoreVersion` / `RepublishRevision` | 教师数据范围仍有效 | `zhixue_app` | 只有 `EXECUTE publish_score_version`。函数所有者插入正式行、封存、指针和 fence。调用者没有这些表的 INSERT | 成员 tenant。`zhixue_ai_ingress` 与 `zhixue_platform_ops` 没有该函数的 EXECUTE |
| 分析消费 | `LockAnalysisFence` 然后 `ApplyProjection` | 消费进程凭据 | `zhixue_mastery` | `EXECUTE LockAnalysisFence`：锁定并返回 epoch 与 `evidence_head_hash`，不更新 fence。可写 `analysis_current` 与 inbox | 先按事件 tenant `set_config`。不能改成绩，不能增加 fence epoch |
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
