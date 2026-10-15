# Cursor M0 / G1 定向修复 Prompt V2

依据 ZX-AR-20261014-02（2026-10-14）。当前 G1 No-Go，仅继续已接受 M0；不进入 M1、不实现完整阅卷、不接入真实学生、不部署生产。

## 复制执行文本

你是智学 SaaS Cursor Development Agent。请读取本轮独立报告 architecture-m0-g1-re-review-report-v2.md，修复 G1-V2-01–07，并补齐旧 G1-01–10 尚未运行验收。v2 已补的授权、外键、scope/exp/jti、新 intent 许可顺序、notice 原子消费保留，不退回 v1。以当前工作区和现行 v5 契约/已接受 M0 为基线；原需求/架构/历史审查与证据保留，不代签 ADR。

先读 AGENTS.md、原 Prompt 2、G0 决议记录、当前事务/授权/状态/模块/Schema、m0-g1-response-v2.md、m0-g1-evidence-v2.md、本轮报告与源码反例产物。本轮反例使用 DB/HTTP 替身，不能替代真实集成。

1. 为 V2-01 添加重入和双执行的计数 provider 用例。Worker 对已有 send_unknown/observed 不能再次 HTTP；只有本次成功签发许可的执行能发送。已有 observed 从持久化结果/收据恢复；缺少合格结果进入人工异常。不能自动再付费或把旧 invocation 改挂新 attempt，不引入 ResumeAfterSettlement。
2. 为 V2-02 完成接管执行交接：takeover 原子写入可恢复投递意图，受限 Python Worker 确实取得新 attempt 并执行；运行态不回写 queued，不另建 admission，占用不双计。持久化 observation 的可信元信息与响应正文/不可变引用。失败接纳有独立、版本化、可重放的阶段失败协议，model_grade 的 500/坏 JSON 不通过 envelope=null + control_mismatch 留在 running。期限涵盖 admitted/queued/running，过期任务不能再次 admit；Redis 错误不跳过 DB 到期/unknown 处理。
3. V2-03 去重 criterion_id，按冻结规则限制题分，用精确两位小数整数最小单位/定点值计算，不用 Number 严格相等或 epsilon 糊过去。双端实际执行版本化 Schema。M0 最小 fixture 足够；页面/文本范围使用真实冻结页/OCR 元数据，不能把 page_set 数量当页数。
4. V2-04 为上传 session 增加成功临时对象收尾和 committing 失败/kill 后恢复或过期。finalized 不永久保护 incoming 临时副本；用锁/CAS 协调清扫和定稿，不能简单按时间删活跃提交或最终资产。
5. V2-05 子进程/容器使用最小环境白名单。Worker 不能取得其他服务签名密钥、用户密钥、bootstrap/migrator/其他 DB 凭据。实际运行验证环境/挂载与可用权限，不只测用 Worker key 自称 billing 被拒。
6. V2-06 用最小模块公开端口和共享本地 UoW 落实 owner。组合根只装配。修复 0003 新增 SECURITY DEFINER 的实际属主：使用新迁移明确受限角色、固定 search_path、撤 PUBLIC 和最小 EXECUTE；不要直接覆写历史迁移当升级。实际查询 proowner/rolbypassrls/权限并运行负例。保留 asset_notices+inbox+delivered 的真实消费事务，补一次效果与 kill 证据。
7. V2-07 参数化统一隔离运行入口，兼容本机和 Compose/CI 端口，不再让 CI 调用旧令牌/旧 prefix 的套件。迁移仍用锁内判断 applied。npm ci、固定依赖与实际版本保留；把旧测试仍有效的用例转移到新契约，不能删关键断言降标。每次 run 使用独立目录保存日志、完整命令与退出码、开始/结束、git HEAD+工作区 diff/hash，禁止混在 append 日志里靠人工挑成功段。

必须跑真实 DB/Redis/HTTP 的关键检查：

- 同校无范围 manual/cancel/finalize 重放、撤权旧令牌、跨租户与平台个人数据拒绝；真实连接池 A/B/无上下文并发。
- 许可签发/响应丢失/HTTP 到达/观察提交/接纳提交的 SIGKILL，重复执行/双恢复者，外部请求计数不重复、预算不重复、账保持未知或合法确认。
- Worker kill 后自动执行新 attempt，observed 后丢响应恢复不用再次推理；500/坏 JSON/超时/推理重启进入正确可重放异常/失败。
- 无 Worker 的 queued/admitted deadline、默认 cap 下第三项、轮转、Redis down/队列重建，不依赖手动修复端点。
- 真实 invocation 正例及不存在/错任务/错 attempt/错配置/控制字段不一致负例；同 body 新 jti 合法重试一次效果。
- rubric 重复计分、0.10+0.20=0.30、重复/缺/未知第二题、非法资产/页码/span/bbox、双端 extra 字段负例；不写正式分。
- 定稿与清扫并发，成功临时文件清理、失败/kill 会话恢复/回收、已提交资产完整下载。
- 已实现 FK 的不存在/跨租户/同租户别 job/错误 revision；R5-02 两个 stage 绑定负例。
- Outbox notice/inbox 一次效果，relay 进程 kill/重启；300 项由 provider 返回的 295/5，仅失败逻辑项重跑，正常项不再创建。
- 有数据 dump/restore/升级后继续，固定支持剖面和实际 CI。

只在新建专用可丢弃 DB/Redis/对象目录运行破坏性测试；不 reset 共享库、不 FLUSHDB 共享 Redis、不扫用户对象目录。没有 Docker/权限时如实报告待验，不能用全 mock 冒充。

授权真实试卷/标准答案仍缺时，先完成独立于这些资料的全部修复和集成，再列 PoC 所需文件/授权与未验证项；不要求真实学生数据、不自行付费模型。未经样本 PoC 不宣称真实质量或 G1 通过。

交付新文件 m0-g1-response-v3.md、m0-g1-evidence-v3.md、独立原始日志、接口/状态/配置/迁移更新，以及 G1-V2-01–07 + 旧 G1-01–10 的关闭矩阵。分别记录 implementation addressed / developer tested / independent verified / future stage。不要将原 F01–28 整体 Closed，不自行宣布 G1/M1。

若确实需要改变已接受核心协议，先提交局部 ADR 差异。通常实现缺陷直接修复，无需重问已给过的 M0 授权。完成后交回独立 QA 与 Architecture Review Agent。
