# M0 G1 证据 v4

这是开发者本地证据。独立复验未做。退出码 0 只说明这次隔离套件没有断言失败。

## 运行

| 项 | 值 |
|---|---|
| 目录 | `var/runs/1791973007411` |
| 命令 | `ZHIXUE_PROFILE=local node scripts/run-isolated.mjs` |
| 开始 | 2026-10-14T10:16:47.412Z |
| 结束 | 2026-10-14T10:17:14.347Z |
| 退出码 | 0 |
| HEAD | `e302221`（工作区另有未提交修复） |
| Node | v24.15.0 |
| Python | 3.14.4 |
| PostgreSQL | 17.11 Homebrew |
| Redis | 7.4.2，DB 2 |
| 数据库 | `zhixue_m0_g1v3` |
| 队列前缀 | `zhixue-g1-1791973007411` |
| 对象根 | `var/runs/1791973007411/objects` |
| Docker | `docker info` 失败，Compose 与 CI 未执行 |

`command.txt`、`g1-results.json`、`api.log`、`worker.log`、`infer-count.txt` 和 `upgrade.dump` 在该目录。`pg_restore` 有一条被忽略的错误：恢复角色不能给已存在的 `pgcrypto` 写 COMMENT。数据行和随后的 0006 仍完成。

## 哈希

| 文件 | sha256 |
|---|---|
| `apps/worker/worker.py` | `01c1f8e13ca6d5b35c90add54afac6ffa1c322c62ec54d0ae4aa5c827bc657af` |
| `apps/api/src/store.ts` | `367bf034efa40cab215a6ddecb36429dbe1814426d5f09c04f9e9bff78f691ca` |
| `apps/api/src/http.ts` | `e049c2e064625bcefb5b7352afe414e8bb91d24c6695639fc562c010803fbbf7` |
| `db/migrations/0005_g1_v3_status.sql` | `f53e84f8d1797166a0fb94049d5804d8716dc796a29de97dfeabd711b7f3f7ee` |
| `db/migrations/0006_g1_v3_delivery.sql` | `29c0f87ec2afa245fed3833197a5943732007d598147a3651220b727001c977b` |
| `tests/m0/g1-v4-flows.mjs` | `177564e974297f28c2c1af0ea673c1b3ae29af0b1078c89c16ed6392d1ae00eb` |

## 结果摘录

- `worker_model_grade`：`succeeded`，proposal 1，当时预算 998，正式分在前一步已是 0。
- `stage_provider_http` / `stage_bad_json` / `stage_schema_rejected`：均为 `exception_review`，推理计数 1。
- `stage_failure_receipt`：回放为真，冲突 409，旧租约 409。
- `deadline_release`：`failed_final`。
- `schema_corpus`：Python fresh/observed 为真，非法 UUID 为假；Ajv 同样拒绝。
- `png_download` / `jpeg_download` / `binary_download`：哈希一致。
- `download_auth`：跨校 404，跨班 403，撤权 403。
- `model_grade_takeover`：epoch 2，proposal 1。
- `validate_takeover`：`succeeded`，阶段仍是校验。
- `permit_kill_no_second_call`：推理 0。`http_kill_no_second_call` 与 `observed_resume`：推理 1。
- `redis_loss_rebuild`：`succeeded`。
- `sweep_finalize_race`：文件保留。`two_sweepers`：孤儿已删除。
- `default_cap`：占用 2，第三项 `enqueued=false`。
- `batch_300`：失败 5，成功 295，只重跑这 5 个并成功。失败内容带 `SYNTHETIC_PROVIDER_FAULT`。
- `dump_restore_upgrade`：恢复后的旧行 `result_status=provider_http`，且 `zhixue.delivery_intents` 存在。
- `definer_owner`：三个定义者函数属主 `zhixue_owner`，`rolbypassrls=false`。
- `rls_pool`：租户 A 10 行，租户 B 1 行，无上下文 0 行。

## 隔离边界

重置、删键和 trigger 只发生在 `zhixue_m0_g1v3`、Redis DB 2 的 `zhixue-g1-1791973007411` 前缀，以及本轮对象目录。升级用过又删除的库是 `zhixue_m0_g1v4up` 和 `zhixue_m0_g1v4re`。恢复时使用 `--no-owner`，因此在那两个临时库上应用 0006 时去掉了 `SET ROLE`，由当时拥有对象的 migrator 执行。空库主路径仍由 `scripts/migrate.mjs` 按原文件执行，包含 `SET ROLE zhixue_owner`。没有修改共享角色密码，没有动 `zhixue_m0` 和 Redis DB 0。

## 未跑

- Docker Compose 与 GitHub Actions。
- 两个恢复者同时对同一作业调用接管。
- 授权真实试卷、标准答案和质量 PoC。没有使用真实学生数据，也没有伪造分数质量结论。
