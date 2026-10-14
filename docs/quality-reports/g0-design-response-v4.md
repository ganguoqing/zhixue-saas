# G0 设计答复 v4

**编号：** ZX-DES-20261012-04-RESPONSE  
**日期：** 2026-10-12  
**对照：** ZX-AR-20261012-04  
**结论：** R4-01–R4-04 的设计补丁已提交，供独立 G0 复验。作者不宣布 G0 通过。原 Prompt 2 未执行。

逐项位置、顺序、例子、反例、待决和测试计划在 `docs/architecture/review-remediation-v4.md`。

## 交付

- 新增本答复和 `review-remediation-v4.md`。
- 局部同步了说明 SQL、数据字典、状态、事务、授权、邻接、契约索引和评分契约中的字段名。
- ADR-001/004/012 增加了仍为 Proposed 的句子。没有 Accepted。
- 改前正文在 `docs/architecture/snapshots/zx-des-20261012-03/`。

## 静态说明与运行证据

列组、身份表、cap=1 时间线和对照表都是规格文本。没有执行迁移，没有连接 PostgreSQL 或 Redis，没有调用模型，没有导入学生数据。

## 请独立复验

请复验七列外键目标、submission 与学生同一性、`EXECUTE` 身份、capability 待投递行，以及过期原槽转移。R3-03 的接纳顺序和 R3-04 的 fence 对象保留，但接管边和 `evidence_held_at` 字段需要一并看过。本轮到此停止。
