/**
 * Provider-private wire types for Volcengine Ark's Responses API
 * `web_search` tool. The provider sends one non-streaming Response whose
 * `tools[]` carries the built-in `web_search` tool; the model answers with a
 * `message` output item whose prose and URL citations supply the normalized
 * search result. These types do not create a dependency on `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-ark/types
 */

/** One searchable source channel Ark may be told to restrict retrieval to. */
export type ArkSearchSource = 'search_engine' | 'toutiao' | 'douyin' | 'moji'

/** The built-in `web_search` tool as it appears in the request's `tools[]`. */
export interface ArkWebSearchTool {
  readonly type: 'web_search'
  /** Restrict retrieval to these channels; omitted searches the web wholesale. */
  readonly sources?: readonly ArkSearchSource[]
  /** Max parallel search keywords per round. Range [1, 50]. */
  readonly max_keyword?: number
  /** Max result items returned per round. Range [1, 50]; default 10. */
  readonly limit?: number
}

/** A single `url_citation` annotation attached to a message content block. */
export interface ArkUrlCitation {
  readonly type?: 'url_citation'
  readonly url?: string
  /** Provider-supplied title; absent or explicitly null when Ark omits it. */
  readonly title?: string | null
  /** Provider-supplied page summary/excerpt. */
  readonly summary?: string | null
}

/** A `text` content block inside a message output item. */
export interface ArkTextContent {
  readonly type?: 'text'
  readonly text?: string
  readonly annotations?: readonly ArkUrlCitation[]
}

/** A `message` output item: the model's answer prose plus citations. */
export interface ArkMessageItem {
  readonly type: 'message'
  readonly content?: readonly ArkTextContent[]
}

/** A `web_search_call` output item: one search the model actually dispatched. */
export interface ArkWebSearchCallItem {
  readonly type: 'web_search_call'
  readonly action?: { readonly type?: string; readonly query?: string }
}

/** Any output item; only `message` is consumed. */
export type ArkOutputItem = ArkMessageItem | ArkWebSearchCallItem | { readonly type: string }

/** The non-streaming Response envelope this provider parses. */
export interface ArkResponsesResponse {
  readonly output?: readonly ArkOutputItem[]
}

/** Ark's error response envelope (best-effort; fields vary). */
export interface ArkError {
  readonly error?: { readonly message?: string } | string
  readonly message?: string
}
