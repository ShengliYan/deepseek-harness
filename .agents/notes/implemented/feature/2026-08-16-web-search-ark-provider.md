# Agent Note: Volcengine Ark web search provider

Status: implemented

English | [中文](2026-08-16-web-search-ark-provider.zh.md)

## Problem

Deployments that run model traffic on Volcengine Ark had no search route through the harness [web capability seam](../../../../packages/web/web/README.md): the shipped providers cover Exa, Perplexity, and DeepSeek, so a deployment whose only credential is an Ark API key could run the agent but not the model-facing web search tool. Ark exposes search only through its Responses API as a built-in `web_search` tool — there is no dedicated search endpoint — so no existing provider could be pointed at Ark by configuration alone.

## Decision

A new implementation package `@deepseek-ai/dsh-web-search-ark` registers a `WebSearchProvider` into `ctx.web` (`inject: ['web']`). One search is one full Responses call: the provider posts `{baseURL}/responses` carrying the built-in `web_search` tool and maps the model's `message` output item — prose plus `url_citation` annotations — into the seam's normalized `WebSearchResult`. Only structured `url_citation` annotations become result URLs; model prose is never scraped for links. Ark runs the search server-side and decides per round whether to search, capped by `maxToolCalls`.

Credentialing reuses the deployment's existing Ark key: the reference resolves per search through the optional `ctx.credentials` seam (`apiKeyEnv`, default `ARK_API_KEY`), falling back to the launching process environment when that seam is absent, so a key stored or rotated through the Models page reaches the next call without a restart. A non-empty literal `apiKey` wins. `model` is required config; `baseURL` defaults to `https://ark.cn-beijing.volces.com/api/v3`, and `sources`/`maxKeyword`/`limit`/`maxToolCalls` bound the retrieval. When an initiating Agent session exists, the auxiliary request is recorded in its log.

The bundle mounts the provider dormant: `cordis.patch.yml` registers `web-search-ark` with no config, so nothing activates unless a deployment sets `web.searchProvider: ark-official` and supplies a `web-search-ark` settings section (or a `baseURL`/`model`/`apiKeyEnv` here).

## Alternatives considered

**A dedicated Ark search endpoint.** Rejected: Ark has no standalone search API; the built-in tool is the only search surface, so the Responses call shape is the provider.

**Extending an existing provider with an Ark mode.** Rejected: the Ark wire shape (a full Responses call with tool-use annotations) shares nothing with the dedicated-search endpoints the other providers call; one provider per backend keeps each package's failure and config vocabulary small.

**Scraping URLs out of the model's prose.** Rejected: prose extraction is lossy and unverifiable; trusting only `url_citation` annotations keeps every result URL server-attested.

**A literal API key in cordis.yml.** Rejected: deployment keys belong behind the credentials seam or environment references; a non-empty literal is accepted only as an explicit override.

## Consequences

Ark deployments gain the model-facing web search tool with no new secret. The dormant bundle entry costs nothing until configured. One search spends a complete model turn in latency and tokens, and whether the model searches at all is its judgment within `maxToolCalls` rounds. Package tests pin the provider mapping, the settings validation, and the credential-missing failure; the tool-web consumer is untouched.
