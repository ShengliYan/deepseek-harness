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
import { deriveVersionPager } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './QuestionVersionSwitch.module.css'

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
