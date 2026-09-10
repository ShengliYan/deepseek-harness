/**
 * Session-version pager for the conversation header: a `‹ 2/2 ›` control
 * over the fork lineage. Every rewind creates a child session seeded with the
 * completed turns before the anchor, so "versions" of one conversation are
 * the lineage-connected sessions: the pager walks `parentId` for the chain
 * depth and counts the lineage component for the total. Left opens the direct
 * parent; right opens the most recently updated direct child (a multi-child
 * point picks the newest — siblings stay reachable through the sidebar).
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SessionVersionPager.module.css'

/** One resolved version pager state. */
export interface VersionPagerState {
  /** 1-based depth of the current session in its ancestor chain. */
  index: number
  /** Sessions sharing the current lineage root (ancestors plus descendants). */
  total: number
  /** Direct parent version; undefined at the root. */
  prev: SessionId | undefined
  /** Most recently updated direct child version; undefined without one. */
  next: SessionId | undefined
}

/** Business actions supplied by the slot registration. */
export interface SessionVersionPagerInjected {
  open: (sessionId: SessionId) => void
}

/** Full props for the header version pager. */
export type SessionVersionPagerProps =
  PropsRuntime<'conversation.session.header.actions'> & SessionVersionPagerInjected & PropsLocale<'conversation'>

/** Root of one session's lineage, cycle-guarded. */
function lineageRoot(list: SessionListState, id: SessionId): SessionId {
  const seen = new Set<SessionId>()
  let cursor: SessionId = id
  while (!seen.has(cursor)) {
    seen.add(cursor)
    const parentId: SessionId | undefined = list.byId[cursor]?.parentId
    if (parentId === undefined) return cursor
    cursor = parentId
  }
  return id
}

/**
 * Derive the pager from the live session list. Versions are COMMITTED
 * lineage members: a blank member is a pending rewind draft whose user has
 * not resubmitted yet, so it counts for nobody — the source keeps reading
 * 1/1 and only flips to 1/2 once the draft's first turn lands. Chain depth
 * through `parentId` (oldest first, cycle-terminating) gives the 1-based
 * index among committed members, the committed lineage-component size is the
 * total, the nearest committed ancestor is previous, and the newest
 * committed direct child is next. A blank current session renders nothing.
 * @param list - the session list snapshot.
 * @param id - the current session.
 * @returns the resolved pager; single-version and draft states report 1/1
 *   with no arrows.
 */
export function deriveVersionPager(list: SessionListState, id: SessionId): VersionPagerState {
  if (list.byId[id]?.blank === true) {
    return { index: 1, total: 1, prev: undefined, next: undefined }
  }
  const chain: SessionId[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    chain.unshift(cursor)
    cursor = list.byId[cursor]?.parentId
  }
  if (chain.length === 0) return { index: 1, total: 1, prev: undefined, next: undefined }
  const root = chain[0] as SessionId
  const rows = Object.values(list.byId)
  const committed = rows.filter(row => lineageRoot(list, row.id) === root && !row.blank)
  const committedIds = new Set(committed.map(row => row.id))
  const chainCommitted = chain.filter(member => committedIds.has(member))
  const total = committed.length
  const index = Math.max(1, chainCommitted.length)
  const prev = chainCommitted.at(-2)
  const children = committed.filter(row => row.parentId === id)
  const newest = children.reduce<typeof children[number] | undefined>((best, row) =>
    best === undefined || row.updatedAt > best.updatedAt ? row : best, undefined)
  return { index, total: Math.max(total, index), prev, next: newest?.id }
}

/**
 * Render the version pager; nothing while the session is its lineage's only
 * member.
 * @param props - runtime kit, the injected open callback, and the locale seat.
 * @returns the `‹ n/m ›` control, or null for a single-version session.
 */
export function SessionVersionPager({
  sessionId, useSessions, open, t,
}: SessionVersionPagerProps) {
  const pager = useSessions(s => deriveVersionPager(s, sessionId))
  if (pager.total <= 1) return null
  return (
    <div className={css.pager} data-session-versions>
      <Tooltip label={t('versions.previous')} side="bottom">
        <button
          type="button"
          className={css.arrow}
          aria-label={t('versions.previous')}
          disabled={pager.prev === undefined}
          onClick={() => { if (pager.prev !== undefined) open(pager.prev) }}
        >
          <IconChevronLeftOutline14 />
        </button>
      </Tooltip>
      <span className={css.counter}>{pager.index}/{pager.total}</span>
      <Tooltip label={t('versions.next')} side="bottom">
        <button
          type="button"
          className={css.arrow}
          aria-label={t('versions.next')}
          disabled={pager.next === undefined}
          onClick={() => { if (pager.next !== undefined) open(pager.next) }}
        >
          <IconChevronRightOutline14 />
        </button>
      </Tooltip>
    </div>
  )
}
