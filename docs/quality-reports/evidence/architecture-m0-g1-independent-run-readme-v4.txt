智学 SaaS M0/G1 独立复验 V4 — ZX-AR-20261014-04
结论：G1 No-Go。counterexample_reproduced 表示复现缺陷，不表示产品通过。

证据入口：
- 正式 report：四项 Findings / 上轮七项具体断言处置 / Gate 与责任分工。
- evidence JSON：冻结输入、版本、开发者与独立结果分列。
- reviewed-inputs ZIP：179 个原始输入文件，包含未提交 / 未跟踪源码；另附开发者原始 run 顶层日志、dump 与哈希。
- independent-run ZIP：独立工作副本（仅临时 DB 名调整）、审查探测源码和原始日志；不含 review.env、node_modules 或 .venv。

运行环境：
主库 zhixue_m0_g1reviewv4_20261014；Redis DB5；独立前缀 zhixue-g1-reviewv4-20261014；端口3450/3451。
原样0001–0006迁移，跳过共享角色bootstrap，沿用现有角色，仅新库CREATE授权与pgcrypto安装。
tests/m0/g1-v4-flows.mjs 仅修改两处临时DB名称为reviewer专属。
套件唯一SQL改写是被审查的开发者恢复测试本身；审查方另用未改写0006验证其失败。
目标业务代码未修改。输入文件结束均重新核对。

主要结果文件（workcopy/var/runs/reviewer）：
suite.log / g1-results.json：完整套件通过（44记录/36行为），约25.78秒。
rls-probe.json：两个运行角色，A/B/none均读取A的330行含恢复凭据；B更新A行；非法写回滚。
fk-probe.json：正确A上下文下不存在父行、错误job/attempt、合法父行上的epoch/generation0均被接受；回滚。
restore-probe.json / exact-restore.log：--no-owner恢复后的20个SECURITY DEFINER归属BYPASSRLS migrator；原样0006失败42501。
upgrade-probe.json：有数据原0004，旧CHECK拒绝provider_http，原样0005/0006之后同旧行可写；owner正确。
recovery-probe.json：双takeover 201/409；ACK前中断由双reconcile同dispatch恢复；实际pending event的relay回滚与重放；零正式成绩。
pool-probe.json：实际M0Store Pool复用同PID A/B/none，16并发请求使用8个连接，释放后无上下文0。
final-environment.json：版本、零正式成绩/暂停trigger、端口无监听。
harness-counter-first-*：审查计数器首跑错误原始记录；计数文件是每行ID而非ID+空格，修审查器后重跑通过。
submitted-hash-checks.json / source-manifest.json：完整原始哈希；harness-adjustments.json：副本调整。

复现须使用新的独立资源后缀，不能重跑固定名称去覆盖保留证据库：
1. 解压workcopy，按锁文件和requirements准备依赖；建Python环境或使用同版本已有环境。
2. 从config/dev.env.example准备本地ENV_FILE，配置新数据库、新Redis前缀、新对象/日志目录和空闲端口；不要把凭据发到日志。
3. 复用已安装角色；数据库管理员只建立本次新库、安装pgcrypto、授予新库CREATE。migrate-review.mjs仅apply，原SQL保留SET ROLE；没有bootstrap或reset。
4. 跑migrate-review.mjs、seed.mjs、API build，然后独立g1.integration.test.mjs。先把测试两个临时数据库名改为本次专属名称；该测试会创建/删除这两个临时库。
5. reviewer-recovery-probe.mjs使用HTTP/API/真实Worker；reader SQL probes使用角色连接。restore/upgrade probes会建立新库且拒绝已有库；复现前更换脚本中的专属DB名。
6. 本次保留的审查库只含合成数据；不要对共享库运行 run-isolated.mjs 或 --reset，也不要FLUSHDB。脚本不代表授权生产运行。
7. SQL非法写探测均ROLLBACK；恢复反例故意保留坏恢复权限状态以供核对，不可作为应用环境使用。

未执行：Compose/CI、授权真实试卷与标准答案PoC、真实学生质量、生产以及完整M1–M3。
开发者原restore绿色断言不能代替原样权限保留验收。使用现有M0授权继续修复，无需重新批准既决范围。
