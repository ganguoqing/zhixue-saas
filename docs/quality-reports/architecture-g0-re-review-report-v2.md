# Architecture Review Report — 架构补充包 v2 的独立复验

**报告编号：** ZX-AR-20261012-03  
**日期：** 2026-10-12  
**被审包：** ZX-DES-20261012-02；答复 ZX-DES-20261012-02-RESPONSE  
**审查身份：** 独立 Architecture Review Agent  
**前次报告：** ZX-AR-20261012-02，G0-01–G0-13  
**结论：** **G0 No-Go。当前仍不能执行原 Prompt 2。** 仓库骨架、隔离合成实验和已授权试卷/答案 PoC 维持原有受限许可。

## 1. 执行摘要

本轮修订解决了上次发现的多项具体冲突：可空父引用改为 MATCH SIMPLE；正式事实与草稿/生命周期分开；名单与页面按版本唯一；总分导入有 total_only 正式发布路径；恢复命令、调用前 intent、双层输出、评分组合函数以及 G0/G1 区分均有实质补充。这些修改应保留，不需要重写整包。

但作者的“逐项答复”不能代替规格一致性验收。仍有几处核心协议没有封口：核心 FK 矩阵使用未展开的目标，generation 与 binding 更新不一致；控制索引没有明确与业务同事务写入及恢复 capability 的路径；接纳的必备条件缺少租约 token/到期和 invocation 归属；分析 CAS 检查了投影行，却没有明确检查发布时更新的 fence 行；admission 未计入容量占用。它们会影响合法业务、隔离、成绩或恢复。

本轮归并为 **8 项残留发现：2 Blocker、4 Critical、1 Major、1 Minor**，编号 R3-01–R3-08。它们主要是原 G0 Findings 的残留与方案衔接问题，不应与原 F01–F28、G0-01–13 相加统计缺陷总数。G0-03、G0-05、G0-11、G0-12 的主要设计问题可在设计复验栏标记通过或通过并附后续项；其他 9 项仍需局部补修。所有 ADR 仍 Proposed，所有实现风险和运行验证仍未关闭。

**No-Go 的理由是设计缺口和相关 ADR 未决，不是没有运行 M0 测试。** RLS、Outbox 故障注入、Python/Node 互操作、双端 schema 和恢复实测继续属于 G1/对应里程碑。本轮 Minor 不单独阻断 G0；完整算法、生产数值及真实质量阈值仍可在对应阶段决议。

## 2. 依据、范围与证据

以 V0.1–V0.28 确认记录和 V1.0 original 基线为依据，技术建议保持 Proposed。本次用户“再来”授权的是独立复验，没有授权接受 ADR 或实施生产模型。本轮没有修改仓库、原设计或 ADR。

| 缩写 | 被审文件 |
|---|---|
| A | [review-remediation-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/review-remediation-v2.md)，167 行 |
| D | [data-dictionary.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/data-dictionary.md)，202 行 |
| S | [state-transitions.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/state-transitions.md)，66 行 |
| T | [transaction-boundaries.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/transaction-boundaries.md)，182 行 |
| U | [authorization-matrix-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/authorization-matrix-v2.md)，55 行 |
| M | [module-adjacency-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/module-adjacency-v2.md)，43 行 |
| Q | [core-constraints-v2.sql](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/sql/core-constraints-v2.sql)，108 行，说明性 SQL |
| C | [grading-contract-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/architecture/schemas/grading-contract-v2.md)，双层契约说明 |
| J | schemas 中的 model-grade-payload、acceptance-envelope 与 withdrawn grading-result JSON，全文 |
| ADR | [ADR-001–015](/Users/johnny/Documents/GitHub/zhixue-saas/docs/decisions/)，全文 |
| R/F | [g0-design-response-v2.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/g0-design-response-v2.md) 与 [architecture-findings-tracker.md](/Users/johnny/Documents/GitHub/zhixue-saas/docs/quality-reports/architecture-findings-tracker.md)，全文 |

同时对照 v1 补充稿、前两份独立报告及原始基线。原确认记录、需求 original、架构 original、初次报告的 SHA-256 与前次证据一致。v1 补充稿增加历史提示；去掉提示后正文 SHA-256 与上轮一致，因此不将其误判为正文改写。

执行了文本/引用/约束对照、JSON 解析、schema `$id`/`$ref` 静态核对、分数正则抽查和文件摘要记录，并查阅 PostgreSQL 16、Ajv 官方文档。没有运行 PostgreSQL、Redis、BullMQ、对象存储或供应商服务。检查的运行时缺少 Ajv/ajv-formats/jsonschema，本轮没有安装依赖，未执行双端 schema 验证。

下文反例均为**规格推演，不是数据库或服务实测**。详见 [证据清单与输入快照位置](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/outputs/architecture-g0-evidence-manifest-v2.json)。

## 3. 上轮 13 项的设计复验结果

“设计通过”仅表示本项上轮具体设计缺陷已回应，仍待真实 ADR 决议、实现和运行验收。它不是 Fxx Closed，也不代表整个 G0 通过。

| 原 G0 ID | 本次 design_review 建议 | 已解决 | 残留 / 依赖 |
|---|---|---|---|
| 01 | partially_addressed | 可空 FK、全局目录和成绩指针目标 | R3-01：核心链仍有占位目标与归属漏洞 |
| 02 | partially_addressed | router 思路、分列 scope、服务角色 | R3-02：控制索引事务、恢复、relay 读路径及策略细节 |
| 03 | design_passed_pending_decision | 草稿/事实/生命周期分离，审核与正式分更新冲突已解 | 事实完整性随 R3-01 验收；ADR-006/007；M2/M3 实测 |
| 04 | partially_addressed | 名单/页集版本内唯一，保留旧字节 | R3-01：世代/绑定/同考试一致；发布后归属模式仍需产品语义决议 |
| 05 | design_passed_pending_decision | 四来源链、total_only、缺考/空白记零 | 正式记录精确 FK 随 R3-01；ADR-007/015；M3 功能验收 |
| 06 | partially_addressed | 校验、纠错、补页、人工恢复、复核重开有边 | R3-01：CorrectRecognition/SupplyReplacementPage 的新 binding；保留的取消/重试契约需可定位 |
| 07 | partially_addressed | current attempt/epoch、旧请求无副作用、新 jti 业务重试 | R3-03：token/expiry、invocation、终态幂等和统一锁顺序 |
| 08 | partially_addressed | HTTP 前 intent、unknown 与确认差额分开 | R3-06：发送许可、observation 入口及结算唯一键 |
| 09 | partially_addressed | 稳定指针聚合、多考试 evidence set、固定时间方向 | R3-04：真正的 fence CAS；R3-07：事件和消费者名称 |
| 10 | partially_addressed | 轮转、stage 预留、测试剖面、到期政策 | R3-05：已 admission 名额与 Claim 的原子承接 |
| 11 | design_passed_with_followups | 模型/服务分层、组合函数、评分点和证据语义 | R3-08：format 注册；R3-03：任务 invocation/题项集合守卫；G1/M3 双端与语义实测 |
| 12 | design_passed_pending_decision | 四状态分列，G0/G1 分开，不冒充测试 | 本报告复验结论回填；ADR 决议另记 |
| 13 | partially_addressed | 旧反向箭头已修，三个接纳协调者明确 | R3-07：新表 owner/公开命令与旧 ADR 文字同步 |

原 F01/F08/F15 三项 Blocker 的设计风险仍未关闭。原 Findings 的编号/严重度和历史保持；本表不代替原 Fxx 的实现关闭门槛。

## 4. 残留 Findings

### R3-01 — Blocker — 核心归属链仍未精确约束，世代更新与绑定不一致

**证据：** D:60–80、109、202；S:27、30–31、40；Q:59–76。D:71 的目标仍写“exam_participations 与 entry 的复合唯一键”，D:76 写“版本与 paper_questions”，未给精确列组。页集只按 tenant/id 被 generation 引用，答案槽位只按 paper_version/id 引用，未明确与 submission/participation 的同考试同卷关系。

**风险/反例：** 同租户的 submission 甲的 generation 可引用 submission 乙的 page_set；binding 可关联另一场考试的 participation；答案可选另一份卷的槽位。单独命中各表的 tenant/id 并不阻止这些组合。页/名单唯一问题虽已修，归属完整性仍未证明。D:72 要求 answer 的 `(generation_id,binding_id)` 命中不可变 binding，S:31 却只写新 generation/answer，未创建该代 binding；旧 binding 的 generation 不等于新 generation。D:202 称 current_attempt_id 非空，S:40 明确 queued 时为空，也不能同时实施。

**修复：** 列出核心链每一个精确目标 UNIQUE/FK，而不是目标表名占位。将 generation.page_set 与同一 submission 绑定；matching 关联同一 submission/exam 的 participation/名单；answer、review、draft item、正式 item 关联同一 participation/冻结槽位。为新 generation 选择“新 binding 记录”或可跨 generation 的匹配决定模型之一，全链一致；明确首个未匹配 validate job、queued 未领取 job 的可空守卫。区分稳定 participation 身份与名单版本：名单修订不能让同一考试同一学生出现两个仍生效成绩进入分析。给已发布 item 的追加/删除和发布聚合完整性明确数据库或受控命令防护。

FK 只检查声明的引用列；跨行/跨表条件不能靠普通 CHECK 随意读取其他表代替约束。[PostgreSQL 16 约束规则](https://www.postgresql.org/docs/16/ddl-constraints.html)。不要求现在写全产品 DDL，要求这一条核心链可直接翻译、合法初始状态可创建。

**G0 验收：** 精确 FK 表 + 最小说明性 DDL/伪命令 + 两代 OCR 修正/换页示例。每个目标键有列组和定义；新旧 binding 合法；未匹配/queued 路径不存在 NOT NULL 冲突。

**G1/M3 验收：** 同租户跨 submission 页集、跨 exam participation、跨卷槽位、跨学生 review 均失败；两代同学生输入可成功保存；名单纠错不双计历史/当前证据；正式发布事实不能被补插项或改归属。

**关联与责任：** G0-01/04/06；F01/F11/F18/F19。Cursor 补规格，负责人决议 ADR-001/006/011，独立审查复验。

### R3-02 — Blocker — 路由控制面与 RLS 业务面的事务和恢复仍不完整

**证据：** U:7–19、28–41；T:14、151–158；D:200。控制表 work_route_index/outbox_dispatch_index 不启用 RLS，router 只返回 tenant；relay 表中只明确 UPDATE 投递列，没有读取事件载荷的路径。

**风险/反例：** DB 已提交 job/outbox，但控制索引未提交时，Worker、relay 或 scheduler 仍不能发现任务。queue 清空后，索引只存 capability 哈希，恢复进程不能从哈希重建随机秘密；若无重新签发/投递路径，持久 job 存在也不能恢复。relay 拿到 event/tenant 却无合法 payload 读取能力，无法按完整协议投递。平台运营不设置 tenant，但订阅/用量属于租户 RLS 表，其汇总读政策或专用视图也未明示。

**修复：** 将路由/dispatch/就绪索引的创建、终结、失效和重建纳入业务同一数据库事务及公开端口；或者明确可证明不丢任务的派生/扫描替代方案。规定 capability 的生成、环境绑定、有效期、撤销/重发、恢复后旧 capability 的权限，秘密不得进入日志；不用“存哈希”暗示可解密。relay 给出限定 payload 读权限或受控读取函数。给平台全局身份、汇总视图和 grant 读取路径具体策略。函数 EXECUTE 授权与 safe search_path 必须明示；不把 API 已认证假装成数据库函数能自动验证的条件。

SECURITY DEFINER 函数默认可有 PUBLIC EXECUTE，且固定 search_path 还需排除不可信可写 schema，正确处理临时 schema；应明确创建、撤权、选择性授权的事务。[PostgreSQL 16 安全函数说明](https://www.postgresql.org/docs/16/sql-createfunction.html)。这些不是要求运行后台使用 BYPASSRLS。

**G0 验收：** 提交“业务+索引同提交/同回滚”“Redis 全清→重新签发/补投→首次解析”“两个租户 relay 完整投递”“平台汇总/个人只读”的权限与事务时间线。每一步有明确角色、表/函数权限、tenant 来源和 owner。

**G1 验收：** 索引写入前后崩溃不丢已提交工作；普通/错误环境 capability 无效；恢复后的旧凭据不能扩大权限；relay 可读该事件而不能读取学生正文；平台汇总不因缺上下文失败，也不越权读个人数据。

**关联与责任：** G0-02；F08/F13/F15/F16。Cursor，ADR-001/003/005。

### R3-03 — Critical — 接纳守卫缺少关键凭据/调用关联，幂等与锁顺序仍矛盾

**证据：** T:55–84、97–102；J acceptance-envelope 要求 lease_token/invocation_id；C:31；D:202。T:63–71 的“必须同时成立”未列 lease_token、lease_until/grace 和 invocation 与当前 attempt/job 的关联。T:63 先锁 job，T:97/102 则先锁 binding 指针。

**风险/反例：** A 仍是 current_attempt，但租约已过期、无人新领，按列出的条件仍可能提交，违背 M0 grace=0。当前 attempt 携错误 token 没有明确拒绝条件。提供同租户另一任务的 invocation_id，结构合法但谱系/费用可错挂。合法接纳将 job 改 succeeded，之后新 jti 的相同请求又遇到“job 不得 succeeded”，若按上述条件先执行，幂等应答分支不可达。不同入口采用相反锁顺序会造成可避免的死锁。payload 的重复题 ID 或不属于这次任务的题项集合，也尚未明确接纳规则。

**修复：** 接纳决策表包含 token 的可信比对、租约截止与唯一宽限规则、current attempt/epoch、当前业务输入/绑定、job stage、invocation 的 tenant/job/attempt/input/config 归属及已允许发送的状态。声明本任务预期题项集合，重复/越界/缺项按明确完整性政策拒绝，不因部分 items 让整 job 成功。合法幂等查找顺序先认证/受众/job/请求哈希，再返回已保存响应；新业务效果再执行非终态守卫。所有相关命令采用同一个锁顺序。分别定义 validate/OCR 无评分 invocation 的接纳契约，不能拿评分信封强迫伪造 invocation。

**G0 验收：** 给过期但未被接管、错误 token、错误 invocation、重复题 ID、相同结果在 succeeded 后重试、改输入与回传竞争的决策表。每个拒绝不改当前合法 job，不制造费用。

**G1 验收：** 真实窄切片验证过期/token 错误/跨任务 invocation 失败；同体幂等返回第一次结果；不同体失败；各命令按一致锁序完成，旧 attempt 不影响新 attempt。

**关联与责任：** G0-07，G0-11 的任务边界后续项；F11/F13/F21/F22。Cursor，ADR-003/004/013。

### R3-04 — Critical — 投影 CAS 没有明确检查当前 source fence

**证据：** T:130–145；A:72；T:19。

**风险/反例：** 文档规定发布更新 student_analysis_fences.epoch，但示例 CAS 为 `UPDATE analysis_current ... WHERE epoch=:read AND evidence_set_hash=:hash`。如果 analysis_current 仍是 epoch=4/H4，发布只把另一张 fence 表改为 5，旧计算用 4/H4 提交时这条 WHERE 仍能命中旧投影行。反之，新 evidence hash 与当前投影旧 hash 不同，若直接套同一 WHERE，新分析也可能永远无法推进。这是 CAS 对象/哈希用途没有区分，不能仅以表格说“失败”证明安全。

**修复：** 区分 source fence、捕获输入 evidence hash、投影行的 expected/current version。投影提交事务锁定或以等价并发控制校验实际 source fence 行，且与发布更新使用同一冲突对象；校验源证据集合仍匹配，再用投影自身版本 CAS 移动当前指针。首次投影插入、无证据、不同知识点/窗口、重复事件和 needs_recompute 都有路径。明确事件携带的 held_at 是证据时间，调度固定的分析窗口终点是计算 as_of，不能混为同一个时钟。

**G0 验收：** 两行不同表的反例必须被修订伪 SQL/锁时间线拒绝；新增 B 考试证据可成功更新；首次分析没有 current 行也可成功。给出发布和投影两个事务的逐步交错，不能仅写结果断言。

**M4–M6 验收：** 旧计算不成为当前；新 evidence set 不被旧 hash 阻断；跨考试、同场乱序、修订中计算、固定窗口重算和重排重启完整覆盖。G0 不要求算法实现。

**关联与责任：** G0-09；F09/F20。Cursor，ADR-005/006/007。

### R3-05 — Critical — Admission 没有占用容量，可能突破租户与全局上限

**证据：** T:151–168、179–180；S:40–41；U:35；ADR-012:22–23。

**风险/反例：** 租户 cap=2、running=0，scheduler 连续给三个 job 写 admission_until，Worker 尚未领取时 running 仍为 0，三次都满足文档挑选条件。ClaimJob 又只明确租约/attempt 条件，未检查/消耗 admission 名额，三个 Worker 都可能成为 running。即使 scheduler 单实例，这个窗口仍存在。多实例游标未明确锁定，公平和容量也缺少线性化点。

**修复：** admission 是可过期的容量预留，running+未消耗 admission 或等价占用不得超过 tenant/global cap。游标、tenant/global 计数或容量槽、job admission 在明确锁/CAS 下同事务变更；Claim 原子消费有效 admission 变成 running，不再次占用，也不能绕过。定义 release/expiry/cancel/reconcile 和重建，补足 expired 的已 admitted 当前 stage 例外及新 stage 拒绝。将 stage 费用额度与执行并发槽区分。

**G0 验收：** 在测试 cap 2/4 下推演多个 scheduler、多个已 admitted 尚未 running job、迟到 Worker、到期/暂停、重复 Claim、重启恢复。每步可计算占用总量，不能只看 running。

**G1/M3 验收：** 无超发/泄漏/重复消耗；A 的积压不让 B 长期饥饿；过期 admission 被收回；已 admitted 的到期例外与取消按决议执行。

**关联与责任：** G0-10；F12/F14/F17。Cursor，ADR-012。

### R3-06 — Critical — Invocation 发送、观察和结算还缺少可重入协议

**证据：** T:18、28–34、38–51；U:31–34；M:37–39；S:28。PrepareInvocation 已有，但 observation 的持久入口/角色/事务与账本业务唯一键未列。

**风险/反例：** 持久 intent 的 not_sent 不能自行证明外部请求没有送出；A 已开始调用但未保存发送事实时，恢复者可能重复发送。反之无法判定的 intent 会永久挂起。T:31 把“响应已到”等同于 intent+observation 已提交，实际还有响应到达至 observation 持久化的窗口。账本允许多条 confirm_delta，却没有 settlement/reconciliation event 唯一键；对同一供应商确认或人工指令重试可再次追加 12.50。付费 OCR 的接纳协调者未像评分一样列出结算参与者。

**修复：** 在调用前 intent 之后，定义唯一一次发送许可/epoch、发送尝试的持久状态、可证明未发与无法证明的区别；发送不确定走 unknown，不自动二次付费，不承诺外部精确一次。定义 RecordInvocationObservation/Settlement/Reconciling 等公开命令、能力、状态和失败恢复，observation 与原 invocation/attempt 绑定且金额来源可信。账本每个结算事件有稳定幂等键和 body hash，确认/差额重试不会双计；相同供应商 request/账单行的关联策略明确。将付费 OCR/其他 stage 的观察与费用结算一并覆盖。

**G0 验收：** 给 intent→领取发送许可→HTTP→observation→结果接纳/独立结算的时间线；两次恢复同时处理同一 intent；响应已收到但 observation 未提交；同一确认重试两次；unknown 后人工确认再重试。每笔已有成本都有可对账身份。

**G1/M3 验收：** mock 崩溃点不自动重复付费；未知可被审计/升级，且不伪装为零；一条确认重试 N 次仍只算一次，两次真实调用分别记账，账单更正差额可追加一次。

**关联与责任：** G0-08；F12/F14/F22。Cursor，ADR-012/013。

### R3-07 — Major — 现行规范仍有事件名、owner 和历史引用不一致

**证据：** T:106–123、145；M:31；ADR-006:22、ADR-007:20 保留 ScoreVersionPublished/Superseded；ADR-002:18–20/44 保留 AcceptAIResult 及旧章节指向；ADR-004:39 仍用并发上限表达公平。D:200 把外围对象继承 v1，但当前 D/S/T 都已替换，没有仓库内可读的完整旧配套版本；当前目录不是 Git 仓库。

**风险：** 实施者依 ADR 编写旧事件消费者时，收不到事务文档的 ScorePointerAdvanced。事件示例未携 event_id，但 inbox 明确用 event_id，必须声明在完整序列化信封或外层元数据中的位置。新 route/dispatch/admission/fence/observation/lifecycle 表缺少完整 owner/公开写端口清单；grading 直接 UPDATE fence 与模块只走公开命令原则没有映射。引用“2026-10-11 同文件”不能定位已覆盖的详细规则，也不能让 v1 主补充稿自动替代旧配套文档。

**修复：** 一个现行契约索引明确事件名称、schema、信封字段/外层元数据、所有消费者、事务命令和表 owner；旧名字撤回或明确别名转换，不能两套都作为规范。给新控制/生命周期/fence 表唯一写模块与公开端口，同步邻接。统一 AcceptGradeResult 等命令名、ADR 指向和条件。补齐现行需要保留的 relay ACK/租约、inbox、重试/取消、对象补偿和范围撤权契约；旧配套文档能从 Cursor 历史等恢复时保存真实快照，不能恢复则如实说明，不能重构后冒充原文。保留历史不要求先写业务代码。

**G0 验收：** 从事件生产者到每个消费者只有明确一致的路径；新表每个写动作都有 owner/角色/端口；保留条款可找到现行精确位置。旧审查证据有可读取版本或诚实标记其历史快照未提供。恢复历史本身不单独阻断 G0，现行核心契约的缺失/冲突必须补。

**G1 验收：** 序列化事件含去重与追踪身份，消费能工作；依赖检查禁止互写 repository；relay/inbox/恢复按现行契约故障验证。

**关联与责任：** G0-09/13，G0-06 保留契约；F07/F08/F28。Cursor，ADR-002/004/005/006/007。

### R3-08 — Minor — Ajv 配置还应声明 UUID format 的注册方式

**证据：** C:19–22；两份现行 JSON 使用 `format: uuid`。

**风险：** `validateFormats: true` 表示启用检查，不自动提供格式实现；仅照现行配置建立 Ajv 2020-12，在 strict 模式下可能因未注册格式而无法编译。Ajv 7 起格式由 ajv-formats 等提供。[Ajv 官方 format 指南](https://ajv.js.org/guide/formats.html)。本轮没有安装/运行 Ajv，不声称已复现编译错误。

**修复与验收：** 在契约说明补出 ajv-formats 或明确 addFormat 注册、schema 注册顺序及 UUID 正/反例。M0/G1 用固定版本运行两个 validator。此 Minor 可作为受限 M0 后续任务，不单独使 G0 No-Go；双层输出方案无需重写。

**关联与责任：** G0-11 后续项，F21/F28。Cursor，ADR-013。

## 5. ADR 与产品语义的决议边界

15 份 ADR 均诚实保持 Proposed，本轮不代签。下面是修订后可裁决的范围，不要求现在决定所有生产数字。

| ADR | 本次建议 |
|---|---|
| 001 | MATCH 区分/RLS 方向可保留；R3-01/02 补齐后再接受核心方案 |
| 002 | 新邻接方向可保留；R3-07 的 owner/公开端口与正文同步后裁决 |
| 003 | Worker→NestJS 与分 scope 可保留；R3-02/03/06 接纳/观察路径补齐 |
| 004 | 保持已确认 Python Worker；测试版本在 M0 开始互操作实验前锁定，实际兼容证据在 G1 |
| 005 | Outbox 方向可保留；控制索引、事件/去重、fence 契约按 R3-02/04/07 修订 |
| 006 | 草稿/正式事实分离已可审；精确归属和派生 fence 仍按 R3-01/04 修订 |
| 007 | total_only/缺考/空白/整场首发方向可审；发布后错人纠正见下段，事件名要同步 |
| 008 | 保持 PostgreSQL 图谱与内容生命周期方向，M2 细节后续决议 |
| 009 | 私有对象/代理/page_set 可审；跨 submission 归属和 worker 读取按 R3-01/02 |
| 010 | 三环境、单迁移者、expand/回填/校验/contract 方向可审；RPO/RTO 后续批准 |
| 011 | 版本内名单唯一可保留；participation 跨名单版本身份和绑定按 R3-01；班级政策 M1 前决议 |
| 012 | stage 预留与轮转方向可保留；admission 容量和 invocation/结算按 R3-05/06 修订 |
| 013 | 双层 schema、组合函数和默认人工方向可审；R3-03/08；阈值等基准后决议 |
| 014 | M0 合成学生数据/授权试卷/端点名单边界可独立批准；真实数据专项仍未通过 |
| 015 | 所有来源保留与总分正式路径可审，原 M1–M7 落位继续保留 |

`attribution_corrected_away` 不因被称为“不是撤回按钮”就成为已确认产品行为。它使甲的当前成绩变为 NULL，对排名、统计、导出、缺考区分、学生乙已有成绩以及教师/学校通知流程均有影响。负责人须明确选择：接受有定义的归属纠正政策，或本版继续拒绝发布后换绑并记录人工处置流程。后者也可以通过 G0，不能强迫增加原基线未确认的写操作。

如果选择支持归属纠正，还须明确甲、乙两个 participation 的原子/分阶段语义、权限、已有分数冲突、待处理展示、审计、分析失效及不得重复使用相同证据的规则。在此之前该路径保持 Proposed、不可实施，不能把 null 模式当作隐式批准的成绩撤回。

M0 最小数据政策、日志/指标、环境/迁移计划已比 v1 具体。真实合规、供应商区域、删除/备份重放、RPO/RTO、生产 SLO 与真实学校质量不在本轮认定完成，仍按原阶段闸门执行。

## 6. 下一轮只需提交的精确补丁

| 顺序 | 任务 | 需给出的材料 |
|---|---|---|
| 1 | R3-01 核心引用链 | 精确 FK/UNIQUE、可空状态、generation/binding 与同考试链，最小说明 DDL |
| 2 | R3-02 控制索引与授权 | 索引同事务写入、capability 重发、完整 relay 读路径、函数/策略矩阵 |
| 3 | R3-03/06 接纳与调用账 | 完整接纳顺序、锁序、发送/observation/结算命令和业务唯一键 |
| 4 | R3-04/05 两个并发协议 | 实际 fence 冲突行的交错时间线；admission 占用/消耗/释放计数 |
| 5 | R3-07/08 规范同步 | 现行契约索引、owner/公开命令、事件全信封、ADR 正文同步、format 注册 |
| 6 | 决议与再复验 | 修订方案准备裁决，更新四状态追踪表；独立复验后记录负责人决议 |

无需再铺一整套概念章节；保持本轮已经正确的表形、输入范围、双层 schema 和门槛。每项提交“改变了哪些具体字段/约束/顺序”“一个合法例子”“一个被拒绝的反例”“对应未来 G1 测试”，而非再写一次“已补齐”。

执行修复交给 Cursor/开发者；ADR 及产品语义决议交给项目负责人；设计复验由独立 Architecture Review Agent；运行验证由 QA/测试负责人。原 Fxx 的 Closed 只能按实际证据与阶段门槛完成。

另附 [Cursor 第三轮精确补修 Prompt](/Users/johnny/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an-2/outputs/cursor-g0-remediation-prompt-v3.md)。本轮仍只交付设计，不授权原 Prompt 2。

## 7. Go / Conditional Go / No-Go 判定

**本次 G0：No-Go。** 两项 Blocker 与四项 Critical 的核心设计仍未闭合，相关核心 ADR 未决；原 Prompt 2 仍未具备前置条件。R3-08 Minor 和没有 G1 测试不单独作为 No-Go 理由。

**受限前置工作：维持原 Conditional Go。** 可继续仓库骨架、合成数据实验和已授权试卷/答案隔离 PoC，不能据此建立上述未决协议的正式生产模型、导入真实学生数据或发布真实成绩。

下一次 G0 放行须有：R3-01/02 设计复验通过；R3-03–06 的 M0 核心协议和后续版本/事件边界一致；R3-07 现行规范无实质冲突；负责人对修订后的核心 ADR/M0 使用范围明确决议；追踪表保留独立设计复验结果、决策证据与尚未运行栏。未来完整算法和生产数值可以有边界地后续处理。届时无需先提交 G1 实测才能开始 M0，实现完成后再按 G1 验收。
