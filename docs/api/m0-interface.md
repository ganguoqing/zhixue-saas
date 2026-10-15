# M0 窄切片接口

本文件描述 2026-10-13 决议之后的可运行切片。它不是完整阅卷，也不接入真实学生数据。开发配置里的 cap、租约和文件大小是测试值。

## 复现

```bash
python3 -m venv .venv
.venv/bin/pip install -r apps/worker/requirements.txt
npm install
node scripts/run-m0.mjs
```

`run-m0.mjs` 会按 `docker-compose.yml` 启动 PostgreSQL 与 Redis，再执行迁移、合成种子和集成测试。2026-10-13 这次通过记录没有走到该脚本：本机 Docker 守护进程不可用，实际使用的是本机 PostgreSQL 17.11（端口 5432）和本机编译的 Redis 7.4.2（端口 6379）。复现命令和原始结果见 `docs/quality-reports/m0-g1-evidence.md`。

## 角色

应用连接池使用 `zhixue_app`、`zhixue_ai_ingress`、`zhixue_relay`、`zhixue_reconciler`、`zhixue_scheduler`、`zhixue_platform_ops`。迁移使用 `zhixue_migrator`。这些池不执行 `SET ROLE`。

`resolve_work_route` 只授予 ingress 和 reconciler。函数属主是 `zhixue_router`。

## 用户接口

- `POST /api/session`：邮箱和密码，返回会话令牌。
- `POST /api/uploads/finalize`：合成文件定稿。同一事务写入答卷、校验任务、Outbox 和审计。请求头 `Idempotency-Key`。
- `GET /api/submissions/:id`、`GET /api/assets/:id/content`、`GET /api/jobs/:id`：先过租户 RLS，再过班级和学科范围。
- `POST /api/jobs/:id/cancel`
- `POST /api/jobs/:id/manual-score`：只在异常或最终失败后，先写 `origin=manual` 的修订，再写草稿。
- `GET /ops/usage`：平台令牌，只有租户合计。

学校用户不能插入 `score_versions`。本切片没有正式发布路由。

## 服务接口

服务令牌的 audience 是 `zhixue-internal`，并且必须带对应 scope。租户以持久 job 为准，请求体里的 tenant 不能改写它。

- `ai.job.claim`：`POST /internal/jobs/claim`
- `ai.job.prepare_invocation`：`POST /internal/jobs/prepare-invocation`
- `ai.invocation.issue_permit`：`POST /internal/jobs/issue-send-permit`。提交 `send_unknown` 之后 Worker 才能调用推理。
- `ai.invocation.observe`：`POST /internal/jobs/record-observation`
- `ai.result.accept`：`POST /internal/jobs/accept`
- `ai.job.read_frozen`：`GET /internal/jobs/:id/frozen`
- `ai.billing.settle`：结算和放弃未知费用
- `reconciler.repair`：停放、关闭未证明阶段、接管、补投、清孤儿
- `relay.deliver`：`POST /internal/relay`
- `scheduler.admit`：占用查询

服务令牌必须带 `iss`、`sub`、`aud`、`exp`、`jti`。Worker、reconciler、scheduler、relay、billing 使用不同密钥。Worker 密钥不能签发 billing 或 reconciler scope。`jti` 不能重用。调度进程是 `node apps/api/dist/supervisor.js`。

2026-10-14 的隔离运行记录见 `docs/quality-reports/m0-g1-evidence-v2.md`。那次记录不是 G1 通过。

没有 `ResumeAfterSettlement`。费用 `unknown` 不会被自动再付费。放弃未知费用只把 `cost_status` 从 `unknown` 改成 `abandoned_unknown`，金额保持 NULL。

队列名是 `zhixue-jobs`。BullMQ 的 job id 使用 capability dispatch id，不是业务 job id。
