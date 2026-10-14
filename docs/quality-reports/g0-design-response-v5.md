# G0 设计答复 v5

**编号：** ZX-DES-20261012-05-RESPONSE  
**日期：** 2026-10-12  
**对照：** ZX-AR-20261012-05  
**结论：** R5-01 与 R5-02 的设计补丁已提交，供独立 G0 复验。作者不宣布 G0 通过。保守恢复政策尚未被负责人接受。原 Prompt 2 未执行。

位置、命令、三个样例和空值行在 `docs/architecture/review-remediation-v5.md`。

## 交付

- 新增本答复和 `review-remediation-v5.md`。
- 局部同步了状态、事务、字典、说明 SQL 注释、授权、契约索引。
- ADR-004/012/013 增加 Proposed 说明，没有 Accepted。
- 改前正文在 `docs/architecture/snapshots/zx-des-20261012-04/`。

## 静态说明与运行证据

命令表和空值行都是规格文本。没有执行迁移，没有连接服务，没有调用模型，没有导入学生数据。

## 请独立复验并请负责人决议

请复验：费用确认不会把没有业务结果的 job 标成成功；旧 invocation 不会被改挂到新 attempt；初次评分 job 在 queued 时带有 binding。请项目负责人决定是否接受 ADR-004/012/013 中的保守恢复提案。本轮到此停止。
