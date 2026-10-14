# 智学 SaaS 当前项目工作范围

当前阶段：2026-10-13 项目负责人已批准 G0 决议清单 v5 第 2 节 M0 范围和第 3 节保守恢复政策。记录见 docs/decisions/g0-decision-record-20261013.md。可以按原 Prompt 2 做 M0 窄切片。完整阅卷、真实学生数据接入和生产部署仍未授权。先读该决议记录、README.md 和 docs/prompts/cursor-repair-prompts.md 的 Prompt 2。

- 用户确认记录与V1.0基线是需求依据。记录中下一轮问题、备选方案和未确认建议不能自动成为决策；后续明确更改须追踪。
- docs/product/requirements-v1.0-original.md、docs/product/requirement-decisions-v0.1-v0.28.md、docs/architecture/architecture-v1.0-original.md和现有独立审查报告作为来源保留，修复设计另存新文件。
- 2026-10-13 的用户指令授权 M0 窄切片。该指令不授权完整阅卷、真实学生数据接入或生产部署。ADR 整体仍不标 Accepted；只记录决议清单第 2 节已决条款。
- 保持已确认技术栈与Python Worker路线。RLS、Outbox实现、状态与具体数据库方案按ADR决议，不能把审查建议默认为Accepted。
- ADR如实标注Proposed/Accepted/Superseded及实际决策责任，未经决议不替用户填写Accepted。
- Findings区分设计补齐、实现完成与验证通过。未执行的测试和未取得的样本如实列出。
- 遵循Monorepo、Migration、服务端租户与数据范围、AI建议与正式成绩分离的既有要求；如与明确用户指令冲突，以用户指令为准并记录影响。
