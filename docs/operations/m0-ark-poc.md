# M0 方舟离线 PoC

仅用于获得明确授权的试卷、标准答案和合成答卷。本工具不是阅卷工作台，不连接业务数据库，不能发布成绩。端点和模型只允许本次已授权配置；价格按 2026-10-20 查询的常规非音频刊例价估算。

## 准备

先安装 `apps/worker/requirements.txt` 和可选图片准备依赖 `scripts/requirements-poc.txt`；本机还需有 Poppler 的 `pdftoppm`。`prepare-ark-poc.py` 只处理本次已核对的四张双页扫描布局，逐个指定空白试卷与四张答案图，不扫描上传整个目录。

```bash
POC_SOURCE=/Users/johnny/Downloads/7年级月考
POC_RUN=var/poc-approved-run
.venv/bin/python scripts/prepare-ark-poc.py extract \
  --paper "$POC_SOURCE/七年级月考数学_试卷.pdf" \
  --answer-keys "$POC_SOURCE/七年级月考数学_标准答案_1.jpg" \
    "$POC_SOURCE/七年级月考数学_标准答案_2.jpg" \
    "$POC_SOURCE/七年级月考数学_标准答案_3.jpg" \
    "$POC_SOURCE/七年级月考数学_标准答案_4.jpg" \
  --output-dir "$POC_RUN" --two-up
```

本地查看裁切图片，确认没有学生身份或作答。把 `config/ark-poc.env.example` 复制到忽略目录下的私有文件，填入凭据并设置权限 `600`。不把凭据放进命令行或 Git。

## 调用

以下示例的 `10` 只适用于本轮已批准预算，不是生产参数。模型请求关闭思考、不使用工具和流式响应、限制输出 token，不自动重试。

```bash
.venv/bin/python scripts/run-ark-poc.py \
  --task "$POC_RUN/paper-task.json" --output-dir "$POC_RUN/model" \
  --budget-cny 10 --approved-synthetic-only --secrets-file "$POC_RUN/ark.env"

.venv/bin/python scripts/run-ark-poc.py \
  --task "$POC_RUN/key-task.json" --output-dir "$POC_RUN/model" \
  --budget-cny 10 --approved-synthetic-only --secrets-file "$POC_RUN/ark.env"

.venv/bin/python scripts/prepare-ark-poc.py synthetic \
  --output-dir "$POC_RUN" --model-dir "$POC_RUN/model"

.venv/bin/python scripts/run-ark-poc.py \
  --task "$POC_RUN/synthetic-task.json" --output-dir "$POC_RUN/model" \
  --budget-cny 10 --approved-synthetic-only --secrets-file "$POC_RUN/ark.env"
```

复用同一个 `model/ledger.json` 统计整轮预算。客户端在 HTTP 前原子持久化 `send_unknown` 和费用预留，以锁避免并发双花；保守预留不因成功响应而回收。同一个 task_id 不自动重发；超时、未知用量或错误响应阻止继续付费。不得通过换目录清空账本来绕过未知费用或预算。

`--approved-synthetic-only` 是操作者对既有授权范围的确认，不是自动个人信息检测；材料白名单和本地视觉检查仍需执行。

## 证据与验收

私有目录保存每次 invocation 的响应、解析结果、token 用量、版本/摘要、耗时、费用估算和账本。stdout 只显示元数据；默认不打印题目、答案、请求头或凭据。`schema_passed_pending_human_review` 不表示内容正确；题号集合、总分、公式、参考完整性和复核理由需单独检查。

费用按 [方舟官方价格表](https://docs.volcengine.com/docs/ark/model-pricing?lang=en&redirect=1) 估算，未对账前不写成实结费用。接口和图像方式参见 [Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=en)、[图片理解](https://docs.volcengine.com/docs/ark/image-understanding?lang=zh)。

本轮实测与未验证范围见 `../quality-reports/m0-ark-poc-report-20261020.md`。网络安全和预算负例测试使用 MockTransport，命令为 `.venv/bin/python -m unittest discover -s tests/poc -v`；它们不冒充真实模型质量测试，真实调用另有元数据。
