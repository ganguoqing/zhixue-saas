# 智学 SaaS

2026-10-13，项目负责人批准了 G0 决议清单 v5 的 M0 范围。批准原文见 `docs/decisions/g0-decision-record-20261013.md`。M0 只做 Prompt 2 的窄切片。完整阅卷、真实学生数据和生产部署不在该授权内。

以下是此前的起步说明，保留作来源，不再表示仓库只能停留在设计。

# 智学 SaaS — Cursor G0 项目起步材料

本目录起初是项目起步材料。可以把本目录重命名为 zhixue-saas 后用 Cursor 打开，或将目录内全部内容复制到已有项目根目录。

## 操作步骤

1. 创建独立项目文件夹，例如 zhixue-saas。可以直接使用本目录作为该项目文件夹。
2. 在Cursor中打开这个文件夹，而不是只打开一个Markdown文件。
3. 阅读 docs/prompts/prompt-1-g0-design-remediation.md，把“执行文本”下面的全部内容粘贴给Cursor Agent，并让它读取列出的项目文件。
4. Cursor应产出新的架构补充稿、ADR候选、数据字典、状态表、事务规格和Findings追踪表。
5. 将输出交回独立Architecture Review Agent复验G0，再决定M0实现。不要同时执行全部后续Prompt。

## 输入文件

| 文件 | 用途 |
|---|---|
| docs/product/requirement-decisions-v0.1-v0.28.md | 28轮需求确认和相邻用户答复；其中建议/下一轮备选不能自动当成批准决策 |
| docs/product/requirements-v1.0-original.md | 原V1.0需求正文，内容未改写 |
| docs/architecture/architecture-v1.0-original.md | 原完整架构初稿，内容未改写 |
| docs/quality-reports/architecture-review-report.md | 28项Findings、G0/G1/G2、ADR与验收要求 |
| docs/prompts/prompt-1-g0-design-remediation.md | 本次交给Cursor的独立Prompt 1 |
| docs/prompts/cursor-repair-prompts.md | 全部后续Prompt备查；当前只执行Prompt 1 |
| docs/references/review-evidence.md | 原消息ID和章节定位备查 |
| AGENTS.md | 当前阶段范围与来源保留规则 |

需求与架构原文从本次审查读取的原对话中提取，未改写。审查报告/Prompt包的副本仅将链接转换为包内相对路径，便于复制后使用。

## 本阶段不需要的材料

不需要先安装依赖、生成React/NestJS代码框架、申请数据库/云服务或提供API密钥。真实学生答卷、真实身份信息、供应商凭据也不是Prompt 1的必需输入。不要把这些材料混入起步包。

## 可稍后补充的材料

index.html原Demo可放到references/demo/index.html作为视觉参考，不能替代需求基线。已有知识图谱内容和Quality Report、真实获授权试卷/标准答案可在相关设计或M0 PoC阶段补充。本包未包含这些附件，也不假装已对其实现进行审查。

Git初始化建议在复制完成后做，首次提交可记录输入资料；不必在本阶段配置远程仓库或部署。
