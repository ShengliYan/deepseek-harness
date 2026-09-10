/**
 * Dist-time app version: Australia/Sydney calendar date + hour:minute,
 * encoded as `YYYY.MM.DD.HHmm` so electron-builder, Info.plist, and the
 * updater's numeric compare all carry a clock you can read.
 */
const SYDNEY = 'Australia/Sydney'

/** @param {Date} [date] */
export function sydneyAppVersion(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYDNEY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = type => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}.${get('month')}.${get('day')}.${get('hour')}${get('minute')}`
}

/** `2026.08.18.0012` → `2026-08-18 00:12` for dialogs; other strings pass through. */
export function formatAppVersion(version) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(version))
  if (match === null) return String(version)
  return `${match[1]}-${match[2]}-${match[3]} ${match[4].slice(0, 2)}:${match[4].slice(2)}`
}
