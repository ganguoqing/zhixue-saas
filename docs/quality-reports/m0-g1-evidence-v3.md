# M0 G1 修复运行记录 v3

**日期：** 2026-10-14  
**结论：** 这是一次隔离库上的开发者运行记录。它不宣布 G1 通过，不把原 Findings 标成 Closed，也不宣称学校阅卷质量。v1 和 v2 的历史证据文件不覆盖。

## 这次运行

目录 `var/runs/1791954241082/` 只属于这一次，不是追加到旧日志。

```text
node scripts/run-isolated.mjs
profile=local
started=2026-10-14T05:04:01.083Z
ended=2026-10-14T05:04:04.828Z
exit=0
```

`node --test tests/m0/g1.integration.test.mjs`：1 项通过，0 项失败，约 2114 ms。结果原文在该目录的 `g1-results.json`。库是 `zhixue_m0_g1v3`。Redis 使用 DB 2 和本次前缀 `zhixue-g1-1791954241082`。对象目录在这次 run 目录下。没有 reset 共享库 `zhixue_m0`，没有对 Redis DB 0 执行 `FLUSHDB`。

HEAD 仍是 `e302221c5f7b8e81274dab1d5f02b2145dc0d3b9`。被测代码是未提交工作区。`git.txt` 记录了 diff 统计。

| 文件 | SHA-256 |
|---|---|
| `apps/worker/worker.py` | `d89aea2a8993a647c6fdd42c7e9cd649babf657b5584b4f125bec2ffa5f42af8` |
| `apps/api/src/store.ts` | `41f9dc9716b7d5d51ad4ef005bf2bf09a75c0ff8372f9a8434def579c38271ab` |
| `db/migrations/0004_g1_v2_controls.sql` | `1dcdbcd966a8ef6ce209bc00445f1d7d033a3de355f39f971f22bca9269ab946` |
| `scripts/run-isolated.mjs` | `f3e63ebf61cbdebd0215444285481cde6b2c0466363fd87507cabb7334bea3e0` |

版本：Node v24.15.0，Python 3.14.4，PostgreSQL 17.11，Redis 7.4.2。

## 这次打到的结果

- 同校无范围读/取消：403
- 成功任务取消：409，`succeeded`
- 重用 jti：401
- Worker 密钥签发 billing scope：403
- Worker 进程环境键里没有 `BILLING_JWT_SECRET`、`ZHIXUE_MIGRATOR_PASSWORD`、`BOOTSTRAP_PASSWORD`，有 `WORKER_JWT_SECRET`
- 不存在 job 的 attempt：提交时 23503
- 付费 mock 超时后任务 `awaiting_settlement`，没有手调修复接口
- `object_is_live`、`list_unknown_running`、`list_past_deadline` 的属主是 `zhixue_owner`，`rolbypassrls=false`
- 重复 criterion：`rubric_duplicate`；`0.10+0.20=0.30` 的接纳成功，`score_versions` 仍是 0

## 没有跑

- 许可后、HTTP 后、观察后的 SIGKILL，以及计数 provider 上的双执行
- 接管后的 Worker 实际完成、500/坏 JSON 的阶段失败、无 Worker 的 deadline、默认 cap 第三项、轮转、Redis 中断
- 并发清扫、成功临时文件删除、committing 过期回收
- 跨租户/别的 job/错误 revision、R5-02 绑定负例
- relay 进程杀死后的一次 notice 效果
- 300 项 provider 295/5
- 有数据的 dump/restore/升级后续跑
- Docker Compose 的 PostgreSQL 16.10 和 GitHub Actions。本机 Docker 守护进程没有启动
- 授权试卷和标准答案。没有 PoC，没有付费模型，没有真实学生数据
