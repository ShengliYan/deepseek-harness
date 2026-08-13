const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const DEFAULT_PORT = 3080
const PORT = Number(process.env.DSH_PORT) || DEFAULT_PORT
const READY_TIMEOUT_MS = 120_000

const APP_NAME = 'DeepSeek Harness'

let mainWindow = null
let serverProcess = null
let serverLogPath = null
let quitting = false

function repoExists(repoPath) {
  return (
    fs.existsSync(path.join(repoPath, 'package.json')) &&
    fs.existsSync(path.join(repoPath, 'apps', 'cli', 'src', 'bin.ts'))
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

function isServerReady() {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1_500 }, res => {
      res.resume()
      resolve(res.statusCode !== undefined && res.statusCode < 500)
    })
    request.on('error', () => resolve(false))
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
  })
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isServerReady()) return true
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

    isServerReady().then(inUse => {
      if (inUse) {
        finish(reject, new Error(`端口 ${PORT} 已被占用，可能已有 dsh 实例在运行。请先关闭它，或设置 DSH_PORT 使用其它端口。`))
        return
      }
      const args = ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--port', String(PORT)]
      serverProcess = spawn(nodeBin, args, {
        cwd: repoPath,
        detached: true,
        env: { ...process.env, DSH_PROFILE: 'web' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const logStream = fs.createWriteStream(logPath, { flags: 'a' })
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

function stopServer() {
  if (!serverProcess) return
  const pid = serverProcess.pid
  serverProcess = null
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }, 3_000)
}

function createWindow() {
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
      sandbox: true,
    },
  })
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function installMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `关于 ${APP_NAME}` },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${APP_NAME}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${APP_NAME}` },
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

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    installMenu()
    const repoPath = resolveRepoPath()
    if (!repoPath) {
      dialog.showErrorBox(
        '找不到 deepseek 仓库',
        '未找到 deepseek-harness 仓库。请设置环境变量 DSH_REPO_PATH 指向仓库目录，或把仓库放在 ~/deepseek-harness。',
      )
      app.quit()
      return
    }
    const nodeBin = findNode()
    if (!nodeBin) {
      dialog.showErrorBox('找不到 Node.js', '请在 macOS 上安装 Node.js (>= 22)，然后重新打开本应用。')
      app.quit()
      return
    }
    serverLogPath = path.join(app.getPath('userData'), 'server.log')
    try {
      await startServer(repoPath, nodeBin, serverLogPath)
    } catch (error) {
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
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', event => {
    if (quitting || !serverProcess) return
    event.preventDefault()
    quitting = true
    stopServer()
    app.quit()
  })
}