#!/usr/bin/env node
/**
 * One-time setup for the local dev-update loop: copy the freshly built app
 * from dist/mac-arm64 to a stable install location (default ~/Applications).
 * From then on, rebuilding dist never disturbs the running instance; the
 * running app polls dist/latest.json and offers in-app updates instead.
 *
 * Usage: node scripts/install-app.mjs [--launch] [--dir <install dir>]
 * Env:    DSH_INSTALL_DIR overrides the install directory.
 *
 * If the installed copy is already running, quit it first (or just let the
 * update badge flow swap it once a new build exists).
 */
import { cpSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const macosAppDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = join(macosAppDir, 'dist', 'mac-arm64')

function fail(message) {
  console.error(`install-app: ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const launch = args.includes('--launch')
const dirIndex = args.indexOf('--dir')
const installDir = resolve(
  dirIndex >= 0 ? args[dirIndex + 1] : process.env.DSH_INSTALL_DIR ?? join(homedir(), 'Applications'),
)

const apps = existsSync(appRoot) ? readdirSync(appRoot).filter(entry => entry.endsWith('.app')) : []
if (apps.length !== 1) fail(`expected exactly one .app under ${appRoot}; run dist:mac:arm64 first`)
const builtApp = join(appRoot, apps[0])
const target = join(installDir, apps[0])

rmSync(target, { recursive: true, force: true })
cpSync(builtApp, target, { recursive: true })
console.log(`install-app: ${builtApp} -> ${target}`)

if (launch) {
  const opened = spawnSync('open', ['-n', target], { encoding: 'utf8' })
  if (opened.status !== 0) fail(`启动失败: ${opened.stderr}`)
  console.log('install-app: launched')
} else {
  console.log('install-app: 使用 `open` 启动它，或加 --launch 参数安装后直接启动。')
}
