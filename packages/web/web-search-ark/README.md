---
description: "Volcengine Ark-backed web search provider for the web capability seam: mount Ark's Responses API web_search tool as a ctx.web provider that reuses the deployment's existing Ark API key."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-ark

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-ark`, the harness retrieves the web through [Volcengine Ark](https://www.volcengine.com/product/ark) (火山方舟), using an Ark API key the deployment already manages for model traffic. Choose it when the deployment serves models from an Ark base URL and accepts that one search costs a complete Responses model turn in latency and tokens, because Ark model routing has no dedicated retrieval endpoint. Results come only from Ark's structured `url_citation` annotations; prose never contributes a URL. A missing credential fails the call with a structured error; a redirect is rejected before it carries the request elsewhere. The model-facing `web_search` tool lives in `dsh-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the web service and this provider in a composition; it registers as the `ark-official` search provider, so when it is the only usable search backend, `ctx.web.search()` resolves to it automatically — pin it with `searchProvider: ark-official` when more than one search backend is loaded.

### When to choose it

Exa and Perplexity expose dedicated search endpoints; this provider instead issues a **full Responses model call** carrying Ark's built-in `web_search` tool, so one search costs a complete model turn in latency and tokens, and Ark runs the search server-side, gating whether to search on the model's judgment (`maxToolCalls` caps how many rounds it may). Reuses the **same Ark API key** a deployment already manages for model traffic — no new secret. Avoid it when per-search cost or latency dominates and a dedicated retrieval endpoint is available.

A mounted credentials service is authoritative; without one, the provider falls back to the launching process environment. The reference is resolved for each search, so a key stored or rotated through the Models page reaches the next call without a restart.

### Minimal configuration

Load the web service and the provider; the key resolves from `ctx.credentials` when that service is mounted, otherwise from the process environment. The Responses endpoint base is Ark's public API by default; set `baseURL` to your deployment's base (e.g. the Agent-Plan base) when your model is served there.

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal Ark API key. Prefer `apiKeyEnv` so no secret enters configuration; a non-empty literal wins. |
| `apiKeyEnv` | `ARK_API_KEY` | Credential reference resolved for each search through `ctx.credentials`, or from the process environment when that seam is absent. A missing value fails the call as `WEB_PROVIDER_CREDENTIAL_MISSING`. |
| `baseURL` | `https://ark.cn-beijing.volces.com/api/v3` | Responses endpoint base; `/responses` is appended. An unparseable value makes the provider unavailable. |
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

### What a search returns

`sources[]` comes from the `message` output item's `url_citation` annotations: `url` ← `url`, `title` ← `title`, `snippet` ← `summary`. The answer prose is aliased as `content` when present. Results are deduplicated by URL. The seam enforces `maxResults` by truncating `sources[]` and setting `truncated`.

### Request logging

A search running under an initiating agent logs the logging-only `web/ark-search-llm-request` session event immediately before dispatch. It carries the resolved endpoint and the exact secret-free JSON request body sent to Ark; no headers and no credential. Credential failures and cancellations before dispatch leave no event, while later HTTP or response failures leave the attempted request. Direct programmatic provider calls outside an agent have no initiating session to record into.

### Failures and recovery

Provider failures become `WEB_PROVIDER_ERROR`; caller cancellation becomes `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted, and surface as `WEB_PROVIDER_ERROR`. Provider error messages are actionable: missing-credential hints, `Ark search credential resolution failed: <error>`, `Ark search aborted`, `Ark search request failed: <error>`, `Ark returned an unprocessable response body: <error>`; HTTP failures keep the provider message. Consumers own error wrapping.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

This is an **implementation** package: it registers a provider into `ctx.web`, resolves its credential for each search through the optional `ctx.credentials` seam, records the auxiliary request in the initiating Agent session when one exists, and does not register a model-facing tool. It is a function/namespace plugin (`inject: ['web']`). The Responses wire shape is a provider-private detail — it does **not** make this provider depend on `ctx.llm`.

The provider trusts only structured `url_citation` annotations — it never scrapes URLs out of model prose. A response without a `message` citation returns empty results rather than an error, because whether a model endpoint actually serves the `web_search` tool (and whether the account's base-URL surface exposes it) is Ark console configuration, not a provider contract.

### Source map

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, Settings-section install, per-call option projection |
| [`src/provider.ts`](src/provider.ts) | `ArkSearchProvider`: Responses dispatch, `url_citation` extraction, answer-text aliasing, credential resolution |
| [`src/types.ts`](src/types.ts) | Ark Responses wire types (tool definition, citations, output items) |
| [`src/sources.ts`](src/sources.ts) | The `ARK_SEARCH_SOURCES` channel list, in Ark docs order |
| [`src/invariant.ts`](src/invariant.ts) | Runtime invariant companion (invariants seam) |

### Request flow

Each search first projects the current Settings section into provider options — endpoint, model, key reference, caps — then resolves the credential reference through `ctx.credentials` (or the environment), appends the logging-only session event, and dispatches the Responses request carrying the `web_search` tool. The response's `message` output item yields `sources[]` from its `url_citation` annotations and `content` from its prose; results are deduplicated by URL; the seam enforces the requested source cap on the way back.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the web package family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [dsh-web-search-deepseek](../web-search-deepseek/README.md) — the sibling provider backed by DeepSeek's Messages API.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-ark) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

### Auxiliary Ark search request

#### What the model sees

An isolated Ark model receives exactly `Perform a web search for the query: <query>` as user text, plus the built-in `web_search` tool definition. The request is not part of the conversation model's context.

#### Token effect

Each search produces its own provider input and output tokens; `limit` caps result items and `maxToolCalls` caps tool rounds.

#### KV Cache effect

Independent of the conversation request's cache. The auxiliary instruction and tool definition can form a stable prefix, but every query change or model-route change blocks reuse from the first difference.

### Conversation tool result, indirectly

#### What the model sees

Through [`dsh-tool-web`](../tool-web/README.md), the conversation model sees the model-generated answer text plus the deduplicated URLs, titles, and citation snippets from the structured annotations.

#### Token effect

Registration produces no conversation tokens. Result tokens grow with the returned sources and prose, after which the seam enforces the requested source cap.

#### KV Cache effect

Append-only; new visible content follows a reusable request prefix and does not invalidate existing KV cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>



- **One search costs one full Responses model turn** — latency and generated tokens, up to `maxToolCalls` rounds of server-side search; Ark model routing has no dedicated retrieval endpoint.
- **Web search is a deployment capability, not a model guarantee** — whether a model endpoint actually serves the `web_search` tool, and whether the account's base-URL surface exposes it, is Ark console configuration (the web-content plugin must be enabled). A response without a `message` citation returns empty results, not an error.
- **Dynamic credential availability is resolved inside the operation** — the synchronous `available()` contract can only confirm a resolver exists; it cannot query an asynchronous credential store. A selected keyless provider therefore fails its searches with `WEB_PROVIDER_CREDENTIAL_MISSING`; the stable `web_search` schema stays registered. Caller cancellation races the preflight locally but cannot force an arbitrary credential backend to stop working.
- **Over-returned sources still cost tokens** — `limit` bounds one search's retrieval, but the seam-enforced source cap is applied as a post-hoc truncation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

- Unit coverage lives in `tests/ark.spec.ts` (mapping, config validation, error paths) and `tests/settings.spec.ts` (Settings-section projection); live-endpoint checks need an `ARK_API_KEY` (or the deployment's key reference) against a base URL whose model serves the `web_search` tool.
- If Ark ever exposes a dedicated retrieval endpoint, the full-model-turn cost above disappears and this provider can become a thin endpoint adapter like the Exa/Perplexity providers.
</details>
