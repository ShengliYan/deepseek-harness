#!/usr/bin/env node
/**
 * Generate the update feed (dist/latest.json) after a dist build. Reads the
 * version from build/app-version (Sydney clock stamped by stage-runtime)
 * and the build fingerprint from build/build-id, picks the zip for `--arch`
 * (or the host arch) that electron-builder produced, and hashes it.
 *
 * The zip url is written RELATIVE to the feed (bare file name), so the same
 * feed works for:
 *   - the local dev loop: app runs from ~/Applications and polls
 *     dist/latest.json via file:// (build/update-config.json feedUrl)
 *   - https hosting: upload latest.json + zip + blockmap together and set
 *     build/update-config.json zipBaseUrl to an https:// prefix.
 *
 * Usage:
 *   node scripts/make-update-feed.mjs [--arch arm64|x64] [--notes "修复了xx问题"]
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findMacZip, resolveMacArch } from './dist-layout.mjs'
import { formatAppVersion } from './app-version.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const macosAppDir = join(scriptDir, '..')
const distDir = join(macosAppDir, 'dist')

function fail(message) {
  console.error(`make-update-feed: ${message}`)
  process.exit(1)
}

const versionFile = join(macosAppDir, 'build', 'app-version')
if (!existsSync(versionFile)) fail('build/app-version 缺失；请通过 dist:mac 完整构建（stage-runtime 会生成它）')
const version = readFileSync(versionFile, 'utf8').trim()
const buildIdFile = join(macosAppDir, 'build', 'build-id')
if (!existsSync(buildIdFile)) fail('build/build-id 缺失；请通过 dist:mac 完整构建（stage-runtime 会生成它）')
const buildId = readFileSync(buildIdFile, 'utf8').trim()

const config = JSON.parse(readFileSync(join(macosAppDir, 'build', 'update-config.json'), 'utf8'))
const zipBaseRaw = typeof config.zipBaseUrl === 'string' ? config.zipBaseUrl.trim() : ''
if (zipBaseRaw !== '' && !zipBaseRaw.startsWith('https://')) {
  fail('zipBaseUrl must be https:// (the updater rejects http); omit it for a relative local feed')
}
const zipBaseUrl = zipBaseRaw === '' ? null : (zipBaseRaw.endsWith('/') ? zipBaseRaw : `${zipBaseRaw}/`)

const notesIndex = process.argv.indexOf('--notes')
const notes = notesIndex >= 0 ? (process.argv[notesIndex + 1] ?? '') : ''

const arch = resolveMacArch()
if (!process.argv.slice(2).includes('--arch')) {
  const other = arch === 'arm64' ? 'x64' : 'arm64'
  if (findMacZip(distDir, version, other) !== null) {
    fail(`dist 里同时有 arm64 与 x64 zip；请传入 --arch ${arch}（或刚构建的那一侧）`)
  }
}
const zipName = findMacZip(distDir, version, arch)
if (zipName === null) fail(`找不到构建产物 ${join(distDir, `DeepSeek Harness-${version}-${arch}-mac.zip`)}；请先执行 dist:mac`)
const zipPath = join(distDir, zipName)

const hash = await new Promise((resolve, reject) => {
  const digest = createHash('sha256')
  const stream = createReadStream(zipPath)
  stream.on('data', chunk => digest.update(chunk))
  stream.on('end', () => resolve(digest.digest('hex')))
  stream.on('error', reject)
})
const size = statSync(zipPath).size

const feed = {
  version,
  buildId,
  url: zipBaseUrl ? zipBaseUrl + encodeURIComponent(basename(zipPath)) : encodeURIComponent(basename(zipName)),
  sha256: hash,
  size,
  notes,
  date: new Date().toISOString(),
}
const feedPath = join(distDir, 'latest.json')
writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`)
console.log(`make-update-feed: ${feedPath}`)
console.log(`  version ${version} (${formatAppVersion(version)} Sydney)  buildId ${buildId}  size ${(size / 1048576).toFixed(1)}MB  sha256 ${hash.slice(0, 12)}…`)
if (zipBaseUrl) {
  console.log('上传以下文件到 zipBaseUrl 指向的目录后，老版本 app 即可检测到更新：')
} else {
  console.log('本地更新模式：运行中的 app 通过 feedUrl(file://) 轮询本目录；如需 https 分发请配置 zipBaseUrl。')
}
for (const file of ['latest.json', zipName, `${zipName}.blockmap`]) {
  console.log(`  ${join(distDir, file)}`)
}
