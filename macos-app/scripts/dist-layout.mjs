/**
 * Shared dist-layout helpers for verify / install / feed generation.
 * electron-builder writes `dist/mac-<arch>/` and `*-<arch>-mac.zip`.
 * Callers that run after `--arm64` / `--x64` must pass that target via
 * `--arch`; falling back to a zip of the other architecture would publish
 * a stale artifact under a fresh buildId.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

/** True when `target` is `root` or a path inside it (not a prefix sibling). */
export function pathInside(root, target) {
  if (target === root) return true
  const prefix = root.endsWith(sep) ? root : root + sep
  return target.startsWith(prefix)
}

/** Arch electron-builder targeted, from `--arch <arm64|x64>` or the host. */
export function resolveMacArch(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--arch')
  if (index >= 0) {
    const value = argv[index + 1]
    if (value !== 'arm64' && value !== 'x64') {
      throw new Error(`unsupported --arch ${value ?? '(missing)'}; expected arm64 or x64`)
    }
    return value
  }
  if (process.arch === 'arm64' || process.arch === 'x64') return process.arch
  throw new Error(`unsupported host arch ${process.arch}; pass --arch arm64|x64`)
}

/** electron-builder mac output directory for one target arch; never the other. */
export function findMacDistRoot(distDir, arch = resolveMacArch(), argv = process.argv.slice(2)) {
  const preferred = join(distDir, `mac-${arch}`)
  if (existsSync(preferred)) return preferred
  // `electron-builder --mac` (no --arm64/--x64) writes `dist/mac/` for the
  // host arch. Explicit `--arch` must not pick that leftover up as the
  // other architecture.
  if (!argv.includes('--arch')) {
    const generic = join(distDir, 'mac')
    if (existsSync(generic)) return generic
  }
  return preferred
}

/** Zip electron-builder emitted for this version and arch; no cross-arch fallback. */
export function findMacZip(distDir, version, arch = resolveMacArch()) {
  if (!existsSync(distDir)) return null
  const suffix = `-${arch}-mac.zip`
  const files = readdirSync(distDir).filter(name =>
    name.endsWith(suffix) && name.includes(`-${version}-`))
  return files[0] ?? null
}
