# M0 G1-V2-01–07 修复响应

对照 ZX-AR-20261014-02。v2 已补的授权、外键、scope/exp/jti、新 intent 先许可、notice 与 inbox 同事务都保留。没有代签 ADR，没有宣布 G1 或 M1 通过。运行见 `m0-g1-evidence-v3.md`。

## G1-V2-01 已有许可不再次 HTTP

`apps/worker/worker.py` 只在本次 `prepare` 返回 `not_sent` 且 `issue-send-permit` 成功时调用推理。`send_unknown` 直接返回，不再请求。`observed` 只用已保存的 `response_body` 组装信封或走 `stage-failure/1.0.0`，不重新推理，也不把旧 invocation 改挂到新 attempt。

这次运行证明了超时后进入 `awaiting_settlement`。同一次 attempt 的重入计数和 SIGKILL 窗口没有在这次运行里打到。

## G1-V2-02 接管交接和阶段失败

接管在租约过期且没有 `send_unknown` 时仍增加 epoch、不新建 admission。随后 `dispatchCurrentAttempt` 写入新的 capability 并投递 `execute_current`。Worker 用 `POST /internal/jobs/continue` 取得当前 attempt，而不是把任务改回 queued。`recordObservation` 保存 `provider_status`、`response_body` 和 `response_sha256`。`POST /internal/jobs/stage-failure` 用 `stage-failure/1.0.0` 结束 provider 500、坏 JSON 和缺少持久结果，不再把 `envelope=null` 送进评分接纳。`list_past_deadline` 覆盖 queued 和 running。维护步骤各自捕获错误，Redis 失败不会跳过前面的期限和 unknown 处理。

这次运行没有杀死 Worker 来观察新 attempt 被 Python 执行，也没有单独断言 500 或坏 JSON。

## G1-V2-03 评分点

`gradeSemantic` 拒绝重复 `criterion_id`。分数用 `整数元*100 + 两位小数` 相加，不用 `Number` 直接比较。页码使用 `submissions.page_count`，span 上限使用 `ocr_char_count`，不再把 page_set 行数当作页数。Worker 用 jsonschema 校验同一份 envelope schema。

这次运行：重复计分返回 `rubric_duplicate`；`0.10+0.20` 对 `0.30` 接纳成功，正式成绩行数是 0。缺题、错资产、反向 bbox、额外字段和双端 schema 负例没有全部打到。

## G1-V2-04 上传收尾

成功定稿后 `releaseFinalizedTemp` 写下 `temp_released_at` 并删除 incoming 副本。`object_is_live` 不再因为 finalized 永久保护临时键。过期的 committing 由 `expire_committing_uploads` 标成 expired 再删临时文件。这次运行没有并发清扫断言。

## G1-V2-05 进程环境

测试启动 Worker 时只传入白名单。这次运行的 `worker-env.txt` 有 `WORKER_JWT_SECRET`，没有 billing、reconciler、relay、scheduler、bootstrap 或 migrator 密钥。用 Worker 密钥签发 billing scope 仍是 403。

## G1-V2-06 函数属主

`0004_g1_v2_controls.sql` 删除由 migrator 创建的三个定义者函数，改由没有 `BYPASSRLS` 的 `zhixue_owner` 重建，并撤掉 PUBLIC、只授予 reconciler。没有改写 0001–0003 的历史正文。这次查询到这三个函数的 `proowner=zhixue_owner` 且 `rolbypassrls=false`。组合根仍装配现有 store；跨表写入还在同一个事务里。notice/inbox 同事务保留。relay 进程杀死的一次效果没有在这次运行里取证。

## G1-V2-07 运行入口

`scripts/run-isolated.mjs` 用 `ZHIXUE_PROFILE=local|compose` 选择端口和库名。CI 改为调用它，不再调用旧的 `run-m0.mjs`。每次运行写入 `var/runs/<id>/`，包含命令、开始、结束、退出码和 `git HEAD`。旧套件文件还在，这次执行的是带新令牌和新前缀的 `g1.integration.test.mjs`。

本机 Docker 没启动，所以 compose 剖面和 CI 没有实际跑。有数据的备份恢复和 300 项也没有跑。

## 旧 G1-01–10

授权、终态取消、外键 missing-job、jti、发送超时停放、评分去重和小数在这次运行里有开发者结果。撤权令牌、进程杀死、双恢复者、语义其余负例、清扫并发、R5-02、300 项和备份恢复仍是未跑。矩阵见追踪表 2026-10-14 v3 一节。独立验证列保持 `not_run`。

授权试卷和标准答案仍缺。没有 PoC。请独立 QA 和 Architecture Review Agent 复验，不要把本文件当成 G1 通过。
