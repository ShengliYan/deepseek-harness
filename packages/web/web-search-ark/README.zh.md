---
description: "火山方舟（Volcengine Ark）支持的 web 搜索提供方：把方舟 Responses API 的 web_search 工具作为 ctx.web 提供方挂载，复用部署已有的 Ark API 密钥。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-ark

[English](README.md) | 中文

## 概述

有了 `dsh-web-search-ark`，harness 可以通过[火山方舟](https://www.volcengine.com/product/ark)检索 web，使用部署已为模型流量管理的 Ark API 密钥。当部署从方舟基址提供模型、并接受一次搜索在延迟与 token 上消耗一个完整 Responses 模型轮次时选择它，因为方舟的模型路由没有专用检索端点。结果只来自方舟结构化的 `url_citation` 标注；正文从不贡献 URL。凭据缺失时调用以结构化错误失败；重定向会在接触 `Location` 目标前被拒绝。面向模型的 `web_search` 工具位于 `dsh-tool-web`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在组合中挂载 web 服务与本提供方；它以 `ark-official` 搜索提供方身份注册，因此当它是唯一可用的搜索后端时，`ctx.web.search()` 会自动解析到它——加载了多个搜索后端时，用 `searchProvider: ark-official` 固定它。

### 何时选择

Exa 与 Perplexity 提供专用搜索端点；本提供方改为发起一次携带方舟内置 `web_search` 工具的**完整 Responses 模型调用**，因此一次搜索会产生完整模型轮次的延迟与 token 开销，且方舟在服务器侧执行搜索，是否搜索由模型自行判断（`maxToolCalls` 限制其最多执行几轮）。它复用部署已为模型流量管理的**同一把 Ark API 密钥**——不增加新密钥。当单搜索成本或延迟占主导、且可用专用检索端点时，避免使用本提供方。

已挂载的凭据服务具有权威性；没有该服务时，提供方会回退到启动进程的环境。该引用每次搜索都会解析，因此在 Models 页中存储或轮换的密钥无需重启即可用于下一次调用。

### 最小配置

加载 web 服务与本提供方；密钥在 `ctx.credentials` 服务挂载时从该服务解析，否则从进程环境解析。Responses 端点基址默认为方舟公开 API；当你的模型由部署专属基址（例如 Agent-Plan 基址）提供时，请将 `baseURL` 改为该基址。

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | Ark API 密钥字面值。优先使用 `apiKeyEnv`，避免密钥进入配置；非空字面值优先。 |
| `apiKeyEnv` | `ARK_API_KEY` | 每次搜索都会通过 `ctx.credentials` 解析该凭据引用；没有该 seam 时则从进程环境解析。值缺失时，调用以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://ark.cn-beijing.volces.com/api/v3` | Responses 端点基址；追加 `/responses`。无法解析时提供方不可用。 |
| `model` | 必填 | Responses 格式模型 id 或端点 id（例如 `ark-code-latest`）。 |
| `sources` | 未设置 | 限制从方舟的哪些搜索渠道检索（`search_engine`、`toutiao`、`douyin`、`moji`）；未设置则全量搜索网页。 |
| `maxKeyword` | `10` | 每轮最大并行搜索关键词的正整数上限，范围 `[1, 50]`。 |
| `limit` | `10` | 每轮返回的最大结果条数的正整数上限，范围 `[1, 50]`。 |
| `maxToolCalls` | `3` | 最大工具调用轮数的正整数上限，范围 `[1, 10]`。 |

```yaml
- id: web-search-ark
  name: '@deepseek-ai/dsh-web-search-ark'
  config:
    apiKeyEnv: HUOSHAN_FANGZHOU_API_KEY
    baseURL: https://ark.cn-beijing.volces.com/api/plan/v3
    model: ark-code-latest
```

上述条目是 `web-search-ark` Settings 节的基础层：覆盖其上的用户层会作用于**下一次**搜索，因为提供方每次调用都会重新投影该节，而不会在注册时捕获。因此 seam 的提供方选择在端点或模型变化时不会闪烁。`apiKey` 携带 `role('secret')`，因此不会在任一层的 `describe()` 响应中出现。

### 搜索返回什么

`sources[]` 来自 `message` 输出条目中的 `url_citation` 标注：`url` ← `url`、`title` ← `title`、`snippet` ← `summary`。有正文时，答案文本作为 `content` 返回。结果按 URL 去重。seam 通过截断 `sources[]` 并设置 `truncated` 来执行 `maxResults`。

### 请求日志

在发起的 agent 下运行的搜索，会在派发之前记录日志专用的 `web/ark-search-llm-request` 会话事件。它包含解析后的端点与发送给方舟的确切无密钥 JSON 请求体；不含标头与凭据。派发前的凭据失败与取消不产生事件，而后续的 HTTP 或响应失败会留下已尝试的请求。Agent 之外的直接编程式提供方调用没有可记录的发起会话。

### 失败与恢复

提供方失败会转为 `WEB_PROVIDER_ERROR`；调用方取消会转为 `WEB_ABORTED`。HTTP 重定向会在接触 `Location` 目标前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。提供方错误消息是可操作的：缺凭据提示、`Ark search credential resolution failed: <error>`、`Ark search aborted`、`Ark search request failed: <error>` 与 `Ark returned an unprocessable response body: <error>`；HTTP 失败会保留提供方消息。消费方负责错误包装。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

这是一个**实现**包：它向 `ctx.web` 注册提供方，通过可选的 `ctx.credentials` seam 为每次搜索解析凭据，若存在发起请求的 Agent 会话，还会在其中记录该辅助请求，且不注册面向模型的工具。它是函数／命名空间插件（`inject: ['web']`）。Responses 协议格式（wire shape）是提供方私有细节——并**不**使该提供方依赖 `ctx.llm`。

提供方只信任结构化的 `url_citation` 标注——**绝不会从模型正文中抓取 URL**。响应缺少 `message` 引用时返回空结果，而非报错，因为某模型端点是否真正提供 `web_search` 工具（以及账号的基址表面是否暴露它）是方舟控制台配置，而不是提供方契约。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、Settings 段安装、逐次选项投影 |
| [`src/provider.ts`](src/provider.ts) | `ArkSearchProvider`：Responses 派发、`url_citation` 提取、答案文本别名、凭据解析 |
| [`src/types.ts`](src/types.ts) | Ark Responses 协议类型（工具定义、引用、输出条目） |
| [`src/sources.ts`](src/sources.ts) | `ARK_SEARCH_SOURCES` 渠道列表，按方舟文档顺序 |
| [`src/invariant.ts`](src/invariant.ts) | 运行时不变式伴生入口（invariants seam） |

### 请求流程

每次搜索先把当前 Settings 节投影为提供方选项——端点、模型、密钥引用、上限——然后通过 `ctx.credentials`（或环境）解析凭据引用，追加日志专用会话事件，并派发携带 `web_search` 工具的 Responses 请求。响应的 `message` 输出条目由其 `url_citation` 标注产生 `sources[]`，由正文产生 `content`；结果按 URL 去重；seam 在返回路径上执行请求的来源上限。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够时阅读这些页面。它们从共享词汇出发，走向服务、面向模型的工具与设计依据。

- [Web 子系统](../../../docs/subsystems/web.zh.md) — 完整的搜索请求／结果词汇与错误码。
- [Web 包地图](../README.zh.md) — web 包家族及各自角色。
- [dsh-web](../web/README.zh.md) — 本提供方注册进其的 web 服务。
- [dsh-tool-web](../tool-web/README.zh.md) — 渲染本提供方来源的面向模型 `web_search` 工具。
- [dsh-web-search-deepseek](../web-search-deepseek/README.zh.md) — 由 DeepSeek Messages API 支持的姊妹提供方。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-ark) — 每个接受的配置字段及其来源声明。
- [Web 能力 seam 决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md) — 为什么搜索与抓取共享一个提供方选择服务。

-----

<a id="model-experience"></a>
## 模型体验

### 辅助 Ark 搜索请求

#### 模型看到的内容

一个独立的方舟模型恰好收到 `Perform a web search for the query: <query>` 作为用户文本，外加内置 `web_search` 工具定义。该请求不属于对话模型的上下文。

#### Token 影响

每次搜索都会产生独立的提供方输入与输出 token；`limit` 限制结果条数，`maxToolCalls` 限制工具轮次。

#### KV Cache 影响

与对话请求缓存无关。辅助指令与工具定义可形成稳定前缀，但每次查询或模型路由改变都会从首个差异处阻止复用。

### 会话工具结果（间接）

#### 模型看到的内容

通过 [`dsh-tool-web`](../tool-web/README.zh.md)，对话模型会看到模型生成的答案文本，以及来自结构化标注的去重 URL、标题与引用摘要。

#### Token 影响

注册本身不产生对话 token。结果 token 随返回的来源与正文增长，随后 seam 执行请求的来源上限。

#### KV Cache 影响

仅追加；新可见内容跟随可复用请求前缀，不会使既有 KV 缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>



- **一次搜索消耗一次完整 Responses 模型轮次**——延迟与生成 token，最多 `maxToolCalls` 轮服务器侧搜索；方舟的模型路由没有专用检索端点。
- **联网搜索是部署能力，而非模型保证**——某模型端点是否真正提供 `web_search` 工具，以及账号的基址表面是否暴露它，取决于方舟控制台配置（需开通联网内容插件）。响应不含 `message` 引用时返回空结果，而非报错。
- **动态凭据可用性在操作内部解析**——同步 `available()` 契约只能确认存在解析器，无法查询异步凭据存储。因此被选中的无密钥提供方会以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败搜索；稳定的 `web_search` schema 仍保持注册。调用方取消会本地竞速该预检，但无法强制任意凭据后端自身停止工作。
- **超量返回的来源仍会消耗 token**——`limit` 限制单次搜索的检索量，但 seam 执行的来源上限是在事后截断时施加的。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文</summary>

本开发备注是维护者的工作上下文：开放问题与未定方向。它明确不具权威性——已发布行为、限制与依据位于上述章节。

- 单测位于 `tests/ark.spec.ts`（映射、配置校验、错误路径）与 `tests/settings.spec.ts`（Settings 节投影）；真实端点检查需要一个 `ARK_API_KEY`（或部署的密钥引用），且基址对应的模型须提供 `web_search` 工具。
- 若方舟将来暴露专用检索端点，上述整模型轮次开销将消失，本提供方可变为类似 Exa／Perplexity 提供方的轻量端点适配器。
</details>
