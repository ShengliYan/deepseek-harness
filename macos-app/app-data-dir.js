/**
 * `DSH_APP_DATA_DIR` test-isolation mode (integration §5.3).
 *
 * When set to an existing absolute directory, the shell runs in test mode:
 * the Electron `userData`, the main-process log, and the server subprocess's
 * `DSH_HOME` all live under that directory, the server is fixed to
 * `TEST_MODE_PORT`, the single-instance lock is independent of the
 * production app, and update checks are disabled. Validation failures are
 * fatal (the app must not silently fall back to the real `~/.dsh`).
 *
 * Pure module: no Electron imports, so it unit-tests under plain Node.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** Server port test mode always uses; an occupied port stops the launch. */
const TEST_MODE_PORT = 13080

/** Raised for any invalid `DSH_APP_DATA_DIR` value (fail loud, no fallback). */
class AppDataDirError extends Error {}

/**
 * Resolve the effective app-data mode from the environment.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {{ mode: 'production' } | { mode: 'test', dir: string }} `dir` is
 *   the normalized (symlinks resolved) test directory.
 * @throws {AppDataDirError} when `DSH_APP_DATA_DIR` is set but not an
 *   existing absolute directory, or overlaps the real `~/.dsh`.
 */
function resolveAppDataDir(env) {
  const raw = env.DSH_APP_DATA_DIR
  if (raw === undefined || raw === '') return { mode: 'production' }
  if (!path.isAbsolute(raw)) {
    throw new AppDataDirError(`DSH_APP_DATA_DIR 必须是绝对路径，当前是 "${raw}"`)
  }
  let dir
  try {
    dir = fs.realpathSync(raw)
  } catch (error) {
    throw new AppDataDirError(
      `DSH_APP_DATA_DIR 指向的目录不存在: ${raw} (${(error && error.code) || error.message})`,
    )
  }
  if (!fs.statSync(dir).isDirectory()) {
    throw new AppDataDirError(`DSH_APP_DATA_DIR 必须是一个目录: ${raw}`)
  }
  // Overlap with the real ~/.dsh defeats the isolation: reject the directory
  // itself, anything inside it, and any ancestor of it (its realpath is the
  // comparison anchor; a symlink into it is caught by resolution above).
  const homeDshPath = path.join(os.homedir(), '.dsh')
  const homeDsh = fs.existsSync(homeDshPath) ? fs.realpathSync(homeDshPath) : homeDshPath
  if (dir === homeDsh) {
    throw new AppDataDirError(`DSH_APP_DATA_DIR 不能是真实配置目录: ${homeDsh}`)
  }
  if (dir.startsWith(homeDsh + path.sep)) {
    throw new AppDataDirError(`DSH_APP_DATA_DIR 不能位于真实配置目录内: ${homeDsh}`)
  }
  if (homeDsh.startsWith(dir + path.sep)) {
    throw new AppDataDirError(`DSH_APP_DATA_DIR 不能包含真实配置目录: ${homeDsh}`)
  }
  return { mode: 'test', dir }
}

module.exports = { resolveAppDataDir, AppDataDirError, TEST_MODE_PORT }
