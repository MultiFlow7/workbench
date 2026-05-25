---
project: 工作台
version: v0.13
status: confirmed
doc_revision: 2
created: 2026-05-23
---

# 产品规划 · v0.13 · AI 工具层 Python 后端服务

## 版本定位

v0.13 是一个**基础设施版本**，核心目标是将 AI 调用从 Tauri 前端剥离，建立独立的 Python 后端服务作为 AI 工具层。这是一次架构升级，不引入新的用户可见功能，但为后续多模型支持、多用户协作、成本管理奠定基础。

驱动因素：
- 多模型路由（Claude / OpenAI / DeepSeek / Gemini）需要统一的格式转换层
- API key 存在客户端不可持续，需集中管理
- 未来多用户协作需要权限管理扩展点
- Prompt Caching 策略（v0.12 引入的 UI 开关）需要在服务端统一实现

---

## 本版本选入需求

| ID | 需求 | 优先级 | 来源 |
|----|------|--------|------|
| [req-047](../../requirements/req-047-ai-service-backend.md) | AI 工具层 Python 后端服务（Model Router + LLM Gateway） | high | 架构决策 |

---

## 需求冲突分析与裁决

本版本仅含单一需求 req-047，无跨需求冲突。

req-047 吸收了 req-029（自建 LLM Gateway）的核心目标（API key 管理、成本可见性）。req-029 此前处于 in-progress 状态（v0.9 缩减范围版），本版本完整承接其目标，**req-029 同步标记为 dropped，目标已转移至 req-047**。

---

## 衍生需求

本版本规划过程中未衍生新的独立需求。以下事项确认不新开 req，直接在 req-047 实现范围内处理：

- Gemini 显式缓存（需 storage fee，暂不实现，隐式缓存已足够）
- Kimi 模型支持（优先覆盖 Claude/OpenAI/DeepSeek/Gemini，Kimi 暂不纳入）

---

## 需求详解与设计决策

### req-047 · AI 工具层 Python 后端服务

**问题**：Tauri 前端直接调 AI API，导致格式转换逻辑分散、API key 暴露在客户端、不同模型的 Cache 策略难以统一处理，且无法为未来多用户协作预留扩展点。

**方案**：建立独立 Python 后端服务，Tauri 前端改为调统一接口 `POST /v1/chat`，服务内部处理所有模型差异。

**两个核心模块（平级关系，同属 AI 工具层）：**

| 模块 | 职责 |
|------|------|
| Model Router | 格式转换、模型路由、Cache 策略注入、Tool use 映射、Thinking blocks 处理 |
| LLM Gateway | API key 集中管理、token 用量记录、成本追踪、未来权限管理预留 |

**关键决策：**
- 技术栈：Python + FastAPI + httpx（异步 SSE 流式透传）
- 部署：用户自己的服务器，独立于 Tauri 应用
- Auth：暂不实现（单用户阶段），接口预留但不强制验证
- Normalized 格式：以 Claude content block 为基准（覆盖所有模型，无损转换）
- 格式转换确定性：同一输入永远产生同一输出，确保 DeepSeek 磁盘缓存在跨模型对话中可命中

**Cache 策略分工：**

| 模型 | 策略 | caching=true | caching=false |
|------|------|-----------|-----------|
| Anthropic Claude | Automatic Caching | 注入顶层 `cache_control` | 不注入 |
| OpenAI | 自动透明（128 token 粒度） | 无需处理 | 无需处理 |
| DeepSeek | 磁盘缓存自动（64 token 起） | 无需处理，确保转换确定性即可 | 无需处理 |
| Gemini | 隐式自动（默认 90% 折扣） | 无需处理 | 无需处理 |

**与 v0.12 req-045 的关系**：req-045（Prompt Caching 优化长对话 Token 消耗）在 v0.12 交付前端 UI 开关，v0.13 交付真正的 Cache 策略注入（服务端）。`caching` 参数由前端 UI 开关透传至本服务，由 Model Router 中的 Anthropic adapter 处理。

**与 req-029 的关系**：req-029「自建 LLM Gateway」（原 v0.9 缩减范围版，目标为 API key 管理 + 成本可见性）被本版本完整承接。**req-029 标记为 dropped，目标已转移**（见「需求冲突分析与裁决」节）。

---

## 长期一致性

本版本与产品方向.md 架构原则的对应关系：

| 产品方向原则 | 本版本体现 |
|------------|----------|
| **后端逻辑 AI first** | 模型路由、格式标准化、Cache 策略注入全部移至服务端；Tauri 前端仅负责 UI 渲染，不承担 AI 调用逻辑 |
| **前端逻辑 Human first** | 前端保留 Caching UI 开关（v0.12 已交付），用户决策透传至服务端；前端不处理模型差异 |
| **不堵死未来扩展** | Auth 接口预留（多用户阶段启用）；Rate limiting 扩展点预留；未来 Kimi 等模型只需新增 adapter，不改主流程 |
| **AI 工具层架构决策（2026-05-23）** | 本版本正是该架构决策的具体实现，完全一致 |

本版本不引入新的用户可见功能，不影响四面板布局、多工作区等前端架构方向，属于对现有架构的底层加固。

---

## 不在本版本范围内

- Auth / 用户账号体系（多用户阶段再启动）
- 多端同步机制（由用户自行接入 iCloud/Git，产品不介入）
- Rate limiting / 并发控制（单用户阶段无需，扩展点已预留）
- Gemini 显式缓存（需 storage fee，隐式缓存已足够）
- Kimi 模型支持（暂不列入，优先覆盖 Claude/OpenAI/DeepSeek/Gemini）

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1 | 2026-05-23 | 初稿，选入 req-047 |
| v2 | 2026-05-23 | review-agent 修订：补充「需求冲突分析与裁决」「衍生需求」「长期一致性」章节；Cache 策略表补充 caching=false 列；明确 req-029 dropped 理由；同步修复 req-029 文件状态 |
