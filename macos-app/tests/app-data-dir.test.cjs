/**
 * Unit tests for the DSH_APP_DATA_DIR isolation-mode validation.
 * Runs under plain Node (no Electron): `node --test tests/`.
 *
 * HOME is redirected per test so the "real ~/.dsh" checks never touch the
 * developer's actual config directory.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { resolveAppDataDir, AppDataDirError, TEST_MODE_PORT } = require('../app-data-dir')

/** @returns {string} a fresh temp dir whose subtree is removed on `done` */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-app-data-'))
  return {
    root,
    home: fs.mkdtempSync(path.join(root, 'home-')),
    real: fs.mkdtempSync(path.join(root, 'real-')),
    done: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

/** Run `resolveAppDataDir` with `HOME` pointed at `sb.home`. */
function resolveWith(sb, env) {
  const prev = process.env.HOME
  process.env.HOME = sb.home
  try {
    return resolveAppDataDir(env)
  } finally {
    process.env.HOME = prev
  }
}

test('unset DSH_APP_DATA_DIR keeps production mode', () => {
  const sb = sandbox()
  try {
    assert.deepEqual(resolveWith(sb, {}), { mode: 'production' })
  } finally {
    sb.done()
  }
})

test('empty DSH_APP_DATA_DIR keeps production mode', () => {
  const sb = sandbox()
  try {
    assert.deepEqual(resolveWith(sb, { DSH_APP_DATA_DIR: '' }), { mode: 'production' })
  } finally {
    sb.done()
  }
})

test('an existing absolute directory resolves to test mode with a normalized path', () => {
  const sb = sandbox()
  try {
    const dir = path.join(sb.real, 'test-data')
    fs.mkdirSync(dir)
    const out = resolveWith(sb, { DSH_APP_DATA_DIR: dir })
    assert.equal(out.mode, 'test')
    assert.equal(out.dir, fs.realpathSync(dir))
  } finally {
    sb.done()
  }
})

test('a symlinked directory resolves through to its real path', () => {
  const sb = sandbox()
  try {
    const target = path.join(sb.real, 'target')
    const link = path.join(sb.real, 'link')
    fs.mkdirSync(target)
    fs.symlinkSync(target, link, 'dir')
    const out = resolveWith(sb, { DSH_APP_DATA_DIR: link })
    assert.equal(out.mode, 'test')
    assert.equal(out.dir, fs.realpathSync(target))
  } finally {
    sb.done()
  }
})

test('a relative path is rejected, not defaulted', () => {
  const sb = sandbox()
  try {
    assert.throws(
      () => resolveWith(sb, { DSH_APP_DATA_DIR: 'relative-dir' }),
      (error) => error instanceof AppDataDirError && /absolute|绝对路径/i.test(error.message),
    )
  } finally {
    sb.done()
  }
})

test('a missing directory is rejected, not created', () => {
  const sb = sandbox()
  try {
    const missing = path.join(sb.real, 'no-such-dir')
    assert.throws(
      () => resolveWith(sb, { DSH_APP_DATA_DIR: missing }),
      (error) => error instanceof AppDataDirError && /does not exist|不存在/.test(error.message),
    )
    assert.equal(fs.existsSync(missing), false)
  } finally {
    sb.done()
  }
})

test('a file (not a directory) is rejected', () => {
  const sb = sandbox()
  try {
    const file = path.join(sb.real, 'a-file')
    fs.writeFileSync(file, 'x')
    assert.throws(
      () => resolveWith(sb, { DSH_APP_DATA_DIR: file }),
      (error) => error instanceof AppDataDirError && /directory|目录/.test(error.message),
    )
  } finally {
    sb.done()
  }
})

test('the real ~/.dsh itself is rejected', () => {
  const sb = sandbox()
  try {
    fs.mkdirSync(path.join(sb.home, '.dsh'))
    assert.throws(
      () => resolveWith(sb, { DSH_APP_DATA_DIR: path.join(sb.home, '.dsh') }),
      (error) => error instanceof AppDataDirError,
    )
  } finally {
    sb.done()
  }
})

test('a subdirectory of the real ~/.dsh is rejected', () => {
  const sb = sandbox()
  try {
    const inside = path.join(sb.home, '.dsh', 'test-sandbox')
    fs.mkdirSync(inside, { recursive: true })
    assert.throws(
      () => resolveWith(sb, { DSH_APP_DATA_DIR: inside }),
      (error) => error instanceof AppDataDirError,
    )
  } finally {
    sb.done()
  }
})

test('an ancestor of the real ~/.dsh (the home dir) is rejected', () => {
  const sb = sandbox()
  try {
    fs.mkdirSync(path.join(sb.home, '.dsh'))
    assert.throws(
      () => resolveWith(sb, { DSH_APP_DATA_DIR: sb.home }),
      (error) => error instanceof AppDataDirError,
    )
  } finally {
    sb.done()
  }
})

test('a sibling of the real ~/.dsh is accepted', () => {
  const sb = sandbox()
  try {
    fs.mkdirSync(path.join(sb.home, '.dsh'))
    const sibling = path.join(sb.home, '.dsh-test')
    fs.mkdirSync(sibling)
    const out = resolveWith(sb, { DSH_APP_DATA_DIR: sibling })
    assert.equal(out.mode, 'test')
  } finally {
    sb.done()
  }
})

test('test mode port is the fixed 13080', () => {
  assert.equal(TEST_MODE_PORT, 13080)
})
