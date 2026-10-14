# M0 窄切片运行记录

**日期：** 2026-10-13  
**范围：** 项目负责人已批准的 M0 必需范围。合成数据，`student_data=forbidden`。  
**结论：** 下面是一次本机集成测试的原始结果。本文不宣布 G1 通过，不把 Findings 标成 Closed 或 Verified，也不把学校阅卷质量说成已验证。

## 这次实际跑过的命令

Docker 守护进程不可用，所以没有执行 `scripts/run-m0.mjs`，也没有执行 `.github/workflows/m0.yml`。`docker-compose.yml` 里的 PostgreSQL 16.10 与端口 54329/63799 这次没有启动。

本机服务：

- PostgreSQL 17.11（Homebrew），超级用户本机 trust，库 `zhixue_m0`，端口 5432
- Redis 7.4.2，由源码编译后监听 6379，可执行文件在 `/tmp/redis-build/redis-7.4.2/src/redis-server`

通过前的命令：

```bash
export PGPORT=5432 REDIS_PORT=6379 PGHOST=127.0.0.1
export PATH="/Users/johnny/.homebrew/opt/postgresql@17/bin:$PATH"
node scripts/migrate.mjs --reset
node scripts/seed.mjs
node --test --test-concurrency=1 --test-timeout=300000 tests/m0/integration.test.mjs
```

`node --test` 结果：1 项通过，0 项失败，约 6861 ms。用例名是 `M0 narrow slice`。原始记录在 `var/m0-g1-raw.json`。

## 版本

| 组件 | 这次运行 |
|---|---|
| Node.js | v24.15.0 |
| Python | 3.14.4（`.venv`） |
| PostgreSQL | 17.11 Homebrew，aarch64 |
| Redis | 7.4.2 |
| API | 仓库内 NestJS 构建产物 `apps/api/dist` |
| Worker / 推理 | `apps/worker/worker.py`，`apps/inference/main.py`，端点 `mock://local` |

依赖锁定见根目录 `package.json`、`package-lock.json` 和 `apps/worker/requirements.txt`。

## 原始结果里已经出现的检查

| 记录名 | 结果 |
|---|---|
| health | `dbRole=zhixue_app`，`studentData=forbidden`，`autoRetryUnknown=false`，`modelEndpoint=mock://local` |
| identity | 应用角色 `rolbypassrls=false`。`resolve_work_route` 的 `current_user` 是 `zhixue_router`，`session_user` 是 `zhixue_ai_ingress`。`search_path=pg_catalog, pg_temp` |
| isolation_http | 租户 B 对教师 A 为 404；教师 A 对自己无范围的答卷为 403；平台用量合计 `1.50`，响应不含学生标签 |
| rls_pool | 租户 A、B 各见 1 行，空上下文 0 行 |
| roster_fk | 学生不一致的名单链接被外键拒绝 |
| browser_closed | 定稿在 Worker 完成前返回。BullMQ job id 为 `cap-...`，与业务 job id 不同。任务最终 `succeeded` |
| crash_before_enqueue | 入队前崩溃后任务仍为 queued，协调后完成 |
| crash_before_ack | 确认前崩溃后只留下 1 条 succeeded |
| redis_loss | 清空 Redis 后重发并完成 |
| duplicate_and_forged | 重复接受的 `stateVersion` 同为 `2`；伪造租户 403 |
| cancel_and_stale_input | 取消后接受 409；代际过期 409 |
| admission_cap | 占用 2，第三项 `enqueued=false` |
| takeover | fencing epoch 2，占用前后相同，旧 epoch 接受 409 |
| unknown_recovery | 停放在 `awaiting_settlement`。放弃后 `send_state=send_unknown`，`cost_status=abandoned_unknown`，金额 `null`，`includeInTotal=false`，显示「未知」，任务状态不变。关闭后 `exception_review` / `missing_result`。手工分的正式成绩数是 0 |
| schema | 非法 UUID、多余字段、越界框、未知题目均为 422。合法信封 201，建议数 1，`score_versions` 为 0 |
| publish_denied | ingress 没有 `publish_score_version` 的 EXECUTE。应用调用得到 M0 之外的发布拒绝 |
| metrics_and_orphans | 三个指标名存在。清扫删除了 323 个本地文件，其中包含本次之前留下的合成文件和测试植入的 `stray.bin` |
| batch_300 | 成功 295，失败 5，只重跑这 5 项且重跑成功 |
| migration_upgrade | 对 0001 做 `pg_dump` / `pg_restore` 后再应用 0002，`submissions.correlation_note` 存在 |
| production_config | 缺少 `EXECUTION_TENANT_CAP` 时进程退出码 1 |

结算重放与首次响应相同，且没有把任务改成 succeeded，也没有新建建议。`POST /internal/jobs/resume-after-settlement` 返回 404。

## 这次没有跑

- `docker compose` 与镜像 PostgreSQL 16.10
- GitHub Actions 工作流 `.github/workflows/m0.yml`
- 真实模型供应商、付费调用和生产密钥
- 生产备份演练。上面的 dump 只证明本机从 0001 补到 0002
- 授权的真实试卷、答案或学校样本。仓库里没有这些材料，因此没有公式、切分或匹配质量结论
- 完整阅卷、学校管理界面、题库、真实学生数据接入、生产部署
- R5-02 的绑定负例。迁移里有阶段约束，这次测试没有单独断言违规绑定被拒绝

## 运行中改过的实现点

这些改动是为了让上述测试在本机跑通，不是新的产品决议。

- 迁移角色要在 schema 属主下授权。`schema_migrations` 归 `zhixue_router` 所有，迁移者获 INSERT。
- 租户策略在 `app.tenant_id` 为空字符串时不再把空串转成 uuid。
- Ajv 保持 `strict: true`，只关闭 `strictRequired`。现行 schema 用 `anyOf` 要求 `bbox` 或 `ocr_span`，Ajv 的 strictRequired 会在编译期拒绝这种写法。校验规则本身没有放宽。
- 会话和定稿返回 200。首次接受返回 201，同一幂等键重放返回 200。
- 缺少的路由仍走 Nest 的 404，不再被统一过滤器写成 500。
- Worker 的 HTTP 客户端设置 `trust_env=False`。第一次认领曾返回 502，且 API 日志没有对应请求；改完后认领进入 API 并完成。
- 应用角色可以删除未消耗的 admission，也可以读取本租户的调用和评分建议，供取消释放占用和测试观察使用。
