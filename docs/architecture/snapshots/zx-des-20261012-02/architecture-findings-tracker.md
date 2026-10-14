# 架构发现追踪表

**编号：** ZX-FT-20261012-02  
**日期：** 2026-10-12  
**历史：** 2026-10-11 的 ZX-FT-20261011-01 曾把“ADR 未签署且测试未跑”一起写成 G0 不满足。ZX-AR-20261012-02 要求分开。本表从本日起分列四个状态。原 F 的编号和严重度不改。

| 列 | 本轮允许的值 | 本轮不用 |
|---|---|---|
| design_review | `revised_pending_rereview`：v2 已提交，独立审查尚未复验 | 不写“设计通过” |
| decision | `proposed` | 不写 Accepted |
| implementation | `not_started` | — |
| verification | `not_run` | 不写 Verified、Closed |

作者不宣布 G0 通过。G1 测试未跑只记录在 verification，不再单独推导 G0 失败。

## G0-01–G0-13

| ID | 严重度 | 原 F | design_review | decision | implementation | verification | v2 位置 |
|---|---|---|---|---|---|---|---|
| G0-01 | Blocker | F01/F04/F15 | revised_pending_rereview | proposed ADR-001/006 | not_started | not_run | 数据字典 §1、§3；SQL 草案 |
| G0-02 | Blocker | F08/F13/F15/F16 | revised_pending_rereview | proposed ADR-001/003/005 | not_started | not_run | `authorization-matrix-v2.md` |
| G0-03 | Critical | F03/F04/F19/F20 | revised_pending_rereview | proposed ADR-006/007 | not_started | not_run | 数据字典 §2、§4 |
| G0-04 | Critical | F02/F11/F18 | revised_pending_rereview | proposed ADR-006/011 | not_started | not_run | 数据字典 §5、§7 |
| G0-05 | Critical | F06/F18/F19/F20 | revised_pending_rereview | proposed ADR-007/015 | not_started | not_run | 数据字典 §6 |
| G0-06 | Critical | F12/F18/F19 | revised_pending_rereview | proposed ADR-007 | not_started | not_run | `state-transitions.md` |
| G0-07 | Critical | F11/F13/F19 | revised_pending_rereview | proposed ADR-003/004 | not_started | not_run | 事务文档 §4–§5 |
| G0-08 | Critical | F12/F14/F22 | revised_pending_rereview | proposed ADR-012/013 | not_started | not_run | 事务文档 §2–§3 |
| G0-09 | Critical | F09/F20 | revised_pending_rereview | proposed ADR-005/006/007 | not_started | not_run | 事务文档 §6 |
| G0-10 | Major | F12/F14/F17/F27 | revised_pending_rereview | proposed ADR-012 | not_started | not_run | 事务文档 §7 |
| G0-11 | Critical | F21/F22/F23 | revised_pending_rereview | proposed ADR-003/013 | not_started | not_run | `schemas/grading-contract-v2.md` |
| G0-12 | Major | F27/F28 | revised_pending_rereview | proposed，待负责人 | not_started | not_run | `g0-design-response-v2.md` |
| G0-13 | Major | F07/F08 | revised_pending_rereview | proposed ADR-002/005 | not_started | not_run | `module-adjacency-v2.md` |

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

## 未运行

RLS、复合外键、连接池、Outbox 崩溃、Python/Node BullMQ、双端 schema、对象存储、供应商调用、备份恢复、学校样本、公平调度。以上 verification 都是 `not_run`。
