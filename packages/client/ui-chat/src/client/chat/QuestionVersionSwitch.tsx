/**
 * Per-question version switch: a compact `‹ n/m ›` in the user bubble's
 * action row over the same fork lineage the header pager reads. Arrows open
 * the neighbouring version and jump to this question's turn, so the reader
 * compares the answers each version produced under the same question. Turn
 * numbers are shared across versions (every child seeds the source prefix),
 * which is what makes the cross-session jump land on the same question.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import css from './QuestionVersionSwitch.module.css'

/** Chat-local copy of the header pager projection; owners stay independent. */
interface VersionPagerState {
  index: number
  total: number
  prev: SessionId | undefined
  next: SessionId | undefined
}

/* jscpd:ignore-start -- Chat bubble pager; Conversation header owns the other copy. */
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

function deriveVersionPager(list: SessionListState, id: SessionId): VersionPagerState {
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
/* jscpd:ignore-end */

/** Full props: the runtime kit, the version-jump callback, and the locale seat. */
export type QuestionVersionSwitchProps = {
  sessionId: SessionId
  /** The question's turn number; the target version shares it. */
  turn: number
  useSessions: SnapshotSelectorHook<SessionListState>
  openVersion: (target: SessionId, turn: number) => void
  t: PropsLocale<'chat'>['t']
}

/**
 * Render the per-question version switch; nothing while the session has a
 * single committed version.
 * @param props - session kit, jump callback, and translator.
 * @returns the `‹ n/m ›` control, or null for single-version questions.
 */
export function QuestionVersionSwitch({
  sessionId, turn, useSessions, openVersion, t,
}: QuestionVersionSwitchProps) {
  const pager = useSessions(s => deriveVersionPager(s, sessionId))
  if (pager.total <= 1) return null
  return (
    <span className={css.root} data-question-versions>
      <Tooltip label={t('versions.previous')} side="bottom">
        <button
          type="button"
          className={css.arrow}
          aria-label={t('versions.previous')}
          disabled={pager.prev === undefined}
          onClick={() => { if (pager.prev !== undefined) openVersion(pager.prev, turn) }}
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
          onClick={() => { if (pager.next !== undefined) openVersion(pager.next, turn) }}
        >
          <IconChevronRightOutline14 />
        </button>
      </Tooltip>
    </span>
  )
}
