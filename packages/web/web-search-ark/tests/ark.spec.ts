import { createRequire } from 'node:module'

import { describe, expect, it, vi, afterEach } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ArkSearchProvider, ARK_PROVIDER_ID, answerText, citationSources, mapArkResponse } from '../src/provider.ts'
import type { ArkSearchProviderOptions } from '../src/provider.ts'
import type { ArkResponsesResponse } from '../src/types.ts'

const options: ArkSearchProviderOptions = {
  apiKey: 'ark-key',
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'ark-endpoint',
  maxKeyword: 10,
  limit: 10,
  maxToolCalls: 3,
}

const provider = (overrides: Partial<ArkSearchProviderOptions> = {}): ArkSearchProvider =>
  new ArkSearchProvider(() => ({ ...options, ...overrides }))

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

function messageResponse(): ArkResponsesResponse {
  return {
    output: [
      { type: 'web_search_call', action: { type: 'web_search', query: 'ark' } },
      {
        type: 'message',
        content: [
          {
            type: 'text',
            text: 'Here is the answer.',
            annotations: [
              { type: 'url_citation', url: 'https://a.test', title: 'A', summary: 'snippet A' },
              { type: 'url_citation', url: 'https://b.test', title: 'B' },
            ],
          },
        ],
      },
    ],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('citationSources', () => {
  it('tolerates an undefined output list', () => {
    expect([...citationSources(undefined).values()]).toEqual([])
  })

  it('tolerates a message item without content', () => {
    const items: ArkResponsesResponse['output'] = [{ type: 'message' }]
    expect([...citationSources(items).values()]).toEqual([])
  })

  it('tolerates a content block without annotations', () => {
    const items: ArkResponsesResponse['output'] = [{ type: 'message', content: [{}] }]
    expect([...citationSources(items).values()]).toEqual([])
  })

  it('maps url_citation annotations to sources, first occurrence wins', () => {
    const items: ArkResponsesResponse['output'] = [
      {
        type: 'message',
        content: [
          {
            annotations: [
              { type: 'url_citation', url: 'https://a.test', title: 'A', summary: 'first' },
              { type: 'url_citation', url: 'https://a.test', title: 'A2', summary: 'second' },
            ],
          },
        ],
      },
    ]
    const map = citationSources(items)
    expect(map.size).toBe(1)
    expect(map.get('https://a.test')).toMatchObject({ url: 'https://a.test', title: 'A', snippet: 'first' })
  })

  it('omits title and snippet when an annotation carries empty strings', () => {
    const items: ArkResponsesResponse['output'] = [
      {
        type: 'message',
        content: [
          { annotations: [{ type: 'url_citation', url: 'https://c.test', title: '', summary: '' }] },
        ],
      },
    ]
    expect([...citationSources(items).values()]).toEqual([{ url: 'https://c.test' }])
  })

  it('omits null title and summary fields', () => {
    const items: ArkResponsesResponse['output'] = [
      {
        type: 'message',
        content: [
          { annotations: [{ type: 'url_citation', url: 'https://d.test', title: null, summary: null }] },
        ],
      },
    ]
    expect([...citationSources(items).values()]).toEqual([{ url: 'https://d.test' }])
  })

  it('skips non-message items and sessions without url', () => {
    const items: ArkResponsesResponse['output'] = [
      { type: 'web_search_call', action: { query: 'x' } },
      {
        type: 'message',
        content: [
          { annotations: [{ type: 'url_citation', url: '' }] },
          { annotations: [{ type: 'url_citation', url: 'https://c.test' }] },
        ],
      },
    ]
    expect([...citationSources(items).values()]).toEqual([{ url: 'https://c.test' }])
  })
})

describe('answerText', () => {
  it('joins the first message text blocks', () => {
    const items: ArkResponsesResponse['output'] = [
      { type: 'message', content: [{ text: 'one ' }, { text: 'two' }] },
    ]
    expect(answerText(items)).toBe('one two')
  })

  it('tolerates an undefined output list', () => {
    expect(answerText(undefined)).toBeUndefined()
  })

  it('skips a message without content', () => {
    expect(answerText([{ type: 'message' }])).toBeUndefined()
  })

  it('returns undefined when no message text exists', () => {
    expect(answerText([{ type: 'web_search_call', action: { query: 'x' } }])).toBeUndefined()
  })

  it('skips a message whose blocks carry no text and answers from the next one', () => {
    const items: ArkResponsesResponse['output'] = [
      { type: 'message', content: [{ type: 'text' }] },
      { type: 'message', content: [{ text: 'second' }] },
    ]
    expect(answerText(items)).toBe('second')
  })
})

describe('mapArkResponse', () => {
  it('normalizes sources and content from a message item', () => {
    const result = mapArkResponse(messageResponse())
    expect(result.content).toBe('Here is the answer.')
    expect(result.sources).toEqual([
      { url: 'https://a.test', title: 'A', snippet: 'snippet A' },
      { url: 'https://b.test', title: 'B' },
    ])
    expect(result.truncated).toBe(false)
  })

  it('omits content when the model returns no answer prose', () => {
    const result = mapArkResponse({ output: [{ type: 'web_search_call', action: { query: 'x' } }] })
    expect(result.content).toBeUndefined()
    expect(result.sources).toEqual([])
  })
})

describe('ArkSearchProvider', () => {
  it('surfaces its stable id and availability', () => {
    expect(provider().id).toBe(ARK_PROVIDER_ID)
    expect(provider().available()).toBe(true)
  })

  it('is unavailable without a resolvable key or endpoint', () => {
    const keyless = new ArkSearchProvider(() => ({
      baseURL: 'https://ark.test/api/v3',
      model: 'm',
      maxKeyword: 10,
      limit: 10,
      maxToolCalls: 3,
    }))
    expect(keyless.available()).toBe(false)
    expect(provider({ baseURL: 'not-a-url' }).available()).toBe(false)
    expect(provider({ model: '' }).available()).toBe(false)
  })

  it('sends a web_search Response and maps the message item', async () => {
    let captured: { url: string; body: unknown } | undefined
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(init.body as string) }
      return jsonResponse(messageResponse())
    })
    const result = await provider().search({ query: 'ark' })
    expect(captured?.url).toBe('https://ark.cn-beijing.volces.com/api/v3/responses')
    expect(captured?.body).toMatchObject({
      model: 'ark-endpoint',
      stream: false,
      tools: [{ type: 'web_search' }],
    })
    expect(result.content).toBe('Here is the answer.')
    expect(result.sources.length).toBe(2)
  })

  it('sends the configured sources, max_keyword, and limit', async () => {
    let body: unknown
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string)
      return jsonResponse({ output: [] })
    })
    await provider({ sources: ['toutiao', 'douyin'], maxKeyword: 5, limit: 3 }).search({ query: 'x' })
    expect(body).toMatchObject({
      tools: [{ type: 'web_search', sources: ['toutiao', 'douyin'], max_keyword: 5, limit: 3 }],
    })
  })

  it('uses the bearer authorization header', async () => {
    let auth: string | undefined = ''
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).authorization
      return jsonResponse({ output: [] })
    })
    await provider().search({ query: 'x' })
    expect(auth).toBe('Bearer ark-key')
  })

  it('sends the package version as User-Agent', async () => {
    const { version } = createRequire(import.meta.url)('../package.json') as { version: string }
    let agent: string | undefined
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      agent = (init.headers as Record<string, string>)['user-agent']
      return jsonResponse({ output: [] })
    })
    await provider().search({ query: 'x' })
    expect(agent).toBe(`deepseek-harness/${version}`)
  })


  it('throws WEB_PROVIDER_ERROR on a non-2xx response with the detail message', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 }))
    await expect(provider().search({ query: 'x' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'quota exceeded',
    })
  })

  it('throws WEB_PROVIDER_CREDENTIAL_MISSING without a key', async () => {
    const p = new ArkSearchProvider(() => ({
      baseURL: options.baseURL,
      model: options.model,
      maxKeyword: 10,
      limit: 10,
      maxToolCalls: 3,
      resolveApiKey: async () => undefined,
      apiKeyEnv: credentialRef('ARK_TEST_KEY'),
    }))
    await expect(p.search({ query: 'x' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('reports the default credential reference when no resolver or reference is configured', async () => {
    const p = new ArkSearchProvider(() => ({
      baseURL: options.baseURL,
      model: options.model,
      maxKeyword: 10,
      limit: 10,
      maxToolCalls: 3,
    }))
    await expect(p.search({ query: 'x' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
      message: /no API key for "ARK_API_KEY"/,
    })
  })

  it('honors caller cancellation with WEB_ABORTED', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', async () => {
      controller.abort('cancel')
      throw Object.assign(new DOMException('aborted', 'AbortError'))
    })
    await expect(provider().search({ query: 'x' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('records and posts the exact web_search Response before dispatch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(messageResponse()))
    const recordRequest = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await provider({ recordRequest }).search({ query: 'hello' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/responses')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    const body = JSON.parse(init.body as string) as { model: string; input: unknown[]; tools: unknown[] }
    expect(body.model).toBe('ark-endpoint')
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Perform a web search for the query: hello' }] }])
    expect(body.tools).toEqual([{ type: 'web_search' }])
    expect(recordRequest).toHaveBeenCalledOnce()
    expect(recordRequest).toHaveBeenCalledWith({ endpoint: url, body })
    expect(recordRequest.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0] ?? 0)
  })

  it('forwards the abort signal to fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ output: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await provider().search({ query: 'x' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })

  it('does not start credential resolution or dispatch for a pre-aborted call', async () => {
    const resolveApiKey = vi.fn(async () => 'late-key')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort(new Error('caller stopped'))
    await expect(provider({ apiKey: '', resolveApiKey }).search({ query: 'x' }, controller.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts while an uncooperative credential resolver remains pending', async () => {
    const resolveApiKey = vi.fn(() => new Promise<string>(() => {}))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const search = provider({ apiKey: '', resolveApiKey }).search({ query: 'x' }, controller.signal)
    controller.abort(new Error('deadline'))
    await expect(search).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(resolveApiKey).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves credentials under an active cancellation signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ output: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await expect(provider({ apiKey: '', resolveApiKey: async () => 'resolved-key' }).search({ query: 'x' }, controller.signal))
      .resolves.toMatchObject({ truncated: false })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer resolved-key')
  })

  it('maps a credential resolver rejection under an active signal to WEB_PROVIDER_ERROR', async () => {
    const controller = new AbortController()
    await expect(provider({
      apiKey: '',
      resolveApiKey: () => Promise.reject(new Error('credential backend failed')),
    }).search({ query: 'x' }, controller.signal))
      .rejects.toMatchObject({
        code: 'WEB_PROVIDER_ERROR',
        message: 'Ark search credential resolution failed: Error: credential backend failed',
      })
  })

  it('observes cancellation triggered synchronously by credential resolution', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(provider({
      apiKey: '',
      resolveApiKey: () => {
        controller.abort(new Error('resolver cancelled caller'))
        return Promise.resolve('unused-key')
      },
    }).search({ query: 'x' }, controller.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws WEB_PROVIDER_ERROR with the parsed detail on a string error form', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'tf quota exceeded' }), { status: 429 }))
    await expect(provider().search({ query: 'x' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'tf quota exceeded',
    })
  })

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>oops</html>', { status: 502 }))
    await expect(provider().search({ query: 'x' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Ark API error (HTTP 502)',
    })
  })

  it('throws WEB_PROVIDER_ERROR on an unprocessable success body', async () => {
    vi.stubGlobal('fetch', async () => new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(provider().search({ query: 'x' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('throws WEB_PROVIDER_ERROR on a redirect before contacting the target', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 302, headers: { location: 'https://evil.test' } }))
    await expect(provider().search({ query: 'x' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('answers with a resolved key instead of a literal when the literal is empty', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(messageResponse()))
    vi.stubGlobal('fetch', fetchMock)
    await provider({ apiKey: '', resolveApiKey: async () => 'env-key' }).search({ query: 'x' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer env-key')
  })

  it('maps a custom abort reason to WEB_ABORTED', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new Error('custom abort reason')) }, { once: true })
      })))
    const search = provider().search({ query: 'x' }, controller.signal)
    controller.abort(new Error('timeout reason'))
    await expect(search).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(provider().search({ query: 'x' })).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(provider().search({ query: 'x' })).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(provider().search({ query: 'x' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Ark search request failed: TypeError: connection refused',
    })
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(provider().search({ query: 'x' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Ark API error (HTTP 500)',
    })
  })
})
