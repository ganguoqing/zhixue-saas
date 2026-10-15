# M0 G1-01–10 修复响应 v2

对照 ZX-AR-20261014-01。实现仍在已接受的 M0 范围和 v5 保守政策内。没有把 ADR 标成 Accepted，没有宣布 G1 或 M1 通过。运行细节见 `m0-g1-evidence-v2.md`。

## G1-01 校内写授权

修改：`apps/api/src/store.ts` 的 `assertScope` 现在核对未撤权的 membership，以及 `action`、班级、学科。定稿的幂等重放先做这次检查。成功、最终失败、异常复核和待结算上的 cancel 返回 409，错误文本是当前状态。手工恢复先返回已有草稿，并用 `(tenant_id, job_id)` 唯一约束挡住并发第二份。

这次跑到的反例：同校无范围读取和取消都是 403；成功任务取消是 409，正文 `succeeded`。

未跑：撤权后的旧令牌、定稿重放被拒绝、并发手工恢复只有一行。

## G1-02 发送许可

修改：`issueSendPermit` 在当前 attempt、租约、期限和预算都成立时，把 `send_state` 从 `not_sent` 改成 `send_unknown` 并增加 `send_permit_epoch`。Worker 在这个提交之后才调用推理。超时不再补一次发送，也不再由 Worker 自己停放。`supervisor.ts` 在超过 `UNKNOWN_ESCALATE_AFTER_SECONDS` 后调用停放。

这次跑到的反例：付费 mock 设置了延迟，Worker 日志出现 `provider_timeout`，随后任务状态是 `awaiting_settlement`。

未跑：intent 后、许可后、HTTP 后、observation 前逐一杀死进程；两个恢复者竞争；超预算签发被拒绝。

## G1-03 调用来源

修改：接纳要求信封里的 job、attempt、generation、epoch、lease、input hash 与外层一致，并且 invocation 属于该 job 和 attempt，`send_permit_epoch >= 1`，配置哈希与绑定匹配。结算和放弃的更新带上 `job_id`。没有 `ResumeAfterSettlement`。

这次跑到的反例：令牌里的 attempt 与请求不一致时为 403。

未跑：不存在的 invocation、同租户另一任务、控制字段不一致、错配置。这些路径已写进接纳代码，但这次测试没有打到它们。

## G1-04 推理结果

修改：Worker 读取 HTTP 状态和 JSON。校验任务只有 provider 返回 `outcome=accepted` 且哈希一致才接受。评分任务用冻结题目构造信封。语义检查题目集合、分值合计、rubric、证据资产、页码、bbox 顺序和 span。失败不写 `score_versions`。

这次跑到的正例：两条校验任务出现 `accepted job_id=...`。付费超时没有被当成成功。

未跑：500、坏 JSON、重复题、缺题、分值不符、反向 bbox、300 项里由 provider 失败产生的 5 项重跑。

## G1-05 自动推进

修改：`apps/api/src/supervisor.ts` 循环执行接纳、重发、relay、过期排队失败、过期 admission 释放和 unknown 停放。接纳按 `admit_cursor` 轮转。BullMQ 任务若已是 completed 或 failed，不再因为 ID 还在就跳过重发。过期且没有 `send_unknown` 的接管由 reconciler 进程直接执行，Worker 不再签发 reconciler 令牌。

这次跑到的行为：成功校验和超时停放都没有手调修复接口。

未跑：默认 cap 下第三项自动完成、多租户轮转、Redis 丢失、queued 期限耗尽、两个恢复者。

## G1-06 对象清扫

修改：定稿先提交 `upload_sessions`，文件写在 `incoming/`，再把会话标成 `committing` 并写下最终键，然后才写入最终路径和业务行。清扫调用 `zhixue_ctl.object_is_live`，跳过未过期上传、committing、finalized 和已有资产。删除前再查一次。

未跑：与定稿并发的清扫。不能把这次记录说成清扫已经安全。

## G1-07 外键

修改：`db/migrations/0003_g1_controls.sql` 为 attempt、当前 attempt、invocation、账本、proposal、revision 和 draft 增加复合外键。draft 的触发器核对 `NEW.revision_id`。

这次跑到的反例：ingress 插入指向不存在 job 的 attempt，`COMMIT` 时返回 `23503`。

未跑：跨租户、同租户别的 job、错误 revision，以及 R5-02 的 `validate_asset` 带 binding、`model_grade` 不带 binding。

## G1-08 服务身份

修改：`apps/api/src/service-auth.ts`。Worker、reconciler、scheduler、relay、billing 各有密钥、issuer 和 subject。令牌必须有 `exp` 和 `jti`。`jti` 写入 `zhixue_ctl.used_jti`。命令点名的 job、attempt 必须与令牌一致。

这次跑到的反例：同一令牌第二次 claim 为 401；用 Worker 密钥签发 `ai.billing.settle` 为 403。

未跑：缺 exp、错 issuer、合法新 jti 的幂等重试不产生第二笔账。

## G1-09 模块端口与 Outbox

修改：relay 在同一事务写入 `asset_notices` 和 `consumer_inbox`，然后才把 dispatch 标成 delivered。过期租约会回到 pending。公开写入仍由 store 在一个事务里调用，没有为了拆进程去实现 M1–M3。

未跑：杀死 relay 的领取、入队、ACK、consumer commit 窗口。这次测试没有查询 `asset_notices`。

## G1-10 可复现

修改：`scripts/migrate.mjs` 在 advisory lock 内再次检查版本。`scripts/run-g1.mjs` 拒绝非 `zhixue_m0_g1*` 库。CI 工作流的 npm 安装改为 `npm ci`。Compose 库名改为 `zhixue_m0_g1compose`，避免重置共享库名。

这次实际执行的是本机 PostgreSQL 17.11 和 Redis 7.4.2 DB 2。Docker 守护进程没有起来，所以 PostgreSQL 16.10 剖面没有跑。CI 没有跑。有样例数据的备份恢复没有跑。

授权试卷和标准答案仍不在仓库里。没有 PoC。请独立 QA 和 Architecture Review Agent 按本响应复验，不要把本文件当成 G1 通过。
