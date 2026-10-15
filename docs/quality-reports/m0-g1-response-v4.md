# M0 G1 修复响应 v4

日期：2026-10-14。对照 ZX-AR-20261014-03。这是开发者修复记录，不是 G1 通过，也不是 M1。F01–F28 保持原状态。独立复验栏全部 `not_run`。

原需求、历史迁移 0001–0004 和旧证据没有改写。新增 `db/migrations/0005_g1_v3_status.sql` 与 `db/migrations/0006_g1_v3_delivery.sql`。

## 已保留的先前结果

计分点去重、0.10+0.20=0.30、正式分仍为 0、scope/exp/jti、Worker 环境白名单、受限函数属主为 `zhixue_owner` 且无 `BYPASSRLS`、非计费接管、同一 attempt 的 observed 不再请求模型。这些都在 `var/runs/1791973007411` 里再次跑过。

## G1-V3-01–07

| ID | 实现 | 本次开发者测试 | 独立复验 | 后续 |
|---|---|---|---|---|
| G1-V3-01 | 成功响应和 observed 重入都走 `build_envelope`。Worker 读取已解析的 `response_body` | Node 建 job，原生 Python BullMQ Worker 调 FastAPI mock，再由 Nest 接纳。1 条 `review_required` proposal，预算 1000 降到 998（含此前一次超时许可），`score_versions` 为 0 | not_run | 授权试卷与标准答案仍缺，不能做质量 PoC |
| G1-V3-02 | 0005 在不改 0001 的前提下替换 `result_status` 检查，加入 `provider_http`、`bad_json`、`missing_persisted_result`、`schema_rejected`、`deadline`。失败命令核对当前 attempt、epoch、generation、input、租约哈希和身份，收据版本 `stage-failure/1.0.0` | 三种供应商失败由 Worker 写成 `exception_review`。缺保存结果的命令同体回放，异体 409，旧租约 409。过期任务由维护步骤写成 `failed_final/deadline` 并释放一次占用。空库迁移含 0005。升级库在恢复后把已有行改成 `provider_http` | not_run | — |
| G1-V3-03 | 接管返回作业上的 `stage` 和 `billable`。新 attempt 与 `delivery_intents` 同一事务。Worker 只按 claim/continue 的 `billable` 选择阶段。observed 续跑同一 attempt，不新建许可。`send_unknown` 不发 HTTP | model_grade SIGKILL 后新 Worker 以 epoch 2 完成，1 条 proposal，推理 1 次。validate SIGKILL 后仍是 `validate_asset`。许可后杀死推理 0 次；HTTP 后杀死推理 1 次且停在 `awaiting_settlement`；观察后杀死不再推理并成功。提交后崩溃留下 `pending` 意图，删掉本轮队列前缀后由 reconcile 重建并成功 | not_run | 两个恢复者同时调用同一作业没有单独断言。ACK 前崩溃的代码路径存在，这次断言的是提交后崩溃 |
| G1-V3-04 | finalize 在事务里对上传会话 `FOR UPDATE`，CAS 必须改到一行，然后才写最终文件。清扫调用 `claim_object_reclaim`，拿不到行锁就不会删最终文件 | 只在 `zhixue_m0_g1*` 上安装 3 秒暂停 trigger，上传租约 1 秒。并发清扫结束后原件还在，下载 sha256 与元数据一致。无会话的孤儿文件由两个清扫者删除。trigger 已在测试里删除 | not_run | — |
| G1-V3-05 | 资产 GET 返回 `StreamableFile` | PDF、PNG、JPEG 的 HTTP 字节 sha256 等于 `source_assets.sha256`，响应不是 Buffer JSON。跨校 404，跨班 403，撤权 403 | not_run | — |
| G1-V3-06 | Python `Draft202012Validator` 使用 `FormatChecker` | 同一合法信封在 Ajv 与 Python 都通过。`paper_question_id=not-a-uuid` 两端都拒绝。observed 形状复用同一验证器 | not_run | — |
| G1-V3-07 | `composePorts()` 装配评分评估、对象回收和通知投影。组合根把端口交给 store，端口自己不提交 | 正常自动链、relay 在提交前抛错并回滚、默认占用 2 且第三项不入队、300 项中 295 成功 / 5 失败且只重跑这 5 个并成功。有数据的 dump/restore 后应用 0006，旧行改为 `provider_http` | not_run | 不展开 M1–M3。Docker 未启动，Compose 与 CI 未执行 |

## 没有改的政策

没有把错误改成成功，没有关闭 `result_status` 约束，没有 `ResumeAfterSettlement`，没有写 `score_versions`，没有使用付费模型。测试供应商是本机 FastAPI mock。真实学生数据没有接入。

## 交给独立复验

原始运行目录：`var/runs/1791973007411`。退出码 0。开始 `2026-10-14T10:16:47.412Z`，结束 `2026-10-14T10:17:14.347Z`。库 `zhixue_m0_g1v3`，Redis DB 2，队列前缀 `zhixue-g1-1791973007411`。没有重置 `zhixue_m0`，没有 `FLUSHDB` 0 号库，没有改共享角色密码。

仍缺：授权试卷和标准答案、Docker/Compose/CI、两个接管者的并发断言。不能把这次退出码当成 G1 通过。
