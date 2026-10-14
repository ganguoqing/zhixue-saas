# ADR-001 共享 PostgreSQL 的租户复合外键与 RLS

- **状态：** Proposed（2026-10-12 修订，未签署）
- **日期：** 2026-10-11；修订 2026-10-12
- **决策责任：** 项目负责人。本文不代为填写 Accepted。
- **2026-10-12 撤回：** “所有子表一律 MATCH FULL”。可选父引用改为 MATCH SIMPLE，并另有非空 `tenant_id → tenants`。后台租户上下文见授权矩阵 v2，不使用 migrator。
- **关联：** R01、R12、R19、R20；F01、F15
- **证据：** 架构初稿 §5 只建议评估 RLS。确认记录接受了共享应用上的逻辑隔离和模块化单体，没有接受 RLS 本身。

## 问题

学校数据要在共享 PostgreSQL 中隔离。单列外键不能证明子行与父行同属一个租户。RLS 是否启用、由哪个数据库角色执行，决定 G0 之后的迁移和连接池。

## 方案

### A. 推荐：应用授权 + 复合外键 + RLS 租户边界

- 租户表 `tenant_id NOT NULL`，并单独外键到 `tenants`。必要父子用与目标唯一键列集合相同的 `MATCH FULL`。可选父 id 用 `MATCH SIMPLE`，避免 `(tenant, NULL)` 被拒绝。全局学科/年级外键不含 tenant。指针只指向已发布事实表 `score_versions(tenant_id, participation_id, id)`。控制索引表不启用 RLS，由无 `BYPASSRLS` 的 `zhixue_router` 函数解析，见 `authorization-matrix-v2.md`。
- 表所有者为 `zhixue_owner`，并 `FORCE ROW LEVEL SECURITY`。
- `zhixue_migrator` 单独拥有 `BYPASSRLS`，只用于迁移。
- `zhixue_app` 无 `BYPASSRLS`。策略同时具备 `USING` 与 `WITH CHECK`。`app.tenant_id` 缺失时不匹配任何行，写入失败。
- 事务内 `set_config(..., true)`。连接取出时 `RESET`。
- `zhixue_ai_ingress` 不能写正式成绩。`zhixue_platform_ops` 不能读答卷和成绩。
- 班级、学科范围仍由 `data_scope_grants` 在每个命令中检查。
- 平台内容使用无 `tenant_id` 的独立表，经授权复制为租户快照。

### B. 不启用 RLS，只用应用过滤

每个查询、导出、后台任务和原生 SQL 都必须带租户条件，并用漏过滤测试证明。PostgreSQL 不会在数据库层挡住漏写的查询。审查报告把“以后再评估”视为不能关闭 F15。

### C. 每校独立 schema 或数据库

隔离更强，但与已确认的共享应用、逻辑隔离起步不一致，运维和迁移成本更高。不作为推荐。

## 推荐与未决

推荐 A。在被接受之前，实现阶段不能自行宣布 RLS 已批准，也不能自行改为 C。

## 代价

FORCE RLS 使所有者也会受策略约束，所以迁移必须走 `zhixue_migrator`。连接池若使用会话级 `SET`，会串租户。RLS 不检查外键另一侧是否“对当前用户可见”，因此复合外键仍然要建。

## 兼容与回退

先加列、唯一键和外键，再启用 RLS，属于 expand。关闭 RLS 不能替代应用授权。已写入的跨租户脏数据要先清洗，不能靠打开 RLS 自动修复。

## 故障模型

无上下文、A→B→无上下文的连接复用、owner 身份运行应用、跨租户插入、同租户跨卷引用，都应失败。这些测试未运行。

## 验收

真实 `zhixue_app` 下，跨租户 SELECT/INSERT/UPDATE/DELETE、JOIN、导出和后台任务被拒绝；无上下文写入失败；`zhixue_ai_ingress` 插入 `score_versions` 失败；迁移角色不在应用池中。
