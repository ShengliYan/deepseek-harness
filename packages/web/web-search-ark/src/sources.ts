/**
 * The search-source channels Ark's `web_search` tool may be restricted to.
 * @module @deepseek-ai/dsh-web-search-ark/sources
 */

import type { ArkSearchSource } from './types.ts'

/** Every source channel, in the order Ark's docs list them. */
export const ARK_SEARCH_SOURCES = ['search_engine', 'toutiao', 'douyin', 'moji'] as const satisfies readonly ArkSearchSource[]
