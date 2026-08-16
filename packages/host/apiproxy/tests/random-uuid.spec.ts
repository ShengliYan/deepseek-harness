/** Wire-correlation ids must mint on insecure origins, where crypto.randomUUID is undefined. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { AbstractApiClient } from '../src/fetch/client.ts'
import { randomUuid } from '../src/fetch/random-uuid.ts'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * An origin without secure context: getRandomValues present, randomUUID absent
 * (the exact property set a plain-HTTP LAN/Tailnet page sees).
 */
function stubInsecureCrypto(): void {
  vi.stubGlobal('crypto', {
    getRandomValues: (array: Uint8Array): Uint8Array => {
      let state = 0x9e3779b9
      for (let index = 0; index < array.length; index += 1) {
        state = (state * 1664525 + 1013904223) >>> 0
        array[index] = state & 0xff
      }
      return array
    },
  })
}

/** Minimal carrier exposing the protected minter. */
class MintingClient extends AbstractApiClient {
  public id(): string {
    return this.mintRpcId()
  }

  protected doFetch(): Promise<Response> {
    return Promise.resolve(new Response())
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('randomUuid', () => {
  it('mints an RFC 4122 version 4 id on an insecure origin (no crypto.randomUUID)', () => {
    stubInsecureCrypto()
    expect(randomUuid()).toMatch(UUID_V4)
  })

  it('mints distinct ids across calls with the ambient crypto', () => {
    expect(new Set(Array.from({ length: 256 }, () => randomUuid())).size).toBe(256)
  })
})

describe('AbstractApiClient.mintRpcId', () => {
  it('mints on an insecure origin instead of throwing', () => {
    stubInsecureCrypto()
    expect(new MintingClient().id()).toMatch(UUID_V4)
  })
})
