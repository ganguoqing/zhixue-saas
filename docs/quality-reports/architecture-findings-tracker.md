# 架构发现追踪表

**编号：** ZX-FT-20261013-01  
**日期：** 2026-10-13  
**历史：** 先前四列保留。ZX-AR-20261013-01 将 R5-01/02 的 design_review 记为通过但待决。R6-01 只修正术语。原 F/G0/R3/R4 的编号、严重度和运行关闭门槛不改。

**2026-10-13 决议：** 项目负责人接受决议清单第 2 节 M0 条款和第 3 节保守政策。原文见 `docs/decisions/g0-decision-record-20261013.md`。这不是整份 ADR Accepted，也不是 Finding Closed。R5-01、R5-02、R6-01 的 decision 改为 `m0_scope_accepted_20261013`。

**2026-10-13 M0 运行：** 窄切片集成测试有一次通过记录，原文见 `docs/quality-reports/m0-g1-evidence.md`。`m0_slice_present` 和 `m0_evidence_recorded` 只表示这次合成数据运行碰到了对应机制。它们不是 Closed，也不是 Verified，更不是 G1 通过。F、G0、R3、R4 的实现列仍是 `not_started`，因为可运行 SQL 是 M0 子集，不是完整核心链。

| 列 | 本轮允许的值 | 本轮不用 |
|---|---|---|
| design_review | 独立报告已给的处置，或 `submitted_v5_pending_rereview` | 不写 Verified。不把本轮提交写成设计通过 |
| decision | `proposed` | 不写 Accepted |
| implementation | `not_started`，或这次运行用的 `m0_slice_present` | 不写完整实现完成 |
| verification | `not_run`，或这次运行用的 `m0_evidence_recorded` | 不写 Verified、Closed |

作者不宣布 G0 通过，也不宣布 G1 通过。设计通过不等于运行验证通过。

**2026-10-14 G1 修复记录：** ZX-AR-20261014-01 仍是 No-Go。下面的矩阵只记录开发者这次改了什么、测到什么。`independent_verified` 全部是 `not_run`。没有一项原 Finding 被标成 Closed。

## G0-01–G0-13

| ID | 严重度 | 原 F | design_review | decision | implementation | verification | v2 位置 |
|---|---|---|---|---|---|---|---|
| G0-01 | Blocker | F01/F04/F15 | submitted_v3_pending_rereview | proposed ADR-001/006 | not_started | not_run | `core-chain-v3.sql`；数据字典 §3 |
| G0-02 | Blocker | F08/F13/F15/F16 | submitted_v3_pending_rereview | proposed ADR-001/003/005 | not_started | not_run | 授权矩阵第 0 节 |
| G0-03 | Critical | F03/F04/F19/F20 | design_passed_pending_decision；R3-01 的封存写入需再复验 | proposed ADR-006/007 | not_started | not_run | 数据字典 §2、§4；v3 发布函数 |
| G0-04 | Critical | F02/F11/F18 | submitted_v3_pending_rereview | proposed ADR-006/011 | not_started | not_run | 数据字典 §5；`core-chain-v3.sql` |
| G0-05 | Critical | F06/F18/F19/F20 | design_passed_pending_decision；正式 item 外键随 R3-01 再复验 | proposed ADR-007/015 | not_started | not_run | 数据字典 §6 |
| G0-06 | Critical | F12/F18/F19 | submitted_v3_pending_rereview | proposed ADR-007 | not_started | not_run | 状态文档；契约索引第 4 节 |
| G0-07 | Critical | F11/F13/F19 | submitted_v3_pending_rereview | proposed ADR-003/004 | not_started | not_run | 事务文档 §4–§5 |
| G0-08 | Critical | F12/F14/F22 | submitted_v3_pending_rereview | proposed ADR-012/013 | not_started | not_run | 事务文档 §2–§3 |
| G0-09 | Critical | F09/F20 | submitted_v3_pending_rereview | proposed ADR-005/006/007 | not_started | not_run | 事务文档 §6 |
| G0-10 | Major | F12/F14/F17/F27 | submitted_v3_pending_rereview | proposed ADR-012 | not_started | not_run | 事务文档 §7 |
| G0-11 | Critical | F21/F22/F23 | design_passed_with_followups；R3-03/08 待复验 | proposed ADR-003/013 | not_started | not_run | 评分契约；stage 信封在事务文档 §4 |
| G0-12 | Major | F27/F28 | design_passed_pending_decision | proposed，待负责人 | not_started | not_run | 本表与 `g0-design-response-v3.md` |
| G0-13 | Major | F07/F08 | submitted_v3_pending_rereview | proposed ADR-002/005 | not_started | not_run | 邻接 v2 第 2.1 节；契约索引 |

## F01–F28

严重度保持 ZX-AR-20261011-01。处置用语沿用 ZX-AR-20261012-02 第 5 节，并加上 v2 是否补了当时指出的缺口。全部 Closed = 否，Verified = 否。

| 原 ID | 严重度 | 复验处置 | v2 补修 | design_review | decision | implementation | verification |
|---|---|---|---|---|---|---|---|
| F01 | Blocker | 需补修 | G0-01/04 的键与版本 | revised_pending_rereview | proposed | not_started | not_run |
| F02 | Major | 时间模型可保留 | 名单版本键 G0-04 | revised_pending_rereview | proposed | not_started | not_run |
| F03 | Critical | 冻结方向可保留 | 事实表与页/名单版本 | revised_pending_rereview | proposed | not_started | not_run |
| F04 | Critical | 需补修 | 指针目标与 basis | revised_pending_rereview | proposed | not_started | not_run |
| F05 | Major | 授权方向可保留 | 审核改生命周期列 | revised_pending_rereview | proposed | not_started | not_run |
| F06 | Major | 范围在，路径要补 | total_only 发布路径 | revised_pending_rereview | proposed | not_started | not_run |
| F07 | Major | 所有权可保留 | 邻接矩阵 G0-13 | revised_pending_rereview | proposed | not_started | not_run |
| F08 | Blocker | 协议方向可保留 | 后台角色与 event/2 | revised_pending_rereview | proposed | not_started | not_run |
| F09 | Critical | 需补修 | 证据集合与 fence | revised_pending_rereview | proposed | not_started | not_run |
| F10 | Major | 路线明确 | 无栈变更。互操作仍属 G1 | revised_pending_rereview | proposed；栈已由 R19 确认 | not_started | not_run |
| F11 | Critical | 需补修 | 当前 attempt CAS | revised_pending_rereview | proposed | not_started | not_run |
| F12 | Critical | 部分可保留 | 恢复边、intent、轮转 | revised_pending_rereview | proposed | not_started | not_run |
| F13 | Critical | 需补修 | scope、拒绝表、jti | revised_pending_rereview | proposed | not_started | not_run |
| F14 | Major | 需补修；丢账场景在 G0-08 另列 Critical | intent 与差额账 | revised_pending_rereview | proposed | not_started | not_run |
| F15 | Blocker | 需补修 | RLS 与路由函数 | revised_pending_rereview | proposed | not_started | not_run |
| F16 | Critical | 方向可保留 | 读包权限与 page_set | revised_pending_rereview | proposed | not_started | not_run |
| F17 | Major | 需补修 | 轮转与分 stage | revised_pending_rereview | proposed | not_started | not_run |
| F18 | Critical | 需补修 | 绑定、缺考、空白记零 | revised_pending_rereview | proposed | not_started | not_run |
| F19 | Critical | 需补修 | 状态边写到列 | revised_pending_rereview | proposed | not_started | not_run |
| F20 | Critical | 一次发布方向可审 | basis 与旧指针不改内容 | revised_pending_rereview | proposed | not_started | not_run |
| F21 | Critical | 需补修 | 双层 schema | revised_pending_rereview | proposed | not_started | not_run |
| F22 | Major | 谱系方向可保留 | 元数据不来自模型自报 | revised_pending_rereview | proposed | not_started | not_run |
| F23 | Major | 默认人工可保留 | 未填阈值 | revised_pending_rereview | proposed | not_started | not_run |
| F24 | Critical | M0 边界可保留 | 端点默认 mock、学生数据禁止 | revised_pending_rereview | proposed | not_started | not_run |
| F25 | Major | 指标清单可保留 | M0 三个指标名 | revised_pending_rereview | proposed | not_started | not_run |
| F26 | Critical | 方向可保留 | M0 环境与单迁移者 | revised_pending_rereview | proposed | not_started | not_run |
| F27 | Major | 落位可保留 | 门槛拆开 | revised_pending_rereview | proposed | not_started | not_run |
| F28 | Minor | 术语可保留 | event/2 与邻接 | revised_pending_rereview | proposed | not_started | not_run |

## R3-01–R3-08

来源 ZX-AR-20261012-03。不与 F、G0 相加计数。本轮提交后等待独立复验。decision 仍是 proposed，没有 Accepted。

| ID | 严重度 | 关联 | design_review | decision | implementation | verification |
|---|---|---|---|---|---|---|
| R3-01 | Blocker | G0-01/04/06 | partially_addressed；R4-01 已提交待复验 | proposed ADR-001/006/011 | not_started | not_run |
| R3-02 | Blocker | G0-02 | partially_addressed；R4-02 已提交待复验 | proposed ADR-001/003/005 | not_started | not_run |
| R3-03 | Critical | G0-07/11 | design_passed_pending_decision；接管边随 R4-03 再复验 | proposed ADR-003/004/013 | not_started | not_run |
| R3-04 | Critical | G0-09 | design_passed_pending_decision；字段名随 R4-04 再复验 | proposed ADR-005/006/007 | not_started | not_run |
| R3-05 | Critical | G0-10 | partially_addressed；已消耗槽随 R4-03 再复验 | proposed ADR-012 | not_started | not_run |
| R3-06 | Critical | G0-08 | design_passed_pending_decision；scope 表随 R4-04 再复验 | proposed ADR-012/013 | not_started | not_run |
| R3-07 | Major | G0-09/13 | partially_addressed；权限文字随 R4-04 再复验 | proposed ADR-002/004/005/006/007 | not_started | not_run |
| R3-08 | Minor | G0-11 | design_passed_pending_verification | proposed ADR-013 | not_started | not_run |

## R4-01–R4-04

来源 ZX-AR-20261012-04。不与 F、G0、R3 相加。decision 仍是 proposed。

| ID | 严重度 | 关联 | design_review | decision | implementation | verification |
|---|---|---|---|---|---|---|
| R4-01 | Blocker | R3-01 | design_passed_pending_decision；queued binding 随 R5-02 再复验 | proposed ADR-001/006/011 | not_started | not_run |
| R4-02 | Critical | R3-02 | design_passed_pending_decision | proposed ADR-001/003/005 | not_started | not_run |
| R4-03 | Critical | R3-05 | partially_addressed；unknown 恢复随 R5-01 再复验 | proposed ADR-004/012 | not_started | not_run |
| R4-04 | Major | R3-07 | design_passed_with_followups | proposed ADR-002/007 | not_started | not_run |

## R5-01–R5-02

来源 ZX-AR-20261012-05。不与 F、G0、R3、R4 相加。选定保守恢复政策，ADR 仍 Proposed。

| ID | 严重度 | 关联 | design_review | decision | implementation | verification |
|---|---|---|---|---|---|---|
| R5-01 | Critical | R4-03 | design_passed_pending_decision | m0_scope_accepted_20261013 | m0_slice_present | m0_evidence_recorded |
| R5-02 | Major | R4-01/03 | design_passed_pending_decision | m0_scope_accepted_20261013 | m0_slice_present | not_run |

## R6-01

来源 ZX-AR-20261013-01。Minor。`AbandonUnknownCost` 的 From 现为 `cost_status=unknown`，`send_state=send_unknown` 另列。未知金额不写 0。合成运行里放弃结果保持金额空、显示「未知」，任务状态不变。

| ID | 严重度 | 关联 | design_review | decision | implementation | verification |
|---|---|---|---|---|---|---|
| R6-01 | Minor | F28；ADR-012 | terminology_corrected | m0_scope_accepted_20261013 | m0_slice_present | m0_evidence_recorded |

## 这次合成运行碰到的机制

RLS 与空租户上下文、名单复合外键拒绝、应用连接池、三次崩溃窗口、Redis 清空后重发、BullMQ 与 Python Worker、双 schema 拒绝与一份合法建议、本地文件清扫、测试 cap 2/4、过期接管、unknown 停放与放弃、capability 重发、旧 fence 拒绝、结算幂等重放、300/295/5 重跑、本机 pg_dump 后补列。原始记录在 `var/m0-g1-raw.json`。

## 仍未运行

Docker Compose 所写的 PostgreSQL 16.10、CI 工作流、真实模型供应商、生产备份演练、学校样本、公平调度、R5-02 的绑定负例、完整阅卷、真实学生数据和生产部署。以上不能写成 Verified。

## 2026-10-14 G1-01–10 开发者矩阵

设计来自现行 v5 契约。范围来自 2026-10-13 决议。独立验证留给下一轮 Architecture Review。`developer_tested` 只表示 `tests/m0/g1.integration.test.mjs` 这次隔离运行碰到的行为。

| ID | design | accepted_scope | m0_implemented | developer_tested | independent_verified | future_milestone |
|---|---|---|---|---|---|---|
| G1-01 | 校内 action/class/subject/当前 membership | M0 | 写入和重放前检查；终态 cancel 返回 409 与实际状态 | 同校无范围读/取消 403；成功任务取消 409 `succeeded`。撤权和手工草稿一次未在这次运行中断言 | not_run | 不进入 M1 |
| G1-02 | IssueSendPermit 后才能 HTTP | M0 保守 unknown | 许可 epoch CAS；超时留下 send_unknown | 付费 mock 超时后任务进入 `awaiting_settlement`。进程杀死窗口和双恢复者未跑 | not_run | 不自动第二次付费 |
| G1-03 | 接纳绑定真实 invocation | M0 | 控制字段和 job/attempt/invocation 一致才接纳 | 令牌 attempt 不一致为 403。不存在的 invocation、错任务结算未在这次运行中断言 | not_run | — |
| G1-04 | 双端 schema 与题目集合 | M0 最小 fixture | Worker 读取 HTTP 状态；校验失败不写成正式成绩 | 校验任务按 provider 的 `accepted` 完成。500、坏 JSON、语义负例和 300 项未跑 | not_run | 授权试卷 PoC 仍缺资料 |
| G1-05 | 调度/relay/reconciler 自动推进 | M0 cap 与轮转 | `supervisor.ts` 周期调用维护 | 上述超时停放没有手调 `/internal/reconcile`。默认 cap 下 3 项积压、轮转和 Redis 丢失未单独断言 | not_run | — |
| G1-06 | 上传会话与按年龄清扫 | M0 | 临时路径、committing 会话、`object_is_live` | 这次运行没有并发清扫断言 | not_run | — |
| G1-07 | 已实现实体的复合外键 | M0 | `0003_g1_controls.sql` | ingress 插入不存在 job 的 attempt，提交时 23503。R5-02 绑定负例未跑 | not_run | 完整题库仍属后续 |
| G1-08 | Worker 不能签发全部服务权限 | M0 | 分开发行人密钥、exp、jti | 重用 jti 为 401；Worker 密钥签发 billing scope 为 403 | not_run | — |
| G1-09 | Outbox 与 consumer 同事务 | M0 最小效果 | relay 写入 `asset_notices` 与 inbox 后才 delivered | 这次运行没有断言 notice 行，也没有杀 relay | not_run | 不实现 M1–M3 全图 |
| G1-10 | 隔离运行与原始日志 | M0 | 迁移锁内重查；CI 改为 `npm ci` | 隔离库 `zhixue_m0_g1v2`、Redis DB 2。Docker 不可用，CI 未执行，有数据的 dump/restore 未跑 | not_run | — |

## 2026-10-14 v3 关闭矩阵

`developer_tested` 只表示 `var/runs/1791954241082` 这次本地隔离运行。`independent_verified` 仍是 `not_run`。没有把 F01–F28 标成 Closed，也没有宣布 G1 通过。

| ID | implementation | developer_tested | independent_verified | future_stage |
|---|---|---|---|---|
| G1-V2-01 | Worker 仅在本次签发许可后 HTTP；已有 send_unknown/observed 不再请求 | 超时停放已观察到。重入计数和 SIGKILL 未跑 | not_run | 不自动再付费 |
| G1-V2-02 | 接管后投递 execute_current；阶段失败协议；期限函数；维护步骤隔离 | 代码已进工作区。Worker 接手新 attempt、500/坏 JSON、无 Worker deadline 未跑 | not_run | — |
| G1-V2-03 | criterion 去重；两位小数整数单位；page_count 与 ocr_char_count | 重复计分拒绝；0.10+0.20=0.30 通过且正式分为 0 | not_run | 授权试卷 PoC 仍缺 |
| G1-V2-04 | 成功后释放临时键；过期 committing 可回收 | 未做并发清扫 | not_run | — |
| G1-V2-05 | Worker 启动环境白名单 | 进程环境没有 billing/migrator/bootstrap 密钥 | not_run | — |
| G1-V2-06 | 0004 把定义者函数改属 zhixue_owner | proowner 与 rolbypassrls 已查询。relay kill 未跑 | not_run | 不实现 M1–M3 全图 |
| G1-V2-07 | run-isolated 分剖面；CI 不再调用旧套件 | 本地剖面 exit 0，独立 run 目录。Compose/CI 未跑 | not_run | — |
| G1-01 | 保持 v2 授权 | 无范围 403；终态 409。撤权和 manual 并发未跑 | not_run | — |
| G1-02 | 保持许可，并挡住重入 | 超时停放。杀死窗口未跑 | not_run | — |
| G1-03 | 保持归属检查 | 令牌 attempt 不一致 403。业务接纳负例未全部打到 | not_run | — |
| G1-04 | 语义与阶段失败已补 | 小数和重复计分已测。500/坏 JSON/300 项未跑 | not_run | PoC 资料仍缺 |
| G1-05 | supervisor 与接管投递 | 自动停放。第三项、轮转、Redis 中断未跑 | not_run | — |
| G1-06 | 临时文件收尾已补 | 并发清扫未跑 | not_run | — |
| G1-07 | 0003 外键保留 | missing job 23503。其余 FK 与 R5-02 未跑 | not_run | — |
| G1-08 | 分密钥与 jti 保留 | jti 401；环境白名单。新 jti 幂等重试未跑 | not_run | — |
| G1-09 | notice 事务保留 | 函数属主已查。relay kill 未跑 | not_run | — |
| G1-10 | 独立 run 目录 | 本地 exit 0。备份恢复和 CI 未跑 | not_run | — |

## 2026-10-14 v4 关闭矩阵

`developer_tested` 只表示 `var/runs/1791973007411` 这次本地隔离运行，退出码 0。`independent_verified` 仍是 `not_run`。F01–F28 不标 Closed。不宣布 G1 或 M1 通过。

| ID | implementation | developer_tested | independent_verified | future_stage |
|---|---|---|---|---|
| G1-V3-01 | Worker 成功路径用已解析响应构造信封 | 生产者到 Python Worker 到 mock 到 Nest 的 model_grade 成功：1 条 proposal、预算减 1、正式分 0 | not_run | 授权试卷 PoC 仍缺 |
| G1-V3-02 | 0005 扩展 result_status；阶段失败带围栏和收据 | provider_http、bad_json、schema_rejected、missing_persisted_result、deadline 已落状态。同体回放，异体 409，旧租约 409。升级恢复后的旧行改为 provider_http | not_run | — |
| G1-V3-03 | 接管返回 billable；attempt 与 delivery_intent 同事务；Worker 用 claim/continue 的阶段 | model_grade 与 validate 的 SIGKILL 接管由新 Worker 跑完。许可/HTTP/观察窗口没有第二次付费调用。提交后崩溃再从 Redis 前缀重建 | not_run | 两个接管者同时调用没有单独断言 |
| G1-V3-04 | finalize 的 CAS 与 claim_object_reclaim 共用行锁 | 专用库 1 秒租约加暂停 trigger：文件仍在且下载哈希一致。临时孤儿由两次清扫删除 | not_run | — |
| G1-V3-05 | 下载返回 StreamableFile | PDF/PNG/JPEG 的 HTTP sha256 等于元数据。跨校 404、跨班 403、撤权 403 | not_run | — |
| G1-V3-06 | Python FormatChecker 与 Ajv 使用同一 Schema | 合法信封两端通过；非法 UUID 两端拒绝。新响应和 observed 形状都验过 | not_run | — |
| G1-V3-07 | 评分、对象回收、通知三个公开端口由组合根装配，并在同一 UoW 内调用 | 正常链、relay 提交前崩溃回滚、默认 cap 2、300 项里 5 个失败只重跑这 5 个。Compose/CI 未跑 | not_run | 不实现 M1–M3 全图 |

## 2026-10-14 v5 关闭矩阵

`developer_tested` 只表示 `var/runs/1791977980126`。`independent_verified` 仍是 `not_run`。F01–F28 不标 Closed。不宣布 G1 Go。

| ID | implementation | developer_tested | independent_verified | future_stage |
|---|---|---|---|---|
| G1-V4-01 | 0007 对 delivery_intents 执行 ENABLE 和 FORCE。跨租户扫描仍走 list_open_deliveries | ingress / reconciler 在 B 和无上下文下读不到 A 的 lease_token，也不能写 A。两个 RLS 标志为 true。owner / router 无 BYPASSRLS。claim、接管、observed、Redis 恢复仍通过 | not_run | — |
| G1-V4-02 | 同租户 job / attempt / epoch 外键，epoch 与 generation 必须为正。不一致旧行使 0007 失败且不删除 | 不存在父行、另一个作业、epoch/generation 0、跨租户父引用被拒绝。正常 claim 与接管通过。不一致样本升级失败后原行仍在 | not_run | — |
| G1-V4-03 | restore-isolated.mjs 用不带 --no-owner 的 bootstrap 恢复，再执行原迁移文件。非 pgcrypto COMMENT 错误失败 | 0004 有数据原样升到 0007；另一次 dump/restore 后原样执行 0005–0007。属主不是 migrator，定义者函数 rolbypassrls=false。缺失 dump 使恢复失败。恢复库 Worker 窄链成功且正式分为 0 | not_run | — |
| G1-V4-04 | 保留 Compose / CI 配置，并写出 PoC 授权清单 | 本机 PG 17.11 / Python 3.14.4 套件通过。docker info 失败，Compose 与 CI 未执行。授权试卷和标准答案仍未提供 | not_run | 负责人提供样本与端点；环境执行者提供 Docker / CI |
