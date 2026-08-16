# @deepseek-ai/dsh-web-search-ark

[English](README.md) | 中文

由 [火山方舟](https://www.volcengine.com/product/ark) 支持的 `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它调用方舟的 **Responses API**（`POST {baseURL}/responses`），携带内置 `web_search` 工具，并把模型的 `message` 输出条目——正文加 `url_citation` 标注——映射为 seam 规范化的 `WebSearchResult`。

这是一个**实现**包：它向 `ctx.web` 注册提供方，通过可选的 `ctx.credentials` seam 为每次搜索解析凭据，若存在发起请求的 agent（智能体）会话，还会在其中记录该辅助请求，且不注册面向模型的工具。它是函数／命名空间插件（`inject: ['web']`）。Responses 协议格式（wire format）是提供方私有细节，并**不**使该提供方依赖 `ctx.llm`。

## 与专用搜索端点的区别

Exa 和 Perplexity 提供专用搜索端点；该提供方改为发起一次携带 `web_search` 工具的**完整 Responses 模型调用**，因此一次搜索会产生完整模型轮次的延迟与 token 开销。方舟在服务器侧执行搜索，是否搜索由模型自行判断（`max_tool_calls` 限制其最多执行几轮）。提供方只信任结构化的 `url_citation` 标注，**绝不会从模型文本中抓取 URL**。

它复用部署已为模型流量管理的**同一把 Ark API 密钥**（不增加密钥）。已挂载的凭据服务具有权威性；没有该服务时，提供方会回退到启动进程的环境变量。每次搜索都会解析该引用，因此在 Models 页中存储或轮换的密钥无需重启，即可用于下一次调用。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | Ark API 密钥字面值。优先使用 `apiKeyEnv`，避免密钥进入配置；非空字面值优先。 |
| `apiKeyEnv` | `ARK_API_KEY` | 每次搜索都会通过 `ctx.credentials` 解析该凭据引用；没有该 seam 时则从进程环境解析。值缺失时，调用以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://ark.cn-beijing.volces.com/api/v3` | Responses 端点基址；追加 `/responses`。当你的模型由部署专属基址（例如 Agent Plan 基址 `https://ark.cn-beijing.volces.com/api/plan/v3`）提供时，请改为此基址。无法解析时提供方不可用。 |
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

## 映射

`sources[]` 来自 `message` 输出条目中的 `url_citation` 标注：`url` ← `url`、`title` ← `title`、`snippet` ← `summary`。有正文时，答案文本作为 `content` 返回。结果按 URL 去重。seam 通过截断 `sources[]` 并设置 `truncated` 来执行 `maxResults`。

提供方失败会转为 `WEB_PROVIDER_ERROR`；调用方取消会转为 `WEB_ABORTED`。重定向会在接触 `Location` 目标前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。

## 请求记录

紧邻派发之前，在发起的 agent 下运行的搜索会记录日志专用的 `web/ark-search-llm-request` 会话事件。它包含解析后的端点与发送给方舟的确切无密钥 JSON 请求体；不含标头与凭据。派发前的凭据失败与取消不产生事件，而后续的 HTTP 或响应失败会留下已尝试的请求。Agent 之外的直接编程式提供方调用没有可记录的发起会话。

## 模型体验

### 辅助 Ark 搜索请求

#### 模型所见

一个独立的 Ark 模型恰好收到 `Perform a web search for the query: <query>` 作为用户文本，外加一个内置 `web_search` 工具定义。该请求不属于对话模型的上下文。

#### Token 影响

每次搜索都会产生独立的提供方输入与输出 token；`limit` 限制结果条数，`maxToolCalls` 限制工具轮次。

#### KV 缓存影响

与对话请求缓存无关。辅助指令与工具定义可形成稳定前缀，但每次改变查询或模型路由都会从首个差异处阻止复用。

### 会话工具结果（间接）

#### 模型所见

通过 [`dsh-tool-web`](../tool-web/README.md)，对话模型会看到模型生成的答案文本，以及来自结构化标注的去重 URL、标题与引用摘要。该提供方的精确失败消息包括可操作的缺凭据提示、`Ark search credential resolution failed: <error>`、`Ark search aborted`、`Ark search request failed: <error>` 与 `Ark returned an unprocessable response body: <error>`；HTTP 失败会保留提供方消息。消费方负责错误包装。

#### Token 影响

注册本身不产生对话 token。结果 token 随返回的来源与正文增长，随后 seam 执行请求的来源上限。

#### KV 缓存影响

仅追加；新可见内容跟随可复用请求前缀，不会使既有 KV 缓存条目失效。

## 已知限制与待办

- **一次搜索消耗一次完整 Responses 模型轮次**——延迟与生成 token，最多 `maxToolCalls` 轮服务器侧搜索；方舟的模型路由没有专用检索端点。
- **联网搜索是部署能力，而非模型保证**——某模型端点是否真正提供 `web_search` 工具，以及账号的基址表面是否暴露它，取决于方舟控制台配置（需开通联网内容插件）。响应不含 `message` 引用时返回空结果，而非报错。
- **动态凭据可用性在操作内部解析**——同步 `available()` 契约只能确认存在解析器，无法查询异步凭据存储。因此被选中的无密钥提供方会以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败搜索；稳定的 `web_search` schema 仍保持注册。调用方取消会本地竞速该预检，但无法强制任意凭据后端自身停止工作。
- **超量返回的来源仍会消耗 token**——`limit` 限制单次搜索的检索量，但 seam 执行的来源上限是在事后截断时施加的。
