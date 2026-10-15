# M0 G1 证据 v5

开发者本地证据。独立复验未做。退出码 0 不是 G1 Go。

## 运行

| 项 | 值 |
|---|---|
| 目录 | `var/runs/1791977980126` |
| 命令 | `ZHIXUE_PROFILE=local node scripts/run-isolated.mjs` |
| 开始 | 2026-10-14T11:39:40.129Z |
| 结束 | 2026-10-14T11:40:16.083Z |
| 退出码 | 0 |
| 测试 | 3 项，pass 3 |
| HEAD | `e302221c5f7b8e81274dab1d5f02b2145dc0d3b9` |
| 工作区 | 有未提交和未跟踪源码。下面的哈希才是这次实际文件 |
| Node | v24.15.0 |
| Python | 3.14.4 |
| PostgreSQL | 17.11 Homebrew，端口 5432 |
| Redis | 7.4.2，DB 2 |
| 主库 | `zhixue_m0_g1v3` |
| 队列前缀 | `zhixue-g1-1791977980126` |
| 升级 / 恢复库 | `zhixue_m0_g1v5up`、`zhixue_m0_g1v5src`、`zhixue_m0_g1v5re`、`zhixue_m0_g1v5bad`，结束后删除 |
| Docker | `docker info` 失败 |

`command.txt`、`g1-results.json`、`api.log`、`worker.log` 和 `restore.log` 在该运行目录。恢复命令接受了 `zhixue_m0_g1v5re`，exit 0。故意使用不存在的 dump 时，`scripts/restore-isolated.mjs` 以非 0 退出。

## 本次文件哈希

| 文件 | sha256 |
|---|---|
| `db/migrations/0007_g1_v4_delivery_guard.sql` | `70dfcdbe1f3be062ddea7479f5c06dacb5524949b0c26ea2260e92a4349e26a7` |
| `scripts/restore-isolated.mjs` | `a11fe3f8da7caed8091c79aeb87226a4b3c64bbd05ec234e10659eec44c87e00` |
| `scripts/migrate.mjs` | `110a299ff3995467a5b16ea4b45f4063033021bd20efd3764559bdad5dc6174b` |
| `scripts/run-isolated.mjs` | `b8e57e277f52ff0d39917eefa67d98012ef5f4c18f52b81b5ac17fba14e469ea` |
| `tests/m0/g1-v4-flows.mjs` | `64355a2ff43960755380c3cd2b0125f7f7c5233bec240f16b44fce6d95ede304` |
| `tests/m0/g1-v5-restore.test.mjs` | `316c308f137f73232c119cb3bb1c50f5bb26ea54e36ea8a2921a68dee7ff0fda` |
| `apps/api/src/main.ts` | `e1021a258fd12afa2a5338a9c77c287200b893b2e3bc887110dda3d63a9d747d` |
| `apps/worker/worker.py` | `01c1f8e13ca6d5b35c90add54afac6ffa1c322c62ec54d0ae4aa5c827bc657af` |

## 结果

- `delivery_rls_fk`：enabled true。测试断言 B 和无上下文的 token 计数为 0，跨租户 UPDATE 行数为 0。
- `dual_takeover`：HTTP 状态 `[201, 409]`，proposal 1。测试同时断言 admission、invocation、proposal 和 provider 调用都是 1。
- `ack_interrupt`：状态 `acked`，调用 1 次。两次 reconcile 后的 dispatch 与中断前相同。
- `relay_once`：先有真实 pending 事件；回滚后 notice/inbox 为 0 且状态仍是 pending；重放后为 delivered。
- `rls_pool`：backend PID `55719` 复用，计数 `[10, 1, 0]`，16 个并发请求。
- `model_grade_takeover` epoch 2；`observed_resume` 调用 1 次；`permit_kill_no_second_call` 调用 0 次。
- `batch_300`：失败 5，成功 295，重跑 5。
- 恢复库上的窄链在测试里断言 `succeeded`、1 条 proposal、0 条 `score_versions`。
- 0007 在 `zhixue_m0_g1v5bad` 因 1 条不一致 intent 失败，该行的 `lease_token` 仍可查到。

## harness

`scripts/run-isolated.mjs` 设置 `ZHIXUE_PRESERVE_ROLE_PASSWORDS=1`。角色已存在时，`scripts/migrate.mjs` 不再执行 `ALTER ROLE ... PASSWORD`。这是为了遵守不改共享角色密码。新角色第一次创建仍会设置开发密码。

恢复入口不删除迁移文件中的 `SET ROLE`，也不使用 `--no-owner`。允许的唯一恢复差异是 `must be owner of extension pgcrypto` 且命令为 `COMMENT ON EXTENSION pgcrypto`。

## 未跑

- Docker Compose 的 PostgreSQL 16.10。
- GitHub Actions 的 Python 3.12。
- 负责人授权的试卷、标准答案、模型端点和人工验收。

没有使用真实学生数据，没有编造质量指标。
