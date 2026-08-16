'use strict'
/**
 * Self-rolled auto-updater for the unsigned macOS app: fetch a version feed,
 * download + verify the packaged zip, pre-extract and validate the new bundle,
 * then hand off to a detached install script that swaps the .app once this
 * process has exited and relaunches it. No Apple code signing required.
 *
 * The feed (latest.json) is served from any static host:
 *   { "version": "0.2.0",
 *     "url": "https://host/DeepSeek%20Harness-0.2.0-arm64-mac.zip",
 *     "sha256": "<hex>", "size": 123, "notes": "optional changelog" }
 *
 * @module
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

/** Semver-ish compare; "1.10.0" > "1.9.9", "0.2.0-rc.1" < "0.2.0". */
function compareVersions(a, b) {
  const parse = value => {
    const [core = '', pre = ''] = String(value).split('-')
    return { core: core.split('.').map(part => Number.parseInt(part, 10) || 0), pre }
  }
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i += 1) {
    const delta = (left.core[i] ?? 0) - (right.core[i] ?? 0)
    if (delta !== 0) return delta
  }
  if (left.pre === right.pre) return 0
  if (left.pre === '') return 1 // release outranks its prereleases
  if (right.pre === '') return -1
  return left.pre < right.pre ? -1 : 1
}

/** GET a URL following up to 5 redirects; file:// reads from disk. Resolves the body as a string. */
function fetchText(url, redirects = 5) {
  if (url.startsWith('file://')) {
    const file = decodeURIComponent(new URL(url).pathname)
    return Promise.resolve(fs.readFileSync(file, 'utf8'))
  }
  if (url.startsWith('/')) return Promise.resolve(fs.readFileSync(url, 'utf8'))
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const request = client.get(url, { timeout: 15_000, headers: { 'user-agent': 'dsh-macos-updater' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        if (redirects <= 0) return reject(new Error('too many redirects'))
        return resolve(fetchText(new URL(response.headers.location, url).href, redirects - 1))
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume()
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`))
      }
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve(body))
      response.on('error', reject)
    })
    request.on('timeout', () => {
      request.destroy()
      reject(new Error(`timeout fetching ${url}`))
    })
    request.on('error', reject)
  })
}

async function fetchJson(url) {
  const body = await fetchText(url)
  const feed = JSON.parse(body)
  if (typeof feed.version !== 'string' || typeof feed.url !== 'string') {
    throw new Error('update feed missing version/url fields')
  }
  // Relative zip URLs resolve against the feed's own directory, so the same
  // feed works for http hosting and a local dist/ directory.
  feed.resolvedUrl = resolveFeedUrl(feed.url, url)
  return feed
}

/** Resolve a possibly-relative feed url against its feed source. */
function resolveFeedUrl(url, baseUrl) {
  if (/^https?:\/\//.test(url) || url.startsWith('file://') || url.startsWith('/')) return url
  if (baseUrl.startsWith('file://') || baseUrl.startsWith('/')) {
    const dir = baseUrl.startsWith('/') ? path.dirname(baseUrl) : path.dirname(decodeURIComponent(new URL(baseUrl).pathname))
    return path.join(dir, decodeURIComponent(url))
  }
  return new URL(url, baseUrl).href
}

/** Streaming download with progress (http/https or local file); resolves { file, bytes }. */
function downloadFile(url, destPath, onProgress) {
  if (url.startsWith('file://')) url = decodeURIComponent(new URL(url).pathname)
  if (url.startsWith('/')) {
    return new Promise((resolve, reject) => {
      const total = fs.statSync(url).size
      let received = 0
      const read = fs.createReadStream(url)
      const write = fs.createWriteStream(destPath)
      read.on('data', chunk => {
        received += chunk.length
        if (onProgress) onProgress(received, total)
      })
      read.pipe(write)
      write.on('finish', () => write.close(error => (error ? reject(error) : resolve({ file: destPath, bytes: received }))))
      read.on('error', reject)
      write.on('error', reject)
    })
  }
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const request = client.get(url, { timeout: 60_000, headers: { 'user-agent': 'dsh-macos-updater' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        return resolve(downloadFile(new URL(response.headers.location, url).href, destPath, onProgress))
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume()
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`))
      }
      const total = Number(response.headers['content-length']) || 0
      let received = 0
      const stream = fs.createWriteStream(destPath)
      response.on('data', chunk => {
        received += chunk.length
        if (onProgress) onProgress(received, total)
      })
      response.pipe(stream)
      stream.on('finish', () => stream.close(error => (error ? reject(error) : resolve({ file: destPath, bytes: received }))))
      stream.on('error', reject)
      response.on('error', reject)
    })
    request.on('timeout', () => {
      request.destroy()
      reject(new Error(`timeout downloading ${url}`))
    })
    request.on('error', reject)
  })
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/** The running .app bundle directory for an Electron main executable path. */
function appBundlePath(execPath) {
  return path.resolve(execPath, '..', '..', '..')
}

/** CFBundleShortVersionString of a bundle, via macOS plutil. */
function bundleVersion(bundleDir) {
  const plist = path.join(bundleDir, 'Contents', 'Info.plist')
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' })
  return JSON.parse(json)['CFBundleShortVersionString']
}

/** Unzip with macOS ditto (preserves symlinks and permissions). */
function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  execFileSync('ditto', ['-x', '-k', zipPath, destDir], { stdio: 'ignore' })
}

/**
 * Download and verify the update into stagingRoot, pre-extract the new bundle,
 * and emit the detached install script. Everything that can fail happens
 * BEFORE the app quits; the script itself only moves verified directories.
 *
 * @returns {{ scriptPath: string }} the installer to spawn right before quit
 */
async function stageUpdate({ feed, execPath, stagingRoot, productName, onProgress, onStage }) {
  fs.mkdirSync(stagingRoot, { recursive: true })
  const zipPath = path.join(stagingRoot, `update-${feed.version}.zip`)
  const extractDir = path.join(stagingRoot, `update-${feed.version}`)

  if (!fs.existsSync(zipPath)) {
    if (onStage) onStage(`正在下载 v${feed.version} …`)
    const { bytes } = await downloadFile(feed.resolvedUrl ?? feed.url, `${zipPath}.part`, onProgress)
    if (feed.size && feed.size !== bytes) throw new Error(`下载大小不符: 期望 ${feed.size}，实际 ${bytes}`)
    fs.renameSync(`${zipPath}.part`, zipPath)
  }
  if (feed.sha256) {
    if (onStage) onStage('正在校验 …')
    const digest = await sha256File(zipPath)
    if (digest !== feed.sha256.toLowerCase()) throw new Error(`sha256 校验失败: ${digest}`)
  }

  const bundlePath = appBundlePath(execPath)
  if (bundlePath.includes('AppTranslocation')) {
    throw new Error('应用正从隔离转译位置运行；请先把它拖入 /Applications 再更新。')
  }
  fs.accessSync(path.dirname(bundlePath), fs.constants.W_OK)

  fs.rmSync(extractDir, { recursive: true, force: true })
  if (onStage) onStage('正在解压 …')
  extractZip(zipPath, extractDir)
  const stagedBundle = path.join(extractDir, `${productName}.app`)
  if (!fs.existsSync(path.join(stagedBundle, 'Contents', 'Info.plist'))) {
    throw new Error(`更新包中找不到 ${productName}.app`)
  }
  const stagedVersion = bundleVersion(stagedBundle)
  if (stagedVersion !== feed.version) {
    throw new Error(`更新包版本不符: 包内 ${stagedVersion}，feed 声明 ${feed.version}`)
  }
  // Same-version reinstalls are allowed (build-id driven hotfix updates);
  // only a strictly older bundle is rejected.
  if (compareVersions(stagedVersion, bundleVersion(bundlePath)) < 0) {
    throw new Error(`更新包版本 (${stagedVersion}) 低于当前版本`)
  }

  const logPath = path.join(stagingRoot, 'apply-update.log')
  const scriptPath = path.join(stagingRoot, 'apply-update.sh')
  fs.writeFileSync(scriptPath, applyScript({ appPid: process.pid, bundlePath, stagedBundle, extractDir, zipPath, logPath }))
  fs.chmodSync(scriptPath, 0o755)
  return { scriptPath, logPath }
}

/**
 * The installer runs detached from the dying app: wait for full exit, swap
 * bundles (keeping a rollback backup), relaunch, and clean up on success.
 * DSH_APPLY_NO_RELAUNCH=1 skips the relaunch (for tests).
 */
function applyScript({ appPid, bundlePath, stagedBundle, extractDir, zipPath, logPath }) {
  return `#!/bin/bash
set -u
exec >>"${logPath}" 2>&1
echo "[apply] start $(date)"
for i in $(seq 1 120); do
  kill -0 ${appPid} 2>/dev/null || break
  sleep 0.5
done
if kill -0 ${appPid} 2>/dev/null; then
  echo "[apply] app still running after 60s, abort"
  exit 1
fi
BACKUP="${bundlePath}.old-$(date +%s)"
if ! mv "${bundlePath}" "$BACKUP"; then
  echo "[apply] backup failed, abort"
  exit 1
fi
if mv "${stagedBundle}" "${bundlePath}"; then
  rm -rf "${extractDir}" "${zipPath}"
  if [ "\${DSH_APPLY_NO_RELAUNCH:-}" != "1" ]; then
    sleep 1
    open -n "${bundlePath}"
  fi
  sleep 5
  rm -rf "${bundlePath}".old-* 2>/dev/null
  echo "[apply] done"
else
  echo "[apply] install failed, rolling back"
  mv "$BACKUP" "${bundlePath}"
  if [ "\${DSH_APPLY_NO_RELAUNCH:-}" != "1" ]; then
    open -n "${bundlePath}"
  fi
  exit 1
fi
`
}

/** Detached spawn so the script survives this process's exit. */
function launchApply({ scriptPath }) {
  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  child.unref()
  return child
}

module.exports = { compareVersions, fetchJson, fetchText, resolveFeedUrl, downloadFile, sha256File, appBundlePath, bundleVersion, extractZip, stageUpdate, launchApply }
