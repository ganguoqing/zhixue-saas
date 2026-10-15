# 智学 SaaS Architecture Review Report — M0 / G1 独立复验 V4

**审查编号：ZX-AR-20261014-04**  
**日期：2026-10-14，Asia/Shanghai**  
**角色：独立 Architecture Review Agent**  
**上一轮：ZX-AR-20261014-03**  
**输入：** m0-g1-response-v4.md、m0-g1-evidence-v4.md、相关 ADR / 已决 M0 范围、当前源码、开发者原始运行记录。  
**源码基线：** HEAD e302221c5f7b8e81274dab1d5f02b2145dc0d3b9 加未提交 / 未跟踪工作区；以随附输入快照和 SHA-256 清单界定实际版本。

## 1. 执行摘要

**结论：G1 No-Go。继续已授权 M0 修复；尚不能验收 M0 退出或进入 M1。**

v4 有明显、可复现的进展。提交文件的 **6 个哈希全部匹配**。API 独立编译、新库原样迁移和合成种子成功；完整 v4 集成套件在独立 PostgreSQL / Redis 环境重跑成功，退出码 0，耗时约 25.78 秒，记录 44 条，其中 36 条为行为结果，8 条为进程退出记录。

上轮正常评分异常、失败枚举冲突、计费任务接管类型丢失、清扫误删未提交对象、Buffer JSON 下载和 Python UUID 校验缺口，在本轮对应测试范围内均已修复。另补测通过同作业双接管者、入队后 ACK 前中断及双协调者修复、有实际待投递事件的 relay 回滚重放、真实连接池 A→B→无上下文与并发隔离，以及有数据的 0004→0005/0006 原样升级。

本轮剩余 **4 项 Findings：Critical 1、Major 3，Blocker / Minor 0**：

1. 新增 delivery_intents 实际未启用 RLS；真实运行角色在 B 租户或无租户上下文下可读写 A 租户行，并读取其恢复租约凭据。
2. 同表缺少 job / attempt 复合外键与必要的正数约束，真实角色能插入不存在的父记录、把 intent 改挂其他作业、写入 epoch / generation 0。
3. 当前备份恢复测试移除了属主和 SET ROLE，恢复后的受限函数变成 BYPASSRLS 迁移角色所有；原样 0006 实际报权限失败。因此其绿色记录不能作为恢复权限与后续迁移验收。
4. Docker / Compose / CI 和获授权试卷、标准答案 PoC 仍未完成。这是原 G1 范围的验收缺口，不是本轮增加的产品需求。

没有修改用户仓库、原设计或 ADR 状态，没有启动演示或进入 M1。独立运行只使用合成数据、mock 端点和新建复验库；复验 API / Worker / 推理进程均已停止，正式成绩为 0。

## 2. 审查范围、运行方法与限制

### 2.1 依据与边界

需求依据仍是 V0.1–V0.28、V1.0 需求基线、[2026-10-13 实际 G0 决议记录](/Users/johnny/Documents/GitHub/zhixue-saas/docs/decisions/g0-decision-record-20261013.md:10) 和原 [Prompt 2](/Users/johnny/Documents/GitHub/zhixue-saas/docs/prompts/cursor-repair-prompts.md:56)。技术初稿、后续建议及开发者完成声明不能自动成为已决需求。

本轮审查 M0 窄切片和 v3 的七项修复，重点关注新迁移、任务恢复、数据权限及运行证据。没有要求提前实现完整阅卷、正式成绩发布、真实学生接入或生产部署。ADR 仅沿用已批准的 M0 条款，不整体标 Accepted；F01–F28 不整体 Closed / Verified。

### 2.2 独立环境

- 工作副本：[g1-rereview-v4-20261014](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/work/g1-rereview-v4-20261014)。
- 主复验库：zhixue_m0_g1reviewv4_20261014，PostgreSQL 17.11。另建后缀 upgrade_20261014 库验证有数据原样升级、restore_20261014 库重现恢复问题，证据保留。
- 原套件两个临时升级 / 恢复库仅在副本中更名为 reviewer 专属名称，原套件完成后删除。未删除用户既有数据库。
- Redis 7.4.2，DB 5，前缀 zhixue-g1-reviewv4-20261014。队列丢失场景只删除本复验前缀，没有 FLUSHDB。
- 对象和日志均在副本的 var/runs/reviewer/ 内。服务端口 3450 / 3451，结束已确认无监听。
- Node 24.15.0；Node BullMQ 5.61.0；Python 3.14.4；Python BullMQ 2.16.1；其余实际依赖见 evidence。
- 复用现有 DB 角色，跳过会改变共享角色的 bootstrap；只对新复验库授予 migrator CREATE 并安装 pgcrypto。0001–0006 SQL 原样执行，保留 SET ROLE。没有修改共享角色密码、属性或成员关系。
- 冻结 179 个输入文件；结束再次核对，用户仓库中这些文件均未变化。

### 2.3 证据强度

完整集成套件的业务逻辑没有被改写；独立副本只调整临时 DB 名称以避免覆盖共享资源。补测使用真实 DB 角色、HTTP、BullMQ Python Worker 和 FastAPI mock。SQL 反例的非法写入均 ROLLBACK；不会把反例数据留成业务效果。

完整套件的退出码 0 表示其现有断言通过，不代表所有安全不变量通过。开发者披露的恢复偏离已经保留，本报告没有把披露当作隐瞒，也没有把偏离当作验收通过。

补充恢复探测首跑因审查脚本误按“ID 加空格”读取仅含 ID 的调用计数文件而停止。DB / Worker 当时已成功；修正的是审查计数器，未改目标代码。首跑结果保留，修正后补测全部通过。

### 2.4 未验证

Docker / Compose 的 PostgreSQL 16.10 剖面、GitHub Actions 的 Python 3.12 剖面、获授权真实试卷 / 标准答案 PoC、真实学生评分质量、生产配置与完整 M1–M3 状态机均未验收。本轮通过的本机版本组合不能代替这些剖面。完整 FK / 输入世代 / 语义负例矩阵未逐项全量重跑，仅按本轮具体证据结论记录。

## 3. 上轮 G1-V3-01–07 处置

| 上轮 Finding | 本轮独立证据 | 处置 |
|---|---|---|
| V3-01 正常 Worker 评分异常 | 原生 Worker 自动完成 model_grade，一条 review_required proposal，一次发送许可扣减，正式成绩 0 | 原故障 Verified fixed，限本轮正向和 observed 测试 |
| V3-02 failure / deadline 数据库契约 | 三种供应商失败自动异常化；missing_persisted_result 命令重放 / 异体 / 旧 token 检查；deadline 终结并释放；另从原 0004 有数据库原样升级 0005/0006 | 原枚举冲突 Verified fixed；不能将完整状态机负例矩阵整体关闭 |
| V3-03 评分接管 / 持久交接 | 两种 stage 的真正 SIGKILL 接管；permit / HTTP / observed 中断；提交后队列丢失；另补同作业双接管和 ACK 前中断 | 原 billable 丢失与所测恢复窗口已通过；新增意图表隔离及关联问题见 V4-01/02 |
| V3-04 清扫与定稿竞争 | 1 秒上传租约、3 秒事务暂停，并发清扫后下载哈希匹配；双清扫者孤儿删除 | 原误删窗口 Verified fixed，测试 trigger 已删除 |
| V3-05 授权下载 Buffer JSON | PDF / PNG / JPEG 的真实 HTTP 字节与元数据哈希匹配，跨校 / 跨班 / 撤权拒绝 | Verified fixed |
| V3-06 Python UUID format | 同一合法信封两端通过，非法 UUID 两端拒绝；新响应 / observed 共用验证器 | Verified fixed，限已测 corpus |
| V3-07 最小端口 / 验收证据 | composePorts 注入评分、回收、通知公开端口；端口复用调用方事务，不独立 COMMIT；默认 cap、300 项、真实待投递事件回滚、实际池复用通过 | 模块边界与具体证据已补；恢复和外部验收仍待 V4-03/04 |

独立补测细节：

- 同作业两个 takeover 并发：HTTP **201 / 409**，最终 epoch 2；admission / invocation / proposal 各 1，provider 1 次，occupancy_held=false。
- 入队后 ACK 前注入中断：HTTP 500，intent 为 dispatched；两个 reconcile 均成功，恢复为 acked 且沿用同一 dispatch / Bull job；新 Worker 成功，provider 1 次。
- 确实存在 pending outbox event 的 relay 中断：回滚后 pending、notice 0、inbox 0；重放后 delivered、notice 1、inbox 1。
- 使用实际 M0Store.app Pool：A、B 和无上下文复用同一 backend PID，A / B 仅见本租户，退出事务后无上下文为 0；16 个并发请求使用 8 个连接，上下文和释放后检查通过。
- 有数据原 0004 schema：旧 CHECK 拒绝 provider_http；原样 0005/0006 迁移后同一旧行可写 provider_http，迁移记录完整且新表属主为 zhixue_owner。此为原样升级正例，独立于有问题的恢复路径。

## 4. Findings

### G1-V4-01 — Critical — 新投递表 FORCE RLS 但未 ENABLE，运行角色可跨租户读写恢复凭据

**关联：** F01 / F08 / F11 / F12，V3-03。  
**证据位置：** [0006_g1_v3_delivery.sql](/Users/johnny/Documents/GitHub/zhixue-saas/db/migrations/0006_g1_v3_delivery.sql:25)，L25–37；独立 rls-probe.json。

**发现：** 迁移只有 FORCE ROW LEVEL SECURITY 和 policy，没有 ENABLE ROW LEVEL SECURITY。原样新库查询目录实际为 relrowsecurity=false, relforcerowsecurity=true。这不是仅凭源码推测。

**真实反例：** 以 zhixue_ai_ingress 和 zhixue_reconciler 各自连接，分别设置 A、B、无租户上下文。三个上下文都能 SELECT 到 A 的 **330 条 intent 与非空 lease_token**。B 上下文能 UPDATE A 的 330 条 intent；跨租户插入同样成功。所有非法写入均回滚；证据只记录数量，不输出凭据值。旧 submissions 表的池隔离正例不覆盖这个新增表。

**风险：** 持久交接租约凭据和写权限失去已决 DB 租户防线。当前 HTTP 路由和 Worker 环境白名单仍有价值，但不能代替真实 DB 角色的 RLS。本轮没有宣称已证实普通终端用户可从 HTTP 下载这些凭据。

**修复建议：** 以追加迁移显式 ENABLE + FORCE；按既决 owner / ingress / reconciler 职责收紧 USING、WITH CHECK 和列权限。无上下文直接访问应拒绝或零行。受限全局扫描只走审计过的专用函数，不为方便恢复给运行角色 BYPASSRLS。不改已执行的 0006 或原设计。

**验收方法：** 空库和已有 0006 数据库均升级；目录两项标志均 true。真实 ingress / reconciler 角色下测 A/B/无上下文 SELECT、INSERT、UPDATE，B 不能读 A 的 lease_token、不能写 A；owner / migrator 的受控职责保持；正常 claim、takeover、observed、Redis 恢复继续通过。对新增租户表加入目录检查，不能只重复测旧 submissions。

**修复责任 / 复验：** Cursor Development；独立 QA / Architecture Review。

### G1-V4-02 — Major — 投递意图没有约束租户、job、attempt 的关联及世代边界

**关联：** F01 / F11 / F12，V3-03。  
**证据位置：** [0006_g1_v3_delivery.sql](/Users/johnny/Documents/GitHub/zhixue-saas/db/migrations/0006_g1_v3_delivery.sql:5)，L5–23；既有 [attempt 复合唯一键](/Users/johnny/Documents/GitHub/zhixue-saas/db/migrations/0003_g1_controls.sql:22)；独立 fk-probe.json。

**发现与反例：** 新表仅有 PK、attempt UNIQUE 和 state CHECK，没有 parent FK 或 epoch / generation 正数 CHECK。在正确 A 上下文下，真实 ingress 角色能：①插入 job 和 attempt 都不存在的 intent；②把已有 intent 的 job_id 改成另一实际作业，保留原 attempt；③在合法父记录上将 fencing_epoch 和 generation 改成 0。三项均实际成功、随后回滚。这是独立于 V4-01 的数据关联问题。

**风险：** 写入错误、迁移或恢复可以制造不可调度的 orphan、错误交接或不一致控制信息。当前 join 会使部分错行不可见，不能把这种静默丢弃当作父子约束或可恢复保证。本轮未证明这些非法行能绕过 HTTP 接纳直接产生正式分数。

**修复建议：** 追加 (tenant_id, job_id) 与 (tenant_id, job_id, attempt_id) 复合 FK，复用已有父键；补 epoch / generation 必要范围约束，并验证 intent 的 epoch 与其 attempt 对应。恢复快照中的 stage / billable / generation / input 必须与权威 job / attempt 的协议一致，采用既决 M0 约束或事务 guard，不引入未来业务。先检查已有行，处理不一致并记录，不静默删除正在处理的数据。

**验收方法：** 正常 claim / takeover 插入继续成功；真实运行角色对不存在父行、跨 tenant 父行、另一个作业的 attempt、错误 epoch / generation 的写入被 FK / CHECK 或明确协议 guard 拒绝。已有数据升级不产生 orphan；空库、原样升级和恢复后均执行该矩阵。读时过滤不替代写时约束。

**修复责任 / 复验：** Cursor Development；独立 QA / Architecture Review。

### G1-V4-03 — Major — 备份恢复改变安全属主，原样后续迁移失败

**关联：** F01 / F08 / F25，V3-07。  
**证据位置：** [g1-v4-flows.mjs](/Users/johnny/Documents/GitHub/zhixue-saas/tests/m0/g1-v4-flows.mjs:555)，L555–569；[开发者披露](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/m0-g1-evidence-v4.md:59)；独立 restore-probe.json / exact-restore.log。

**发现：** pg_restore 使用 --no-owner，代码接受任何 exit 1；随后剥离原 0006 的 SET ROLE / RESET ROLE 才执行。开发者已披露这一偏离，它仍不能满足实际角色边界下的恢复验收。

**真实反例：** 同一有数据 dump 在另一个新复验库恢复，pg_restore exit 1，本次确认为 pgcrypto COMMENT 权限错误；**原样 0006 返回 42501：permission denied for schema zhixue**。恢复的 20 个 SECURITY DEFINER 函数都属于 zhixue_migrator，其 rolbypassrls=true，包括刚修过的 object_is_live / list_unknown_running / list_past_deadline。原主库 owner 的正确状态不代表恢复库也正确。

**风险：** 灾后恢复不能直接沿用迁移流程，并回退已决受限函数属主边界。无条件容忍 restore exit 1 还可能掩盖其他对象或数据恢复失败。此 Finding 针对现有恢复流程；不将尚未执行的生产恢复推断成已发生事故。

**修复建议：** 制作保留或明确重建 owner / router、ACL、RLS、函数 search_path 的隔离恢复流程。恢复阶段可以使用授权的离线管理身份，结束后必须验证与原角色模型一致，再运行未改写的迁移。不要删除 SET ROLE、降低 owner 限制或让运行角色接管对象。对扩展备注等可允许的非业务差异明确排除或精确校验，其他恢复错误必须失败。

**验收方法：** 先在原 0004 库写入非空合成数据，真实升级 / dump / restore，原样继续迁移；检查 schema/table/function owner、BYPASSRLS、ENABLE/FORCE、ACL、迁移记录、行数 / 哈希和原件对应。恢复后再用真实运行角色执行隔离和 Worker 窄链；注入非备注恢复错误应使测试失败。原文件不改写。

**修复责任 / 复验：** Cursor Development，具备权限的环境执行者协助；独立 QA / Architecture Review。

### G1-V4-04 — Major — 部署剖面与授权样本验收仍未完成

**类型：** 原 G1 验收缺口，非已复现代码漏洞。  
**关联：** F21 / F24 / F26 / F28，V3-07。  
**证据位置：** [response-v4](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/m0-g1-response-v4.md:31)、[evidence-v4](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/m0-g1-evidence-v4.md:61)、原 [Prompt 2](/Users/johnny/Documents/GitHub/zhixue-saas/docs/prompts/cursor-repair-prompts.md:61) 及 L83；当前 [.github/workflows/m0.yml](/Users/johnny/Documents/GitHub/zhixue-saas/.github/workflows/m0.yml:17)。

**发现：** 本机 17.11 / Python 3.14.4 的运行证据已有价值；Compose / CI 的配置剖面尚未执行。获授权真实试卷与标准答案尚未提供，PoC 仍缺；mock 正常输出不能证明公式、拆题与答案匹配能力。

**风险：** 配置环境的启动 / 迁移 / Python 兼容性及最小 AI 业务可行性未验，不能按原准入基线退出 M0。不能编造质量阈值、假样本授权或把未执行改写成通过。

**修复 / 验收：** Cursor 在隔离 Compose / CI 剖面跑原迁移及包含本轮修复的集成套件，保留命令、依赖、原始结果和失败修复。项目负责人提供试卷 / 标准答案及允许使用的环境、端点授权；Cursor 用合成答卷执行已授权 PoC，记录解析 / 拆题 / 答案匹配、失败样例、耗时和成本，独立复验后由负责人做人工验收。真实学生数据仍在未授权范围。若要调整 G1 范围，应由负责人明确记录调整，而不是开发者自行降门槛。

**责任分工：** Cursor 修代码、执行和记录；环境执行者补部署运行条件；负责人负责样本与使用授权、最终人工验收；独立审查负责核验，不替代上述责任。

## 5. ADR 与决策状态

本轮修复不需要重新批准已有 M0 工作，也不将初稿建议整体升级为决策。

| ADR / 事项 | 本轮处理 |
|---|---|
| ADR-001 / 006 / 007 的 M0 隔离、attempt、接纳与保守 unknown 条款 | 按既决条款修新表与恢复流程；不恢复 ResumeAfterSettlement，不追加第二次未知付费调用 |
| ADR-002 的最小模块所有权与调用方事务 | 本轮公开端口 / 事务复用证据可记 Verified；完整业务模块拆分继续随 M1–M3 |
| ADR-010 的迁移 / 环境与恢复 | 基本原样恢复仍未通过；生产 RPO / RTO、云平台和后续细节不由本轮代定 |
| ADR-013 的校准 / 质量基准 | 本轮仅证明合同验证与 mock 流程；真实题型基准与阈值仍待授权样本及实测 |
| G1 的 PoC / 部署验收范围 | 原条款仍有效；没有收到新的明确范围调整，不代负责人填写豁免 |

## 6. 优先修复路线

1. **P0 — 关闭 V4-01。** 新迁移真正启用新表 RLS，补真实角色 / 无上下文 / 跨租户凭据读写测试。修复后先重跑 claim、takeover、observed 和队列丢失，避免启用 RLS 后破坏恢复。
2. **P1 — 关闭 V4-02/03。** 同批补新表关联与世代约束，并建立保留权限模型的恢复流程。空库、原 0004 有数据升级、非空 dump/restore 后原样迁移各自独立验收，不用彼此替代。
3. **P1 — 完成 V4-04。** 并行准备部署运行条件与授权试卷 / 标准答案；技术修复后跑 Compose / CI 与 PoC。没有样本时继续记录待验，不拖入真实学生数据。
4. **重新提交 G1。** 新建 response-v5 / evidence-v5，更新 Findings 追踪表中“代码完成 / 开发者测试 / 独立复验”三列。保留本次已通过断言、加入本次反例回归并提交可复现输入快照。最终仍需要负责人人工验收。

下一轮无须推倒重做已验证的 M0 窄切片；按随附 [Cursor 修复 Prompt V4](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/outputs/cursor-m0-g1-remediation-prompt-v4.md) 收口。

## 7. Gate 判定与交付

| Gate | 本轮结论 | 依据 |
|---|---|---|
| 已授权 M0 内继续修复 | 允许 | G0 既决范围仍在；本轮未要求新的产品能力 |
| G1 / M0 退出、进入 M1 | **No-Go** | 一个已复现 Critical、两项实现 / 恢复 Major 与一项原验收缺口未关闭 |
| 真实学生、完整阅卷、生产 | 不在本次授权 / 验收范围 | 不以本机 mock 通过替代后续门槛 |

当本轮 DB 隔离、关联和恢复问题关闭、部署与 PoC 证据齐备或负责人明确调整准入范围后，再作 Go / Conditional Go 评估。本轮不发提前通过证明。

随附 evidence JSON、冻结输入 ZIP、独立原始运行 ZIP、README 和 Cursor 交接包。独立 JSON 中 counterexample reproduced 表示成功证明缺陷，不能解释成产品通过。
