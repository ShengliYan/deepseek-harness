const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const updater = require('./updater')

const DEFAULT_PORT = 3080
const READY_TIMEOUT_MS = 120_000

const APP_NAME = 'DeepSeek Harness'

const { homedir } = require('node:os')
const { resolveAppDataDir, TEST_MODE_PORT } = require('./app-data-dir')
let appDataError = null
let appData
try {
  appData = resolveAppDataDir(process.env)
} catch (error) {
  appDataError = error
}
// Test isolation (§5.3): fixed port, main log inside the isolation directory;
// production keeps DSH_PORT || 3080 and ~/Library/Logs.
const TEST_MODE = appData !== undefined && appData.mode === 'test'
const PORT = TEST_MODE
  ? TEST_MODE_PORT
  : Number(process.env.DSH_PORT) || DEFAULT_PORT
const MAIN_LOG = TEST_MODE
  ? path.join(appData.dir, 'main.log')
  : path.join(homedir(), 'Library', 'Logs', 'dsh-macos-app-main.log')
function mainLog(message) {
  try {
    fs.appendFileSync(MAIN_LOG, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // logging must never take down the shell
  }
}
process.on('exit', (code) => { mainLog(`exit code=${code}`) })
process.on('uncaughtException', (error) => {
  mainLog(`uncaughtException ${error && error.stack ? error.stack : error}`)
})
process.on('unhandledRejection', (reason) => {
  mainLog(`unhandledRejection ${reason && reason.stack ? reason.stack : reason}`)
})

// GPU helpers still spawn before ready unless Chromium is told in-process.
// Unsigned + renamed helpers otherwise SIGTRAP on macOS 15 (`codeSigningID`
// stays "Electron Helper") and the shell exits, leaving `dsh web` orphaned.
delete process.env.ELECTRON_RUN_AS_NODE
// Packaged launches inherit the caller's environment (`open` from a smoke
// shell, Cursor, CI). `DSH_HOME` then points at a throwaway `/tmp/dsh-*`
// directory, so the GUI misses `~/.dsh/settings.yaml` and the welcome
// acknowledgement cannot persist. Dev `electron .` still forwards DSH_HOME.
if (app.isPackaged) {
  delete process.env.DSH_HOME
  delete process.env.DSH_SMOKE_PORT
}
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('in-process-gpu')
// Unsigned helpers still SIGTRAP under Chromium's sandbox on macOS 15.
if (app.isPackaged && process.platform === 'darwin') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}
app.disableHardwareAcceleration()

let mainWindow = null
let serverProcess = null
/** Pid of a leftover bundled `dsh web` we attached to instead of spawning. */
let adoptedServerPid = null
let serverLogPath = null
let quitting = false
/** `dsh web: http://127.0.0.1:PORT/?token=…` printed after Connection boots. */
let launchAppUrl = null
let serverOutput = ''

// ---------------------------------------------------------------------------
// Self-rolled auto-update (unsigned-friendly). Two feed styles, both driven
// by build/update-config.json's feedUrl (DSH_UPDATE_FEED env overrides):
//   file://…/dist/latest.json  local dev loop: rebuild dist, the running app
//                              shows the badge and restarts into the new build
//   https://…/latest.json      hosted distribution
// "New" is decided by buildId (stamped every dist run) so same-version
// hotfixes are detected; version compare is the fallback for older bundles.
// ---------------------------------------------------------------------------
const { ipcMain } = require('electron')

let updateFeed = null // last feed seen with a pending update
let updateBusy = false
let updateOwnBuildId = null

function resolveUpdateFeedUrl() {
  if (process.env.DSH_UPDATE_FEED) return process.env.DSH_UPDATE_FEED
  if (!app.isPackaged) return null // dev runs never update
  try {
    const configPath = path.join(process.resourcesPath, 'update-config.json')
    const feedUrl = JSON.parse(fs.readFileSync(configPath, 'utf8')).feedUrl
    return typeof feedUrl === 'string' && feedUrl !== '' ? feedUrl : null
  } catch {
    return null
  }
}

function readOwnBuildId() {
  try {
    return fs.readFileSync(path.join(process.resourcesPath, 'build-id'), 'utf8').trim()
  } catch {
    return null // pre-fingerprint bundle: fall back to version compare
  }
}

function readGitRev() {
  try {
    return fs.readFileSync(path.join(process.resourcesPath, 'git-rev'), 'utf8').trim() || null
  } catch {
    return null // dev runs and tarball builds without a stamped hash
  }
}

function broadcastUpdateState() {
  const state = {
    available: updateFeed !== null,
    version: updateFeed?.version ?? '',
    buildId: updateFeed?.buildId ?? '',
    busy: updateBusy,
  }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('dsh-update-state', state)
  }
}

/** Is the feed newer than us? buildId mismatch first, version compare second. */
function feedIsNewer(feed) {
  if (updateOwnBuildId !== null && typeof feed.buildId === 'string' && feed.buildId !== '') {
    return feed.buildId !== updateOwnBuildId
  }
  return updater.compareVersions(feed.version, app.getVersion()) > 0
}

function createProgressWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 140,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: `${APP_NAME} 更新`,
    autoHideMenuBar: true,
    parent: mainWindow ?? undefined,
    modal: mainWindow !== null,
  })
  const html =
    '<body style="margin:0;font:13px -apple-system;display:flex;flex-direction:column;' +
    'justify-content:center;align-items:center;gap:12px;height:100vh;-webkit-user-select:none">' +
    '<div id="stage">正在准备更新 …</div>' +
    '<progress id="bar" value="0" max="100" style="width:320px"></progress>' +
    '<div id="detail" style="color:#888;font-size:11px"></div></body>'
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.setMenuBarVisibility(false)
  return win
}

function progressUpdate(win, stage, received, total) {
  const detail = total > 0 ? `${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB` : ''
  win.webContents.executeJavaScript(
    `document.getElementById('stage').textContent=${JSON.stringify(stage)};` +
      `document.getElementById('bar').value=${total > 0 ? Math.floor((received / total) * 100) : 0};` +
      `document.getElementById('detail').textContent=${JSON.stringify(detail)}`,
  ).catch(() => { /* window closed mid-update */ })
}

let updateCheckRunning = false
async function checkForUpdates({ explicit = false } = {}) {
  if (TEST_MODE) return
  const feedUrl = resolveUpdateFeedUrl()
  if (!feedUrl) {
    if (explicit) {
      dialog.showErrorBox('未配置更新源', '打包配置 build/update-config.json 中 feedUrl 未设置（或用环境变量 DSH_UPDATE_FEED 覆盖）。')
    }
    return
  }
  if (updateCheckRunning) return
  updateCheckRunning = true
  try {
    const feed = await updater.fetchJson(feedUrl)
    const newer = feedIsNewer(feed)
    updateFeed = newer ? feed : null
    broadcastUpdateState()
    if (!newer) {
      if (explicit) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          message: `当前已是最新版本 (${app.getVersion()}${updateOwnBuildId ? `，构建 ${updateOwnBuildId.slice(-6)}` : ''})`,
          buttons: ['好'],
        })
      }
      return
    }
    if (explicit) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: `发现新版本 ${feed.version}`,
        detail: `${feed.notes ?? ''}\n\n当前版本 ${app.getVersion()}\n更新会自动退出应用、安装后重新打开。\n（也可以随时点击界面左下角的更新图标）`,
        buttons: ['立即更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
      })
      if (choice.response === 0) await performUpdate()
    }
  } catch (error) {
    // Silent checks (feed mid-rebuild, offline) must not nag; explicit ones
    // surface the reason.
    if (explicit) dialog.showErrorBox('检查更新失败', String(error.message || error))
  } finally {
    updateCheckRunning = false
  }
}

async function performUpdate() {
  if (!updateFeed || updateBusy) return
  updateBusy = true
  broadcastUpdateState()
  const feed = updateFeed
  const progressWin = createProgressWindow()
  try {
    const staged = await updater.stageUpdate({
      feed,
      execPath: process.execPath,
      stagingRoot: path.join(app.getPath('userData'), 'updates'),
      productName: APP_NAME,
      onProgress: (received, total) => progressUpdate(progressWin, `正在获取 v${feed.version} …`, received, total),
      onStage: stage => progressUpdate(progressWin, stage, 0, 0),
    })
    progressWin.destroy()
    // The detached installer waits for this process to exit, swaps the
    // bundle, relaunches, and rolls back on failure. before-quit still runs
    // stopServer() below; ordering is safe because the script polls our pid.
    updater.launchApply(staged)
    app.quit()
  } catch (error) {
    updateBusy = false
    broadcastUpdateState()
    progressWin.destroy()
    dialog.showErrorBox('更新失败', String(error.message || error))
  }
}

ipcMain.on('dsh-update-apply', () => {
  performUpdate()
})


function repoExists(repoPath) {
  // Production layout: the staged build (lib/bin.js + node_modules) next to a
  // package.json. Source layout (dev): apps/cli/src/bin.ts, launched via tsx.
  return (
    fs.existsSync(path.join(repoPath, 'package.json')) &&
    (fs.existsSync(path.join(repoPath, 'lib', 'bin.js')) ||
      fs.existsSync(path.join(repoPath, 'apps', 'cli', 'src', 'bin.ts')))
  )
}

function resolveRepoPath() {
  const candidates = []
  if (process.env.DSH_REPO_PATH) candidates.push(process.env.DSH_REPO_PATH)
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, 'deepseek'))
  candidates.push(path.join(app.getPath('home'), 'deepseek-harness'))
  candidates.push(path.resolve(__dirname, '..'))
  for (const candidate of candidates) {
    if (repoExists(candidate)) return candidate
  }
  return null
}

function collectNodeBins(dir, depth) {
  if (depth <= 0) return null
  let found = null
  let newest = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = collectNodeBins(full, depth - 1)
      if (nested) return nested
      continue
    }
    if (entry.name === 'node' && fs.statSync(full).isFile()) {
      const mtime = fs.statSync(full).mtimeMs
      if (mtime > newest) {
        newest = mtime
        found = full
      }
    }
  }
  return found
}

function runAndCapture(command, args) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 8_000 })
    if (result.status === 0 && result.stdout && result.stdout.trim()) {
      return result.stdout.trim().split(/\r?\n/)[0]
    }
  } catch {
    return null
  }
  return null
}

function findNode() {
  if (process.env.NODE_BIN && fs.existsSync(process.env.NODE_BIN)) return process.env.NODE_BIN
  if (runAndCapture('node', ['--version'])) return 'node'
  const viaShell = runAndCapture('zsh', ['-ilc', 'command -v node']) || runAndCapture('bash', ['-lc', 'command -v node'])
  if (viaShell) return viaShell
  const home = app.getPath('home')
  const candidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    path.join(home, '.nvm', 'versions', 'node'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.local', 'share', 'mise', 'installs', 'node'),
    path.join(home, '.fnm'),
  ]
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    if (fs.statSync(candidate).isDirectory()) {
      const found = collectNodeBins(candidate, 3)
      if (found) return found
    } else {
      return candidate
    }
  }
  return null
}

function isPortOccupied() {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1_500 }, res => {
      res.resume()
      // 401 is still a live listener: browser-token auth rejects a bare GET /.
      resolve(true)
    })
    request.on('error', () => resolve(false))
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
  })
}

function rememberLaunchUrl(chunk) {
  serverOutput += chunk.toString()
  if (launchAppUrl) return
  const match = serverOutput.match(new RegExp(
    `dsh web: (http://127\\.0\\.0\\.1:${PORT}/\\?token=[A-Za-z0-9_-]+)`,
  ))
  if (match) launchAppUrl = match[1]
}

function cookieHeader(setCookie) {
  const list = setCookie == null ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  return list.map(entry => String(entry).split(';')[0].trim()).filter(Boolean).join('; ')
}

function fetchPage(pathname, headers = {}) {
  return new Promise(resolve => {
    const request = http.get({
      host: '127.0.0.1', port: PORT, path: pathname, timeout: 1_500, headers,
    }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        location: res.headers.location,
        cookie: cookieHeader(res.headers['set-cookie']),
        body,
      }))
    })
    request.on('error', () => resolve({ ok: false, status: 0, location: undefined, cookie: '', body: '' }))
    request.on('timeout', () => {
      request.destroy()
      resolve({ ok: false, status: 0, location: undefined, cookie: '', body: '' })
    })
  })
}

async function fetchAuthenticatedIndex() {
  if (!launchAppUrl) return { ok: false, body: '' }
  const url = new URL(launchAppUrl)
  const first = await fetchPage(`${url.pathname}${url.search}`)
  if (first.status === 303 && first.location !== undefined) {
    const location = first.location.startsWith('http')
      ? new URL(first.location).pathname
      : first.location
    const headers = first.cookie !== '' ? { cookie: first.cookie } : {}
    return fetchPage(location, headers)
  }
  return first
}

function findPortListenerPid() {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
  const pid = Number((result.stdout || '').trim().split(/\n/)[0])
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

function processCommand(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
  return (result.stdout || '').trim()
}

/** True when the listener is this app's bundled `dsh web`, including an orphan after Electron quit. */
function isBundledWebServer(command) {
  if (!command.includes('lib/bin.js web')) return false
  if (app.isPackaged) {
    return command.includes(`${path.sep}DeepSeek Harness.app${path.sep}`)
      && command.includes(`${path.sep}Resources${path.sep}node${path.sep}bin${path.sep}node`)
  }
  return true
}

// The dsh webserver starts serving the index page BEFORE the server boot
// completes, and __DSH_BOOT__ (the client entry graph the page carries)
// is populated incrementally as plugin entries load. A page fetched mid-boot
// gets a PARTIAL manifest, and the web UI then fails to activate everything
// that waits on the wire roots ("Failed to load plugins"). So "HTTP 200" is
// not "ready": we require the client-connection wire root to be present AND
// the manifest revision to stop changing (entries no longer arriving) before
// the window may load.
function checkServerReady(lastManifestRev) {
  return fetchAuthenticatedIndex().then(({ ok, body }) => {
    if (!ok) return { ready: false, rev: null }
    const match = body.match(/(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\]) = (\{[^<]+\})<\/script>/)
    if (!match) return { ready: false, rev: null }
    let manifest
    try {
      manifest = JSON.parse(match[1])
    } catch {
      return { ready: false, rev: null }
    }
    const entries = Array.isArray(manifest.entries) ? manifest.entries : []
    const hasConnection = entries.some(entry => entry && entry.id === '@deepseek-ai/dsh-client-connection')
    const rev = typeof manifest.rev === 'string' ? manifest.rev : null
    return { ready: hasConnection && rev !== null && rev === lastManifestRev, rev }
  })
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastRev = null
  while (Date.now() < deadline) {
    if (!launchAppUrl) {
      await new Promise(resolve => setTimeout(resolve, 500))
      continue
    }
    const result = await checkServerReady(lastRev)
    if (result.ready) return true
    if (result.rev !== null) lastRev = result.rev
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}

function startServer(repoPath, nodeBin, logPath) {
  return new Promise((resolve, reject) => {
    let settled = false
    let started = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      if (fn === resolve) started = true
      fn(value)
    }

    isPortOccupied().then(inUse => {
      if (inUse) {
        if (TEST_MODE) {
          // Test isolation must never attach to, or be served by, a pre-existing
          // service (production or stale test): stop instead.
          finish(reject, new Error(`端口 ${PORT} 已被占用（测试模式不接管已有服务）。请先结束该进程，再重新打开。`))
          return
        }
        // Electron detaches `dsh web`; if the shell quit without killing it,
        // the next launch must attach that process instead of erroring, and
        // must not open a second browser tab.
        const pid = findPortListenerPid()
        const command = pid === null ? '' : processCommand(pid)
        if (pid !== null && isBundledWebServer(command)) {
          adoptedServerPid = pid
          waitForServer(8_000).then(ready => {
            if (ready) finish(resolve)
            else finish(reject, new Error(`端口 ${PORT} 上已有未就绪的 dsh 服务 (pid ${pid})。请先结束该进程，或设置 DSH_PORT 使用其它端口。`))
          })
          return
        }
        finish(reject, new Error(`端口 ${PORT} 已被占用，可能已有 dsh 实例在运行。请先关闭它，或设置 DSH_PORT 使用其它端口。`))
        return
      }
      // Built layout (app bundle): plain-node launch of lib/bin.js. Source
      // layout (dev checkout without a build): tsx source launch.
      // `--no-open`: the Electron window is the UI; default `dsh web` also
      // hands the URL to Safari/Chrome, which is what "jumped to the webpage"
      // looks like from this wrapper.
      const builtEntry = path.join(repoPath, 'lib', 'bin.js')
      const args = fs.existsSync(builtEntry)
        ? ['lib/bin.js', 'web', '--port', String(PORT), '--no-open']
        : ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--port', String(PORT), '--no-open']
      const env = { ...process.env, DSH_PROFILE: 'web' }
      if (app.isPackaged) {
        delete env.DSH_HOME
        delete env.DSH_SMOKE_PORT
      }
      // Test isolation: after the default cleanup above, point the server's
      // data home at the test directory so sessions, settings, and caches
      // stay out of the real ~/.dsh.
      if (TEST_MODE) {
        env.DSH_HOME = appData.dir
      }
      serverProcess = spawn(nodeBin, args, {
        cwd: repoPath,
        detached: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const logStream = fs.createWriteStream(logPath, { flags: 'a' })
      launchAppUrl = null
      serverOutput = ''
      serverProcess.stdout.on('data', rememberLaunchUrl)
      serverProcess.stderr.on('data', rememberLaunchUrl)
      serverProcess.stdout.pipe(logStream)
      serverProcess.stderr.pipe(logStream)
      serverProcess.on('error', error => {
        logStream.end()
        finish(reject, new Error(`无法启动 dsh 服务: ${error.message}`))
      })
      serverProcess.on('exit', code => {
        logStream.end()
        if (started) {
          if (!quitting && code !== 0) {
            dialog.showErrorBox(`${APP_NAME} 服务异常退出`, `dsh 服务已退出 (code ${code})。日志: ${logPath}`)
          }
        } else {
          finish(reject, new Error(`dsh 服务启动失败 (code ${code})。日志: ${logPath}`))
        }
      })
      waitForServer(READY_TIMEOUT_MS).then(ready => {
        if (ready) finish(resolve)
        else finish(reject, new Error(`等待 dsh 服务就绪超时 (${READY_TIMEOUT_MS / 1000}s)。日志: ${logPath}`))
      })
    })
  })
}

function signalPid(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch {
    // process group may already be gone
  }
  try {
    process.kill(pid, signal)
  } catch {
    // already gone
  }
}

function stopServer() {
  const pids = []
  if (serverProcess && serverProcess.pid) pids.push(serverProcess.pid)
  if (adoptedServerPid) pids.push(adoptedServerPid)
  serverProcess = null
  adoptedServerPid = null
  if (pids.length === 0) return
  for (const pid of pids) signalPid(pid, 'SIGTERM')
  setTimeout(() => {
    for (const pid of pids) signalPid(pid, 'SIGKILL')
  }, 3_000)
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !(app.isPackaged && process.platform === 'darwin'),
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  // Show a window before the server is ready. Waiting on startServer with no
  // window left this process looking "not running" while `dsh web` detached.
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
    '<!doctype html><meta charset="utf-8"><title>DeepSeek Harness</title>'
    + '<body style="margin:0;font:15px/1.5 system-ui,-apple-system,sans-serif;color:#444;display:flex;min-height:100vh;align-items:center;justify-content:center">正在启动…</body>',
  )}`)
  const appOrigin = `http://127.0.0.1:${PORT}`
  const isAppUrl = url => {
    try {
      const parsed = new URL(url)
      return parsed.origin === new URL(appOrigin).origin
    } catch {
      return false
    }
  }
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('data:')) return
    if (!isAppUrl(url)) event.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  // Fallback for Cmd+Q: if the native menu key equivalent for Quit is ever not
  // registered (role-accelerator edge cases), still honor the shortcut at the
  // input layer. When the menu DOES consume it, this handler never sees the
  // key, so the two paths never double-fire.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.meta && !input.control && !input.alt && !input.shift && String(input.key).toLowerCase() === 'q') {
      event.preventDefault()
      app.quit()
    }
  })
  let bootCheckDone = false
  let repairReloads = 0
  const MAX_REPAIR_RELOADS = 2
  mainWindow.webContents.on('did-finish-load', () => {
    const current = mainWindow.webContents.getURL()
    if (!current.startsWith(appOrigin)) return
    if (bootCheckDone) return
    bootCheckDone = true
    setTimeout(async () => {
      if (!mainWindow || quitting) return
      try {
        const length = await mainWindow.webContents.executeJavaScript('document.documentElement.outerHTML.length')
        const failed = await mainWindow.webContents.executeJavaScript(
          'document.body ? document.body.innerText.includes("Failed to load plugins") : false',
        )
        // Blank page, or the web boot failed against a partial manifest: reload
        // once the server has finished booting (the manifest is complete by
        // then). Capped so a genuinely broken page is not reload-looped.
        if ((typeof length === 'number' && length < 200) || failed) {
          if (repairReloads < MAX_REPAIR_RELOADS) {
            repairReloads += 1
            mainWindow.webContents.reload()
          }
        }
      } catch {
        // devtools detached or renderer gone; nothing to repair
      }
    }, 3_000)
  })
  // Same-origin window.open must not fall through to Safari: that is the
  // "Mac app still pops the webpage" path. Only off-origin http(s) leaves.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url) || url.startsWith('data:')) return { action: 'deny' }
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function loadAppUrl() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  mainWindow.loadURL(launchAppUrl || `http://127.0.0.1:${PORT}`)
}

function installMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `关于 ${APP_NAME}` },
        { type: 'separator' },
        // Test mode disables updates entirely (no check, no install), so the
        // menu item goes with it.
        ...(TEST_MODE ? [] : [
          { label: '检查更新…', click: () => { checkForUpdates({ explicit: true }) } },
          { type: 'separator' },
        ]),
        { role: 'hide', label: `隐藏 ${APP_NAME}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', accelerator: 'Command+Q', label: `退出 ${APP_NAME}` },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      role: 'window',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Test isolation: redirect userData BEFORE the single-instance lock so the
// test-mode lock file never contends with the production app's.
if (!appDataError && TEST_MODE) {
  const testUserDataDir = path.join(appData.dir, 'electron-userdata')
  fs.mkdirSync(testUserDataDir, { recursive: true })
  app.setPath('userData', testUserDataDir)
}

const gotLock = appDataError ? false : app.requestSingleInstanceLock()
if (!gotLock) {
  if (appDataError) {
    mainLog(`DSH_APP_DATA_DIR invalid: ${appDataError.message}`)
    dialog.showErrorBox(
      `${APP_NAME} 启动失败（DSH_APP_DATA_DIR）`,
      appDataError.message,
    )
  }
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // About panel carries the build stamp; packaged builds read the staged
    // hash, dev runs fall back to the checkout's HEAD.
    let gitRev = readGitRev()
    if (!gitRev && !app.isPackaged) {
      try {
        gitRev = require('node:child_process')
          .execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
          .trim() || null
      } catch {
        gitRev = null
      }
    }
    if (gitRev) {
      app.setAboutPanelOptions({
        applicationVersion: app.getVersion(),
        credits: `构建 ${gitRev}`,
      })
    }
    installMenu()
    mainLog(`ready version=${app.getVersion()} packaged=${app.isPackaged}`)
    const repoPath = resolveRepoPath()
    if (!repoPath) {
      dialog.showErrorBox(
        '找不到 deepseek 仓库',
        '未找到 deepseek-harness 仓库。请设置环境变量 DSH_REPO_PATH 指向仓库目录，或把仓库放在 ~/deepseek-harness。',
      )
      app.quit()
      return
    }
    const bundledNode = path.join(process.resourcesPath, 'node', 'bin', 'node')
    if (fs.existsSync(bundledNode)) process.env.NODE_BIN = bundledNode
    const nodeBin = findNode()
    if (!nodeBin) {
      dialog.showErrorBox('找不到 Node.js', '请在 macOS 上安装 Node.js (>= 22)，然后重新打开本应用。')
      app.quit()
      return
    }
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
        if (serverProcess || adoptedServerPid) loadAppUrl()
      }
    })
    serverLogPath = path.join(app.getPath('userData'), 'server.log')
    try {
      mainLog(`startServer repo=${repoPath}`)
      await startServer(repoPath, nodeBin, serverLogPath)
      mainLog('startServer ready')
    } catch (error) {
      mainLog(`startServer failed ${error && error.stack ? error.stack : error}`)
      dialog.showErrorBox(`${APP_NAME} 启动失败`, String(error.message || error))
      app.quit()
      return
    }
    if (process.platform === 'darwin') {
      const devIcon = path.join(__dirname, 'build', 'icon.png')
      if (fs.existsSync(devIcon)) {
        try {
          app.dock.setIcon(devIcon)
        } catch {
          // dock icon is decorative
        }
      }
    }
    loadAppUrl()
    // Update polling: silent checks right after boot, on window focus (a
    // fresh dist build usually lands while this app is in the background),
    // and every 30s. Errors stay quiet on purpose (the feed is rebuilt in
    // place and can briefly vanish); explicit menu checks surface them.
    // Test mode never polls: it must neither check nor install updates.
    if (!TEST_MODE) {
      updateOwnBuildId = readOwnBuildId()
      const pollUpdate = () => {
        if (!quitting) checkForUpdates().catch(() => {})
      }
      setTimeout(pollUpdate, 8_000)
      setInterval(pollUpdate, 30_000)
      app.on('browser-window-focus', pollUpdate)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // stopServer() is synchronous (SIGTERM + a deferred SIGKILL), so there is
  // nothing to await: kill the server here WITHOUT preventDefault and let the
  // quit proceed naturally. The previous preventDefault + re-entrant app.quit()
  // pattern left the app in a "windows closed but process still running" state
  // on macOS (Dock dot remains).
  app.on('before-quit', () => {
    quitting = true
    stopServer()
  })

  // Backstop in case before-quit is skipped (e.g. autoUpdater.quitAndInstall);
  // stopServer is idempotent, so a double call is harmless.
  app.on('will-quit', () => {
    quitting = true
    stopServer()
  })
}
