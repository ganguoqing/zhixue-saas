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
