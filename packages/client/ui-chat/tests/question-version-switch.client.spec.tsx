// @vitest-environment jsdom
/** Per-question version switch rendering and jump routing. */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { QuestionVersionSwitch } from '../src/client/chat/QuestionVersionSwitch.tsx'

const id = (value: string): SessionId => value as SessionId

const summary = (sessionId: string, updatedAt: number, parentId?: string): SessionSummary => ({
  id: id(sessionId),
  displayTitle: sessionId,
  running: false,
  blank: false,
  updatedAt,
  ...(parentId !== undefined ? { parentId: id(parentId) } : {}),
})

const listState = (rows: readonly SessionSummary[]): SessionListState => {
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

function renderSwitch(state: SessionListState, sessionId: SessionId, turn: number) {
  const openVersion = vi.fn<(target: SessionId, turn: number) => void>()
  const useSessions: SnapshotSelectorHook<SessionListState> = selector => selector(state)
  const view = render(
    <QuestionVersionSwitch
      sessionId={sessionId}
      turn={turn}
      useSessions={useSessions}
      openVersion={openVersion}
      t={makeTranslate(zh, commonZh)}
    />,
  )
  return { view, openVersion }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('QuestionVersionSwitch', () => {
  it('renders nothing for a single committed version', () => {
    const { view } = renderSwitch(listState([summary('v1', 1)]), id('v1'), 3)
    expect(view.container.textContent).toBe('')
  })

  it('renders n/m and routes the arrows to the neighbouring version with the shared turn', () => {
    const { view, openVersion } = renderSwitch(listState([
      summary('v1', 1),
      summary('v2', 2, 'v1'),
    ]), id('v2'), 3)
    expect(view.getByText('2/2')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '上一个版本' }))
    expect(openVersion).toHaveBeenCalledWith(id('v1'), 3)
  })

  it('hides while the current session is a blank rewind draft', () => {
    const draft = { ...summary('draft', 3, 'v1'), blank: true }
    const { view } = renderSwitch(listState([
      summary('v1', 1),
      draft,
    ]), id('draft'), 3)
    expect(view.container.textContent).toBe('')
  })
})
