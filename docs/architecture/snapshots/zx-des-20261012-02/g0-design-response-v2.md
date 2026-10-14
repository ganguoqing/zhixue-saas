# G0 设计答复 v2

**编号：** ZX-DES-20261012-02-RESPONSE  
**日期：** 2026-10-12  
**对照报告：** ZX-AR-20261012-02  
**身份：** 设计修复执行者。不是独立审查，不宣布 G0 Go。

v1 补充包的 No-Go 来自规格冲突和决策未决。缺少尚未开始的 M0 运行测试，不作为本轮 G0 结论的依据。运行栏全部保持“未运行”。

## 逐项答复

| ID | 答复 | 规格位置 | 仍待决 | 运行 |
|---|---|---|---|---|
| G0-01 | 已分开 MATCH FULL 与 SIMPLE，并给出指针的精确目标键 | 数据字典 §1、§3；`sql/core-constraints-v2.sql` | ADR-001 | 未运行 |
| G0-02 | 路由函数先于 RLS；角色与 scope 矩阵已写 | `authorization-matrix-v2.md` | ADR-001/003 | 未运行 |
| G0-03 | 草稿、正式事实、生命周期分开，并按命令列出列权限 | 数据字典 §2、§4 | ADR-006/007 | 未运行 |
| G0-04 | 版本内唯一；发布前后换绑边界不同，且不改旧成绩行 | 数据字典 §5、§7 | 若否决 `attribution_corrected_away`，发布后换绑保持拒绝 | 未运行 |
| G0-05 | 四种 basis。总分可以正式发布且没有题级证据 | 数据字典 §6 | ADR-007/015 | 未运行 |
| G0-06 | 补上校验、已匹配纠错、换页、人工录分、复核重开 | `state-transitions.md` | 状态名可改，边不可删 | 未运行 |
| G0-07 | 当前 attempt CAS；拒绝副作用表；jti 与业务幂等分开 | 事务文档 §4–§5 | 生产宽限未填 | 未运行 |
| G0-08 | HTTP 前有 intent；unknown 与 confirm 是两行且不双计 | 事务文档 §2–§3 | ADR-012 | 未运行 |
| G0-09 | event/2 用指针聚合；证据集合与 fence CAS | 事务文档 §6 | 算法留到 M4 | 未运行 |
| G0-10 | 轮转 admission，不是单独的 cap；预留按 stage | 事务文档 §7 | 生产 cap 未填 | 未运行 |
| G0-11 | 双层 schema、组合函数、字段来源和向量 | `schemas/grading-contract-v2.md` | ADR-013；双端校验未跑 | 未运行 |
| G0-12 | 四状态分列；作者不宣布通过 | 本文件与追踪表 | 负责人决议 + 独立复验 | 未运行 |
| G0-13 | 调用方矩阵与三个协调者一致 | `module-adjacency-v2.md` | ADR-002 | 未运行 |

## 跨文件一致性

| 检查 | 结论 |
|---|---|
| 指针外键 | 字典、SQL、ADR-006 都是 `score_versions(tenant_id, participation_id, id)` |
| 可选 NULL | 字典与 SQL 对 owner、学生导入 exam 使用 MATCH SIMPLE |
| 事件名 | 事务文档与 ADR-005 使用 `zhixue.event/2`。`zhixue.event/1` 只作为已撤回历史出现 |
| 合并 schema | `grading-result/1.0.0` 文件体为撤回。现行两份 schema 与 ADR-013、契约说明一致 |
| 接纳协调者 | 邻接文件、事务文档、状态文档：校验与 OCR 归 submission，评分归 grading |
| AI 不能发布 | 授权矩阵、字典写权限、状态文档一致 |
| 总分发布 | 字典、状态文档、ADR-007/015 一致：不要求逐题 review，禁止 mastery_evidence |
| 公平 | ADR-012 正文已改为轮转，不再把 cap 当成公平 |
| v1 修复稿 | 未改原文。它与 v2 冲突的 MATCH、唯一键、箭头图和合并 schema 不再有效 |

未发现仍把“无 G1 测试”写成 G0 失败原因的现行句子。v1 文末的 G0 自检保留在历史文件里，不被当作 v2 结论。

## 未解决

1. 十五份 ADR 都还是 Proposed。规格闭合不能代替负责人签署。
2. 若否决 `attribution_corrected_away`，发布后的错误绑定没有第二个写路径。这是留给决议的风险，不是实现细节。
3. 生产重试秒数、公平上限、RPO/RTO、保留年限、准确率阈值、掌握度公式仍然空白。
4. 双端 schema、RLS、Outbox、Python 互操作都没有运行证据。它们属于 G1，不在本轮冒充通过。
5. `grading-result/1.0.0` 的旧文件还在，内容已不可用作契约。复验时应读 `$comment`，不要按 2026-10-11 的字段实现。

## G0 决议清单

见 `review-remediation-v2.md` 的决议表。核心是 ADR-001、002、003、005、006、007，以及 M0 会直接用到的 009、010、012、013、014、015。004 与 008 保持已确认技术方向，细节仍 Proposed。

通过独立复验并且负责人写下选项、日期和责任人之后，才可能变成 G0 Go 或有边界的 Conditional Go。本文件不完成那一步。

## G1 测试计划（现在不执行）

1. `zhixue_app`：学校题空 owner 成功；跨租户 owner 失败；指针指向草稿失败；同卷槽位错误失败。
2. 无 tenant 的 Worker 用错误 capability 不改变 job；正确 capability 后只读到该租户，且输入包无姓名。
3. Relay 依次处理两个租户的 outbox，载荷不串。平台运营读个人成绩失败；限时 grant 只读成功。
4. 提交前、入队前、ACK 前、HTTP 发送前、发送后、接纳前的崩溃。未知费用显示为未知，确认后合计等于确认值而不是两倍。
5. A 过期、B 领取、A 回传不改变 B。教师改 generation 与旧回传只有一个提交。
6. 锁定的 Node 与 Python BullMQ 版本完成入队和消费。失败才允许另提替代 ADR。
7. 两端按契约说明的 Ajv 与 Draft202012 配置跑结构向量；语义向量另测 8≠3、重复 criterion、反向 bbox。
8. 四来源发布。总分无 mastery 行。缺考不是 0。空白记零能找到原 blank 行。
9. 两版名单、两版第 1 页都能读到旧字节。发布后换绑不 UPDATE 旧 total。
10. 测试剖面下 A 积压时 B 仍被轮转到。A 到期后不再 admission 评分 stage。
11. 合成数据开关：非 forbidden 拒绝启动；日志抽查无答卷正文。

Prompt 2 仍不执行。
