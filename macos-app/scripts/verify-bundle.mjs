#!/usr/bin/env node
/**
 * Verify the built app bundle after electron-builder: the staged runtime must
 * be complete and self-contained before the artifacts ship. A failed or
 * interrupted build otherwise produces an app that crashes at first launch
 * with ERR_MODULE_NOT_FOUND.
 *
 * Checks:
 *   1. app.asar contains the Electron main, preload, and updater modules
 *   2. Resources/node/bin/node exists (the bundled runtime; without it the
 *      shell silently falls back to whatever Node the target Mac happens to
 *      have, or none)
 *   3. Resources/deepseek carries package.json + lib/bin.js
 *   4. every symlink under Resources/deepseek resolves to an existing path
 *      inside the bundle (no dangling links, no escapes into a checkout)
 *   5. optional smoke boot (--no-smoke to skip): the bundled Node boots the
 *      staged server with a throwaway DSH_HOME and serves the web index with
 *      a complete boot manifest
 */
import { listPackage } from '@electron/asar'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import http from 'node:http'

const macosAppDir = import.meta.dirname
const appRoot = join(macosAppDir, '..', 'dist', 'mac-arm64')
const args = new Set(process.argv.slice(2))
const smokePort = Number(process.env.DSH_SMOKE_PORT) || 3299

function fail(message) {
  console.error(`verify-bundle: ${message}`)
  process.exit(1)
}

const candidates = existsSync(appRoot)
  ? readdirSync(appRoot).filter(entry => entry.endsWith('.app'))
  : []
if (candidates.length !== 1) fail(`expected exactly one .app under ${appRoot}, found: ${candidates.join(', ') || 'none'}`)
const appBundle = join(appRoot, candidates[0])
const appAsar = join(appBundle, 'Contents', 'Resources', 'app.asar')
const deepseek = join(appBundle, 'Contents', 'Resources', 'deepseek')
const nodeBin = join(appBundle, 'Contents', 'Resources', 'node', 'bin', 'node')

if (!existsSync(appAsar)) fail(`app.asar missing: ${appAsar}`)
const asarFiles = new Set(listPackage(appAsar))
for (const required of ['/main.js', '/preload.js', '/updater.js', '/package.json']) {
  if (!asarFiles.has(required)) fail(`app.asar missing required module: ${required}`)
}
console.log('verify-bundle: Electron modules ok')

if (!existsSync(nodeBin)) fail(`bundled Node missing: ${nodeBin}`)
if (!existsSync(join(deepseek, 'package.json'))) fail(`staged package.json missing under ${deepseek}`)
if (!existsSync(join(deepseek, 'lib', 'bin.js'))) fail(`staged lib/bin.js missing under ${deepseek}`)
if (!existsSync(join(appBundle, 'Contents', 'Resources', 'build-id'))) {
  fail('Resources/build-id missing; build via the dist scripts (stage-runtime stamps it) or the update badge can never detect new builds')
}
console.log(`verify-bundle: app ${appBundle} (buildId ${readFileSync(join(appBundle, 'Contents', 'Resources', 'build-id'), 'utf8').trim()})`)

/** Symlinks under root without following them (pnpm's farm would cycle). */
function listSymlinks(root) {
  const links = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) links.push(full)
      else if (entry.isDirectory()) stack.push(full)
    }
  }
  return links
}

let dangling = 0
let escaping = 0
for (const link of listSymlinks(deepseek)) {
  let target
  try {
    target = realpathSync(link)
  } catch {
    dangling += 1
    continue
  }
  if (!target.startsWith(deepseek)) escaping += 1
}
if (dangling > 0 || escaping > 0) {
  fail(`${dangling} dangling and ${escaping} escaping symlinks under Resources/deepseek`)
}
console.log('verify-bundle: symlinks ok')

if (args.has('--no-smoke')) {
  console.log('verify-bundle: smoke skipped')
  process.exit(0)
}

function fetchIndex() {
  return new Promise(resolvePromise => {
    const request = http.get({ host: '127.0.0.1', port: smokePort, path: '/', timeout: 1500 }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolvePromise({ ok: res.statusCode >= 200 && res.statusCode < 300, body }))
    })
    request.on('error', () => resolvePromise({ ok: false, body: '' }))
    request.on('timeout', () => {
      request.destroy()
      resolvePromise({ ok: false, body: '' })
    })
  })
}

const home = mkdtempSync(join(tmpdir(), 'dsh-verify-'))
const server = spawn(nodeBin, ['lib/bin.js', 'web', '--port', String(smokePort)], {
  cwd: deepseek,
  detached: true,
  env: { ...process.env, DSH_PROFILE: 'web', DSH_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
server.stdout.on('data', chunk => { output += chunk })
server.stderr.on('data', chunk => { output += chunk })
const deadline = Date.now() + 90_000
let lastRev = null
try {
  for (;;) {
    if (Date.now() > deadline) {
      console.error(output.slice(-4000))
      fail('smoke boot timed out')
    }
    const { ok, body } = await fetchIndex()
    const rev = body.match(/window\.__DSH_BOOT__ = \{[^<]*"rev":"([^"]+)"/)?.[1] ?? null
    if (ok && body.includes('dsh-client-connection') && rev !== null && rev === lastRev) {
      console.log(`verify-bundle: smoke ok (bundled node, manifest rev ${rev})`)
      break
    }
    if (rev !== null) lastRev = rev
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
  }
} finally {
  try {
    process.kill(-server.pid, 'SIGKILL')
  } catch {
    // already gone
  }
  rmSync(home, { recursive: true, force: true })
}
