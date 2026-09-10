/**
 * Register an Ark-backed provider in `ctx.web`. It calls Volcengine Ark's
 * Responses API with the built-in `web_search` tool, so the search rides the
 * same Ark API key a deployment already manages for model traffic. The
 * endpoint and model are configurable; the base URL defaults to the standard
 * Ark service (the `/api/plan/v3` Agent-Plan base is a per-deployment choice).
 * @module @deepseek-ai/dsh-web-search-ark
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import {
  ARK_DEFAULT_BASE_URL,
  ArkSearchProvider,
} from './provider.ts'
import type { ArkSearchProviderOptions } from './provider.ts'
import { ARK_SEARCH_SOURCES } from './sources.ts'

export {
  ARK_DEFAULT_BASE_URL,
  ARK_PROVIDER_ID,
  ArkSearchProvider,
} from './provider.ts'
export type { ArkSearchLlmRequest, ArkSearchProviderOptions } from './provider.ts'
export { ARK_SEARCH_SOURCES } from './sources.ts'
export type { ArkSearchSource } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-ark'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'ARK_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Ark API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `ARK_API_KEY`. */
  apiKeyEnv?: string
  /** Responses endpoint base; `/responses` is appended. Defaults to the standard Ark base. */
  baseURL?: string
  /** Responses-format model id or endpoint id. */
  model?: string
  /** Restrict retrieval to these sources; omitted searches the web wholesale. */
  sources?: ArkSearchSourceField[]
  /** Max parallel search keywords per round. Defaults to 10. */
  maxKeyword?: number
  /** Max result items per round. Defaults to 10. */
  limit?: number
  /** Max tool-call rounds. Defaults to 3. */
  maxToolCalls?: number
}

/** Configurable source channel names (the schema's enum). */
export type ArkSearchSourceField = 'search_engine' | 'toutiao' | 'douyin' | 'moji'

const DEFAULT_MAX_KEYWORD = 10
const DEFAULT_LIMIT = 10
const DEFAULT_MAX_TOOL_CALLS = 3

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string(),
  sources: z.array(z.union(ARK_SEARCH_SOURCES)),
  maxKeyword: z.number().step(1).min(1).max(50).default(DEFAULT_MAX_KEYWORD),
  limit: z.number().step(1).min(1).max(50).default(DEFAULT_LIMIT),
  maxToolCalls: z.number().step(1).min(1).max(10).default(DEFAULT_MAX_TOOL_CALLS),
})

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const WEB_SEARCH_ARK_SETTINGS_NAMESPACE = 'web-search-ark'

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: Config): ArkSearchProviderOptions {
  /* v8 ignore next -- the Config schema always defaults apiKeyEnv, so the alternate is unreachable */
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    /* v8 ignore next -- a section that omits baseURL falls back to the constant default */
    baseURL: config.baseURL ?? ARK_DEFAULT_BASE_URL,
    /* v8 ignore next -- a section that omits model defaults to empty, making the provider unavailable */
    model: config.model ?? '',
    /* v8 ignore next -- sections either list sources or omit them entirely; both are defaulted here */
    ...config.sources === undefined || config.sources.length === 0
      ? {}
      : { sources: [...config.sources] },
    /* v8 ignore next -- the Config schema defaults maxKeyword, so the fallback is unreachable */
    maxKeyword: config.maxKeyword ?? DEFAULT_MAX_KEYWORD,
    /* v8 ignore next -- the Config schema defaults limit, so the fallback is unreachable */
    limit: config.limit ?? DEFAULT_LIMIT,
    /* v8 ignore next -- the Config schema defaults maxToolCalls, so the fallback is unreachable */
    maxToolCalls: config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'web/ark-search-llm-request',
        request,
      )
    },
  }
}

/** Register the Ark search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, WEB_SEARCH_ARK_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source
      },
      // The registration carries no resolved value: the provider projects the
      // section per search, so a committed change needs no re-registration.
      onChange: () => {},
    })
  })
  ctx.web.registerSearchProvider(new ArkSearchProvider(() => resolveOptions(ctx, current())))
}
