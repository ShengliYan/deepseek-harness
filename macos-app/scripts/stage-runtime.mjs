#!/usr/bin/env node
/**
 * Build the self-contained desktop runtime staged at macos-app/runtime-stage,
 * which electron-builder then copies into the app bundle as Resources/deepseek.
 *
 * Pipeline:
 *   1. pnpm run build            repo lib + web frontend (skip with --skip-build)
 *   2. regenerate apps/desktop-runtime/package.json - the deploy-root closure
 *      manifest (union of apps/cli + dsh-web-app + dsh-web-frontend deps plus
 *      the web-profile plugin surface, mirroring python/sdk-runtime's pattern)
 *   3. pnpm install              record the manifest in the workspace lockfile
 *   4. pnpm --filter dsh-desktop-runtime-pkg deploy --prod --legacy --config.node-linker=hoisted runtime-stage
 *   5. overlay apps/cli          lib/, config/, package.json onto the stage root
 *   6. rewrite escaping symlinks vendored link: overrides and Linux-only stubs
 *      must become real files, or the bundle only works next to this checkout
 *   7. verify + smoke boot       no symlink resolves outside the stage; the
 *      bundled Node must serve the web UI before electron-builder runs
 *
 * Requires node on PATH (or NODE_BIN) and a built repo (step 1).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs'
import { execSync, spawn, spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const macosAppDir = resolve(scriptDir, '..')
const repoRoot = resolve(macosAppDir, '..')
const stageDir = join(macosAppDir, 'runtime-stage')
const manifestDir = join(repoRoot, 'apps', 'desktop-runtime')
const manifestName = 'dsh-desktop-runtime-pkg'

const args = new Set(process.argv.slice(2))
const skipBuild = args.has('--skip-build')
const skipSmoke = args.has('--no-smoke')
const smokePort = Number(process.env.DSH_SMOKE_PORT) || 3199

// Web-profile plugin surface loaded by the cordis loader at runtime. These are
// peers/devDependencies inside the workspace, so a --prod deploy of apps/cli
// alone drops them; declaring them as direct deps of the deploy root keeps the
// closure complete. Derived from the loader's resolution failures of a prod
// stage boot; keep in sync when the web profile grows plugins.
const WEB_PROFILE_PLUGINS = [
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-default-model',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-anonymous-user-id',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-attachment-local',
  '@deepseek-ai/dsh-bash-local',
  '@deepseek-ai/dsh-bash-sandbox',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-hmr',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-ui-commands',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-deliverables',
  '@deepseek-ai/dsh-client-ui-goal',
  '@deepseek-ai/dsh-client-ui-input-trigger',
  '@deepseek-ai/dsh-client-ui-jobs',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-message-feedback',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-permission-presets',
  '@deepseek-ai/dsh-client-ui-plan',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-general',
  '@deepseek-ai/dsh-client-ui-settings-models',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-skill',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-subagent',
  '@deepseek-ai/dsh-client-ui-theme',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-client-ui-trajectory',
  '@deepseek-ai/dsh-client-ui-user-questions',
  '@deepseek-ai/dsh-client-ui-workflow-run',
  '@deepseek-ai/dsh-client-ui-workspace',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-code-runtime',
  '@deepseek-ai/dsh-code-runtime-worker-thread',
  '@deepseek-ai/dsh-command-feedback',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-compaction',
  '@deepseek-ai/dsh-cordis-host-runner',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-credentials-local',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-fs-observation-policy',
  '@deepseek-ai/dsh-fs-sandbox',
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-host-directory-picker',
  '@deepseek-ai/dsh-host-directory-picker-auto',
  '@deepseek-ai/dsh-host-plugin-inventory',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-jobs',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-llm-retry',
  '@deepseek-ai/dsh-message-feedback',
  '@deepseek-ai/dsh-native-command',
  '@deepseek-ai/dsh-output-retention',
  '@deepseek-ai/dsh-permission-presets',
  '@deepseek-ai/dsh-repeat-tool-reminder',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-sandbox-local',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-checkpoint-policy',
  '@deepseek-ai/dsh-session-log-export',
  '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-session-projection-cache',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-session-query-sqlite',
  '@deepseek-ai/dsh-session-stats',
  '@deepseek-ai/dsh-session-telemetry',
  '@deepseek-ai/dsh-session-telemetry-otel',
  '@deepseek-ai/dsh-session-title',
  '@deepseek-ai/dsh-session-title-first-prompt-llm',
  '@deepseek-ai/dsh-session-title-llm',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-settings-file',
  '@deepseek-ai/dsh-shell',
  '@deepseek-ai/dsh-shell-env',
  '@deepseek-ai/dsh-spill',
  '@deepseek-ai/dsh-spill-local',
  '@deepseek-ai/dsh-spill-policy',
  '@deepseek-ai/dsh-storage',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-storage-json',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-subagent-fork-in-process',
  '@deepseek-ai/dsh-subagent-in-process-driver',
  '@deepseek-ai/dsh-subagent-spawn-in-process',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-tool-call-timeout-policy',
  '@deepseek-ai/dsh-tool-subagent-report',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-typert-loader',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-user-questions',
  '@deepseek-ai/dsh-web',
  '@deepseek-ai/dsh-web-search-ark',
  '@deepseek-ai/dsh-web-search-deepseek',
  '@deepseek-ai/dsh-workflow',
  '@deepseek-ai/dsh-workspace',
  '@deepseek-ai/schemastery',
]

function fail(message) {
  console.error(`stage-runtime: ${message}`)
  process.exit(1)
}

function log(step, message) {
  console.log(`[stage-runtime ${step}] ${message}`)
}

function findNodeBin() {
  if (process.env.NODE_BIN && existsSync(process.env.NODE_BIN)) return process.env.NODE_BIN
  const probe = spawnSync('node', ['--version'], { encoding: 'utf8', timeout: 8000 })
  if (probe.status === 0) return 'node'
  const home = process.env.HOME ?? ''
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    if (existsSync(candidate)) return candidate
  }
  const nvmRoot = join(home, '.nvm', 'versions', 'node')
  if (existsSync(nvmRoot)) {
    const versions = readdirSync(nvmRoot).sort()
    const newest = versions.at(-1)
    if (newest) {
      const bin = join(nvmRoot, newest, 'bin', 'node')
      if (existsSync(bin)) return bin
    }
  }
  return null
}

function run(step, command, commandArgs, options = {}) {
  log(step, `$ ${command} ${commandArgs.join(' ')}`)
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // CI=true keeps pnpm's verify-deps-before-run check non-interactive; a
    // no-TTY modules-dir confirmation aborts the build otherwise.
    env: { ...process.env, CI: 'true' },
  })
  if (result.status !== 0) {
    console.error(result.stdout)
    console.error(result.stderr)
    fail(`${step} failed with exit code ${result.status}`)
  }
  return result.stdout
}

/**
 * Symlinks under root, without following them: the pnpm virtual store's
 * symlink farm would recurse (and cycle) under a naive recursive readdir.
 */
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

/** Resolved target of a link, without requiring it to exist. */
function resolveLinkTarget(link) {
  return resolve(dirname(link), readlinkSync(link))
}

function generateManifest() {
  const closure = {}
  const sources = ['apps/cli/package.json', 'packages/bundle/web-app/package.json', 'apps/web/package.json']
  for (const source of sources) {
    const pkg = JSON.parse(readFileSync(join(repoRoot, source), 'utf8'))
    Object.assign(closure, pkg.dependencies ?? {})
  }
  for (const name of WEB_PROFILE_PLUGINS) {
    if (!(name in closure)) closure[name] = 'workspace:^'
  }
  const manifest = {
    name: manifestName,
    description: 'Dependency-only deploy root for the macOS desktop runtime closure; regenerated by macos-app/scripts/stage-runtime.mjs, materialized via pnpm deploy',
    version: '0.0.1',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(Object.entries(closure).sort(([a], [b]) => a.localeCompare(b))),
  }
  mkdirSync(manifestDir, { recursive: true })
  const manifestPath = join(manifestDir, 'package.json')
  const previous = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : ''
  const next = `${JSON.stringify(manifest, null, 2)}\n`
  if (previous !== next) {
    writeFileSync(manifestPath, next)
    log('manifest', `regenerated ${relative(repoRoot, manifestPath)} (${Object.keys(closure).length} deps)`)
  } else {
    log('manifest', `unchanged (${Object.keys(closure).length} deps)`)
  }
}

function overlayCli() {
  rmSync(join(stageDir, 'package.json'))
  const cliDir = join(repoRoot, 'apps', 'cli')
  for (const entry of ['package.json', 'lib', 'config']) {
    const source = join(cliDir, entry)
    rmSync(join(stageDir, entry), { recursive: true, force: true })
    cpSync(source, join(stageDir, entry), { recursive: true })
  }
  log('overlay', 'apps/cli lib/, config/, package.json staged over the deploy root')
}

/**
 * pnpm's link: overrides for vendored packages and Linux-only native stubs
 * leave symlinks pointing back into this checkout. Replace every link whose
 * resolved target escapes the stage with a real copy, or the packaged app
 * only runs next to this repository. Runs to a fixpoint because each copy
 * can shadow links captured by the previous snapshot.
 */
function fixEscapingSymlinks() {
  let fixedTotal = 0
  for (let pass = 0; pass < 8; pass += 1) {
    let fixedInPass = 0
    for (const link of listSymlinks(stageDir)) {
      let target
      try {
        target = realpathSync(link)
      } catch (error) {
        if (error.code === 'ENOENT') continue // removed by an earlier fixup
        try {
          target = resolveLinkTarget(link) // dangling link
        } catch {
          continue // vanished mid-pass; the next pass re-checks
        }
      }
      if (target.startsWith(stageDir)) {
        // An ABSOLUTE symlink whose target happens to live inside the stage
        // still breaks once the stage is copied into the app bundle: its
        // readlink keeps pointing at this checkout's runtime-stage. Rewrite
        // it relative to its parent so the tree stays relocatable.
        let raw
        try {
          raw = readlinkSync(link)
        } catch {
          continue // vanished mid-pass; the next pass re-checks
        }
        if (isAbsolute(raw)) {
          rmSync(link)
          symlinkSync(relative(dirname(link), target), link)
          fixedInPass += 1
          continue
        }
        continue
      }
      const rel = relative(stageDir, link)
      if (rel === join('node_modules', '.pnpm', 'node_modules', '@deepseek-ai', 'dsh')) {
        // The deploy root's self-reference; point it at the staged app root.
        rmSync(link)
        symlinkSync('../../../../', link)
        fixedInPass += 1
        continue
      }
      if (!target.startsWith(repoRoot)) {
        fail(`symlink escapes to outside the repository: ${link} -> ${target}`)
      }
      rmSync(link)
      if (!existsSync(target)) continue // dangling dev-layout link inside a copied package
      if (!statSync(target).isDirectory()) {
        fail(`escaping symlink target is not a directory: ${link} -> ${target}`)
      }
      cpSync(target, link, { recursive: true })
      // The copied workspace package's dev node_modules points back at the
      // checkout; staged resolution walks up to the stage root instead.
      rmSync(join(link, 'node_modules'), { recursive: true, force: true })
      fixedInPass += 1
    }
    fixedTotal += fixedInPass
    if (fixedInPass === 0) return
  }
  fail('escaping-symlink fixup did not reach a fixpoint within 8 passes')
}

function verifyStage() {
  const offenders = []
  for (const link of listSymlinks(stageDir)) {
    let target
    try {
      target = realpathSync(link)
    } catch {
      offenders.push(`dangling: ${relative(stageDir, link)}`)
      continue
    }
    if (!target.startsWith(stageDir)) offenders.push(`escapes -> ${target}`)
  }
  if (offenders.length > 0) {
    fail(`stage verification failed:\n  ${offenders.slice(0, 20).join('\n  ')}`)
  }
  log('verify', `all ${listSymlinks(stageDir).length} symlinks resolve inside the stage`)
}

function fetchIndex(port) {
  return new Promise(resolvePromise => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, res => {
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

/** Boot the staged server under the bundled Node and require a complete boot
 * manifest - the same readiness contract the Electron shell applies. */
async function smokeTest(nodeBin) {
  const home = join(stageDir, '.smoke-home')
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  const server = spawn(nodeBin, ['lib/bin.js', 'web', '--port', String(smokePort)], {
    cwd: stageDir,
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
    while (Date.now() < deadline) {
      const { ok, body } = await fetchIndex(smokePort)
      const match = body.match(/window\.__DSH_BOOT__ = (\{[^<]+\})<\/script>/)
      const rev = match?.[1]?.match(/"rev":"([^"]+)"/)?.[1] ?? null
      const connected = body.includes('dsh-client-connection')
      if (ok && connected && rev !== null && rev === lastRev) {
        log('smoke', `server ready on :${smokePort} (manifest rev ${rev})`)
        return
      }
      if (rev !== null) lastRev = rev
      await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
    }
    console.error(output.slice(-4000))
    fail('smoke boot timed out')
  } finally {
    try {
      process.kill(-server.pid, 'SIGKILL')
    } catch {
      // already gone
    }
    rmSync(home, { recursive: true, force: true })
  }
}

const nodeBin = findNodeBin()
if (!nodeBin) fail('no node executable found; set NODE_BIN or put node on PATH')

const pnpmBin = join(macosAppDir, 'node_modules', '.bin', 'pnpm')
if (!existsSync(pnpmBin)) fail('pnpm not found; run npm install in macos-app first')

if (!skipBuild) {
  run('build', pnpmBin, ['run', 'build'])
}

generateManifest()
// Keep the checkout install in sync with the regenerated manifest so later
// `pnpm run` invocations do not trip the verify-deps-before-run drift check.
// --no-frozen-lockfile: CI=true (set for pnpm in run()) would otherwise pin
// the lockfile against the manifest we may have just regenerated.
run('install', pnpmBin, ['install', '--no-frozen-lockfile'])
rmSync(stageDir, { recursive: true, force: true })
// --config.node-linker=hoisted flattens the deploy's node_modules into real
// directories (no .pnpm symlink farm). electron-builder cannot copy scoped
// directories containing only pnpm links into extraResources, so the staged
// runtime must be materialized as regular files before packaging.
run('deploy', pnpmBin, ['--filter', manifestName, 'deploy', '--prod', '--legacy', '--config.node-linker=hoisted', relative(repoRoot, stageDir)])
overlayCli()
fixEscapingSymlinks()
verifyStage()
if (!skipSmoke) await smokeTest(nodeBin)

// Build fingerprint: changes on every dist run, independent of version bumps,
// so same-version hotfix rebuilds are still detected as updates by the
// running app (electron-builder bundles build/build-id into Resources).
const version = JSON.parse(readFileSync(join(macosAppDir, 'package.json'), 'utf8')).version
const buildId = `${version}.${Date.now().toString(36)}`
mkdirSync(join(macosAppDir, 'build'), { recursive: true })
writeFileSync(join(macosAppDir, 'build', 'build-id'), `${buildId}\n`)
// Short commit hash for the About panel (the sidebar no longer shows it).
let gitRev = ''
try {
  gitRev = execSync('git rev-parse --short HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim()
} catch {
  // tarball builds without a .git dir ship without the About-panel hash.
}
writeFileSync(join(macosAppDir, 'build', 'git-rev'), `${gitRev}\n`)
log('done', `${stageDir} (buildId ${buildId})`)
