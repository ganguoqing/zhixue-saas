# M0 G1 验证补充 v6

日期：2026-10-19，Asia/Shanghai。角色：开发者回归与 CI 证据整理。

本轮不替代独立 QA，不改写 ZX-AR-20261014-04 的 No-Go，也不宣布 M0 退出或进入 M1。v5 对 G1-V4-01–03 的修复已重新运行；V4-04 的 Compose / CI 环境证据已有补充，获授权 AI PoC 仍缺。

## 1. 范围和源码

- 业务、数据库迁移、Worker 和恢复实现沿用 `51f8cc90d04604fc03cb83b585a7c5a84ae3b99f`，没有修改 0001–0007 或放宽运行权限。
- 本轮测试与工作流提交：`30a81b1613630efec9e5e0fef329e4bf0b1799ba`。本地测试时这两个文件尚未提交，以证据包中的源码与 SHA-256 清单界定实际输入。
- 原需求、原架构、独立报告和历史证据不回写。ADR 整体状态保持原样；只沿用 2026-10-13 已批准 M0 条款。

| 输入 | SHA-256 |
|---|---|
| `tests/m0/g1-v4-flows.mjs` | `9f9800e4ad3f6837369e042d393051c89824c5c791596f42e4d41845c96a0777` |
| `.github/workflows/m0.yml` | `bd7225e647df36e3528e720190db85a1f99bcfc329de459d2223d468ed3a848e` |
| `db/migrations/0007_g1_v4_delivery_guard.sql` | `70dfcdbe1f3be062ddea7479f5c06dacb5524949b0c26ea2260e92a4349e26a7` |
| `scripts/restore-isolated.mjs` | `a11fe3f8da7caed8091c79aeb87226a4b3c64bbd05ec234e10659eec44c87e00` |

## 2. 本地完整集成

| 项 | 结果 |
|---|---|
| 开始 / 结束 | 2026-10-19 23:52:17 / 23:52:51（UTC+8，含临时服务启动和停止） |
| 命令 | `ZHIXUE_PROFILE=local PGPORT=54339 REDIS_PORT=6389 node scripts/run-isolated.mjs` |
| Node / Python | v24.15.0 / 3.14.4 |
| PostgreSQL / Redis | 17.11 Homebrew / 7.4.2 官方源码临时编译 |
| 数据范围 | 全部合成；新建临时 PostgreSQL 集群和 Redis 实例，端口 54339 / 6389 |
| 原始目录 | `var/runs/1792425137696` |
| 退出 / 测试 | exit 0；顶层测试 3、pass 3、fail 0，套件约 32.33 秒 |
| 行为记录 | `g1-results.json` 共 52 条，其中 40 条行为结果、12 条进程退出记录 |

新集群使用独立角色和数据目录；测试中的固定升级/恢复库都在这个集群。没有重置现有 5432 数据库或改共享角色。结束后本轮 PostgreSQL / Redis 已停止。原始本地启动脚本、版本和运行命令收入证据包。

通过内容包含：

- **RLS 目录回归：** 动态枚举 `zhixue` schema 中所有带 `tenant_id` 的普通/分区表，本轮为 32 张，逐表断言 ENABLE 和 FORCE。此检查不替代每张表的业务授权测试或 `zhixue_ctl` 控制函数审查。
- **实际角色隔离：** ingress / reconciler 在 B 租户或无上下文时读不到 A 的投递租约，跨租户 UPDATE 和无上下文 UPDATE 均为 0，跨租户 INSERT 被拒绝。
- **关联和权威快照：** 原有父引用负例继续通过；分别尝试 epoch 0、generation 0、正数 epoch 不匹配、正数 generation 不匹配、输入摘要不匹配、stage 不匹配、billable 不匹配，七类 UPDATE 均以 `23514` 拒绝，探测事务全部回滚。
- **原有正常链和故障回归：** 原生 Python Worker 的评分建议、unknown 不二次发送、observed 复用、两个接管者得到 201/409、ACK 前中断重投后仍只调用一次；同一连接 A→B→无上下文和 16 并发隔离；300 项中 295 成功、5 失败且只重跑 5 项。
- **升级和恢复：** 有数据的 0004 原样升级至 0007；dump/restore 保留属主再原样执行 0005–0007；核对函数属主及无 BYPASSRLS；恢复库 Worker 成功，1 条 proposal、0 条正式成绩。不一致旧行使 0007 失败并保留原行，缺失 dump 使恢复入口失败。

日志中的预期迁移拒绝和缺失 dump 错误是负例断言的一部分；不是被忽略的套件失败。没有修改断言来掩盖这些错误。

## 3. Compose 与 CI

已从 GitHub 读取并保存 [main 的 CI 运行 39196505335](https://github.com/ganguoqing/zhixue-saas/actions/runs/39196505335)。

| 项 | 结果 |
|---|---|
| 目标提交 | `51f8cc90d04604fc03cb83b585a7c5a84ae3b99f` |
| 平台 | GitHub-hosted `ubuntu-latest` |
| 环境 | Compose 固定 `postgres:16.10` / `redis:7.4.2`；日志记录 Node 24.21.0、Python 3.12.15 |
| 执行 | `ZHIXUE_PROFILE=compose node scripts/run-isolated.mjs` |
| 结果 | success；3 个顶层测试全部通过、fail 0，套件约 41.15 秒 |
| 运行时间 | 2026-10-19 11:49:34–11:50:56（UTC+8） |

这补充了 v5 当时未运行的 PostgreSQL 16.10 / Python 3.12 剖面。本机 Docker daemon 仍不可用；不将 GitHub 的运行写成 macOS 本地 Compose 通过。

本轮工作流还加入 `config/**`、`docker-compose.yml` 和工作流自身的 push 路径触发，以及始终执行的证据归档步骤。归档 `var/runs` 的 JSON、命令、锁文件哈希和日志，排除对象文件，便于独立 QA 读取断言结果。上传配置依据 [官方 upload-artifact 文档](https://github.com/actions/upload-artifact/tree/v4)。新增回归与归档步骤的分支 CI 结果另见本节后续运行记录。

新增回归提交的 [CI 运行 39281298123](https://github.com/ganguoqing/zhixue-saas/actions/runs/39281298123) 已触发。截至 2026-10-19 23:56（UTC+8）仍在等待 GitHub runner；不能将新增测试的 Compose 执行或 artifact 上传步骤写为通过。本地新增测试已通过，见第 2 节。

2026-10-20 后续核对：该运行现为 `success`，目标提交仍为 `30a81b1613630efec9e5e0fef329e4bf0b1799ba`。证据 artifact `m0-g1-evidence-39281298123-1` 已成功下载，包含 `g1-results.json`、命令、Worker/API 日志、恢复记录和锁文件哈希；新增 RLS 目录与七类权威快照负例均在归档结果中。本段补充后续状态，不将上一段当时的排队观察改写为通过。

## 4. 复现和原始证据

已安装 Node 依赖、Python 虚拟环境和 Docker daemon 的环境可运行：

```bash
ZHIXUE_PROFILE=compose node scripts/run-isolated.mjs
```

该入口会重置专用合成测试库，不应指向既有业务数据。

本轮证据包：`evidence/m0-g1-validation-v6-20261019.zip`。包内含冻结源码、逐文件 SHA-256、CI 元数据/日志、本地运行元数据/日志和行为结果；不包含对象文件、数据库备份或真实学生数据。证据文件目录以包内清单为准。

## 5. 未完成与后续条件

| 项 | 当前状态 | 后续责任 |
|---|---|---|
| G1-V4-01–03 独立复验 | 本轮开发者与 CI 验证通过，独立复验尚未做 | 独立 QA / Architecture Review |
| 授权试卷、标准答案 | 仓库授权清单仍为未提供 | 项目负责人 |
| 模型端点、账号、费用上限 | 未提供，本轮只运行 mock | 项目负责人 |
| 合成答卷与人工 PoC 验收 | 按既有授权清单落实后执行 | 项目负责人及开发者 |
| G1 最终判定 / M1 准入 | 不在本轮宣告 | 依据完整证据的独立复验及人工验收 |

没有评估真实学生评分质量，没有填写准确率承诺，也没有接入真实学生数据或执行生产部署。
