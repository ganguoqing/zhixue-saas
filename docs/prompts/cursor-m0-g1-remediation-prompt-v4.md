# Cursor — M0 / G1 复验 V4 后的收口修复 Prompt

把本文件交给当前 zhixue-saas 项目的 Cursor Development Agent。将随附审查报告、evidence 和原始证据放入项目 docs/quality-reports / evidence 后执行。此任务承接已授权 M0，不是重新做架构设计或进入 M1。

你是智学 SaaS Cursor Development Agent。处理独立复验 ZX-AR-20261014-04 的 G1-V4-01–04。当前 G1 为 No-Go，授权仅限既决 M0 窄切片。不要实现完整阅卷、真实学生接入或生产部署，不修改原需求 / 原设计，不整体把 ADR 标 Accepted，不擅自调整 G1 条款。

先读：

- AGENTS.md、2026-10-13 G0 决议记录、原 Prompt 2。
- architecture-m0-g1-re-review-report-v4.md、architecture-m0-g1-re-review-evidence-v4.json、独立 run README / ZIP。
- m0-g1-response-v4.md、m0-g1-evidence-v4.md、Findings 追踪表。
- 0001–0006 迁移、store 的 claim / takeover / dispatch / continue、模块 ports、现有 g1 测试与恢复流程。

保留本轮已通过的行为和 Python Worker 路线，禁止覆写历史迁移。所有修复放进追加迁移 / 正常源码；测试不能删除 SET ROLE、关闭 RLS/CHECK/FK、使用运行角色 BYPASSRLS、改失败为成功或生成正式成绩以求通过。用新建隔离数据库、独立 Redis 前缀和对象目录，不重置共享库，不改共享角色密码。

## A. P0：G1-V4-01 — 新投递表 RLS

独立原样新库显示 delivery_intents relrowsecurity=false、relforcerowsecurity=true。ingress / reconciler 在 B 或无上下文下可读 A 的 lease_token、修改 A 行。追加迁移显式 ENABLE + FORCE；按既决职责核对 USING、WITH CHECK、最小列权限。跨租户协调扫描走受限函数，不扩大直表权限。升级已有 0006 数据时也必须生效。

验收：真实 ingress / reconciler 的 A/B/无上下文 SELECT/INSERT/UPDATE 矩阵；B 不读 A 凭据、不写 A；目录两个 RLS 标志均 true；owner / 函数属主保持 NOBYPASSRLS；正常 claim、takeover、observed、Redis 恢复仍通过。不要只测试 submissions 旧表。

## B. P1：G1-V4-02 — 意图关联与世代

新表无 parent FK，可接受不存在 job/attempt、另一个作业的 attempt、合法父行上的 epoch/generation 0。追加同租户 job FK 和 (tenant_id,job_id,attempt_id) FK，复用已存在 execution_attempts 的复合键；补正数约束及 attempt epoch 一致性。控制快照与权威 job/attempt 的一致性沿既决协议实现。先检查旧行，明确处理不一致与升级失败策略，不静默丢弃处理中数据。

验收：实际运行角色拒绝上述负例及跨租户父引用；正常初始 claim、接管、恢复继续通过。空库、已有数据升级、恢复后均验，不能用读时过滤代替写时约束。

## C. P1：G1-V4-03 — 原样迁移的有数据恢复

当前 --no-owner 恢复让 20 个 SECURITY DEFINER 函数属于 BYPASSRLS migrator；原样 0006 报 permission denied for schema zhixue。测试剥离 SET ROLE 不构成通过。实现独立恢复入口或明确恢复程序，保留 / 重建 schema/table/function owner、router/owner 分工、ACL、RLS、search_path 和迁移记录；用受控离线身份恢复，结束后恢复原运行权限模型。后续执行原 migration 文件，禁止删 SET ROLE。

不要无条件接受 pg_restore exit 1。对本次 pgcrypto COMMENT 这样的允许差异精确排除 / 校验，其余恢复错误必须失败。

验收：原 0004 schema 先写非空合成数据；有数据原样升级和真实 dump/restore 是分别的检查。恢复后原样迁移到当前版本；验证行数 / 关键哈希、对象对应、owners、rolbypassrls=false、ACL、ENABLE/FORCE、迁移版本，再跑真实角色隔离和 Worker 窄链。注入一个非备注恢复错误，测试必须失败。原件、审计、任务不静默消失。

## D. G1-V4-04 — 部署与 PoC 证据

跑配置中的 Docker / Compose 和 CI 版本剖面，记录版本、命令、原始结果和失败修复。本机 PG17.11 / Python3.14.4 不能替代 Compose / CI 剖面。

授权试卷和标准答案须由负责人提供并明确环境 / 端点使用范围。可先准备 PoC 接口与样本授权清单；得到授权后使用合成答卷执行最小解析、公式、拆题、答案匹配、异常、耗时 / 成本报告。不使用真实学生数据，不编造质量指标或授权。缺外部条件如实列待验；不自行豁免原 Prompt 2 的 G1 条款。

## E. 将已通过的独立断言纳入稳定回归

- 正常原生 Worker model_grade -> 1 proposal、1 invocation / permit 扣减、0 score_versions；provider 500 / 坏 JSON / 非法 UUID / 缺保存结果正确异常化，deadline 一次释放。
- model_grade / validate 真正 SIGKILL 接管；unknown 不二次调用；observed 保存后续跑只使用已有结果。
- 同作业双 takeover：201/409，1 admission、1 invocation、1 proposal；入队后 ACK 前中断，双 reconcile 保留同 dispatch，最终只调用一次。
- 清扫 / finalize 行锁竞争原件保留；PDF/PNG/JPEG 二进制哈希与授权拒绝。
- relay 提交前回滚必须先创建实际 pending event：回滚后 notice/inbox 0、状态 pending；重放后各 1 / delivered。不能在空 pending 集合上抛错后声称投影回滚通过。
- 真实同一 Pool backend PID 的 A->B->无上下文，以及同池并发租户请求 / 释放后检查。当前名为 rls_pool 的三个独立 Client 不等于连接池复用，补实际池断言。
- 原重复 rubric / 小数计分、Worker 环境白名单、服务身份 / scope / exp / jti、默认 cap、300 项 295/5 且仅重跑 5 项继续保持。

## 提交要求

1. 源码和追加迁移；恢复入口 / 文档；更新稳定回归。
2. 新建 m0-g1-response-v5.md、m0-g1-evidence-v5.md，按 G1-V4-01–04 逐项给证据路径与实际结果。保留旧轮次。
3. 固定输入快照 / 文件哈希（不能只报 HEAD；本项目有未提交和未跟踪源码）、隔离资源名称、依赖版本、完整命令与原始结果。说明任何 harness 调整。
4. Findings 追踪表分别记录“代码完成 / 开发者实测 / 独立复验”。不代独立审查填写 Verified，不把 F01–F28 整体 Closed。
5. 仍缺样本 / 环境 / 人工验收的事项及责任人。不要仅凭测试进程 exit 0 宣布 G1 Go。

先完成 A/B/C 的现有范围内修复并自测；D 的外部条件可并行准备。不为这些既决修复重新请求产品审批。
