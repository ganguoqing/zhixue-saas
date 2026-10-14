# ADR-004 BullMQ 与 Python Worker 的版本兼容验证

- **状态：** Proposed（2026-10-12 修订，未签署）。v3 只改公平与执行槽的句子。v4 的过期接管是 `TakeoverExpiredAttempt`，不改 Python Worker 路线。
- **日期：** 2026-10-11；修订 2026-10-12
- **2026-10-12：** 路线仍是 Python Worker。当前租约以 `current_attempt_id` / `current_fencing_epoch` 为准。版本互操作仍是 G1，不作为本轮 G0 失败理由，也尚未运行。
- **决策责任：** 项目负责人。技术栈本身已由 R19 确认，本 ADR 只决定如何验证，不重新选择队列。
- **关联：** R19、R21；F10、F11、F12
- **证据：** 2026-10-11 查阅 [BullMQ Python 介绍](https://docs.bullmq.io/python/introduction)，存在 `Worker`。产品页 [bullmq.io/python](https://bullmq.io/python/) 写明 Python 3.10+、Redis 6.2+，并写 BullMQ Pro 的 Python 支持仍为 Coming soon。本仓库没有安装或运行任何版本。

## 问题

不能凭记忆认定 Python 没有 BullMQ Worker，也不能在未测版本的情况下使用跨语言特性。CPU 密集的 OCR 若堵住 asyncio，锁续租会失败。

## 方案

### A. 推荐：保持 NestJS 生产、Python Worker 消费、FastAPI 推理

M0 锁定并记录一组版本：Node、`bullmq` npm、Python、`bullmq` pip、Redis。验证：

- Node 入队，Python `Worker` 消费
- 重试、退避、stalled 后重新领取
- 锁续租期间把 CPU 工作放到线程或子进程
- 优雅退出不丢已领取未完成的持久 job
- 结果经 ADR-003 的路径回到 NestJS
- 不使用未在 Python 库中验证的 Pro 分组能力

持久任务状态在 PostgreSQL。队列清空后由协调者按 job 与过期租约补投。

### B. 仅当 A 的实测失败：Node Worker 调用 Python HTTP

这会改变 R19 写明的 Python Worker，必须由新的已接受 ADR 说明失败证据。在此之前不实现 B。

### C. FastAPI 自己用另一套队列

会形成双重调度。不推荐。

## 代价

版本锁定可能排除较新的未验证特性。公平调度不能假设 Pro。ADR-012 用租户轮转挑选下一个租户；执行槽只限制占用，不代替轮转。能力上限要实测。

## 兼容与回退

升级 BullMQ 主版本要重跑上述清单。失败时回退到上一组已测版本。不用手写 Redis 协议代替官方库。

## 故障模型

Worker 崩溃、锁过期后双份执行、FastAPI 重启、Redis 丢队列、事件循环被 OCR 堵住导致误判 stalled。

## 验收

提交实际版本号、命令和原始结果。未运行前，F10 保持未验证。官方文档证明有 API，不证明本项目所选版本兼容。
