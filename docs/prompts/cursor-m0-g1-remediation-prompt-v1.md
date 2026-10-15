# Cursor M0 / G1 修复 Prompt V1

配套独立报告：ZX-AR-20261014-01，2026-10-14。当前 G1 No-Go，继续已授权 M0；不进入 M1、不实现完整阅卷、不接入真实学生、不部署生产。

## 可复制执行文本

你是智学 SaaS Cursor Development Agent。请修复 architecture-m0-g1-review-report-v1.md 中 G1-01–10。不是再写一轮纯设计稿；以 2026-10-13 已接受的 M0 核心范围和 v5 保守政策实现并真实验证。保留原需求/架构/独立审查源文件，不代签 ADR。

先读 AGENTS.md、README.md、g0-decision-record-20261013.md、G0 v5 决议清单、现行事务/授权/状态/模块/AI契约、原 Prompt 2，以及本轮独立报告与反例产物。反例使用 DB/HTTP 替身，只证明源码控制逻辑缺失，不能替代你必须跑的真实集成。

按顺序做：
1. 在隔离的 DB/Redis/对象根目录添加能复现缺陷的集成负例。不要用现有本机共享服务跑 reset、FLUSHDB 或全目录清扫；默认拒绝这些破坏性测试指向非测试资源。现有服务不得清空。
2. G1-01：统一校内 action/class/subject/current membership 授权，在每次写入与幂等重放前检查。cancel 非法终态返回 409/实际状态；manual 恢复重试与竞争只有一次有效草稿。
3. G1-02/03：实现发送前 IssueSendPermit 和 epoch CAS，提交 send_unknown 后才能 HTTP。严格检查当前 attempt/epoch/lease/generation/input/binding/config/stage、预算、cancel/deadline。控制字段统一或逐一相等验证。invocation 必须真实存在且属于当前 job/attempt；观察/结算/放弃均锁定正确 job/invocation，账只写费用。unknown 不自动第二次付费、不改挂旧 invocation、不提供 ResumeAfterSettlement。
4. G1-04：真正读取推理 HTTP 状态和响应，双端 Schema 验证，按 stage 构造信封；用最小冻结题目/rubric/资产 fixture 验证全题集合、重复/缺项、分值与组合、证据所属/页码/bbox/span。Worker 不把 500 或缺结果当成功，不写正式成绩。模型正向链和坏输出都通过真实 DB 接纳入口测试。
5. G1-06：按持久化上传 session/租约和隔离临时路径保护定稿；清扫按年龄/无引用/无处理中标志，删除前重检。并发文件写/事务提交/清扫时不得破坏已提交文件或活跃上传。
6. G1-05：实现可启动、可停机、身份受限的调度/relay/reconciler。默认 cap 下，释放槽后 queued 自动推进；进程故障和 Redis 队列丢失无需测试人员手调 HTTP 才恢复。覆盖 queued deadline、lease 接管、unknown 停放/升级、过期未消耗 admission、队列存在但 completed/failed 且 DB queued。按批准的轮转游标防饥饿；占用不重建/不双计。
7. G1-07/08/09：用新迁移修复已实现实体的复合外键与精确 revision 引用，运行真实角色违规引用负例和 R5-02 阶段绑定负例。Worker 不持有可任意签发所有服务权限的密钥；验证 issuer/subject/audience/expiry/job/attempt/jti，合法重试用新 jti。用 M0 最小实现落实表 owner、公开端口和同一 UoW；relay 必须有真实可靠投递和 ACK，consumer inbox 与效果同事务。不要为了拆模块提前实现 M1–M3 完整功能。
8. G1-10：修复 migration 在锁外判断已应用的竞态；验证干净环境的固定版本运行和有样例数据的 dump/restore/升级。CI 使用锁文件确定性安装。保留实际日志、版本、commit 和输入哈希，不用摘要 JSON 代替全部原始证据。

必须实际执行的检查包括：
- 同租户无范围写/已撤权令牌/跨租户读写与对象访问、真连接池 A/B/无上下文并发。
- API DB commit 前后、队列 add/ACK 前后、Worker HTTP 发送/observation 前后真正终止进程并重启。抛异常只能作为附加用例。
- 两个恢复者竞争、默认 cap 下 3 项及多租户积压自动推进、FastAPI 超时/500/坏 JSON/重启、Redis 丢失、预算/期限耗尽。
- 不存在/错任务/错租户/旧 attempt invocation、信封控制不一致、重复/缺/未知第二题、评分点不一致、证据资产/页码/bbox/span 负例。
- 清扫与定稿并发；已提交对象完整且授权可下载。
- 真实角色所有已实现 FK 正负例、幂等效果与账本一次、manual 恢复一次、正式发布保持禁用。
- 300 项的失败来自实际 mock provider 状态/输出，只重试失败的逻辑业务项；不要把 295 个成功项重新创建。允许合成最小业务替身。
- 有数据备份恢复、升级后继续任务，以及实际被支持的 Docker/CI 剖面。

AI PoC 的真实试卷/标准答案必须有授权，答卷仍合成。仓库没有授权资料时：先完成全部独立于样本的修复，报告缺什么资料和无法验证的功能；不声称 PoC 或 G1 通过。不要接入真实学生或自行使用付费模型。无需提供真实学生答卷。

交付：
- docs/quality-reports/m0-g1-response-v2.md：逐 G1-01–10，修改位置、反例、命令、真实结果/未跑原因。
- docs/quality-reports/m0-g1-evidence-v2.md + 独立运行的原始日志/版本/commit/hash；不覆盖 V1 的历史证据。
- 新迁移、接口/状态/配置/身份/UoW 文档和有意义的回归用例。
- Findings 追踪矩阵分开记录 design、accepted_scope、M0 implemented、developer tested、independent verified、future milestone。不把原 F01–28 全部写 Closed，不自行宣布 G1/M1 批准。

发现实施必须改变既定核心政策时，先提交可审查的局部 ADR 差异与取舍；普通实现缺陷直接修复，不重复请求已经给过的 M0 授权。真实 DB/Redis/Docker 不可用时如实保留待验，不能再用全 mock 冒充集成。完成后交回独立 QA 和 Architecture Review Agent 复验 G1。
