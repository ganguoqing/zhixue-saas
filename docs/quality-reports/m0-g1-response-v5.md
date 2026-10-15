# M0 G1 修复响应 v5

日期：2026-10-14。对照 ZX-AR-20261014-04。G1 仍是 No-Go。这次只修已授权 M0 窄切片里的 V4-01 到 V4-03，并记录 V4-04 的外部缺口。没有实现完整阅卷、真实学生接入或生产部署，没有把 ADR 标成 Accepted，没有关闭 F01–F28。

旧轮次文档保留。0001–0006 没有覆写。新约束在 `db/migrations/0007_g1_v4_delivery_guard.sql`。

## G1-V4-01–04

| ID | 实现 | 开发者实测 | 独立复验 | 后续 |
|---|---|---|---|---|
| G1-V4-01 | 追加迁移显式 `ENABLE ROW LEVEL SECURITY` 和 `FORCE`。ingress / reconciler 仍只有本租户 USING / WITH CHECK。跨租户扫描继续走 `zhixue_ctl.list_open_deliveries`，不给运行角色 `BYPASSRLS` | `var/runs/1791977980126` 的 `delivery_rls_fk`。B 和无上下文读到的 A 凭据行数为 0，B 更新 A 的行数为 0。目录 `relrowsecurity` 与 `relforcerowsecurity` 都是 true。owner / router 的 `rolbypassrls=false`。同一运行里的 claim、接管、observed 和 Redis 恢复通过 | not_run | — |
| G1-V4-02 | 同租户 `(tenant_id, job_id)`、`(tenant_id, job_id, attempt_id)` 和带 epoch 的复合外键；`fencing_epoch >= 1`、`generation >= 1`。写入时再核对 stage、billable、generation、input hash 与当前 job/attempt。升级前若发现不一致行，0007 直接失败，不删除这些行 | 不存在的父行、挂到另一个作业、epoch/generation 0、用 B 引用 A 的父行都被拒绝。正常初始 claim 和接管通过。`zhixue_m0_g1v5bad` 上的不一致行在 0007 失败后仍然存在 | not_run | — |
| G1-V4-03 | `scripts/restore-isolated.mjs` 用 `zhixue_bootstrap` 创建空库并不带 `--no-owner` 恢复。随后执行未改写的迁移文件，保留其中的 `SET ROLE`。只有 `pgcrypto` 的 COMMENT 权限差异可以放行，其它恢复错误失败。`ZHIXUE_PRESERVE_ROLE_PASSWORDS=1` 时，已有角色不再被改密码 | 0004 合成数据先原样升到 0007。另一条路径 dump/restore 后再原样执行 0005–0007。行哈希还在，表属主是 `zhixue_owner`，四个定义者函数属主是 `zhixue_owner` 且 `rolbypassrls=false`，迁移版本含 0007。缺失 dump 使恢复命令失败。恢复库上的 Worker 窄链得到 1 条 proposal、0 条正式分。恢复说明在 `docs/operations/m0-restore.md` | not_run | — |
| G1-V4-04 | 没有改 G1 的部署和 PoC 条款。授权缺口写在 `docs/quality-reports/m0-poc-authorization-checklist.md` | 本机 PostgreSQL 17.11、Python 3.14.4、Redis 7.4.2 的隔离套件退出码 0。`docker info` 失败，Compose 的 PostgreSQL 16.10 和 CI 的 Python 3.12 没有跑。授权试卷、标准答案和允许的模型端点仍未提供 | not_run | 项目负责人提供样本、端点和人工验收；环境执行者提供 Docker 与 CI |

## 纳入回归的已通过行为

同一次 `var/runs/1791977980126` 还断言了：原生 Worker `model_grade` 的 1 条 proposal、预算扣减和 0 条正式分；provider 500、坏 JSON、非法 UUID、缺保存结果和 deadline；两种 SIGKILL 接管；unknown 不二次调用；observed 只用已有结果；同作业双接管 201/409；入队后 ACK 前中断再由两次 reconcile 保住同一个 dispatch，provider 只调用一次；清扫与 finalize 竞争后原件仍可下载；PDF/PNG/JPEG 哈希和授权拒绝；先插入真实 pending 事件再让 relay 回滚，notice/inbox 为 0，重放后各为 1 且 delivered；同一个 Pool backend PID 的 A、B、无上下文，以及 16 个并发请求。重复计分、小数、环境白名单、jti、默认 cap 和 300 项 295/5 仍在。

## 不能当成 G1 Go

退出码 0 只说明这次开发者套件的断言通过。独立复验尚未填写。Compose、CI 和授权 PoC 仍缺。
