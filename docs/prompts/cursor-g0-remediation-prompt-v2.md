# Cursor Prompt — 第二轮 G0 架构设计补修

**配套独立报告：** ZX-AR-20261012-02  
**用途：** 修订设计补充包，重新申请 G0；本 Prompt 不授权实施原 Prompt 2。

将配套报告放入项目 `docs/quality-reports/architecture-g0-re-review-report-v1.md`，本文件可放入 `docs/prompts/`。随后把下方 Prompt 发给 Cursor。原始需求和架构文件仍保留原路径。

---

你是智学 SaaS 的架构设计修复执行者。请根据独立报告 ZX-AR-20261012-02 修复 G0-01–G0-13，输出第二轮可评审设计包。本轮只做设计，完成后交回独立 Architecture Review Agent 复验。

## 输入与权威顺序

先读取以下文件，建立需求→原 Findings→本轮 Findings→ADR→设计规格的追踪关系：

1. `docs/product/requirement-decisions-v0.1-v0.28.md`
2. `docs/product/requirements-v1.0-original.md`
3. `docs/architecture/architecture-v1.0-original.md`
4. `docs/quality-reports/architecture-review-report.md`
5. `docs/quality-reports/architecture-g0-re-review-report-v1.md`
6. `docs/architecture/review-remediation-v1.md`、`data-dictionary.md`、`state-transitions.md`、`transaction-boundaries.md` 与 `schemas/` 中的草案
7. `docs/decisions/ADR-001` 至 `ADR-015`，以及 `docs/quality-reports/architecture-findings-tracker.md`

需求确认记录和原始需求基线优先；原架构与补充稿技术建议不等于已批准决策。另一份 PRD 或演示页面不能隐式替代上述基线。若配套报告缺失，先列出缺失输入，不能仅凭本 Prompt 宣称修复已通过。

## 本轮边界

- 保留 NestJS 模块化单体、FastAPI 推理服务、PostgreSQL、Redis+BullMQ+Python Worker 和确认的前端/部署路线。
- 保留 Word/手工标准答案、Excel 学生/总分/逐题、已批改卷提取教师分、AI 生成题审核、无学生端等已确认要求。
- 不写业务实现，不执行生产迁移，不创建真实服务连接，不调用付费模型，不导入学生数据。
- 可以写说明用 SQL、接口签名、JSON schema、测试向量及事务时间线；明确标注 Proposed / illustrative，不冒充已运行代码或证据。
- 原始需求、原始架构、独立报告不修改。创建 `review-remediation-v2.md`，保留 v1 历史。配套字典、状态、事务、schema、ADR 和追踪表可同步修订，但必须记录变化和旧版本来源；契约变化需要明确版本关系。
- 无项目负责人决议不得把 ADR 改为 Accepted；没有测试不得把 Findings 标为 Verified 或 Closed。

## 工作包 A：数据关系、版本事实与来源发布

完成 G0-01/03/04/05。

1. 核心外键矩阵逐项写源表/源列、NOT NULL、MATCH、目标表/目标列、目标唯一约束、ON DELETE、数据库或事务守卫。必要关系全部非空；可选关系不能沿用导致 `(nonnull tenant,NULL parent)` 失败的通用 MATCH FULL。全局目录引用与租户引用分开。
2. 明确当前成绩指针的精确 FK 目标及已发布限制，保证 participation、score version、exam、冻结卷、槽位、review 和 answer/generation 的归属链。不能只说“都同租户”。
3. 选定草稿/不可变正式事实/生命周期的统一表形，逐命令写具体 INSERT/UPDATE 列、角色、CAS 和状态限制。合法审核/作废/草稿编辑可行，已发布内容和 items 不可变；AI 接纳角色不可发布。
4. 名单版本及 entries、世代页清单、匹配绑定有明确身份与 FK。支持同考试同学生的名单纠错版本、同答卷同页码的替换版本，保存旧证据。定义发布前/后错误学生绑定的处置边界，不修改历史成绩归属来掩盖错误。
5. 定义 itemized、total_only、absent 或等价的成绩依据模式：真实来源、教师确认、total/items 校验、NULL 语义、发布资格和分析资格。仅有总分不能构造题级证据，但必须可以确认并成为正式总成绩。
6. 非 AI proposal/review 的 job/answer 引用组合按来源说明；提取教师分若有解析 job，明确性质，不能制造 AI 评分调用。空白被教师明确判为零时，有合法 numeric 0 记录与原 blank 证据。

交付样例：两版名单、两版第 1 页；四来源进入正式成绩的引用图；缺考和空白记零；6→8→7 三次修订与当前指针；核心约束 SQL 设计片段。

## 工作包 B：后台授权、结果接纳与调用账

完成 G0-02/07/08/11。

1. 身份→内部动作→服务能力→数据库角色→表/列→tenant 上下文建立方式矩阵，覆盖普通请求、Worker claim/read-input/renew/prepare-invocation/accept、relay、reconciler、scheduler、平台运营、限时个人只读与发布。
2. 解开“先查 job 才有 tenant，但无 tenant RLS 不可查 job”的循环。选择最小控制入口或受约束函数等明确方案，写认证/防枚举/审计与 RLS 行为；常规后台不得使用 migrator BYPASSRLS。
3. CAS 核对 job 的 current_attempt/current_epoch 与业务当前 generation/匹配/输入配置，定义原子失效边界。租约宽限若存在，明确无新领取/取消/世代变化的前提。
4. 接纳副作用表至少区分：未认证、错受众/错 job、旧世代、旧租约、取消、当前合法但输出非法、合法成功、同幂等体重试、不同幂等体。旧/未认证输入不得把当前 job 改失败，不得凭不可信载荷制造费用。
5. 区分 jti 防重放与业务幂等。相同逻辑请求合法返回原结果的凭据规则和 body hash 明确，保持认证检查。
6. 调用前持久化 invocation intent 与配置/输入/预算，事务提交后外部调用；调用观察、proposal 接纳、费用结算分别有可信入口。定义发送后崩溃、未知费用、对账追加和人工升级。unknown→confirmed 在 INSERT_ONLY 账本下有可计算且不双计的事件/差额规则。
7. 分离 ModelGradePayload 与服务接纳信封。控制 token、generation、epoch、身份不放模型 prompt；模型元数据从实际配置/供应商响应记录。字段来源矩阵注明 trusted/untrusted 和生产者。
8. 冻结 rubric 定义评分组合函数、必要 criterion 集合、重复 ID 拒绝、suggested_score 对组合结果的校验与合法例外。证据绑定 asset/generation/OCR revision；bbox/span 顺序合法。双端 validator 的 draft/format/额外字段规则明确。

交付时间线：调用前崩溃、发送后崩溃、接纳前崩溃；A 旧租约/B 新领取/A 迟到；教师改输入与回传竞争；unknown 对账两条账；合法幂等重试与恶意重放。结构和语义测试向量分开，不把 JSON 可解析当成 schema 双端通过。

## 工作包 C：恢复状态、派生事件、调度与依赖

完成 G0-06/09/10/13。

1. 补齐新 submission→validated、已经 matched 的纠错、缺页补/换页、终败后的纯人工评分、复核失效后重审等必要边。统一上传状态与事务顺序。每边列 actor/from/guard/to/版本/具体写入/费用/错误；禁止通用 PATCH status。
2. 发布事件排序使用稳定聚合身份，把 score_version_id 作为版本事实。定义多考试 evidence_set_version/analysis_generation 和固定 as_of/分析窗口。发布推进轻量 freshness 栅栏，外部计算提交时检查完整输入仍有效；不能用单场成绩版本号比较学生全部证据。
3. 推演 A 考试 v2 后 B 考试 v1、同场 v2 先完成 v1 后到、计算中修订、重复事件和固定时间重算。定义历史归档、当前推进、失效与需重算的 ACK/inbox 语义。不实现完整学情算法。
4. 定义开源可实现的租户公平挑选与 admission 上限，不能只把并发 cap 称作公平调度。明确多阶段预留与 expired/suspended 后续阶段政策；重试预算/deadline/unknown 处理是确定配置接口，测试值与生产待定值分开。
5. 以调用方→被调用方邻接矩阵为规范，区分编译依赖、查询端口、事件和 UoW 参与。图与表一致，无编译环。分别定义文件校验、OCR 结果、评分结果接纳协调者和参与命令；组合根路由不使 ai-orchestration 导入业务内部代码。

## 工作包 D：门槛、ADR 与追踪表

完成 G0-12，汇总所有修复。

- G0：核心设计一致、可实施、相关决策明确、需求/M0/Python/数据边界清楚。
- G1：M0 真实角色、故障注入、Python 互操作、双端 schema、对象与账本验证。
- G2：完整关键风险、真实数据/质量、容量、恢复及生产试点验收。
- 不再用“没有 G1 运行测试”推导 G0 失败；本轮也不能代独立审查宣布 G0 已通过。
- 保留原 F01–F28 ID/严重度/历史，新增 G0-01–13 关联。设计复验、ADR 决策、实现、验证分列，不把 Design proposed 当成设计通过。
- ADR-001/002/003/005 及 ADR-006/007 核心契约准备成具体可决议选项；ADR-009/010/012/013/014/015 按 M0 使用范围准备决议。未来算法、阈值、年限和生产数值可明确待定，不填虚构值。
- 保留 M0 窄切片、M1–M7 来源落位。M0 最小环境/迁移/日志指标/端点名单/合成数据规则要具体；不把隐私和恢复全部推到上线前最后一刻。

## 最终交付

1. `docs/architecture/review-remediation-v2.md`，逐条回应 G0-01–13，注明修改位置、方案、假设与待决。
2. 同步的字典、状态、事务、模块邻接矩阵、授权矩阵、事件与双层输出契约；全部版本一致。
3. 修订的 Proposed ADR，未决项与推荐可供负责人直接评估，不能伪造签署。
4. 更新 Findings 追踪表，原 Fxx 与本轮 G0-xx 均可定位；本轮只记录设计交付，运行栏保持实际状态。
5. `docs/quality-reports/g0-design-response-v2.md`：每项 finding 的答复、跨文件一致性检查、未解决项、G0 决议清单和未来 G1 测试计划。

自检必须检查：每个 FK 有精确目标键；合法 NULL 不被拒；每条状态边有允许的数据库写操作；每个跨模块调用有合法依赖边；每个后台动作有可建立 tenant 的身份路径；每类成绩来源能人工确认和发布；每次可能付费调用在外部请求前有持久意图；旧 attempt 不推进当前业务；多考试证据不靠单场版本排序；所有文档/ADR/schema 版本一致。

若某项无法闭合，明确留下风险与备选，不能用“实现时再处理”盖过数据安全、成绩和任务核心不变量。完成后停止在设计交付，提交独立 G0 复验；不要执行原 Prompt 2。
