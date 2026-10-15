# M0 隔离恢复

这个入口只用于 `zhixue_m0_g1*` 可丢弃库。它不改共享角色密码，不删除迁移文件里的 `SET ROLE`。

## 步骤

1. 用能读取源库的角色做 `pg_dump -Fc`。源库对象属主应仍是 `zhixue_owner` / `zhixue_router`。
2. 运行 `node scripts/restore-isolated.mjs <dump> <新库名> <日志路径>`。脚本用 `zhixue_bootstrap` 创建空库、安装 `pgcrypto`，再执行不带 `--no-owner` 的 `pg_restore`。
3. 只允许这一条非业务差异：`must be owner of extension pgcrypto` 且对应命令是 `COMMENT ON EXTENSION pgcrypto`。其它 `pg_restore: error` 或被忽略错误数量对不上时，脚本失败。
4. 恢复后用原来的 `scripts/migrate.mjs --database <新库名>` 执行尚未记录的迁移。迁移文件保持原样，包含 `SET ROLE`。
5. 核对 schema/table/function 属主、`rolbypassrls=false`、RLS 的 ENABLE 与 FORCE、ACL 和 `schema_migrations`，再跑真实运行角色。

`zhixue_bootstrap` 只在这次离线恢复里创建库和执行 restore。应用、Worker、reconciler 不使用它。不要把 `zhixue_migrator` 设成恢复后的函数属主。

若 0007 发现 `delivery_intents` 与 job/attempt 不一致，迁移直接失败并留下原行。先修正这些行，再重跑迁移。不要为了通过而删除处理中的数据。
