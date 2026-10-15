# 智学 SaaS Architecture Review Report — M0 / G1 复验 V2

**编号：ZX-AR-20261014-02**  
**日期：2026-10-14（Asia/Shanghai）**  
**上一轮：ZX-AR-20261014-01，G1 No-Go。**  
**审查对象：** `m0-g1-response-v2.md`、`m0-g1-evidence-v2.md`、当前工作区修复及原始日志。  
**源码标识：** HEAD `e302221c5f7b8e81274dab1d5f02b2145dc0d3b9` + 未提交修复 + 未跟踪文件；不以 HEAD 单独代表被测代码。冻结输入与 SHA-256 清单随包提供。

## 1. 执行摘要

**结论仍为 G1 No-Go：不能验收 M0 退出或进入 M1。继续已授权 M0 修复。**

这次有实质进展：校内写授权与终态 cancel、精确 revision 外键、发送前许可入口、控制字段和 invocation 归属检查、服务 issuer/scope/exp/jti、supervisor 及真实 consumer 效果已进入代码。提交证据中的 **6 项文件哈希全部匹配当前工作区**。开发者保留未运行事项，没有把自检当成独立验证；这些口径正确。

仍发现 **7 项残余问题：Critical 3、Major 4，Blocker/Minor 0**。关键缺陷是：已有许可的调用在 Worker 重入时仍会再发；接管后没有 Worker 执行交接，已观察响应也没有持久化可恢复正文；重复 rubric 计分与浮点比较破坏评分语义。其他缺口是上传清理不收尾、服务密钥实际分发过宽、模块/函数所有权仍不足、CI 仍运行不兼容旧测试和运行验收覆盖不足。

本轮在隔离源码副本重新构建 API，编译通过，执行 **9 项 Store/身份源码核验和 5 项 Worker 源码核验**，包含已修复守卫和残余缺陷反例。它们使用连接池/HTTP 替身，**不等于真实 DB/RLS/队列/供应商集成通过**。本轮读取本机隔离库的只读连接仍返回 `EPERM`，因此没有独立重跑开发者套件；未运行 reset、FLUSHDB 或用户对象清扫，未修改用户仓库。

G0 的已接受 M0 范围继续有效。这不是要求回到完整设计阶段，也不授权真实学生数据、付费模型、完整阅卷或生产部署。

## 2. 证据和上轮 G1-01–10 处置

开发者新增测试仅实际覆盖 7 条结果：无范围读/取消、终态取消、令牌 attempt 不一致、jti 重用、Worker 自称 billing scope 被拒、attempt 指向不存在 job、unknown 自动停放。该覆盖不能替代其他原验收反例。

`var/g1-logs` 是多次运行追加日志。早期 supervisor 有权限失败，后续源码加了 grant；本轮**没有将早期失败认定为当前失败**。但 commands.log 仅有开始时间，没有完整命令、退出码或 run_id 与结果的绑定，仍须提交可独立追踪的一次干净运行。

| 上轮项 | 本轮源码/现有证据 | 处置 |
|---|---|---|
| G1-01 写授权 | cancel/manual 和 finalize 重放增加 action/class/subject/未撤权 membership 检查；终态 409、单 job 草稿唯一键 | 实现方向已补齐；有开发者取消负例。撤权、manual 并发、重放负例未跑，保持待真实复验 |
| G1-02 发送许可 | 新 intent 的 Worker 路径确实先 IssueSendPermit 再 HTTP；API 有 CAS/预算/租约/期限检查 | 部分修复；已有 invocation 重入仍违反一次许可语义，见 V2-01 |
| G1-03 来源绑定 | 控制字段逐一相等，查询 invocation 的 job/attempt、绑定和 config；费用命令增加 job_id | 旧虚构调用缺陷的守卫已进入代码；现有 403 发生在身份层，未打到业务接纳。持久观察与失败问题见 V2-02；其余负例待验 |
| G1-04 语义/推理 | validate_asset 500 不再提交 ok=true；遍历完整题目集合，检查部分 rubric/证据 | 部分修复；重复计分、精度、模型失败及双端 Schema 仍有问题，见 V2-02/03 |
| G1-05 自动推进 | 新 supervisor、admit cursor、队列 getState、unknown 自动停放 | 有开发者自动停放正例；接管执行交接、观察恢复、期限处理未闭合，见 V2-02 |
| G1-06 清扫 | 持久会话与 committing 保护、年龄检查、删除前重读 | 原“未提交最终文件直接被删除”的风险已有代码保护；失败/成功临时文件无法回收，且并发实测未跑，见 V2-04 |
| G1-07 外键 | attempt/job、invocation/attempt、ledger、proposal、revision、draft 的复合 FK 和指定 revision 检查已补 | 原主要键缺口在 SQL 层补齐；开发者有 missing-job 23503。其他真实角色负例与 R5-02 待验，不宣称 Verified |
| G1-08 身份 | 新 verifier 能拒绝旧格式、缺 exp、错误 attempt、Worker key 扩大 billing scope；jti 有真实开发者负例 | 校验器有独立源码正向核验；Worker 仍获其他服务密钥，见 V2-05 |
| G1-09 模块/Outbox | asset_notices + inbox + delivered 现在同事务，有真实最小消费效果 | 不能再说“完全没有消费效果”；owner/公开端口仍缺，notice/relay 崩溃证据未跑，见 V2-06/07 |
| G1-10 复现 | Migration 应用判断移入 advisory lock；测试库/Redis 前缀隔离、npm ci 改进 | CI 仍指向旧套件，覆盖/恢复/PoC 未完成，见 V2-07 |

**本轮没有把任何原 F01–F28 整体 Closed/Verified。**上表承认已修复部分；未运行的真实负例保持待验。源码核验与真实集成须分别记录。

## 3. 残余 Findings

### G1-V2-01 — Critical — 已有 send_unknown/observed 调用仍可再次发送

**关联：G1-02；F12/F14。证据：** [worker.py](/Users/johnny/Documents/GitHub/zhixue-saas/apps/worker/worker.py:40) L40–79；[store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:745) L745–773。Worker 仅在 prepare 返回 not_sent 时申请许可；其他状态跳过许可后继续 `/infer`。

**独立反例：** 实际 `finish` 方法在同一 attempt 的执行重入测试里，分别对 prepare 返回 send_unknown 与 observed 各调用两次：每组产生 **2 次推理请求、0 次新许可请求**。这证明 Worker 分支没有拒绝已发送状态；**不宣称当前原生 BullMQ 已实测自动重入**。安全协议须在执行重入时仍成立，不能靠暂时没有该调用者保护付费。

**风险：** 一次持久化许可不能约束请求次数；重复投递/执行重入/恢复包装会再次调用。旧 unknown 的保守策略被绕开。

**修复：** Worker 只能消费本次合法签发许可发出的单次执行路径。已有 send_unknown 禁止 HTTP，走停放/可见恢复；已有 observed 只能使用持久化合格观察/接纳收据重试，缺少可用结果则走保守人工异常，不重新推理。不得把 not_sent 与“肯定没有发过”混淆，不放松已批准策略。

**验收：** 同 attempt 重入、并发两次执行、许可响应丢失、Worker 在许可/HTTP/观察窗口 SIGKILL，真实 DB + 计数 mock provider 保证每个 invocation 最多一次发送许可消费、不会第二次外部调用；状态保持未知或合法恢复，无额外预算扣减。

### G1-V2-02 — Critical — 接管与已观察结果没有可恢复的执行闭环

**关联：G1-03/04/05；F11/F12/F22。证据：** [store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:998) L998–1057、1170–1179、816–831、674–682、1303–1337；[worker.py](/Users/johnny/Documents/GitHub/zhixue-saas/apps/worker/worker.py:85) L85–101、169–170。

**独立反例与静态核对：**

- 实际 `reconcile` + `takeover` 方法测试创建了 1 个新 attempt，却没有任何 Worker dispatch。takeover 返回的新 lease token 被调用者丢弃；Worker 对 action=takeover 已改为 ignored。队列丢失不会让 running job 回到 queued，也没有当前 attempt 的可恢复交接。
- model_grade 的 HTTP 500 路径记录 observed 后提交 `ok=false, envelope=null`；实际 Store 接纳方法抛 `409 control_mismatch` 并回滚，job 不终结。bad JSON 走相同无信封路径。
- `RecordObservation` 只存 provider_status，不存响应正文/输出引用、请求标识、用量等。在记录 observed 后、接纳前杀 Worker，即使供应商成功也无数据可恢复；接管过滤仅排除 send_unknown，observed 仍可建立新 attempt，原 invocation 不能改挂。
- `expireQueuedAndAdmissions` 用只列“尚无 admission”的函数查到期 queued；maintenanceTick 先 admit/reconcile，再过期处理。已 admission 但没有 Worker 的任务可能超过整体 deadline，释放后再次被 admit。takeover 也没检查整体 deadline。Redis 相关步骤失败时整次 tick 会跳过后面的 DB 过期/停放。

**风险：** 恢复只是增加 epoch，并未恢复工作；预算可被空接管耗尽，成功响应不可复原，provider 失败无法直接进入正确状态，期限不能可靠终止。

**修复：** 接管原子产生可恢复投递意图，受限 Worker 能获取新 attempt 的执行权；保持 running、不新增 admission、不改挂旧 invocation。观察正文/可信元信息或不可变结果引用持久化，接纳失败可重试同一效果。为合法服务身份定义独立的阶段失败协议，不用伪造评分 payload 表示 provider 错误。deadline 检查涵盖全部 queued/admitted/running；过期先处理或在 admission 事务内拒绝。维护步骤应隔离错误，Redis 故障不阻止 DB 终结/unknown 停放。

**验收：** 杀 Worker 后无人手调端点，新 attempt 确实由 Python Worker 执行并完成或按真实失败原因终结；响应观察已提交但未接纳的恢复不重新调用、不丢来源。500/坏 JSON 进入已定义可重放失败/异常状态。无 Worker 时 deadline 也会释放占用并终结；双恢复者、Redis down/重建、默认 cap 下 3 项、多租户轮转全部实测。

### G1-V2-03 — Critical — rubric 可重复计分，合法小数被浮点比较误拒

**关联：G1-04；F21/F23。证据：** [store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:1280) L1280–1292；Worker L102–116 未调用 Python JSON Schema validator；`requirements.txt` 也未声明该校验器。

**独立反例：** rubric 同一 criterion 上限 1.00，两条相同 criterion 各给 1.00，suggested_score=2.00，实际 gradeSemantic 返回 null（接受）。合法不同 criterion 的 0.10 + 0.20 = 0.30 则返回 score_mismatch。它们分别来自未去重和 Number 严格相等。

**风险：** 超过冻结评分点上限的建议可能通过，合法输出反而升级异常。结构通过不能代表评分语义正确。

**修复：** criterion_id 去重，按冻结 rubric/组合函数计算允许题分；按当前 Schema 的两位小数使用整数最小单位或十进制定点，不能用 epsilon 把不合法分数近似放行。双端执行同版 Schema，并保留未受信模型 payload 的验证结果。证据边界也需补实：page_set 数量不是页数，span 仅检查 start<end 不能证明位于实际冻结 OCR 文本。

**验收：** 实际接纳入口拒绝重复/未知评分点和超满分，无合格 proposal；合法两位小数精确通过。重复/缺/未知第二题、错资产/页码/span、反向 bbox、额外字段分别实测。Python 与 NestJS 的结构正负例一致，M0 只需最小冻结 fixture，不要求完整题库或质量校准算法。

### G1-V2-04 — Major — committing/finalized 会话永久保护临时文件，清理没有完成闭环

**关联：G1-06；F16。证据：** [store.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/store.ts:245) L245–348、1350–1374；[0003_g1_controls.sql](/Users/johnny/Documents/GitHub/zhixue-saas/db/migrations/0003_g1_controls.sql:199) L199–214。

**静态反例：** `object_is_live` 对 temp_key/final_key 不区分，对 committing/finalized 无期限地返回 true。成功定稿留下 incoming 文件；失败或 kill 留下 committing 会话。没有收尾/过期/恢复命令把这些会话移出永久保护，sweep 两次查询都仍为 true。

**风险：** 原误删风险已有保护，但成功上传占两份存储，失败对象无法回收，清理功能不能验收。不能为了修泄漏简单按时间删除 committing，而重新引入误删。

**修复：** 明确成功后的临时文件释放与失败会话恢复/过期收尾；finalized 只保护持久业务引用的最终对象，活跃租约和恢复事务保护处理中对象。删除与 finalize/recovery 使用协调锁或等效协议，CAS 状态必须检查受影响行数。

**验收：** 成功定稿后临时对象可安全清理、最终资产摘要与下载保持；事务失败/进程 kill 的 committing 能恢复或回收；并发清扫不能删活跃上传和已提交对象。

### G1-V2-05 — Major — 密钥分开命名，但 Worker 实际获得其他服务和数据库凭据

**关联：G1-08；F13/F24。证据：** [g1.integration.test.mjs](/Users/johnny/Documents/GitHub/zhixue-saas/tests/m0/g1.integration.test.mjs:76) L76–100；[dev.env.example](/Users/johnny/Documents/GitHub/zhixue-saas/config/dev.env.example:37) L37–41；run-g1 的 loadDevEnv。start() 对每个进程传 `env: process.env`，其中有所有服务密钥及 bootstrap/migrator 密码。

**独立核对：** verifier 确实拒绝用 Worker key 自称 billing scope；但持有 billing key 签发 billing issuer 的令牌会按设计被接受。当前启动配置把这个 key 也给 Worker，所以已有 worker_cannot_bill 负例只证明校验器策略，不能证明运行身份隔离。**这里审查的是合成测试剖面；没有宣称真实生产凭据泄漏。**

**修复：** 实际子进程/容器用最小环境白名单及分服务配置/secret mount。Worker 只获 Worker 凭据、其队列与受限推理/业务端点；不获其他 issuer key 或直接数据库高权凭据。监督服务也按职责配置，不靠“程序当前不读取”实现权限分离。

**验收：** 实际 Worker 进程环境与挂载中没有 billing/reconciler/relay/scheduler/用户/迁移/bootstrap 密钥；只能使用允许 scope。用其实际可获得凭据无法 impersonate 其他身份；正常调用与合法幂等重试保持可用。

### G1-V2-06 — Major — 核心 owner/公开端口未实施，新增 SECURITY DEFINER 也未固定最小属主

**关联：G1-09/G1-07；F07/F15。证据：** [app.module.ts](/Users/johnny/Documents/GitHub/zhixue-saas/apps/api/src/app.module.ts:9) 仍只有 Controller/Store；Store 仍直接写多个 owner 的表。SQL 0003 L197 后 RESET ROLE，后续三个 SECURITY DEFINER 函数创建时没有 SET ROLE/ALTER OWNER。migrate 使用带 BYPASSRLS 的 zhixue_migrator 会话。

**风险与证据界限：** `asset_notices` 是新增真实最小效果，不能否认其事务价值；但单 Store 并不是批准的公开端口/UoW 边界示例。按当前迁移路径推导，object_is_live/list_unknown_running/list_expired_admissions 的属主是 migrator，而非受限 router/owner；本轮未连 DB 查询 proowner，必须用实际 catalog 确认。即便当前函数返回有限字段，也不应把迁移高权身份变成常规后台函数的执行身份。

**修复：** 用 M0 最小模块端口落实表 owner，事务由明确协调者共享 UoW，组合根仅装配；不要求完整 M1–M3 模块功能。新增函数显式设置受限属主、固定 search_path、撤 PUBLIC/最小 EXECUTE、限制返回和路由能力；以真实运行角色验证。保留 notice/inbox/dispatch 同事务的已实现部分。

**验收：** 实际 proowner/rolbypassrls/search_path/EXECUTE 断言通过；常规池不能 SET ROLE 到 owner/migrator、不能借函数读取学生正文。跨模块写仅走公开端口，同 UoW 任一参与失败全部回滚；notice 与 inbox 恰好一次的真实负例通过。

### G1-V2-07 — Major — CI 入口仍运行不兼容旧测试，剩余 G1 运行证据不足

**关联：G1-10；F10/F12/F26/F27。证据：** [.github/workflows/m0.yml](/Users/johnny/Documents/GitHub/zhixue-saas/.github/workflows/m0.yml:27) 调 run-m0；[run-m0.mjs](/Users/johnny/Documents/GitHub/zhixue-saas/scripts/run-m0.mjs:21) 调旧 integration.test.mjs。旧测试 L36–38 令牌无新 issuer/subject/jti，L163–167 期待 identity 成功；旧 Queue 也没传当前 prefix/Redis DB。新 run-g1 硬编码本机 5432/6379，不能直接代替 Compose 的 54329/63799。

**独立核对：** 当前 verifier 对旧测试令牌格式返回 401，证明不兼容；本轮没有执行 GitHub Actions，不宣称取得 CI 实际失败日志。现有 7 条结果未运行发送/进程杀死、恢复并发、语义、并发清扫、300 provider 失败、双租户池并发、有数据恢复、R5-02 等原验收。

**修复：** 用参数化的统一隔离测试入口连接本机或 Compose/CI，统一 DB/Redis/队列前缀/对象根/服务凭据和最新测试；保留旧测试历史并将仍有价值用例迁移，不能只删断言让 CI 通过。一次 run 单独目录，记录完整命令、开始/结束/退出码、commit+未提交 diff/hash、全部版本和原始测试输出。

**验收：** 干净环境运行固定支持剖面和 CI，真实故障与负例完整。数据备份恢复含业务、任务、账与对象摘要关联，升级后可继续；授权真实试卷/标准答案 + 合成答卷 PoC 单独报告。资料缺失不能编造通过，但也不阻止先完成独立于样本的全部修复。

## 4. 修复优先顺序和待决事项

1. **P0：V2-01/02**，先完成“许可→一次发送→持久观察→接纳/可见失败→恢复交接”。所有阶段失败/重试都不重新付费，遵循 v5；接管 epoch 不双占用。
2. **P0：V2-03**，评分点去重、精确数值、双端结构和最小冻结语义反例。
3. **P1：V2-04/05/06**，清理收尾、实际凭据隔离、最小 owner/UoW 和受限函数属主。
4. **P1：V2-07**，统一测试入口，补真实进程故障/恢复/并发/数据恢复/CI 证据。同步回应旧 G1-01–10 尚未运行验收。

无需再次批准已经接受的 M0 核心政策。若要改变发送策略、任务所有权、Outbox 路线或版本基线，提交具体局部 ADR 差异；不能把现有实现缺陷通过降低规格关闭。

授权试卷/标准答案仍是 PoC 的外部输入缺口；本轮不要求真实学生答卷或生产供应商密钥。先修源码与完整合成集成，再报告 PoC 材料缺口。

## 5. 最终准入结论

| 项目 | 本轮结论 |
|---|---|
| G0 / 已接受 M0 范围 | 保持，不撤回、不代签未来 ADR |
| 可继续工作 | M0 限定范围的修复、隔离合成验证、明确授权 PoC |
| G1 / M0 退出 / M1 准入 | **No-Go**：残余 Critical 与真实验证缺口未闭合 |
| 原 F01–F28 | 本轮未整体 Closed/Verified，未来阶段不提前验收 |
| 完整阅卷 / 真实学生 / 生产 | 未批准，不能从本次 mock 原型推导通过 |

下一次提交应包含 V2-01–07 的逐项响应与实际测试证据，不必再写一轮纯设计长文。完成后独立 QA、Architecture Review 和项目负责人分别记录验收。
