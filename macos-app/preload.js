'use strict'
/**
 * Renderer-side update badge for the packaged app: a small fixed icon near
 * the bottom-left settings area that appears whenever a new build exists in
 * the watched feed, and triggers the in-app update flow on click. Runs in the
 * preload world (contextIsolation on): shares the DOM, isolated JS context,
 * and no API is exposed to page scripts.
 */
const { ipcRenderer } = require('electron')

const BADGE_ID = 'dsh-desktop-update-badge'

const CSS = [
  'position:fixed',
  'left:16px',
  'bottom:60px',
  'z-index:2147483647',
  'width:34px',
  'height:34px',
  'border-radius:50%',
  'display:flex',
  'align-items:center',
  'justify-content:center',
  'cursor:pointer',
  'background:#1f6feb',
  'color:#fff',
  'box-shadow:0 2px 10px rgba(31,111,235,.45)',
  'transition:transform .15s ease',
  'user-select:none',
].join(';')

const ICON =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round" stroke-linejoin="round" style="animation:dshspin 2.4s linear infinite">' +
  '<path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>'

const STYLE_KEYFRAMES = '@keyframes dshspin{to{transform:rotate(360deg)}}'

let state = { available: false, version: '', buildId: '', busy: false }

function titleText() {
  if (state.busy) return '正在准备更新 …'
  const label = state.version ? `新版本 v${state.version}` : '发现新版本'
  return `${label}（构建 ${String(state.buildId).slice(-6)}）\n点击重启并更新`
}

function ensureBadge() {
  const existing = document.getElementById(BADGE_ID)
  if (existing) return existing
  if (!document.body) return null
  const badge = document.createElement('div')
  badge.id = BADGE_ID
  badge.style.cssText = CSS
  badge.title = titleText()
  badge.innerHTML = ICON
  badge.addEventListener('click', () => {
    if (!state.busy) ipcRenderer.send('dsh-update-apply')
  })
  const style = document.createElement('style')
  style.textContent = STYLE_KEYFRAMES
  document.head.append(style)
  document.body.append(badge)
  return badge
}

function applyState() {
  const badge = ensureBadge()
  if (!badge) return
  badge.style.display = state.available || state.busy ? 'flex' : 'none'
  badge.title = titleText()
}

ipcRenderer.on('dsh-update-state', (_event, next) => {
  state = { ...state, ...next }
  applyState()
})

// The web UI is an SPA that may re-render after load; re-assert the badge.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => applyState())
}
setInterval(applyState, 3000)
applyState()
