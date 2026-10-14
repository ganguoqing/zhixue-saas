# Prompt 1：架构设计闭合与 G0 准入

将下面“执行文本”的全部内容粘贴到 Cursor Agent 聊天中。

## 执行文本

开始前，请按顺序读取项目内这些文件：
1. AGENTS.md
2. docs/product/requirement-decisions-v0.1-v0.28.md
3. docs/product/requirements-v1.0-original.md
4. docs/architecture/architecture-v1.0-original.md
5. docs/quality-reports/architecture-review-report.md
必要时查阅 docs/references/review-evidence.md。上述材料已放入当前项目，不需要重新访问原ChatGPT对话。

你是智学 SaaS 的 Cursor Development Agent。本任务仅提交独立的“架构修复设计补充稿”，不得覆盖原产品基线或架构初稿，不编写完整业务功能，不部署生产。

先读取：
- V0.1–V0.28逐项确认及用户答复；
- 产品需求规格说明书V1.0；
- 技术架构设计V1.0初稿；
- ZX-AR-20261011-01审查报告及F01–F28；
- 当前仓库AGENTS.md、Cursor Rules和已有ADR（如存在）。

已确认技术栈：React+TS+Vite+Ant Design、NestJS模块化单体、Python FastAPI、PostgreSQL、Redis+BullMQ+Python Worker、S3兼容存储、Monorepo、Docker+托管服务。不要擅自改栈。RLS、Outbox实现、具体实体与状态命名、确认/发布语义仍需ADR决议。官方Python BullMQ有Worker API，必须做所选版本兼容验证，不能凭记忆认定Python不支持BullMQ。

按以下顺序输出：
1. 需求追踪表，逐条覆盖R01–R28，标已确认、设计建议、待验证、汇总遗漏/矛盾。特别保留Word标准答案/手工录入、Excel总分/逐题/学生导入、已批改卷提取、AI生成题审核、无学生端。后续口径只有明确更改才可取代先前确认。
2. ERD+数据字典：每表owner模块、tenant分类、PK/复合FK/UNIQUE/CHECK、索引、删除/归档策略。区分全局身份/平台内容/租户内容。租户父子约束必须保证同tenant；答案/attempt/paper_question还要保证同exam与同固定卷版本。包含名单快照、来源资产/上传会话、答案revision、AI proposal、人工review、正式score_version、修订请求、job/attempt/invocation、outbox/inbox、quota reservation/ledger。
3. 学年/学期/班级有效关系、半开时间区间、转班/任课历史与历史访问权，考试名单与教学事件目标快照。不要用当前班级反写历史。
4. 模块表所有权、公开命令/查询、依赖DAG、业务事务协调者、Unit of Work。禁止跨模块直接写内部repository。common仅技术基础设施。
5. 事务/Outbox/对象finalize协议：每个命令哪些写入必须同DB事务；relay ACK/重投、inbox去重、事件schema与聚合版本；对象上传与DB不能假装原子，给出补偿/孤儿清理。
6. 权限矩阵：action/resource/tenant/subject/grade/class，角色与数据范围、平台运营与个人记录访问分离、撤权及缓存；RLS选择、实际运行DB角色、USING/WITH CHECK、无上下文拒绝、连接池事务上下文、迁移角色分离。若不采用RLS，提交同等级隔离方案与可检验证据。
7. 上传→匹配→OCR→逐题评分→人工复核→确认发布→成绩修订的完整转换表，含actor/guard/from/event/to/事务副作用/错误码/expected_version。任务执行状态与业务状态分开，补齐取消/最终失败/人工恢复/部分成功/重复提交/缺考/空白/缺页，明确批量确认ID+版本选择。
8. 评分冻结闭包、成绩修订后的重新发布与派生失效/重算协议。正式分数不可覆盖；AI不能确认发布；旧结果不能覆盖新世代或教师修改。
9. AI输入/输出与服务结果接纳契约：版本化JSON Schema、冻结满分/题目/评分点校验、证据定位、未知/非法输出升级、服务身份/防重放、版本谱系、成本未知与真实重试费用。
10. 数据流与样本授权最小政策、环境分离、迁移/恢复、M0窄切片范围与M0–M7需求落位。

交付建议：
docs/architecture/review-remediation-v1.md
docs/architecture/data-dictionary.md
docs/architecture/state-transitions.md
docs/architecture/transaction-boundaries.md
docs/decisions/ADR-001...015.md
docs/quality-reports/architecture-findings-tracker.md

ADR均保留真实状态和决策责任，不代项目负责人填Accepted；将备选、代价、兼容、故障模型与验收列清楚。原设计不修改。若发现用户决策已与候选建议冲突，按基线执行并记录问题。

完成报告必须逐项列F01–F28：设计补齐位置、待决项、未来测试、关闭所需证据。G0只报告是否满足，不将未运行测试标通过。本任务不应声称已关闭实现风险。
