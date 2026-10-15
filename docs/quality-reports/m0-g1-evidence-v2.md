# M0 G1 修复运行记录 v2

**日期：** 2026-10-14  
**结论：** 这是一次隔离库上的开发者运行记录。它不宣布 G1 通过，不把 Findings 标成 Closed 或 Verified，也不把学校阅卷质量说成已验证。V1 记录 `m0-g1-evidence.md` 保持不动。

## 被测源码

工作区当时的 HEAD 是 `e302221c5f7b8e81274dab1d5f02b2145dc0d3b9`。G1 修复还没有单独提交，测试跑的是工作区文件。关键文件 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `package-lock.json` | `a3333347108f4114b0874d7cfafa3e57a393dbe7eee66a6c5cc2e7fe7a0c59ad` |
| `apps/api/src/store.ts` | `0f7cc643fc84aea9c0d4e959a8d3fe0ae5e8c286da6682386d08c51ab36624d2` |
| `apps/worker/worker.py` | `acf8a8baca985a8c6fd2eb8c08fa792191ec95864b9d2865b885a2310750a25c` |
| `db/migrations/0003_g1_controls.sql` | `ca0b7a3df12948727948cac3a740d638ccf35c6fd1ef45968c27eb7f800ed2cd` |
| `apps/api/src/service-auth.ts` | `d0fa9b7a99e55e4a2d24d581792775790f6456e813e85421a1cb9ea050cc75b5` |
| `apps/api/src/supervisor.ts` | `2d38b719530390035c70443a1f96907122f5b782e619e99628fed66912b95f98` |

## 命令

没有对共享库 `zhixue_m0` 执行 reset，也没有对 Redis DB 0 执行 `FLUSHDB`。对象目录是 `var/g1-objects`。

```bash
node scripts/run-g1.mjs
```

该脚本创建或重置隔离库 `zhixue_m0_g1v2`，只删除 Redis DB 2 里前缀 `zhixue-g1v2:` 的键，然后迁移、种子、构建并运行 `tests/m0/g1.integration.test.mjs`。

结果：1 项通过，0 项失败，约 2113 ms。原始日志在 `var/g1-logs/`：`api.log`、`worker.log`、`supervisor.log`、`g1-results.json`。下面是结果文件原文：

```json
[
  { "name": "out_of_scope", "read": 403, "cancel": 403 },
  { "name": "terminal_cancel", "status": 409, "error": "succeeded" },
  { "name": "forged_accept_without_attempt", "status": 403 },
  { "name": "jti_reuse", "first": 404, "second": 401 },
  { "name": "worker_cannot_bill", "status": 403 },
  { "name": "fk_missing_job", "rejected": true },
  { "name": "unknown_auto_park", "status": "awaiting_settlement" }
]
```

Worker 日志里这次成功路径有：

```text
accepted job_id=51327c42-a73b-41e6-85df-dd7c10d5cac7
accepted job_id=12549a62-3da7-4fbe-8f6f-04127d9e2de6
provider_timeout job_id=defd69b5-2c9d-4a85-9906-760ebc9dcaa0
```

超时之后，测试读到的任务状态是 `awaiting_settlement`。测试进程没有调用 `/internal/reconcile`。

## 版本

| 组件 | 这次运行 |
|---|---|
| Node.js | v24.15.0 |
| Python | 3.14.4（`.venv`） |
| PostgreSQL | 17.11 Homebrew，库 `zhixue_m0_g1v2`，端口 5432 |
| Redis | 7.4.2，DB 2，前缀 `zhixue-g1v2` |
| API / supervisor | 工作区 `apps/api/dist` |
| 推理 | FastAPI mock，`mock://local` |

## 没有跑

- `docker info` 失败，Docker 守护进程没启动。因此没有跑 Compose 里的 PostgreSQL 16.10。
- GitHub Actions 工作流没有在本机执行。工作流已改为 `npm ci`，但仍未实际跑过。
- 没有有数据的 `pg_dump` / `pg_restore` / 升级后续跑。
- 没有进程 `SIGKILL` 窗口、两个恢复者竞争、默认 cap 下 3 项积压、多租户轮转、Redis 队列丢失、推理 500、坏 JSON、语义负例、并发清扫、300 项 provider 失败重跑。
- 仓库没有授权的真实试卷和标准答案。没有 PoC，也没有使用付费模型或真实学生数据。
