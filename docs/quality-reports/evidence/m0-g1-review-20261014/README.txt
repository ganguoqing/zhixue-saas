These are source-logic counterexamples, NOT actual DB/RLS/HTTP/provider integration tests. Successful exit means the defect was reproduced.

Reproduction in an isolated source workspace: extract architecture-m0-g1-reviewed-inputs-v1.zip, install the fixed npm/Python dependencies, build apps/api, and run the counterexample scripts from that workspace root. For example node <path-to-source-counterexamples.cjs> and .venv/bin/python <path-to-worker-counterexamples.py>. The scripts use process working directory as source root. The Store probe creates/removes only the dedicated sweep-probe/pending-finalize.pdf fixture. Do not use these scripts as production tests.

Current review rebuilt TypeScript successfully and ran these probes. Shared memory/network restrictions prevented a new isolated PostgreSQL/Redis integration run. Cursor must still supply real integration evidence in disposable isolated test services. Never run reset/FLUSHDB/orphan sweeps on shared user resources.
