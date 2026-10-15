# 智学 SaaS Architecture Review Report — M0 / G1 独立复验 V3

**审查编号：ZX-AR-20261014-03**  
**日期：2026-10-14（Asia/Shanghai）**  
**上一轮：ZX-AR-20261014-02。**  
**对象：** `m0-g1-response-v3.md`、`m0-g1-evidence-v3.md`、当前源码与原始记录。  
**被测基线：** HEAD `e302221c5f7b8e81274dab1d5f02b2145dc0d3b9` 加未提交/未跟踪工作区；随附快照与哈希才代表完整输入。

## 1. 执行摘要

**G1 仍为 No-Go：不能验收 M0 退出或进入 M1。继续已授权 M0 修复。**

本轮已能独立运行真实 PostgreSQL、Redis、NestJS、Python Worker 与 FastAPI mock，验证强度高于前两轮仅源码替身复验。提交文件的 **4 个哈希全部匹配当前工作区**。API 独立编译通过；Cursor 的 v3 集成套件独立重跑通过，10 条结果记录均复现。

补测后发现 **7 项残余问题：Critical 4、Major 3；Blocker/Minor 0**。它们包括正常评分的运行时异常、失败/截止状态与数据库约束冲突、评分任务接管丢失处理类型、清扫误删仍在定稿的对象、授权下载输出错误、双端格式校验不一致，以及模块边界/验收覆盖缺口。

已有修复也获得了实际证据：重复 rubric 被拒，0.10+0.20 精确通过；Worker 环境白名单、服务身份及受限函数属主可保留；同 attempt 的 observed 结果重入成功且未第二次调用；真正 SIGKILL 后的非计费校验任务接管到 epoch 2，并由新 Python Worker 完成。**不能因此将未跑或失败的评分与清扫路径标通过。**

本轮没有修改用户仓库或原设计，没有 reset 用户既有库或清空 Redis。测试在新建专用库、独立队列前缀和文件目录中进行；所有本次 API/Worker/推理进程已停止，证据数据保留。没有真实学生、付费模型、真实试卷 PoC 或生产操作。

## 2. 独立运行范围与限制

### 2.1 环境

- 复验副本：`work/g1-rereview-v3-20261014`。
- 新建数据库：`zhixue_m0_g1reviewv3_20261014`，本机 PostgreSQL 17.11；未重置 Cursor 的 `zhixue_m0_g1v3` 或原共享库。
- Redis 7.4.2 DB 4；仅使用前缀 `zhixue-g1-reviewv3-20261014`，未执行 FLUSHDB/DEL。
- 对象目录：复验副本内 `var/runs/reviewer/objects`。
- 服务端口：3440/3441，测试结束已关闭。Node 24.15.0、Python 3.14.4；其余实际版本见 evidence 中 `versions.json`。
- 复用已有 DB 角色；仅给 migrator 授予新复验数据库 CREATE 并在新库安装 pgcrypto。应用了原 0001–0004 SQL，跳过会改变共享角色的 bootstrap 阶段。没有修改共享角色密码、属性或成员关系。

### 2.2 已执行

1. 冻结源码、核对提交哈希、重新编译 API。
2. 新库迁移与合成种子；独立执行原 `g1.integration.test.mjs`，退出码 0，约 2.28 秒。
3. 8 组补充真实集成探测：正常 model_grade、观察结果重入、provider 500、坏 JSON、4 种失败码、deadline、非计费/计费任务真正 SIGKILL 接管、清扫/定稿竞争。组内包含多个断言，脚本成功意味着符合预期的缺陷或正向行为被复现，**不等于产品全部通过**。
4. 授权文件下载真实 HTTP 检查，以及同一输入的 Python/NestJS Schema 格式对照。
5. 确认正式成绩仍为 0，测试暂停 trigger 已移除，复验服务端口已关闭。

清扫竞争使用**新复验库专用 trigger 暂停资产 INSERT 2 秒**，测试上传租约设为 1 秒；目标 finalize/sweep 源码未改。该组合确定性制造“事务未提交但租约已过”的窗口，完成后删除 trigger/function。它证明任何有限租约超期时的并发不变量，**不表示默认配置下每次上传都会丢文件**。

原套件插入的额外 rubric fixture 仅在复验库中移除后进行正常 Worker 流程测试；原套件通过日志保持。故障任务在记录状态后，通过正常取消接口清理其占用；已提交的丢文件反例作为证据保留，不反写用户环境。

### 2.3 未执行或不在范围

Docker PostgreSQL 16.10、GitHub Actions、全部 Redis 中断/投递 ACK 窗口、双恢复者、默认 cap/轮转完整矩阵、300 项、真实有数据备份恢复、完整撤权/池并发/复合 FK/R5-02 矩阵、relay kill、授权真实试卷/答案 PoC仍未全量执行。已发现确定阻断后，本轮没有以大量无关检查替代修复。

## 3. 上轮 G1-V2-01–07 处置

| 上轮项 | 已确认进展 | 剩余结论 |
|---|---|---|
| V2-01 已许可不重发 | send_unknown 分支已退出；真实 observed 同 attempt 重入成功，provider 仍为一次 | 正常初次评分失败；观察后过期/跨 attempt 的安全恢复仍需闭合，见 V3-01/03 |
| V2-02 执行/观察/失败 | 保存了观察正文与摘要；非计费 SIGKILL 接管实际完成 | model_grade 正向异常，阶段失败/期限被 DB 拒绝，评分交接类型错误，见 V3-01/02/03 |
| V2-03 计分/Schema | 原套件真实接纳：重复 criterion 拒绝；0.30 精确通过，正式分仍为 0 | UUID format 两端不一致，见 V3-06；其余语义负例尚未全量跑 |
| V2-04 清理收尾 | 正常提交会释放临时文件，新增 committing 过期处理 | 租约过期时清扫与未提交 finalize 竞争仍能丢对象，见 V3-04 |
| V2-05 Worker 凭据 | 实际 Worker 环境无其他服务/迁移/bootstrap key；Worker key 扩大 billing scope 拒绝 | 在已测本机剖面通过；未宣称生产挂载或部署隔离验收 |
| V2-06 函数/模块 owner | 三个定义者函数实际属主 owner、NOBYPASSRLS；历史迁移未覆写 | 最小公开端口/UoW 边界尚未实现，notice/relay 故障矩阵待验，见 V3-07 |
| V2-07 入口与证据 | CI 已改用新入口；独立 run 目录和完整测试输出已补，原套件可复现 | Compose/CI/恢复/PoC与缺失用例仍待验；正向样例未覆盖实际 Worker 评分，见 V3-07 |

原 F01–F28 不整体 Closed/Verified。可以在追踪表中标记本次具体断言的独立通过；“已补代码”与“全项验证”仍分开。

## 4. Findings

### G1-V3-01 — Critical — 正常 model_grade 在观察成功后抛 UnboundLocalError

**关联：V2-01/02，F10/F12/F21。证据：** [worker.py](/Users/johnny/Documents/GitHub/zhixue-saas/apps/worker/worker.py:127) L127–165，特别是 L160 `body.get(...)`。成功 JSON 已写入 response_body，但该分支没有给 body 赋值。

**真实反例：** `fresh_model_grade_200_raises_unbound_body`：真实服务返回合法 200 和两题 payload，观察已保存，实际 Worker.finish 抛 `UnboundLocalError: cannot access local variable 'body'...`。DB job 仍 running/pending、占用保留。日志与结果已保存；provider 请求数为 1。随后在同一有效 attempt 内调用 observed 重入分支成功，provider 仍为 1，这证明持久观察已有价值，**不能掩盖首轮正向路径失败**。

**风险：** 新评分任务即使供应商正常返回也不能自动完成。现有绿色套件主要是校验、超时和人工构造接纳，未执行这个正常 Worker 正向链。

**修复：** 使用实际解析并验证的 response_body 构造 payload；新响应和观察重入共用明确的验证/信封构造逻辑，不依赖另一 stage 的局部变量。

**验收：** 新建真实 job/attempt/invocation，经 Node producer→Python Worker→FastAPI mock→NestJS 自动得到一次 review_required proposal、succeeded、一次预算扣减、零正式分；原始 payload/来源保存。有效 observed 重入不再 HTTP，合法接纳重试不重复效果。禁止只手工 POST envelope 当成该正向链通过。

### G1-V3-02 — Critical — 新失败与 deadline 值未进入数据库契约，命令全部回滚

**关联：V2-02，F11/F12/F19。证据：** [store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:902) L902–950、1130–1146、1482–1488；[0001_m0.sql](/Users/johnny/Documents/GitHub/zhixue-saas/db/migrations/0001_m0.sql:175) L175–177。0004 没有升级 result_status CHECK。

**真实反例：** provider_http、bad_json、missing_persisted_result、schema_rejected 四个阶段失败命令均 HTTP 500；实际 PG CHECK 只允许 pending/accepted/missing_result/input_changed/rejected_schema/rejected_semantic。provider 500 和坏 JSON 的真实 Worker 路径因此留下 running/pending。过期 job 写 deadline 也触发 `23514`，maintenanceTick 的 deadline step 失败，queued 未终结。

**风险：** 源码“有失败端点”和“有到期函数”不构成可运行状态机。错误/过期任务不能进入可见终态并释放占用。

**修复：** 统一 execution status、result status 和 failure reason：采用新迁移扩展已决语义或将失败理由放在独立字段，不能把 API 原因字符串直接写入不匹配枚举。失败协议要实际版本化校验，与普通接纳一样验证 current attempt/epoch/有效租约/generation/input/stage；当前 recordStageFailure 仅检查 attempt ID，不能在约束修好后引入旧回传终结当前状态的新漏洞。幂等响应须来自同一已保存效果。

**验收：** 四种失败与 deadline 正反例实际 DB/HTTP 通过，正确终态、准确原因、一次释放占用；重放同 body 同结果，同键异体 409。旧 lease/epoch/generation、取消或已成功后的迟到失败不能改变当前状态。空库和上一版数据升级后均执行这些命令，不绕过 CHECK 或把错误改成成功。

### G1-V3-03 — Critical — 评分接管投递丢失 billable，恢复凭据/意图仍不原子

**关联：V2-02，F11/F12/F14。证据：** [store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:1181) L1181–1192 的返回值没有 billable；L1311–1315 调用 `Boolean(taken.billable)`；L1514–1547 在 takeover COMMIT 后另写 capability/投队列；Worker L59 用队列 data.billable 选择路径。

**真实反例：** 真正 SIGKILL 第一任 Worker：非计费校验任务接管到 epoch 2 后新 Python Worker 实际完成。相同过程用于 model_grade，DB billable=true，但 execute_current payload billable=false；新 Worker走 validate_asset、提交无评分 envelope，API 拒绝，job仍 running，invocation 数为 0。不能用非计费恢复正例代替评分恢复。

**静态残余：** 接管事务提交和持久投递意图不是同一事务；投递持久行仅有 job/capability hash，重发扫描仍跳过 running job。lease token只存在返回值/Redis payload，崩溃或 Redis 丢失后当前交接不能完整重建；旧 dispatch ID 用新 ID 代入也未正确 supersede。continueAttempt 未完整检查当前租约期限。已 observed 的当前未接纳结果不应被隐式新付费调用替代；本轮仅验证有效同 attempt 的保存结果重入。

**修复：** takeover 返回与投递契约保留完整受信字段，Worker按 claim/continue 的持久 job stage/billable 选择处理器，不能让 Redis 提示覆盖。当前 attempt与可恢复投递意图同事务；派发/ACK可重复，只有一次执行许可。受控恢复凭据与 generation/epoch/input/attempt绑定，running 交接也可恢复；不回写 queued、不新增 admission、不改挂旧 invocation、不恢复 ResumeAfterSettlement。

**验收：** 非计费和 model_grade 分别 SIGKILL、交接前后 kill/restart、Redis 队列丢失、双恢复者；新 Worker执行正确 stage，占用不双计，当前交接可重建。未知发送不再请求；观察保存后未接纳用既有合格结果或保守异常恢复，不凭空产生第二次付费调用。旧 token/过期租约/旧世代拒绝。

### G1-V3-04 — Critical — 租约过期时清扫可删未提交最终文件，finalize仍成功

**关联：V2-04，F08/F16。证据：** [0004_g1_v2_controls.sql](/Users/johnny/Documents/GitHub/zhixue-saas/db/migrations/0004_g1_v2_controls.sql:31) L31–50 用提交快照与 lease_until 判断 live；[store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:268) finalize 的状态更新/对象写入/DB 事务，以及 L1589–1613 的 sweepOrphans。它们没有锁/CAS 共同排除该窗口。

**真实反例：** finalize 在未提交事务内已把 session 更新 finalized，但对其他连接仍可见旧 committing；租约已过，source_asset INSERT被测试 trigger暂停。实际 sweep删除 2 个文件（临时与最终），随后实际 finalize完整提交并返回。DB source_asset存在，最终文件不存在。trigger仅用于确定性暂停，已移除；测试没有修改业务方法。

**风险：** committed 元数据引用丢失原件，破坏审计/可复核来源与对象完整性。清扫两次 SELECT live不能替代与定稿互斥。

**修复：** 明确定稿与清扫共用的 session/对象状态锁或可证明等效协议；清扫先原子取得回收资格，提交中的 finalize不被回收。租约超期/被 expire 后，finalize 的 CAS必须影响一行，否则拒绝并回滚所有业务插入，不能无条件继续。临时释放与最终资产引用分开，删除前重检是补充，不是核心互斥。

**验收：** 保留本轮超期未提交竞争反例：要么 finalize成功且文件/摘要可完整下载，要么合法失败且没有提交引用不存在文件的业务行。活跃提交、成功临时释放、过期真正孤儿、kill后恢复、双清扫者分别实测；不能仅延长租约或加睡眠让测试侥幸通过。

### G1-V3-05 — Major — 授权下载 HTTP 200 返回 Buffer JSON，不是原文件

**关联：F16、旧 G1-06/10。证据：** [http.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/http.ts:49) asset方法设置 PDF Content-Type 后返回 Buffer；本机 Nest Express adapter按 object调用 response.json。

**真实反例：** 合法范围教师读取一个已保存资产，HTTP200、Content-Type=application/pdf，但响应以 `{"type":"Buffer","data":[...]}` 开头。磁盘文件摘要等于元数据，HTTP响应摘要不等于元数据。本轮结果 `download-result.json` 记录了两个哈希比较，说明是输出协议问题，不是伪造权限拒绝。

**风险：** 前端/浏览器不能得到原件，基础上传下载原型尚未闭环。只跑未授权 403/404 无法发现该缺陷。

**修复：** 用正确二进制响应/StreamableFile或受控输出方式，保留授权、Content-Type和必要长度，不把字节序列化成 JSON。

**验收：** PDF/PNG/JPEG合法下载字节与已保存 sha256完全一致，格式可打开；跨租户、无校内范围、撤权拒绝仍通过。文件缺失/摘要不符是可见异常，不返回伪成功。

### G1-V3-06 — Major — Python未启用format断言，双端Schema结果不一致

**关联：V2-03，F21。证据：** [worker.py](/Users/johnny/Documents/GitHub/zhixue-saas/apps/worker/worker.py:13) L13–26，Draft202012Validator未传format checker；Nest端Ajv启用了 formats。

**独立格式对照：** 同一完整 envelope的paper_question_id=`not-a-uuid`：Python schema_ok=True，Nest validateEnvelope=False（format uuid）。这是实际两端校验器的结果；该格式对照本身不宣称经真实模型产生，也未证明后端被绕过，Nest拒绝仍有效。

**修复：** 明确启用当前Schema要求的UUID等format校验，并统一格式/额外字段/类型测试语料。新响应与 observed重入分支都实际校验，不只在新响应调用一次。

**验收：** 同一组合法、非法UUID/额外字段/类型/越界/缺项在两端得到相同结果；远端引用只用受控注册schema。非法结构不能因Worker忽略format而标成“已通过双端校验”。

### G1-V3-07 — Major — 最小模块边界尚缺，G1正向与故障覆盖仍不完整

**关联：V2-06/07，F07/F08/F10/F26/F27。证据：** [app.module.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/app.module.ts:9) 仍只装配单Controller/Store；跨owner直接SQL仍在Store。`g1.integration.test.mjs`评分正例用migrator手建job并直接POST envelope，未跑正常Worker评分；原报告列出的大量未跑项仍保留。

**风险：** 单一大事务不等于批准的唯一模块owner、公开端口、DAG和共享UoW示例。本轮正常路径、截止/失败枚举、下载、计费接管、清扫的问题都在已有绿色套件外。报告如实列缺口值得保留，但不能据此通过门槛。

**修复：** 实施最小owner/公开端口/协调者UoW，不扩展完整M1–M3功能。将本轮反例改为期望健康行为的必要回归，并补最小自动正向链、队列/提交/ACK故障、真实角色/范围/池并发、已实现FK/R5-02、notice/inbox一次、有数据恢复。正常例与错误例都作为CI门槛。

**验收：** 支持的local/Compose/CI剖面可运行，关键当前状态机、完整性和恢复不变量都有真实证据；授权试卷/标准答案PoC仍是外部资料缺口，不伪造。开发者、自检之外的独立复验和负责人验收分别记录。

## 5. 优先级与可执行路线

1. **P0：V3-01/02/03/04。**先把正常评分、失败/期限、正确执行交接与对象并发安全跑通。
2. **P1：V3-05/06。**原件下载和双端格式一致；这是当前M0基础能力，不延期到完整阅卷。
3. **P1：V3-07。**最小模块端口和真实验收矩阵。保留v3已通过的计分、身份、受限函数、非计费恢复与观察重入，不重新写纯设计长文。

普通修复沿用已接受的M0核心政策，无需重复请负责人批准。若真的改变状态/费用/调用授权/Outbox协议或版本剖面，提交具体局部ADR差异再复审，不能降低隔离、成绩或对象不变量。

## 6. 正式结论

| 门槛/范围 | 结论 |
|---|---|
| G0、2026-10-13 M0范围决议 | 保持，不撤回、不代签未来ADR |
| 继续M0 | 可以，限合成数据、受限mock/明确授权PoC、基础修复 |
| G1、M0退出、M1准入 | **No-Go：4项实证Critical和残余Major未闭合** |
| 原F01–F28 | 本轮不整体关闭；只更新具体独立验证范围 |
| 真实学生、完整阅卷、生产 | 本轮未批准 |

下一次需提交修复实现、失败转为健康预期的回归、原始真实日志与逐项响应。优先修复能稳定复现的问题，再进行完整G1复验；不以手工成功接纳替代完整后台自动链。
