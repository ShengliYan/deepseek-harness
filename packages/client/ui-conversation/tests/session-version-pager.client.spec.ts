/** Session-version pager derivation over fork lineage. */

import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { deriveVersionPager } from '../src/client/skeleton/SessionVersionPager.tsx'

const id = (value: string): SessionId => value as SessionId

const summary = (sessionId: string, updatedAt: number, parentId?: string): SessionSummary => ({
  id: id(sessionId),
  displayTitle: sessionId,
  running: false,
  blank: false,
  updatedAt,
  ...(parentId !== undefined ? { parentId: id(parentId) } : {}),
})

const state = (rows: readonly SessionSummary[]): SessionListState => {
  const byId: Record<SessionId, SessionSummary> = {}
  for (const row of rows) byId[row.id] = row
  return {
    ids: rows.map(row => row.id),
    byId,
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

describe('deriveVersionPager', () => {
  it('reports 1/1 with no arrows for a root-only session', () => {
    const pager = deriveVersionPager(state([summary('root', 1)]), id('root'))
    expect(pager).toEqual({ index: 1, total: 1, prev: undefined, next: undefined })
  })

  it('reports 2/2 on the newest version with prev pointing at the source', () => {
    const pager = deriveVersionPager(state([
      summary('v1', 1),
      summary('v2', 2, 'v1'),
    ]), id('v2'))
    expect(pager).toEqual({ index: 2, total: 2, prev: id('v1'), next: undefined })
  })

  it('reports 1/2 on the source with next pointing at the newest child', () => {
    const pager = deriveVersionPager(state([
      summary('v1', 1),
      summary('v2', 2, 'v1'),
    ]), id('v1'))
    expect(pager).toEqual({ index: 1, total: 2, prev: undefined, next: id('v2') })
  })

  it('picks the most recently updated child for next among siblings', () => {
    const pager = deriveVersionPager(state([
      summary('v1', 1),
      summary('v2a', 2, 'v1'),
      summary('v2b', 3, 'v1'),
    ]), id('v1'))
    expect(pager.next).toBe(id('v2b'))
    expect(pager.total).toBe(3)
  })

  it('terminates on a parentId cycle without throwing', () => {
    // A cycle splits each member into its own degenerate lineage; the pager
    // must degrade to a finite 1-based report, never loop.
    const pager = deriveVersionPager(state([
      summary('a', 1, 'b'),
      summary('b', 2, 'a'),
    ]), id('a'))
    expect(pager.index).toBeGreaterThanOrEqual(1)
    expect(pager.total).toBeGreaterThanOrEqual(1)
  })

  it('a blank rewind draft counts for nobody: the source keeps 1/1', () => {
    const draft = { ...summary('draft', 3, 'v1'), blank: true }
    const pager = deriveVersionPager(state([
      summary('v1', 1),
      draft,
    ]), id('v1'))
    expect(pager).toEqual({ index: 1, total: 1, prev: undefined, next: undefined })
  })

  it('the blank draft itself renders nothing until its first turn lands', () => {
    const draft = { ...summary('draft', 3, 'v1'), blank: true }
    const pager = deriveVersionPager(state([
      summary('v1', 1),
      draft,
    ]), id('draft'))
    expect(pager).toEqual({ index: 1, total: 1, prev: undefined, next: undefined })
  })

  it('a blank child is skipped for next; the newest committed child wins', () => {
    const blank = { ...summary('blank', 4, 'v1'), blank: true }
    const pager = deriveVersionPager(state([
      summary('v1', 1),
      summary('v2', 2, 'v1'),
      blank,
    ]), id('v1'))
    expect(pager.total).toBe(2)
    expect(pager.next).toBe(id('v2'))
  })
})
