好的。我们现在进入 **《智学 SaaS 技术架构设计 V1.0》** 阶段。

这份设计将以此前确认的 28 项需求决策为基线，重点解决五个问题：**数据如何组织、业务模块如何划分、AI 服务如何协作、学校数据如何隔离、AI 批改如何可靠地完成整个流程。**

以下是技术架构设计初稿。

# 智学 SaaS 技术架构设计 V1.0

**文档状态：** 技术设计初稿，待架构审查  
**需求基线：** 智学 SaaS 产品需求规格说明书 V1.0  
**架构模式：** 模块化单体业务后端 + 独立 AI 服务 + 异步任务处理  
**首期目标：** 支持单校试点，按 500～2,000 名学生的学校规模进行容量设计

## 1. 总体架构

### 1.1 系统分层

```text
┌─────────────────────────────────────────────────────────────┐
│                         Web 前端                            │
│              React + TypeScript + Ant Design                │
│                                                             │
│  教师工作台 | 学校管理 | 考试阅卷 | 知识图谱 | 数据中心        │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    NestJS Business API                      │
│                                                             │
│  Auth / Tenant / School / Student / Teacher / Exam          │
│  Paper / Question / Grading / Mastery / Recommendation      │
│  Teaching Event / Analytics / Subscription / Audit          │
│                                                             │
│               RBAC + Tenant Data Scope                      │
└───────────────┬─────────────────┬───────────────────────────┘
                │                 │
                ▼                 ▼
        ┌──────────────┐  ┌─────────────────┐
        │ PostgreSQL   │  │ Object Storage  │
        │ 业务主数据库  │  │ PDF / 图片 / ZIP │
        └──────────────┘  └─────────────────┘
                │
                ▼
        ┌───────────────────┐
        │ Redis + BullMQ    │
        │ 异步任务与调度     │
        └─────────┬─────────┘
                  │
                  ▼
        ┌─────────────────────────────────────┐
        │            AI Worker                │
        │                                     │
        │  文档解析 / OCR / 评分 / 知识点映射   │
        └─────────────────┬───────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │          FastAPI AI Service         │
        │                                     │
        │  Model Router / Prompt / Validation │
        │  OCR / Grading / Diagnosis          │
        └─────────────────────────────────────┘
```

### 1.2 核心架构原则

**NestJS 是业务数据的唯一权威写入入口。**

FastAPI 负责 AI 推理，不直接修改考试成绩、学生档案或知识掌握度。

AI 返回的是结构化建议结果，由 NestJS 验证业务规则后持久化。

这样可以避免 AI 服务绕过权限检查，直接改变正式成绩。

第二个原则是：

**长时间运行的任务必须异步执行。**

包括试卷解析、答卷识别、批量评分、掌握度更新和 AI 教学建议生成。

浏览器关闭不能导致后台任务中断。

---

## 2. PostgreSQL 数据模型

我建议按照业务领域组织数据库实体，而不是建立一个包含大量字段的统一业务表。

### 2.1 租户与身份领域

| 实体 | 核心字段 | 作用 |
|---|---|---|
| `tenants` | id, name, status | 学校租户 |
| `users` | id, email, phone, status | 用户身份 |
| `tenant_memberships` | tenant_id, user_id, status | 用户与租户关系 |
| `roles` | id, code, scope | 角色定义 |
| `role_assignments` | membership_id, role_id | 角色授权 |
| `subscriptions` | tenant_id, plan_id, status | 学校订阅 |
| `subscription_plans` | id, name, limits | 套餐定义 |
| `usage_records` | tenant_id, resource_type, quantity | 资源使用记录 |

`users` 可以作为全局身份表，但学校内的角色和业务数据必须通过 `tenant_memberships` 关联。

**不允许仅凭客户端传入的 tenant_id 决定访问范围。**

### 2.2 学校组织领域

```text
Tenant
 ├── AcademicYear
 │    └── Semester
 ├── Grade
 │    └── Class
 ├── Teacher
 │    └── TeachingAssignment
 └── Student
      └── ClassEnrollment
```

关键实体包括：

| 实体 | 主要关系 |
|---|---|
| `academic_years` | Tenant 1:N |
| `semesters` | AcademicYear 1:N |
| `grades` | Tenant 1:N |
| `classes` | Grade 1:N |
| `teachers` | Tenant 1:N |
| `students` | Tenant 1:N |
| `class_enrollments` | Student N:M Class，带生效时间 |
| `teaching_assignments` | Teacher N:M Class，带学科及生效时间 |

学生转班不直接覆盖历史关系，而是结束旧的 Enrollment 并创建新的 Enrollment。

### 2.3 知识图谱领域

建议使用以下核心实体：

```text
KnowledgeGraph
 └── KnowledgeGraphVersion
      ├── KnowledgeNode
      └── KnowledgeEdge
```

`knowledge_nodes` 包含知识点编码、名称、学段、年级、学科及描述。

`knowledge_edges` 表示前置依赖、包含关系、相关关系等。

学校定制不直接修改平台标准图谱，而是建立版本化的学校配置或覆盖关系。

**知识图谱版本必须固定。** 已完成的历史考试分析不能因为知识节点后续调整而失去解释依据。

### 2.4 题库领域

建议实体：

`questions`、`question_versions`、`question_options`、`question_answers`、`question_knowledge_links`、`question_assets`。

其中：

- `questions` 表示题目的逻辑身份。
- `question_versions` 保存题目内容的具体版本。
- `question_knowledge_links` 关联知识节点和权重。
- `question_assets` 关联图片、公式附件等资源。

题库需要明确所有权范围：平台公共、学校私有、教师个人。

### 2.5 试卷与考试领域

这是最重要的数据关系之一。

```text
Paper
 └── PaperVersion
      ├── PaperQuestion
      ├── AnswerKey
      └── Rubric
             │
             ▼
            Exam
             │
             ├── ExamClass
             │
             └── StudentAttempt
                    ├── Answer
                    ├── GradingResult
                    └── ScoreRevision
```

建议核心实体：

| 实体 | 作用 |
|---|---|
| `papers` | 试卷逻辑实体 |
| `paper_versions` | 固定试卷版本 |
| `paper_questions` | 试卷题目与顺序 |
| `answer_keys` | 标准答案版本 |
| `rubrics` | 评分规则版本 |
| `exams` | 考试活动 |
| `exam_classes` | 参与考试的班级 |
| `student_attempts` | 学生参加考试的记录 |
| `student_answers` | 学生逐题作答 |
| `grading_results` | AI 或人工评分结果 |
| `score_revisions` | 成绩修订历史 |

建议在正式考试开始后冻结所使用的试卷版本、答案版本和评分规则版本。

后续调整应通过明确的修订机制完成。

### 2.6 教学诊断领域

主要实体包括：

`mastery_snapshots`、`mastery_evidence`、`learning_diagnoses`、`ai_recommendations`、`recommendation_actions`、`teaching_events`、`teaching_event_targets`、`teaching_event_evaluations`。

其中，`mastery_evidence` 非常重要。

它记录某个掌握度结果究竟来自哪些题目、考试和评分证据。

这样教师可以从知识掌握度结果反向查看原始学习证据。

---

## 3. NestJS 模块边界

第一阶段采用模块化单体，而不是直接拆成大量微服务。

建议目录：

```text
apps/api/src/
├── auth/
├── tenant/
├── subscription/
├── school/
├── academic/
├── teacher/
├── student/
├── knowledge/
├── question-bank/
├── paper/
├── exam/
├── submission/
├── grading/
├── mastery/
├── diagnosis/
├── recommendation/
├── teaching-event/
├── analytics/
├── ai-orchestration/
├── storage/
├── audit/
└── common/
```

### 3.1 模块职责

| 模块 | 职责 |
|---|---|
| Auth | 登录、身份认证、会话管理 |
| Tenant | 租户生命周期、租户上下文 |
| School | 学校基本资料 |
| Academic | 学年、学期、年级、班级 |
| Student | 学生档案、转班历史 |
| Teacher | 教师档案、任课关系 |
| Knowledge | 知识图谱与版本 |
| Question Bank | 题目及题库权限 |
| Paper | 试卷、答案、评分规则 |
| Exam | 考试组织及学生作答 |
| Submission | 文件上传、识别任务 |
| Grading | AI 建议评分、人工复核、成绩确认 |
| Mastery | 掌握度计算 |
| Diagnosis | 学习诊断 |
| Recommendation | AI 教学建议 |
| Teaching Event | 教学事件与效果验证 |
| Analytics | 班级、年级、学校分析 |
| AI Orchestration | AI 任务编排与模型调用记录 |
| Storage | 对象存储访问与文件授权 |
| Audit | 关键操作审计 |

### 3.2 模块之间的交互

建议通过模块公开的 Service 接口交互，不允许其他模块随意修改其内部数据。

例如：

`GradingModule` 负责确认成绩。

确认成功后发布业务事件：

`ExamScoresConfirmed`

`MasteryModule` 消费该事件，触发掌握度更新。

`DiagnosisModule` 在掌握度更新完成后生成学习诊断。

`RecommendationModule` 再根据诊断结果产生教学建议。

这样可以避免在一个 HTTP 请求中串行执行所有耗时计算。

**建议使用事务 Outbox 模式保证业务状态变更与事件发布的一致性。** 这是技术设计建议，尚不是此前单独确认过的产品需求。

---

## 4. FastAPI 与异步任务架构

### 4.1 服务职责划分

**NestJS 负责：** 任务创建、身份授权、业务状态、数据库写入、成绩确认、审计和用量管理。

**FastAPI 负责：** OCR、文档结构提取、答案识别、AI 评分、知识点映射和模型路由。

**Worker 负责：** 从队列获取任务、调用 AI 服务、处理超时重试，并将结果交给业务 API 验证。

### 4.2 推荐任务流程

```text
教师上传答卷
      ↓
NestJS 验证租户及考试权限
      ↓
文件写入对象存储
      ↓
数据库创建 Submission
      ↓
创建 Processing Job
      ↓
写入 BullMQ 队列
      ↓
Worker 获取任务
      ↓
调用 FastAPI
      ↓
FastAPI 调用 OCR / AI 模型
      ↓
返回结构化结果
      ↓
NestJS 验证结果与业务状态
      ↓
保存建议评分
      ↓
更新任务状态
      ↓
教师复核工作台展示结果
```

### 4.3 任务可靠性

建议所有长任务具有：

- 唯一任务 ID 和幂等键；
- 任务状态和进度；
- 可配置超时；
- 有上限的自动重试；
- 失败原因及人工重试入口；
- AI 调用记录和成本统计。

需要特别注意：**BullMQ 的任务执行通常属于至少一次处理语义。**

因此，不能假设某个任务只会执行一次。成绩写入和费用结算等操作必须具备幂等保护。

对于部分失败的批量任务，应允许只重试失败的答卷，而不是重新处理整个考试。

---

## 5. 多租户隔离设计

多租户隔离是整个系统最重要的安全边界之一。

### 5.1 建议采用多层防护

**第一层：认证上下文。**

通过服务端验证的身份和租户成员关系建立 Tenant Context。

**第二层：业务权限。**

检查用户是否有权限访问对应班级、学生、考试或文件。

**第三层：数据库访问。**

所有租户业务数据查询必须施加租户范围限制。

**第四层：对象存储。**

文件访问通过服务端授权，不能仅依靠猜测困难的对象路径。

**第五层：后台任务。**

Worker 必须验证任务所属租户，避免跨租户读取或写入。

### 5.2 PostgreSQL Row-Level Security

我建议将 PostgreSQL RLS 作为重点评估的数据库级隔离措施。

应用层权限控制与 RLS 并不互相替代。

如果采用 RLS，需要设计事务级租户上下文、连接池复用安全、后台任务身份及平台级管理操作的例外机制。

这些问题应在 M0 中通过自动化越权测试验证。

### 5.3 重点安全测试

至少覆盖以下情况：

| 场景 | 预期结果 |
|---|---|
| 学校 A 请求学校 B 的学生 ID | 拒绝访问 |
| 教师访问未授权班级 | 拒绝访问 |
| 修改 URL 中的考试 ID | 不能越权读取 |
| 使用其他租户的文件标识 | 不能下载 |
| 后台任务携带错误租户信息 | 任务失败并记录 |
| 用户权限被撤销 | 后续请求立即受限 |

---

# 6. AI 批改完整状态机

这是本次架构设计中需要重点明确的部分。

我建议不要用一个简单的 `status` 字段描述全部流程，而是将**上传处理、AI 评分、人工复核和成绩发布**划分为相互关联的状态机。

这样可以更准确地处理部分失败、重试和成绩修订。

## 6.1 答卷处理状态机

```text
CREATED
   ↓
UPLOADING
   ↓
UPLOADED
   ↓
VALIDATING
   ↓
STUDENT_MATCHING
   ↓
RECOGNIZING
   ↓
ANSWER_PARSING
   ↓
READY_FOR_GRADING
```

异常分支：

```text
VALIDATING
   ├── INVALID_FILE
   └── FAILED_RETRYABLE

STUDENT_MATCHING
   └── MATCH_REVIEW_REQUIRED

RECOGNIZING
   ├── RECOGNITION_REVIEW_REQUIRED
   └── FAILED_RETRYABLE
```

其中，学生身份匹配失败时不能强行将答卷关联到某个学生。

必须进入人工匹配流程。

## 6.2 AI 评分状态机

```text
PENDING
   ↓
QUEUED
   ↓
GRADING
   ↓
AI_GRADED
   ↓
REVIEW_REQUIRED
   ↓
UNDER_REVIEW
   ↓
REVIEW_COMPLETED
```

对于可批量确认的客观题，可以采用经过质量验证的批量复核机制。

但不建议第一阶段允许 AI 在完全没有规定确认流程的情况下直接发布正式成绩。

### 6.3 成绩发布状态机

```text
DRAFT
   ↓
READY_FOR_CONFIRMATION
   ↓
CONFIRMED
   ↓
PUBLISHED
   ↓
REVISION_REQUESTED
   ↓
REVISING
   ↓
RECONFIRMED
```

这里建议明确区分：

**Confirmed：** 教师已经确认成绩。

**Published：** 成绩已经正式进入可见的教学分析范围。

这两个状态可以在产品操作中合并为一个按钮，但数据库层面保留区分，有利于后续扩展。

### 6.4 评分数据不可直接覆盖

例如，一道计算题：

AI 建议评分为 6 分。

教师复核后改为 8 分。

系统应同时保存：

| 数据 | 值 |
|---|---|
| AI 建议分数 | 6 |
| 教师确认分数 | 8 |
| 修改原因 | 某个正确步骤未被识别 |
| 修改人 | 对应教师 |
| 修改时间 | 系统时间 |
| 使用的评分规则 | Rubric Version |
| AI 模型与 Prompt | 对应版本标识 |

这样后续可以评估 AI 评分质量，也能在学校需要时追溯成绩变化。

---

## 7. AI 输出与模型治理

FastAPI 不应只返回一段自然语言解释。

AI 评分输出需要满足严格的结构化数据协议。

建议包含：

```json
{
  "questionId": "question-001",
  "recognizedAnswer": "x = 3",
  "suggestedScore": 8,
  "maxScore": 10,
  "confidence": 0.86,
  "rubricMatches": [
    {
      "criterionId": "step-01",
      "awardedScore": 3,
      "reason": "正确建立方程"
    }
  ],
  "reviewRequired": true,
  "modelVersion": "model-version",
  "promptVersion": "prompt-version"
}
```

以上仅是**接口设计示例**，并非已经确认的最终 JSON Schema。

实际实现时，需要对题目 ID、评分范围、评分点总分、模型版本和输出完整性进行服务端校验。

此外，`confidence` 不能仅因为模型输出了一个数值，就被视为经过统计校准的真实正确概率。

---

## 8. 部署与可观测性

第一阶段采用 Docker 应用部署与云端托管基础服务。

建议从 M0 建立以下可观测指标：

| 类别 | 指标 |
|---|---|
| API | 请求耗时、错误率 |
| 队列 | 等待任务数、失败任务数、重试次数 |
| AI | 模型调用次数、耗时、错误率 |
| 批改 | 每份答卷处理时间、人工复核比例 |
| 成本 | 每学校、每考试、每任务的 AI 成本 |
| 数据库 | 慢查询、连接数、存储增长 |
| 安全 | 登录异常、权限拒绝、跨租户访问尝试 |

日志中不应默认记录完整学生答卷、个人信息或模型请求中的敏感内容。

---

## 9. M0 架构验证重点

在正式开发业务功能之前，M0 应验证以下关键技术假设。

| 验证项目 | 验收要求 |
|---|---|
| Monorepo | 前后端及 AI 服务可独立构建 |
| 本地环境 | Docker Compose 可重复启动 |
| 身份认证 | 用户能够安全登录和退出 |
| 租户隔离 | 跨租户访问测试全部通过 |
| 数据库 Migration | 可以自动创建和更新结构 |
| 文件存储 | 文件上传、授权下载可正常运行 |
| 异步队列 | 浏览器关闭后任务继续执行 |
| AI PoC | 可以对真实试卷和标准答案进行基础解析 |
| 任务恢复 | Worker 异常后任务可恢复或安全重试 |
| 审计 | 关键操作能够追踪 |
| 自动化测试 | CI 能执行核心测试 |

其中，**租户隔离、异步任务可靠性和 AI 技术可行性**应列为 M0 的架构验收重点。

---

# 10. 需要架构审查的关键决策

本次设计中有几项重要技术建议，建议在正式进入 Cursor M0 开发前由 Architecture Review Agent 审查：

| 编号 | 决策 | 当前建议 |
|---|---|---|
| ADR-001 | 多租户数据库隔离 | 共享 PostgreSQL + 租户范围控制，重点评估 RLS |
| ADR-002 | 后端架构 | NestJS 模块化单体 |
| ADR-003 | AI 服务边界 | FastAPI 负责推理，NestJS 负责业务数据 |
| ADR-004 | 异步任务 | BullMQ + Worker，保证幂等与可恢复 |
| ADR-005 | 业务事件 | 事务 Outbox |
| ADR-006 | 试卷与成绩 | 版本冻结 + 不可覆盖的修订历史 |
| ADR-007 | AI 评分 | AI 建议与正式成绩分离 |
| ADR-008 | 知识图谱 | PostgreSQL 优先，保留后续扩展能力 |
| ADR-009 | 文件存储 | 对象存储 + 服务端访问授权 |
| ADR-010 | 部署 | Docker 优先，未来支持 Kubernetes |

## 下一步

**《智学 SaaS 技术架构设计 V1.0》初稿已经形成。**

我建议接下来先进行一次架构审查，尤其检查数据库实体之间的关系、租户隔离方案、异步任务的一致性，以及 AI 批改状态机是否存在遗漏。

通过审查后，再将设计细化为 Cursor 可直接执行的 **M0 Development Prompt**。这样可以避免 Cursor 在尚未确定核心数据与服务边界时就开始实现。
