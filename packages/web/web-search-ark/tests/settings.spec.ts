/** The `web-search-ark` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as arkPlugin from '@deepseek-ai/dsh-web-search-ark'
import { WEB_SEARCH_ARK_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-web-search-ark'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** The smallest Ark-shaped answer the provider accepts — enough to observe the request. */
const ONE_RESULT = {
  output: [
    {
      type: 'message',
      content: [{
        type: 'text',
        text: 'ok',
        annotations: [{ type: 'url_citation', url: 'https://a.test', title: 'A' }],
      }],
    },
  ],
}

async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, {})
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(arkPlugin, { apiKey: 'ark-key', model: 'ark-model' })
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Run one search and answer the endpoint it reached. A fresh `Response` per
 * call because a body can only be read once, and the call history is cleared
 * because repeated `spyOn` returns the same spy.
 * @param ctx - context whose `ctx.web` serves the search.
 * @returns the URL the provider fetched.
 */
async function searchOnce(ctx: Context): Promise<string> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))
  fetchSpy.mockClear()
  await ctx.web.search({ query: 'anything' })
  return String((fetchSpy.mock.calls.at(-1)?.[0] as URL | string | undefined) ?? '')
}

describe('web-search-ark settings section', () => {
  it('registers the ark-official provider and answers searches', async () => {
    const bench = await boot()
    const url = await searchOnce(bench.ctx)
    expect(url).toContain('https://ark.cn-beijing.volces.com/api/v3/responses')
    expect(bench.ctx.web).toBeDefined()
    bench.settingsFiber.dispose()
    bench.pluginFiber.dispose()
  })

  it('serves a stored endpoint to the next search without re-registering the provider', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SEARCH_ARK_SETTINGS_NAMESPACE, {
      baseURL: 'https://plan.test/api/v3',
      model: 'ark-endpoint',
    })
    expect(await searchOnce(bench.ctx)).toContain('https://plan.test/api/v3/responses')
    bench.settingsFiber.dispose()
    bench.pluginFiber.dispose()
  })

  it('resolves a named credential through the credentials seam and sends it as the bearer key', async () => {
    const prev = process.env.ARK_API_KEY
    delete process.env.ARK_API_KEY
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ark-search-credentials-'))
    const fetchMock = vi.fn(async () => jsonResponse(ONE_RESULT))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: 'ark-official' })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(arkPlugin, { apiKeyEnv: 'ARK_TEST_KEY', model: 'ark-model' })
      await expect(ctx.web.search({ query: 'missing' }))
        .rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
      await ctx.credentials.set(credentialRef('ARK_TEST_KEY'), 'stored-key')
      await ctx.web.search({ query: 'stored' })
      const [, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer stored-key')
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (prev === undefined) delete process.env.ARK_API_KEY
      else process.env.ARK_API_KEY = prev
    }
  })

  it('falls back to the process environment when no credentials seam is mounted', async () => {
    const prev = process.env.ARK_API_KEY
    process.env.ARK_API_KEY = 'env-key'
    const fetchMock = vi.fn(async () => jsonResponse(ONE_RESULT))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: 'ark-official' })
      await ctx.plugin(arkPlugin, { model: 'ark-model' })
      await ctx.web.search({ query: 'env' })
      const [, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer env-key')
    } finally {
      await ctx.fiber.dispose()
      if (prev === undefined) delete process.env.ARK_API_KEY
      else process.env.ARK_API_KEY = prev
    }
  })

  it('passes configured sources and limits through to the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(ONE_RESULT))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: 'ark-official' })
    await ctx.plugin(arkPlugin, { apiKey: 'ark-key', model: 'ark-model', sources: ['toutiao', 'moji'], maxKeyword: 5, limit: 3 })
    await ctx.web.search({ query: 'src' })
    const [, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { tools: unknown[] }
    expect(body.tools).toEqual([{ type: 'web_search', sources: ['toutiao', 'moji'], max_keyword: 5, limit: 3 }])
    await ctx.fiber.dispose()
  })

  it('reports an actionable credential error when no key, credentials, or env is present', async () => {
    const prev = process.env.ARK_API_KEY
    delete process.env.ARK_API_KEY
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: 'ark-official' })
      await ctx.plugin(arkPlugin, { model: 'ark-model' })
      let caught: unknown
      try {
        await ctx.web.search({ query: 'q' })
      } catch (error: unknown) {
        caught = error
      }
      expect(caught).toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
      if (!(caught instanceof Error)) throw new Error('search did not throw an Error')
      expect(caught.message).toMatch(/store it through the credentials service.*Models page/s)
    } finally {
      await ctx.fiber.dispose()
      if (prev === undefined) delete process.env.ARK_API_KEY
      else process.env.ARK_API_KEY = prev
    }
  })
})
