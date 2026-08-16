#!/usr/bin/env node
/**
 * Abort a dist build while an app instance runs FROM the build output itself
 * (its process lines contain macos-app/dist): electron-builder deletes and
 * rewrites dist/mac-arm64 in place, and such an instance crashes with
 * ERR_MODULE_NOT_FOUND mid-rebuild. Instances installed elsewhere (e.g.
 * ~/Applications via app:install) are safe to rebuild around - they update
 * themselves through the in-app badge instead.
 */
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const macosAppDir = join(dirname(fileURLToPath(import.meta.url)), '..')
// Match instances whose path points into this checkout's dist output.
const DIST_MARKER = join(macosAppDir, 'dist')

let running = ''
try {
  running = execSync('pgrep -ifl "DeepSeek Harness"', { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
} catch {
  process.exit(0) // pgrep exit 1: nothing matched
}
const offenders = running
  .trim()
  .split('\n')
  .filter(line => line.includes(DIST_MARKER))
if (offenders.length === 0) process.exit(0)

console.error('require-app-not-running: 有实例正从构建输出目录运行：')
console.error(offenders.slice(0, 5).join('\n'))
console.error('重新打包会原位重写该目录，运行中的实例会崩溃。两种解决方式：')
console.error('  1. 完全退出该实例后重新打包（推荐日常用 app:install 装到 ~/Applications 运行）；')
console.error('  2. 直接用已装实例左下角的更新角标完成升级。')
process.exit(1)
