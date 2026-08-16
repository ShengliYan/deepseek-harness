# @deepseek-ai/dsh-web-search-ark

English | [中文](README.zh.md)

A [Volcengine Ark](https://www.volcengine.com/product/ark)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Ark's **Responses API** (`POST {baseURL}/responses`) with the built-in `web_search` tool, and maps the model's `message` output item — prose plus `url_citation` annotations — into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, resolves its credential for each search through the optional `ctx.credentials` seam, records the auxiliary request in the initiating Agent session when one exists, and does not register a model-facing tool. It is a function/namespace plugin (`inject: ['web']`). The Responses wire shape is a provider-private detail — it does **not** make this provider depend on `ctx.llm`.

## How it differs from a dedicated search endpoint

Exa and Perplexity expose dedicated search endpoints; this provider instead issues a **full Responses model call** carrying the `web_search` tool, so one search costs a complete model turn in latency and tokens. Ark runs the search server-side and gates whether to search on the model's judgment (`max_tool_calls` caps how many rounds it may). The provider trusts only structured `url_citation` annotations — it never scrapes URLs out of model prose.

It reuses the **same Ark API key** a deployment already manages for model traffic (no new secret). A mounted credentials service is authoritative; without one, the provider falls back to the launching process environment. The reference is resolved for each search, so a key stored or rotated through the Models page reaches the next call without a restart.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal Ark API key. Prefer `apiKeyEnv` so no secret enters configuration; a non-empty literal wins. |
| `apiKeyEnv` | `ARK_API_KEY` | Credential reference resolved for each search through `ctx.credentials`, or from the process environment when that seam is absent. A missing value fails the call as `WEB_PROVIDER_CREDENTIAL_MISSING`. |
| `baseURL` | `https://ark.cn-beijing.volces.com/api/v3` | Responses endpoint base; `/responses` is appended. Set this to your deployment's base (e.g. the Agent-Plan base `https://ark.cn-beijing.volces.com/api/plan/v3`) when your model is served there. An unparseable value makes the provider unavailable. |
| `model` | required | Responses-format model id or endpoint id (e.g. `ark-code-latest`). |
| `sources` | omitted | Restrict retrieval to Ark source channels (`search_engine`, `toutiao`, `douyin`, `moji`); omitted searches the web wholesale. |
| `maxKeyword` | `10` | Positive-integer max parallel search keywords per round, range `[1, 50]`. |
| `limit` | `10` | Positive-integer max result items per round, range `[1, 50]`. |
| `maxToolCalls` | `3` | Positive-integer max tool-call rounds, range `[1, 10]`. |

```yaml
- id: web-search-ark
  name: '@deepseek-ai/dsh-web-search-ark'
  config:
    apiKeyEnv: HUOSHAN_FANGZHOU_API_KEY
    baseURL: https://ark.cn-beijing.volces.com/api/plan/v3
    model: ark-code-latest
```

The entry above is the base layer of the `web-search-ark` Settings section: a user layer over it reaches the NEXT search, because the provider projects the section per call rather than capturing it at registration. The seam's provider selection therefore never flickers when an endpoint or model changes. `apiKey` carries `role('secret')`, so it never rides a `describe()` response in any layer.

## Mapping

`sources[]` comes from the `message` output item's `url_citation` annotations: `url` ← `url`, `title` ← `title`, `snippet` ← `summary`. The answer prose is aliased as `content` when present. Results are deduplicated by URL. The seam enforces `maxResults` by truncating `sources[]` and setting `truncated`.

Provider failures become `WEB_PROVIDER_ERROR`; caller cancellation becomes `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Request logging

Immediately before dispatch, a search running under an initiating Agent appends the log-only `web/ark-search-llm-request` session event. It contains the resolved endpoint and exact secret-free JSON body sent to Ark; headers and credentials are excluded. Credential failures and cancellations before dispatch create no event, while later HTTP or response failures leave the attempted request durable. Direct programmatic provider calls outside an Agent have no initiating session to log.

## Model Experience

### Auxiliary Ark search request

#### What the model sees

A separate Ark model receives exactly `Perform a web search for the query: <query>` as its user text and one built-in `web_search` tool definition. This request is not part of the conversation model's context.

#### Token effect

Separate provider input and output tokens are incurred for each search; `limit` caps result items and `maxToolCalls` caps tool rounds.

#### KV Cache effect

Independent of the conversation request cache. The auxiliary instruction and tool definition can form a stable prefix, but each changed query or model route prevents reuse from its first difference.

### Conversation tool result, indirectly

#### What the model sees

Through [`dsh-tool-web`](../tool-web/README.md), the conversation model sees the model-generated answer prose and deduplicated URLs, titles, and citation snippets from structured annotations. This provider's exact failures include the actionable missing-credential message, `Ark search credential resolution failed: <error>`, `Ark search aborted`, `Ark search request failed: <error>`, and `Ark returned an unprocessable response body: <error>`; HTTP failures preserve the provider message. The consumer owns the error wrapper.

#### Token effect

Zero direct conversation tokens from registration. Result tokens scale with returned sources and prose, then the seam enforces the requested source bound.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **One search costs a full Responses model turn** — latency plus generated tokens, with up to `maxToolCalls` server-side search rounds; Ark exposes no dedicated retrieval endpoint on the model route.
- **Web search is a deployment capability, not a model guarantee** — whether a given model endpoint on the account actually serves the `web_search` tool, and whether the account's base URL surface exposes it, depends on the Ark console configuration (the 联网内容插件 must be enabled). A response with no `message` citations yields an empty result, not an error.
- **Dynamic credential availability resolves inside the operation** — the synchronous `available()` contract can establish that a resolver exists but cannot query an asynchronous credential store. A selected keyless provider therefore fails the search with `WEB_PROVIDER_CREDENTIAL_MISSING`; the stable `web_search` schema remains registered. Caller cancellation races this preflight locally, but cannot force an arbitrary credential backend itself to stop work.
- **Over-returned sources still cost tokens** — `limit` bounds a single search's retrieval, but the source bound the seam enforces is applied post-hoc by truncation.
