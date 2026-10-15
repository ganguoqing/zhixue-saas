# Cursor M0 / G1 定向修复 Prompt V3

依据 ZX-AR-20261014-03。G1仍No-Go；继续已经授权的M0，不进入M1、不接入真实学生、不部署生产。

## 执行文本

你是智学 SaaS Cursor Development Agent。先读本轮 architecture-m0-g1-re-review-report-v3.md、真实复验日志和脚本，以及AGENTS.md、G0决议记录、原Prompt 2、现行事务/状态/授权/模块/Schema、m0-g1-response-v3.md、m0-g1-evidence-v3.md。

这次独立复验已在新PG17/Redis环境重跑你的v3套件，并实际复现7项残余问题。无需再写纯设计长文；修实现，并让回归期望正确行为。保留已经验证的计分去重与小数、scope/exp/jti/Worker白名单、受限函数属主、非计费接管、同attempt observed不再推理。原设计、历史迁移和旧证据保留。

1. G1-V3-01：修复Worker新model_grade成功响应中的未赋值body，统一新响应/保存观察的验证与信封构造。必须跑Node producer→原生Python BullMQ Worker→FastAPI mock→NestJS的正常评分正例；不要再用migrator手建job后直接POST envelope充当此正例。
2. G1-V3-02：通过新迁移和命令协议统一result_status与failure reason。目前provider_http、bad_json、missing_persisted_result、schema_rejected、deadline都被DB CHECK拒绝。不要覆写0001–0004、关闭约束或把错误改成成功。阶段失败与普通接纳一样检查有效lease、epoch、generation/input、current attempt、stage、身份；有版本化结构和幂等收据。四种失败及deadline在空库/升级库必须真的落到正确状态、一次释放占用。
3. G1-V3-03：修复takeover漏billable导致评分交接投成false。Worker按claim/continue的可信stage/billable路由，不让Redis提示覆盖业务属性。attempt与可恢复投递意图同一事务，派发/ACK可重试，running交接在Redis丢失/进程中断后可重建。continue校验租约/世代/取消/期限；不回写queued、不另建admission、不改挂旧invocation。保存过的响应用当前合法结果/收据恢复，未知不再HTTP，不用隐式新付费调用掩盖丢结果。
4. G1-V3-04：实现清扫与定稿的共同锁/回收资格CAS。真实反例里过期committing在finalize事务未提交时被sweep删除最终文件，但finalize仍提交。过期/被回收时finalize的状态更新必须影响一行，否则回滚所有业务引用。删除前两次只读检查或延长租约都不足。保留成功临时释放与真正孤儿回收。
5. G1-V3-05：授权下载输出真正二进制/受控StreamableFile，不能把Buffer返回成JSON。PDF/PNG/JPEG的HTTP字节sha256必须等于存储元数据；权限拒绝与撤权继续通过。
6. G1-V3-06：Python jsonschema显式启用当前Schema的format断言；同一非法UUID目前Python接受、Ajv拒绝。两端运行同版合法/非法语料，新响应和observed重入均验证。
7. G1-V3-07：用最小表owner/公开端口/UoW例子完成批准的模块边界，不扩展完整M1–M3。补正常自动链与必要故障检查。local/Compose/CI统一入口与本次独立原始证据保留。

把随附independent-live-probes.mjs的“确认缺陷存在”断言改成“健康行为”回归，不直接把它成功退出当产品通过。其中清扫用专用测试DB的暂停trigger和1秒测试租约制造窗口；不得在共享库安装trigger或清扫用户文件。

必须实际运行：

- 新model_grade自动成功、一次proposal、一次预算、零正式分；provider500/坏JSON/非法结构正确异常终结，合法重放不重复。
- send_unknown/observed重复执行、许可/HTTP/观察/接纳窗口SIGKILL、两恢复者，计数mock provider不重复调用；不得付费模型。
- 非计费和model_grade各自SIGKILL接管，由新Python Worker实际执行正确stage；接管提交/投递/ACK窗口与Redis丢失，期限/占用正确。
- finalize租约过期且事务暂停时并发sweep：成功则原件存在且可下载/摘要一致；失败则无提交的丢文件引用。临时释放、真正孤儿、kill后恢复、两清扫者。
- 二进制PDF/PNG/JPEG下载哈希、跨学校/班级/撤权拒绝；双端Schema完整语料和语义负例。
- 真实运行角色FK/R5-02、池A/B/无上下文并发、manual/receipt重放与撤权、notice/inbox一次与relay kill、默认cap/轮转、300项provider295/5只重跑失败、有数据dump/restore/升级后继续。

所有reset/队列丢失/trigger/对象删除仅针对新建可丢弃隔离测试资源，不重置用户既有库或共享Redis，不改变共享DB角色密码。缺Docker/CI/权限如实列待验；有条件的local真实集成必须先完成。

授权真实试卷和标准答案仍缺时，先完成上述合成修复与运行，再列PoC输入与授权缺口；不能用真实学生数据，不伪造PoC或真实质量。

交付新的m0-g1-response-v4.md、m0-g1-evidence-v4.md、新迁移/API/状态/Schema与模块端口、真实run目录和G1-V3-01–07响应矩阵。implementation/developer-tested/independent-verified/未来阶段分列；不整体关闭F01–28，不自行宣布G1/M1。

普通实现缺陷按已授权M0直接修，不重复询问旧授权。确需改核心政策时才提交具体局部ADR差异。完成后交回独立复验。
