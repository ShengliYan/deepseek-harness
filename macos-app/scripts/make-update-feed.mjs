#!/usr/bin/env node
/**
 * Generate the update feed (dist/latest.json) after a dist build. Reads the
 * version from package.json and the build fingerprint from build/build-id
 * (written by stage-runtime.mjs each run), picks the arm64 zip
 * electron-builder produced, and hashes it.
 *
 * The zip url is written RELATIVE to the feed (bare file name), so the same
 * feed works for:
 *   - the local dev loop: app runs from ~/Applications and polls
 *     dist/latest.json via file:// (build/update-config.json feedUrl)
 *   - http hosting: upload latest.json + zip + blockmap together and set
 *     build/update-config.json zipBaseUrl to prefix absolute URLs instead.
 *
 * Usage:
 *   node scripts/make-update-feed.mjs [--notes "修复了xx问题"]
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const macosAppDir = join(scriptDir, '..')
const distDir = join(macosAppDir, 'dist')

function fail(message) {
  console.error(`make-update-feed: ${message}`)
  process.exit(1)
}

const version = JSON.parse(readFileSync(join(macosAppDir, 'package.json'), 'utf8')).version
const buildIdFile = join(macosAppDir, 'build', 'build-id')
if (!existsSync(buildIdFile)) fail('build/build-id 缺失；请通过 dist:mac:arm64 完整构建（stage-runtime 会生成它）')
const buildId = readFileSync(buildIdFile, 'utf8').trim()

const config = JSON.parse(readFileSync(join(macosAppDir, 'build', 'update-config.json'), 'utf8'))
const zipBaseUrl = typeof config.zipBaseUrl === 'string' && /^https?:\/\//.test(config.zipBaseUrl) ? config.zipBaseUrl : null

const notesIndex = process.argv.indexOf('--notes')
const notes = notesIndex >= 0 ? (process.argv[notesIndex + 1] ?? '') : ''

const zipName = `DeepSeek Harness-${version}-arm64-mac.zip`
const zipPath = join(distDir, zipName)
if (!existsSync(zipPath)) fail(`找不到构建产物 ${zipPath}；请先执行 dist:mac:arm64`)

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
console.log(`  version ${version}  buildId ${buildId}  size ${(size / 1048576).toFixed(1)}MB  sha256 ${hash.slice(0, 12)}…`)
if (zipBaseUrl) {
  console.log('上传以下文件到 zipBaseUrl 指向的目录后，老版本 app 即可检测到更新：')
} else {
  console.log('本地更新模式：运行中的 app 通过 feedUrl(file://) 轮询本目录；如需 http 分发请配置 zipBaseUrl。')
}
for (const file of ['latest.json', zipName, `${zipName}.blockmap`]) {
  console.log(`  ${join(distDir, file)}`)
}
