# 智学 SaaS Architecture Review Report — M0 / G1 独立复验 V1

**审查编号：ZX-AR-20261014-01**  
**日期：2026-10-14（Asia/Shanghai）**  
**角色：独立 Architecture Review Agent**  
**对象：** `m0-g1-evidence.md`、运行结果 `var/m0-g1-raw.json`、M0 源码、迁移、测试、CI 与现行 v5 契约。  
**源码提交：** `b1ed02397bb2b7f4ea2460e0392c9f12a94e223c`。源码证据以随附 SHA-256 清单和输入快照为准。

## 1. 执行摘要

**G1：No-Go。M0 尚不能退出，当前不能进入 M1。允许继续修复和验证已授权的 M0 窄切片。**

这不是撤回 v5 的 G0 设计结论。仓库有 2026-10-13 的范围决议记录，继续按该 M0 范围实施。本轮不代签 ADR、不批准真实学生数据、完整阅卷或生产部署。

Cursor 已交付可构建的 NestJS、Python Worker、FastAPI mock、PostgreSQL 迁移、Redis/BullMQ 原型及一次开发者集成运行记录。记录如实说明 Docker/CI、真实试卷与答案、部分负例没有运行，也没有擅自宣告 G1 通过；这部分报告口径可以保留。

但实现没有完整执行已批准的安全和恢复协议。发现 **10 项：Blocker 0、Critical 6、Major 4、Minor 0**。当前学校内写权限、发送前持久化许可、接纳来源、评分语义、后台自动推进和对象清理存在 M0 范围内问题，不能用单项集成测试通过代替闭合。

独立复验在隔离源码副本上 **TypeScript 编译通过**，运行 **10 个 Store 源码逻辑反例和 4 组 Worker 源码逻辑反例**，确认实际分支存在上述问题。数据库/HTTP 使用测试替身，这些反例证明控制逻辑缺失，**不证明实际 RLS、数据库约束或网络端到端结果**。本环境启动独立 PostgreSQL 被共享内存权限限制阻止；连接本机数据库被网络权限拒绝，因此没有重跑开发者的真实 DB/Redis 套件，也没有修改、重置或清扫用户的数据库/Redis/对象目录。

## 2. 审查依据、范围及证据等级

### 2.1 依据

- 原始 Architecture Review Report 的 G1 门槛（§8.2）及原 Prompt 2 的 M0 范围。
- ZX-AR-20261013-01 的 v5 结论与 `g0-decision-record-20261013.md` 的范围记录；该记录中的用户批准原文作为仓库提交的决议证据读取，本轮没有重新独立取得 Cursor 聊天的原始消息。
- 现行 `transaction-boundaries.md`、`state-transitions.md`、`module-adjacency-v2.md`、`authorization-matrix-v2.md`、`current-contract-index-v3.md` 及两份 JSON Schema。
- M0 源码与测试。初稿建议和尚未接受的后续 ADR 条款没有自动升级为要求。本轮只要求 M0 核心协议，不要求完成 M3 的完整阅卷、发布或校准算法。

### 2.2 证据区分

| 等级 | 本轮内容 | 可以支持的结论 |
|---|---|---|
| 开发者运行证据 | `m0-g1-evidence.md` 与 `var/m0-g1-raw.json` | 开发者报告本机 PG17/Redis 下运行过相应断言；未独立重跑 |
| 独立编译 | 隔离副本重新执行 TypeScript 构建，退出码 0 | 当前 API 源码可编译 |
| 独立源码逻辑反例 | Store 原方法 + 连接池替身；Worker 原方法 + HTTP 替身 | 真实方法的守卫、分支、请求顺序与返回值；不充作真实集成 |
| 静态核对 | SQL、调度入口、权限、测试与脚本 | 约束和调用链是否存在；故障时序推导 |
| 未完成 | 独立真实 DB/Redis/HTTP、Docker PG16、CI、授权试卷 PoC | 保持待验证，不宣称通过 |

**禁止把反例脚本的成功退出解释成产品测试通过：脚本成功表示缺陷被复现。**

## 3. Findings

### G1-01 — Critical — 校内写命令遗漏数据范围与实时撤权检查

**证据：** [store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:389) L389–437；读取接口 L139–190 有 `assertScope`，取消和人工恢复没有。`finalize` L221–225 在检查权限前直接返回租户级幂等收据。关联 F15/F19。

**反例：** `out_of_scope_cancel`、`out_of_scope_manual_recovery` 在没有任何班级/学科授权的 actor 下分别返回 cancelled 和新草稿 ID；源码方法没有查询数据范围。租户 RLS 只能限制学校，不能补上校内范围。静态核对还显示：成功后再次 cancel 返回 cancelled，但 UPDATE 的 `status='running'` 条件不匹配，实际终态可能未变。

**风险：** 同校教师知道任务 ID 即可取消或创建不属于自己范围的手工恢复草稿；权限撤回后旧 JWT 仍可执行这些写命令。幂等收据重放也可能绕过当次访问权检查并返回资源 ID。

**修复：** 在同一事务里按任务所属 submission 检查当前 membership、action、class、subject；幂等返回前也检查当前访问权。所有非法状态转换返回明确 409，返回值必须对应实际状态；M0 人工恢复至少保证单一有效恢复草稿与可重放收据，不能重复请求不断建草稿。

**验收：** 真实角色下，同校无范围教师对 cancel/manual/finalize 重放均拒绝且零副作用；撤权后旧令牌立即拒绝；跨租户保持 404/拒绝；允许 actor 成功；终态取消不返回虚假的新状态；并发、重复人工恢复只有一次业务效果。

### G1-02 — Critical — 在 HTTP 之后才标记 send_unknown，违背发送许可协议

**证据：** [worker.py](/Users/johnny/Documents/GitHub/zhixue-saas/apps/worker/worker.py:25) L25–60；[store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:617) L617–654、802–825；SQL L253–276 没有发送许可 epoch。现行事务规格 L21–41 要求先提交 `IssueSendPermit`，再做 HTTP。关联 F12/F14/R5-01。

**反例：** Worker 路径是 PrepareInvocation → HTTP `/infer` → 接纳；只有捕获 TimeoutException 后才 mark-send-unknown。实际调用已发送但进程被杀、响应丢失、标记 API 不可用时，数据库仍是 `not_sent`；接管仅检查有无 `send_unknown`，因此可能允许新 attempt 再调用。已有 unknown 超时的 happy path 测试没有覆盖这个窗口。

**风险：** 已批准的“不自动重复付费”不变量失效。PrepareInvocation 还没有要求 job 正在运行、当前租约有效；源码反例在 cancelled job 上也能创建调用 intent。

**修复：** 实现原批准的发送许可事务与 CAS：当前 job/attempt/epoch/lease/input/binding 和预算合法，许可 epoch 从 0 原子递增，状态提交为 send_unknown 后才允许 HTTP。观察和账务事实分开；许可已签发后的任何不确定结果进入可见恢复路径，不能重付费或改挂旧 invocation。不以禁止 M0 付费来跳过 mock 下的协议验证。

**验收：** 真实 DB + 记录请求次数的 mock provider，在 intent 后、许可后、HTTP 到达后、observation 前逐一杀进程；重启与两个恢复者竞争都不产生第二次发送许可/外部请求。取消、过期租约、旧 epoch 和超预算不能签发；账仍保持未知或合法对账。

### G1-03 — Critical — 接纳和费用命令没有绑定可信调用来源

**证据：** [store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:518) L518–615、640–654、690–778；[integration.test.mjs](/Users/johnny/Documents/GitHub/zhixue-saas/tests/m0/integration.test.mjs:532) L532–566 使用固定虚构 invocation/source asset。现行事务规格 L64–81 要求可信 job/attempt/input 与调用归属一致。关联 F11/F13/F22。

**反例：** `fabricated_invocation_accepted` 使用不存在的 invocation UUID，接纳逻辑没有读 invocation 而写入 proposal 并返回 succeeded。`mismatched_envelope_controls_accepted` 将信封的 job、attempt、generation、epoch、lease、hash 全部改为另一套值，外层字段仍合法时也接受。现有“合法信封”用例本身就在使用未证明存在的调用 ID。

**风险：** 结构合法的结果没有可信来源与模型配置谱系。markSendUnknown、abandon、settle 用传入 job 选择 tenant 后，仅按 invocation ID 写行；同租户另一任务的 invocation 可能被操作，jobId/调用对象之间没有一致性守卫。

**修复：** 消除两套不一致的控制字段，或逐字段严格一致校验；从持久化行核对 tenant/job/current attempt/epoch/input/binding/config/stage、调用状态和观察事实。所有费用/观察命令按点名的 job 与 invocation 的复合归属锁定，不只校验租户。重复接纳先查合法收据，身份授权必须仍满足契约。

**验收：** 不存在/同租户别任务/跨租户/旧 attempt/not_sent 的调用，控制字段不一致、错误模型配置等均拒绝且不改 job/proposal/账。使用真实存在的 invocation 和冻结配置构造正例；相同 body 的合法重试保持一次效果。成本命令错配 job/invocation 的负例必须零副作用。

### G1-04 — Critical — 语义校验与推理失败处理不足

**证据：** [store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:570) L570–605 只查询 `items[0]`；[worker.py](/Users/johnny/Documents/GitHub/zhixue-saas/apps/worker/worker.py:35) L35–79 忽略推理 HTTP 状态与响应内容；[main.py](/Users/johnny/Documents/GitHub/zhixue-saas/apps/inference/main.py:22) 只返回 mock 元信息。关联 F21/F22/F23。

**反例：** 第二道题未知、重复题目、9999.99 建议分与 1.00 评分点不符、反向 bbox、超大页码都被实际接纳方法写入 proposal；所有字段分别仍符合 JSON Schema。Worker 在 `/infer` 返回 HTTP 500 时仍提交 `ok=true`。付费响应成功分支不构造 envelope，无法作为真实 model_grade 正向闭环。Python 端没有调用两份 Schema 的验证。

**风险：** 测试目前的 295/5 来源于 `x-test-fail` 的请求提示，而不是根据实际推理结果判断。畸形评分建议可以成为“成功”任务，人工复核也缺少可核对的可信依据。

**修复：** Worker 检查 HTTP/响应与 adapter 结果，按阶段构造并双端验证不同信封；结构验证之后，逐项验证冻结题目集合完全相等、无重复、rubric/分值/精度/组合一致、资产属于当前输入、页码存在、bbox/span 有序且可定位。用 M0 最小冻结样例验证即可，无需构建完整题库。validate_asset 缺少明确成功结果也不得默认成功。

**验收：** 真实 DB 接纳所有上述负例，零合格 proposal/正式分；mock 的 4xx/5xx、坏 JSON、超时和重启进入正确失败/异常状态。真实持久化的样例调用，经 Worker→FastAPI mock→NestJS 产生一次可复核 proposal，不写正式成绩；300 项失败必须来自推理输出，而不是直接将客户端提示转换为成功标志。

### G1-05 — Critical — 没有自动 admission/恢复闭环，正常背压也可能永久 queued

**证据：** [store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:865) L865–958；[main.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/main.ts:33) L33–48；`http.ts` L224–232。admitAll 仅在新建请求或人工 reconcile 调用；accept 释放槽后没有调度事件或循环。`UNKNOWN_ESCALATE_AFTER_SECONDS` 读取后未用于后台处理。SQL L785–796 是全局 FIFO，没有已批准的租户轮转游标。关联 F12/F17/F25。

**静态反例：** 默认 tenant cap=2 时，提交 3 项，前两项完成后第三项仍无 admission；此后无新提交或人工调用时没有代码路径推进它。before-enqueue、Redis-loss 的已有测试均手动调用 `/internal/reconcile`，300 项则把 cap 提升至 400，绕开正常背压场景。

**风险：** 浏览器关闭后的正常排队和故障任务恢复依赖下一次请求/人工操作。send_unknown 的 Worker 死亡后也缺少自动停放、可见升级路径。队列已有 completed/failed ID 但 DB 仍 queued 时，仅检查 getJob 存在就跳过补投，会留下任务。takeover 未复查整体 deadline。

**修复：** 为 M0 实现明确启动和停机的 scheduler/relay/reconciler 入口，使用受限身份；释放槽后自动唤醒，后台扫过期 admission、capability、租约与 unknown；按已有期限/预算可见终结。检查 BullMQ 状态而不是仅 ID 存在。租户轮转作为批准范围的最小实现保留；不增建复杂调度平台。

**验收：** 不调用人工修复端点：默认 cap 下 3/多租户积压自动完成；独立启动服务后 before-enqueue/Redis 丢失/Worker kill/FastAPI timeout 都恢复或可见终结；completed/failed 队列记录不阻塞 queued 的正确恢复；期限耗尽不重试；占用非负且不双计；恢复者竞争后仍正确。

### G1-06 — Critical — 孤儿清理会删除尚在定稿事务中的文件

**证据：** [store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:234) L234–308 在 DB COMMIT 前写最终对象路径；L998–1018 按一次元数据快照删除所有未知路径，不检查上传 session、租约、年龄或处理中标志。关联 F08/F16。

**反例：** `orphan_sweep_deletes_inflight_uncommitted_file` 将待定稿文件放入对象目录，数据库尚不可见，实际 sweep 方法即删除该文件。更一般地，list_storage_keys 后新写入的文件也可能被旧快照删除。开发者删除 323 个文件的记录不能证明并发清理安全。

**风险：** 定稿最后成功提交，但对象已被清理，形成持久化元数据引用不存在的文件。当前 Worker 并不下载或验摘要，任务仍可能显示 succeeded。

**修复：** storage 使用持久 upload/session/处理中登记与隔离临时路径；清理按年龄、租约、状态选候选，删除前重新验证且与定稿协调。提交前后补偿区分明确，不以无保护的全目录差集代替孤儿协议。

**验收：** 暂停在文件已写/元数据未提交、清扫快照后新上传、COMMIT 后等窗口并发执行清扫；活跃上传和所有已提交资产保持完整摘要与可授权下载，仅过期且无引用、无活跃租约的文件删除。进程 kill 后真正遗留对象可回收。

### G1-07 — Major — M0 已实现表缺少关键外键和精确修订引用

**证据：** [0001_m0.sql](/Users/johnny/Documents/GitHub/zhixue-saas/db/migrations/0001_m0.sql:220) L220–239、253–293、336–397。attempt→job、job.current_attempt→同 job attempt、invocation→job/attempt、ledger→invocation、proposal/revision→job、draft→指定 revision 均没有完整复合外键。manual trigger 仅证明“该 job 存在某个 manual revision”，不检查 NEW.revision_id。关联 F01/F04/F11。

**风险：** 真实角色可建立跨租户/跨任务/不存在的引用；RLS 的 tenant 列检查不能保证引用对象属于相同 tenant/job。M0 子集不要求全部 M3 实体，但已实现的引用必须有效。

**修复：** 通过新迁移补齐现有实体的非空、唯一和准确目标列集合；job/attempt 循环引用用合适的事务顺序/延迟约束。draft 精确引用 tenant/job/revision，并检查 manual origin。不要要求 M0 创建尚未实现的完整卷/名单模型。

**验收：** 实际应用/ingress/reconciler 角色插入不存在引用、跨 tenant、同 tenant 别 job、错误 revision 均数据库拒绝；合法 claim/takeover/manual/accept 事务成功；R5-02 的 validate_asset/model_grade 绑定正负例单独运行。

### G1-08 — Major — Worker 持有服务签发密钥，可自行扩大 scope，令牌无过期

**证据：** [worker.py](/Users/johnny/Documents/GitHub/zhixue-saas/apps/worker/worker.py:10) L10–22、54–57、92–97；[http.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/http.ts:293) L293–307。service() 仅校验共同密钥、audience 和自称 scope，未约束 issuer/subject/job/jti/必须过期。关联 F13。

**反例：** Worker 实际 service_token 可签出 billing.settle/reconciler.repair，且 JWT 不含 exp。正常 Worker 路径已经签发 reconciler.repair 来停放与接管。配置中的 audience 与 scopes 并不能限制一个掌握同一签发密钥的服务。

**风险：** AI Worker 的权限扩大到恢复和费用修改；泄漏的令牌可能长期重放，没有 job 级绑定。这是受限 mock 的服务身份原型问题，不宣称已存在公网生产攻击。

**修复：** 使用可信签发边界，Worker 不持有可任意签发所有服务权限的 API 密钥。按已决身份策略提供受限凭据/公钥验证或身份映射，强制 issuer、subject、audience、expiry、job/attempt 绑定和 jti 防重放；业务幂等重试用新 jti。reconciler/relay/billing 身份分开；不改变 Python Worker 路线。

**验收：** 合法 Worker 不能取得 billing/reconciler/relay 权限；缺 exp、超期、错 issuer/subject/audience/job、重用 jti 的请求拒绝；合法同 body 新 jti 重试仍返回原收据，费用和效果不重复。

### G1-09 — Major — 没有证明模块公开端口与真实 Outbox 投递链

**证据：** [app.module.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/app.module.ts:9) 只装配一个 Controller/Store；`store.ts` 跨表直接写入业务、任务、费用、审计，未实现批准的 owner/公开端口示例。L960–989 的 relayOnce 没有 queue.add 或消费业务效果，只读 payload、写 m0-relay inbox 并将 event 标 delivered。实际入队在 finalize/publishCapability/reconcile。关联 F07/F08。

**风险：** 底层 capability 机制可能恢复任务，但现有证据没有证明批准的 Outbox→投递→consumer 幂等效果链；“delivered”不对应外部投递成功。单一 Store 隐藏事务参与者和 owner，未来 M1 基础依赖会建立在未验证边界上。

**修复：** 保留最小业务替身，按已决 owner 拆公开端口和本地 UoW，组合根仅装配。明确 Outbox 事件与 capability dispatch 的职责、谁触发持久投递；relay 只有真实接收/可靠投递确认后记 delivered，consumer 自己把 inbox 与实际效果放进同一事务。若要采用另一等效协议，另提交 ADR 差异和针对性审查，不能通过重命名绕过批准规格。

**验收：** 跑完整最小链并提供 event/capability/queue ID/consumer effect 的关联证据；杀 relay 在领取、入队、ACK、consumer commit 前后，无丢事件和重复效果；没有请求端帮助也能投递。一次 finalize 的跨模块参与共享事务，任一参与者失败整体回滚。

### G1-10 — Major — 验证覆盖与可复现交付不足，尚不能组成 G1 验收包

**证据：** [m0-g1-evidence.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/m0-g1-evidence.md:1)；测试 L192–208 用一个 Client 顺序切换而不是实际连接池并发；L255–282 的三个 crash 是抛 ApiError，不是 API 进程终止；L398–447 人工改 lease 再手动 takeover，不是 Worker 崩溃后自动恢复；L651–687 在空的 0001 schema dump/restore 后仅断言列存在。Workflow 选 PG16/Python3.12，现有记录来自 PG17/Python3.14；没有授权试卷/答案 PoC。关联 F10/F12/F23/F26/F27。

**风险：** 关键行为只有较弱替代测试，版本组合与 clean checkout 复现未证明。已有 raw JSON 是测试生成摘要，不包含完整 TAP、构建/迁移日志、所有组件版本和每个负例。并不指称记录伪造；只是证据不能支持 G1 通过。

**修复：** 将关键反例变成真正集成测试，记录 commit、锁文件哈希、全部实际版本、命令、开始/结束、退出码、原始日志；按已有 Docker/CI 剖面做 clean run，或明确决议支持另一剖面并保持脚本一致。CI 用锁文件确定性安装。迁移并发检查要在锁内重新判断 applied（migrate.mjs 当前在加锁前读）；恢复至少包含 M0 样例业务/任务/账并验证关联和继续运行。

**验收：** 干净隔离环境成功自动迁移与运行；真实角色复合 FK、真实连接池 A/B/无上下文并发、API/Worker/Scheduler/推理进程 kill、实际超时和队列重建通过；有数据的备份恢复关系/摘要/账后再升级和恢复执行。真实试卷和标准答案取得授权后完成 PoC 报告；资料不足时明确待验，不要求真实学生答卷，也不夸大真实批改质量。

## 4. 原 F01–F28 的状态处理

本轮不把任何原 Finding 整体标 Closed/Verified；M0 子集通过也不能替代 M1–M7 的剩余范围。建议追踪表按“设计 / 范围决议 / M0 实现 / M0 运行 / 独立验证 / 后续阶段”分列。

| 原项 | 本轮结论 |
|---|---|
| F01、F04 | 已有 M0 子集和禁止正式发布的开发者证据；新 FK/修订关联问题，待修复和真实角色验证 |
| F02、F03、F05、F06 | 完整时间关系、冻结闭包、题库和全部导入属后续阶段；本轮不宣称完成。M0 最小冻结 fixture 仍须支撑接纳语义测试 |
| F07、F08 | 事务轮廓存在；owner/端口与真实 Outbox 链仍未验证 |
| F09 | 正式成绩派生闭环未进入 M0，不作通过或关闭结论 |
| F10 | 固定版本 Node/Python 的开发者消费记录可保留；完整支持剖面与独立恢复互操作仍待验 |
| F11、F12、F13、F14 | 当前 epoch/租约/重复接纳/unknown 账的部分记录可保留；本报告来源、发送、恢复与身份缺陷阻止通过 |
| F15、F16、F17 | 有跨租户读取与 cap/路径原型；校内写权限、清扫竞争、自动调度与资源隔离仍待修复验证 |
| F18 | M0 roster 学生不一致负例有开发者记录；其他约束和完整匹配/时间历史仍待后续验证 |
| F19、F20 | M0 无正式发布且入口拒绝的记录可保留；取消/人工恢复守卫待修复，完整发布/修订在后续 |
| F21、F22、F23 | JSON Schema 结构负例有记录；可信调用来源、双端验证、语义与 PoC 不足 |
| F24 | 合成学生边界和 mock/端点配置原型可保留；并未验证真实数据合规专项 |
| F25 | 三个指标名存在；尚不证明自动升级和告警行动 |
| F26、F27 | 本地运行与空 schema 升级记录可保留；可复现环境、数据恢复、G1 条件仍不满足 |
| F28 | R6-01 现行术语已修正；新的状态/API/证据口径需随实现同步 |

## 5. ADR 与修复路线

### 5.1 不需要重新请负责人决定的事项

校内写命令授权、发送前许可、可信 invocation、完整语义守卫、保守 unknown 恢复与核心模块端口已经包含在 M0 范围决议中，应落实原批准协议。修这些实现不需要再走一次完整 G0 设计审查。实际政策发生改变才针对差异复审。

### 5.2 保留待决/待外部证据

- 若替换既定 Outbox/capability/身份协议，提交局部 ADR 差异，不能开发者自行宣布原要求失效。
- 支持运行版本剖面：验证原 CI/Docker 组合；若调整正式基线，记录理由与兼容证据。
- 授权的真实试卷和标准答案 PoC 输入来源仍待提供；这不授权真实学生数据或生产调用。生产指标、完整算法、质量阈值仍保持后续待定。

### 5.3 优先顺序

1. **P0：** G1-01/02/03/04/06，先堵住写权限、重复发送、错误来源、坏结果与误清理；先补会失败的负例，再修实现。
2. **P0：** G1-05，建立默认 cap 下无需人工调用的自动推进/恢复。与发送保护一并验证。
3. **P1：** G1-07/08/09，新迁移闭合引用、分离服务凭据和核心 owner/公开端口、完成真正 Outbox 链。
4. **P1：** G1-10，隔离 clean run、真实故障测试、数据恢复、CI/版本、原始日志和 PoC；开发者自检后提交独立 QA/架构复验。

## 6. 正式门槛结论

| 门槛 | 结论 | 范围 |
|---|---|---|
| G0 | 保留 v5 设计结论与仓库范围决议记录 | 不重新否定已完成设计，未代签未来 ADR |
| M0 后续修复 | 可继续 | 仍限合成数据、受限 mock/明确授权 PoC 与基础机制 |
| G1 / M0 退出 / M1 准入 | **No-Go** | 6 项 M0 范围 Critical 未闭合，关键运行证据不足 |
| G2 / 完整阅卷 / 真实学生 / 生产 | 本轮不适用，未批准 | 不从 M0 原型推导生产安全或质量达标 |

开发者下一次提交应响应本报告 G1-01–10，不必再提交一轮纯设计长文。交付修复代码、新迁移、回归用例、原始运行证据和逐项响应矩阵。先完成实际验证，再来复验 G1。
