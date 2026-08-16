/** Header ancestry breadcrumb derivation: fork lineage joins the subagent chain. */

import { describe, expect, it } from 'vitest'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { deriveAncestry } from '../src/client/skeleton/ConversationSession.tsx'

const id = (value: string): SessionId => value as SessionId

const summary = (sessionId: string, displayTitle: string, parentId?: string): SessionSummary => ({
  id: id(sessionId),
  displayTitle,
  running: false,
  blank: false,
  updatedAt: 0,
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
  } as SessionListState
}

describe('deriveAncestry', () => {
  it('shows a root session as its own single crumb', () => {
    const list = state([summary('root', 'Root title')])
    expect(deriveAncestry(list, id('root')).map(crumb => crumb.displayTitle)).toEqual(['Root title'])
  })

  it('shows a fork child with its source session as a clickable parent crumb', () => {
    const list = state([
      summary('source', 'Source title'),
      summary('child', 'Child title', 'source'),
    ])
    const crumbs = deriveAncestry(list, id('child'))
    expect(crumbs.map(crumb => [crumb.displayTitle, crumb.id])).toEqual([
      ['Source title', id('source')],
      ['Child title', id('child')],
    ])
  })

  it('walks multi-hop subagent lineage oldest first', () => {
    const list = state([
      summary('root', 'Root title'),
      summary('agent', 'Agent title', 'root'),
      summary('leaf', 'Leaf title', 'agent'),
    ])
    expect(deriveAncestry(list, id('leaf')).map(crumb => crumb.displayTitle)).toEqual([
      'Root title', 'Agent title', 'Leaf title',
    ])
  })

  it('degrades an orphaned parent to the single current crumb', () => {
    const list = state([summary('orphan', 'Orphan title', 'ghost')])
    expect(deriveAncestry(list, id('orphan')).map(crumb => crumb.displayTitle)).toEqual(['Orphan title'])
  })

  it('terminates on a parentId cycle', () => {
    const list = state([
      summary('a', 'A title', 'b'),
      summary('b', 'B title', 'a'),
    ])
    expect(deriveAncestry(list, id('a')).map(crumb => crumb.displayTitle)).toEqual(['B title', 'A title'])
  })
})
