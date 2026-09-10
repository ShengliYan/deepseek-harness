#!/usr/bin/env node
/**
 * electron-builder wrapper: stamps extraMetadata.version from build/app-version
 * (written by stage-runtime as the Sydney clock) so the packaged Info.plist,
 * asar package.json, and zip filename all match the feed. `node --check` on
 * main.js runs first: Electron loads that file as the process entry, so a
 * SyntaxError never reaches the boot log or `dsh web --no-open`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const macosAppDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const versionFile = join(macosAppDir, 'build', 'app-version')
if (!existsSync(versionFile)) {
  console.error('electron-builder: build/app-version 缺失；请先跑 stage-runtime')
  process.exit(1)
}
const version = readFileSync(versionFile, 'utf8').trim()
if (!/^\d{4}\.\d{2}\.\d{2}\.\d{4}$/.test(version)) {
  console.error(`electron-builder: 非法 app-version ${version}`)
  process.exit(1)
}

const mainJs = join(macosAppDir, 'main.js')
const syntax = spawnSync(process.execPath, ['--check', mainJs], { encoding: 'utf8' })
if (syntax.status !== 0) {
  console.error(`electron-builder: main.js failed node --check:\n${syntax.stderr || syntax.stdout}`)
  process.exit(syntax.status === null ? 1 : syntax.status)
}

const bin = join(macosAppDir, 'node_modules', '.bin', 'electron-builder')
const result = spawnSync(bin, [
  ...process.argv.slice(2),
  `--config.extraMetadata.version=${version}`,
  '--publish', 'never',
], {
  cwd: macosAppDir,
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status === null ? 1 : result.status)
