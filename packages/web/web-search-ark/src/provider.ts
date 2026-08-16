/**
 * Volcengine Ark-backed search provider. Each search is one non-streaming
 * Responses API call carrying the built-in `web_search` tool; the seam's
 * normalized result comes from the model's `message` output item (prose +
 * `url_citation` annotations). The wire format and native `fetch` client are
 * provider-private and do not use `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-ark/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-session'
import type {
  ArkError,
  ArkMessageItem,
  ArkOutputItem,
  ArkResponsesResponse,
  ArkSearchSource,
  ArkTextContent,
  ArkWebSearchTool,
} from './types.ts'

/** Stable id this provider registers under. */
export const ARK_PROVIDER_ID = 'ark-official'

/** Default endpoint base; `/responses` is appended. @see ark-search-base-url */
export const ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

/** Default max parallel keywords Ark may dispatch per round. */
const DEFAULT_MAX_KEYWORD = 10

/** Default result items per round. */
const DEFAULT_LIMIT = 10

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/**
 * Exact secret-free Ark Responses request recorded immediately before one
 * auxiliary search dispatch.
 */
export interface ArkSearchLlmRequest {
  /** Fully resolved Responses endpoint. */
  readonly endpoint: string
  /** Exact JSON body sent to the provider. */
  readonly body: {
    readonly model: string
    readonly stream: false
    readonly input: readonly [{
      readonly role: 'user'
      readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
    }]
    readonly tools: readonly [ArkWebSearchTool]
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free auxiliary Ark search request recorded before dispatch. */
    'web/ark-search-llm-request': ArkSearchLlmRequest
  }
}

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface ArkSearchProviderOptions {
  /** Literal Ark API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Ark API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/responses` is appended. */
  baseURL: string
  /** Responses-format model id or endpoint id. */
  model: string
  /** Search source restriction; omitted searches the web wholesale. */
  sources?: readonly ArkSearchSource[]
  /** Max parallel search keywords per round. */
  maxKeyword: number
  /** Max result items per round. */
  limit: number
  /** Max tool-call rounds. */
  maxToolCalls: number
  /**
   * Record the exact secret-free request immediately before dispatch. A throw
   * prevents dispatch so model-visible auxiliary input cannot escape logging.
   */
  recordRequest?: (request: ArkSearchLlmRequest) => void
}

/**
 * Narrow one output item to a `message` item. The catch-all `{ type: string }`
 * union member prevents basic discriminant narrowing, so the walkers route
 * through this predicate instead.
 * @param item - one output item.
 * @returns true when the item is a `message` carrying content.
 */
function isMessageItem(item: ArkOutputItem): item is ArkMessageItem {
  return item.type === 'message'
}

/**
 * Build `url → source` from a message item's `url_citation` annotations,
 * joined by URL. First occurrence of a URL wins; blocks outside a `message`
 * item are skipped.
 * @param items - the response's output items.
 * @returns the `url → source` map (empty when no citations are present).
 */
export function citationSources(items: ArkResponsesResponse['output']): Map<string, WebSearchSource> {
  const map = new Map<string, WebSearchSource>()
  for (const item of items ?? []) {
    if (!isMessageItem(item)) continue
    for (const block of item.content ?? []) {
      for (const annotation of block.annotations ?? []) {
        const url = annotation.url
        if (url == null || url.length === 0 || map.has(url)) continue
        const source: WebSearchSource = {
          url,
          ...annotation.title != null && annotation.title.length > 0 ? { title: annotation.title } : {},
          ...annotation.summary != null && annotation.summary.length > 0 ? { snippet: annotation.summary } : {},
        }
        map.set(url, source)
      }
    }
  }
  return map
}

/**
 * Concatenate the first `message` item's `text` content blocks. Aliases the
 * provider-generated answer text; absent prose yields `undefined`.
 * @param items - the response's output items.
 * @returns the joined answer text, or undefined when no message text exists.
 */
export function answerText(items: ArkResponsesResponse['output']): string | undefined {
  for (const item of items ?? []) {
    if (!isMessageItem(item)) continue
    const blocks = (item.content ?? []).filter((block): block is ArkTextContent => block.text != null)
    if (blocks.length === 0) continue
    /* v8 ignore next -- every block passed the text != null filter, so the nullish right side is unreachable */
    return blocks.map(block => block.text ?? '').join('')
  }
  return undefined
}

/**
 * Map an Ark Responses payload to a normalized search result. Cites every
 * `url_citation` as a source and reports the model's answer prose as `content`.
 * @param body - the parsed Responses body.
 * @returns the normalized result.
 */
export function mapArkResponse(body: ArkResponsesResponse): WebSearchResult {
  const sources = [...citationSources(body.output).values()]
  const content = answerText(body.output)
  return {
    ...content == null ? {} : { content },
    sources,
    truncated: false,
  }
}

/** The Ark-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class ArkSearchProvider implements WebSearchProvider {
  readonly id = ARK_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections. A
   * thunk rather than a value because the plugin's settings section can change
   * between searches, and re-registering the provider to carry a new endpoint
   * would make the seam's selection observable to the user as a flicker.
   */
  constructor(private readonly resolveOptions: () => ArkSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && options.model.length > 0
      && isPositiveInteger(options.maxKeyword)
      && isPositiveInteger(options.limit)
      && isPositiveInteger(options.maxToolCalls)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section to the endpoint named by the new one.
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    const tool: ArkWebSearchTool = {
      type: 'web_search',
      ...options.maxKeyword === DEFAULT_MAX_KEYWORD ? {} : { max_keyword: options.maxKeyword },
      ...options.limit === DEFAULT_LIMIT ? {} : { limit: options.limit },
      ...options.sources === undefined || options.sources.length === 0 ? {} : { sources: [...options.sources] },
    }
    const endpoint = `${options.baseURL}/responses`
    const body: ArkSearchLlmRequest['body'] = {
      model: options.model,
      stream: false,
      input: [{
        role: 'user',
        content: [{ type: 'text', text: `Perform a web search for the query: ${request.query}` }],
      }],
      tools: [tool],
    }
    options.recordRequest?.({ endpoint, body })
    throwIfSearchAborted(signal)
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Ark search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Ark API error (HTTP ${status})`
      try {
        const parsed = await response.json() as ArkError
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as ArkResponsesResponse
      return mapArkResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      /* v8 ignore next -- mapArkResponse never throws a WebError, so this rethrow is unreachable */
      if (error instanceof WebError) throw error
      throw new WebError(`Ark returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  private async apiKey(options: ArkSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `Ark search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'ARK_API_KEY'
    throw new WebError(
      `Ark search has no API key for "${ref}"; store it through the credentials service`
      + ' (the web Models page writes it), export it in the launching environment, or set a literal'
      + ' "apiKey" in the web-search-ark config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Ark search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for Ark request limits that can be sent to the Responses API. */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
