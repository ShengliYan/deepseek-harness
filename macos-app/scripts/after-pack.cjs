/**
 * Adhoc-sign the unpacked .app so renamed Electron helpers are not still
 * signed as "Electron Helper". On macOS 15 that mismatch SIGTRAPs the GPU
 * helper within milliseconds and the shell exits, leaving `dsh web` orphaned.
 */
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

/** @param {import('electron-builder').AfterPackContext} context */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!existsSync(appPath)) {
    throw new Error(`after-pack: missing app at ${appPath}`)
  }
  const entitlements = join(context.packager.projectDir, 'build', 'entitlements.mac.plist')
  const args = ['--force', '--deep', '--sign', '-']
  if (existsSync(entitlements)) args.push('--entitlements', entitlements)
  args.push(appPath)
  console.log(`after-pack: codesign ${args.join(' ')}`)
  execFileSync('codesign', args, { stdio: 'inherit' })
}

module.exports.default = module.exports
