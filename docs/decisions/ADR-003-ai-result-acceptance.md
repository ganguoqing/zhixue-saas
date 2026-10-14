# ADR-003 AI 结果接纳的服务身份与业务写入边界

- **状态：** Proposed（2026-10-12 修订，未签署）
- **2026-10-13 M0 范围：** 项目负责人在对话中批准决议清单第 2 节对本 ADR「建议批准」列的条款，并接受第 3 节保守恢复政策。见 `g0-decision-record-20261013.md`。同表「仍保留待定」列和未列入的未来细节仍是 Proposed。本 ADR 整体不是 Accepted。
- **日期：** 2026-10-11；修订 2026-10-12
- **2026-10-12 撤回：** 单一 scope `ai.result.accept` 覆盖领取和读输入。现行能力分为 claim、read_input、renew、prepare_invocation、result.accept。租户经 `resolve_work_route` 建立。旧 attempt 不改变当前 job。见事务文档 v2 第 4 节。
- **决策责任：** 项目负责人
- **关联：** R07、R17、R19；F13、F21
- **证据：** 已确认 FastAPI 不拥有正式成绩。回传认证方式没有确认。

## 问题

Worker 把结果交给业务 API 时，必须证明调用者、任务、世代和租约。错误身份不能发布成绩。

## 方案

### A. 推荐：Worker 同步调用 NestJS 内部接纳

1. NestJS 生产者写入持久 job 与 outbox。
2. 官方 Python BullMQ Worker 领取队列。
3. Worker 向 NestJS 读取不含姓名的输入包。
4. Worker 调用 FastAPI 推理。
5. Worker 用短期凭据调用 NestJS。结果接纳这一步的 scope 才是 `ai.result.accept`。领取、读输入、续租和准备调用使用各自分立 scope，见授权矩阵 v2。
6. 租户、考试、学生以数据库 job 为准。

凭据含过期时间和 `jti`。FastAPI 不持有该凭据，也不连接成绩库。

### B. FastAPI 签名回调 NestJS

要额外做时间窗、nonce、密钥轮换和重放存储。信任面更大。

### C. Worker 直接写 PostgreSQL

绕过业务不变量。不推荐。

## 代价

方案 A 使 Worker 同时依赖 Redis 与 NestJS。NestJS 不可用时任务停留在可恢复的执行状态，而不是由 FastAPI 自行落账。短期凭据增加运维。

## 兼容与回退

若 A 的网络路径在 M0 证明不可用，可以改到 B，但必须新的 ADR 说明签名与重放，不能悄悄改为 C。FastAPI 不拥有业务生命周期这一条不回退。

## 故障模型

伪造结果、重放、过期凭据、错误租户、错误 job、旧 generation、旧租约、已取消任务、Worker 调用发布。合法重复应返回原结果。

## 验收

上述拒绝路径不写 `score_versions`。`zhixue_ai_ingress` 对正式分表没有插入权限。测试未运行。
