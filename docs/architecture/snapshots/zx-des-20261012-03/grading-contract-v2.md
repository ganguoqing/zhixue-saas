# 评分契约 v2（Proposed，2026-10-12）

包编号 ZX-DES-20261012-02。v3 只补充 format 注册顺序，不改两份现行 JSON。未运行双端校验。JSON 能被解析不等于 Draft 2020-12 通过。

## 版本关系

| 标识 | 状态 | 关系 |
|---|---|---|
| `grading-result/1.0.0` | 撤回 | 2026-10-11 草案把模型输出和服务信封写在一起。从未 Accepted，也未部署。禁止实现 |
| `model-grade-payload/1.0.0` | Proposed | 只含模型产生的不可信评分内容 |
| `acceptance-envelope/1.0.0` | Proposed | Worker 组装。`payload` 引用上一份 schema |
| `zhixue.event/1` | 撤回 | 用 score_version UUID 当聚合身份，且没有 `evidence_as_of` |
| `zhixue.event/2` | Proposed | 聚合是 participation 的当前指针；`score_version_id` 是载荷事实 |

## 校验器配置

两端都要显式声明，不能只做 `JSON.parse`。

| 端 | 库配置（设计，未安装、未运行） | 行为 |
|---|---|---|
| TypeScript | `Ajv2020`：`strict: true`，`allErrors: true`，`removeAdditional: false`。先 `addFormats(ajv)`（ajv-formats），再 `addSchema(payload)`，再 `addSchema(envelope)` | 额外字段失败；不删除后当成功。`validateFormats: true` 本身不注册 UUID |
| Python | `jsonschema.Draft202012Validator` + `FormatChecker`，两份 schema 注册到同一 `referencing.Registry` | 同上。信封里的 `$ref` 必须解析到 payload schema |

UUID 正例：`018f0a3e-7c21-7b2a-8c11-111111111111`。反例：`not-a-uuid`。本说明未安装、未运行 Ajv。双层 schema 文件不因该项改写。

结构测试与语义测试分开。结构测试只证明 schema。语义测试读取冻结 rubric，不把“JSON 合法”当成分数合法。

## 字段来源

| 字段 | 所在层 | 生产者 | 信任 |
|---|---|---|---|
| `paper_question_id`、`recognized_answer`、`suggested_score`、`criterion_awards`、`evidence.*` | ModelGradePayload | 模型 | untrusted，必须对照冻结闭包 |
| `job_id`、`attempt_id`、`generation`、`fencing_epoch`、`lease_token`、`input_hash`、`invocation_id` | AcceptanceEnvelope | Worker，从领取时的持久 job 复制 | trusted only after CAS 与凭据一致；不放进模型 prompt |
| provider、model_id、prompt_version、pipeline、ocr、temperature | `model_invocations` 行 | `PrepareInvocation` 时的服务配置，加上供应商响应里可得的 request id / revision | trusted。模型 JSON 里若自报这些字段，schema 已拒绝（payload `additionalProperties: false`） |
| 租户、考试、学生 | 持久 job 与 matching binding | NestJS | trusted。载荷中的同名值若出现则属于额外字段，整包结构失败 |

控制 token、generation、epoch、lease 不进入模型输入包。输入包只有冻结槽位、答案、评分点、允许的 asset id 与页码。

## 冻结 rubric 的组合函数

每个冻结槽位有 `scoring_mode`，在冻结时写入，模型不能改。

`criterion_sum`：

- 必填评分点集合 = 该槽位冻结 rubric 中 `required = true` 的 criterion id，且该集合非空。
- `criterion_awards` 中的 id 必须与该集合完全相同：缺一个、多一个、重复一次都拒绝。
- 每个 `awarded_points` 在 0 与该点 `max_points` 之间。
- `suggested_score` 必须等于这些点数按十进制两位四舍五入后的和。
- 因此建议分 8.00、评分点和 3.00，即使都小于满分，仍然拒绝。

`atomic`（客观题或没有评分点的槽位，冻结时声明）：

- `criterion_awards` 必须为空数组。这是冻结规则允许的例外，不是模型临时发明的。
- `suggested_score` 只与槽位 `max_score` 比较，范围 0 至满分。

其他 `scoring_mode` 拒绝。空的 `criterion_awards` 在 `criterion_sum` 下不合法。

## 证据

- `source_asset_id + page_index` 必须属于该 generation 的 `page_set`。
- bbox 为 `[x0, y0, x1, y1]`，均在 0 到 1，且 `x0 < x1`、`y0 < y1`。反向框拒绝。
- `ocr_span.start < ocr_span.end`。若该页 OCR revision 的文本长度已知，`end` 不得大于长度。
- 证据行保存 `ocr_revision_id`（服务端从 generation 写入，不由模型提供）。模型只提供页与框或 span。

## 语义测试向量（不是结构测试）

| 编号 | 输入 | 期望 |
|---|---|---|
| S1 | payload 含 `lease_token` | 结构失败 |
| S2 | 信封含模型自报 `provider` | 结构失败 |
| S3 | 重复 `criterion_id` | 结构可通过，语义拒绝 |
| S4 | 缺少一个 required criterion | 语义拒绝 |
| S5 | 和为 3.00，`suggested_score` 为 8.00 | 语义拒绝 |
| S6 | `atomic` 且 awards 为空、分数在满分内 | 语义通过，仍只形成 proposal |
| S7 | bbox `[0.8, 0.2, 0.1, 0.9]` | 语义拒绝 |
| S8 | span `start >= end` | 语义拒绝 |
| S9 | asset 不在该 page set | 语义拒绝 |
| S10 | 额外字段 `reviewRequired` | 结构失败，不剥掉后接受 |

S3–S9 使用已经通过结构校验的文档。S1、S2、S10 是结构向量。未运行。
