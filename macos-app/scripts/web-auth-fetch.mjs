/**
 * Fetch the authenticated dsh web index: GET `/?token=…` exchanges the
 * process launch token for a cookie and 303s to `/`. Smoke and verify
 * must follow that exchange; a bare GET `/` is 401 after browser-token
 * authentication landed in 0.1.2.
 */
import http from 'node:http'

/** @param {string} output @param {number} port */
export function parseWebLaunchUrl(output, port) {
  const match = output.match(new RegExp(
    String.raw`dsh web: (http://127\.0\.0\.1:${String(port)}/\?token=[A-Za-z0-9_-]+)`,
  ))
  return match?.[1] ?? null
}

function cookieHeader(setCookie) {
  const list = setCookie == null ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  return list.map(entry => String(entry).split(';')[0].trim()).filter(Boolean).join('; ')
}

function request(port, path, headers = {}) {
  return new Promise(resolvePromise => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 1500, headers }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolvePromise({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        location: res.headers.location,
        cookie: cookieHeader(res.headers['set-cookie']),
        body,
      }))
    })
    req.on('error', () => resolvePromise({ ok: false, status: 0, location: undefined, cookie: '', body: '' }))
    req.on('timeout', () => {
      req.destroy()
      resolvePromise({ ok: false, status: 0, location: undefined, cookie: '', body: '' })
    })
  })
}

/**
 * Exchange the launch-token URL for the index body.
 * @param {number} port
 * @param {string} launchUrl
 */
export async function fetchAuthenticatedIndex(port, launchUrl) {
  const url = new URL(launchUrl)
  const first = await request(port, `${url.pathname}${url.search}`)
  if (first.status === 303 && first.location !== undefined) {
    const location = first.location.startsWith('http')
      ? new URL(first.location).pathname
      : first.location
    const headers = first.cookie !== '' ? { cookie: first.cookie } : {}
    return request(port, location, headers)
  }
  return first
}

/** Index HTML is ready when the connection plugin is in a stable boot graph. */
export function indexLooksReady(body, lastRev) {
  const rev = body.match(
    /(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\]) = \{[^<]*"rev":"([^"]+)"/,
  )?.[1] ?? null
  const connected = body.includes('dsh-client-connection')
  return {
    ready: connected && rev !== null && rev === lastRev,
    rev,
  }
}
