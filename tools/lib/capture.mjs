// CLI output capture and private stdin handoff for nested fixed tool scripts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const preload = path.resolve(toolRoot, '../src/worker-preload.mjs')
export function execFileSync(file, args = [], options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-bili-capture-'))
  const out = path.join(dir, 'stdout'), err = path.join(dir, 'stderr')
  const fds = []
  try {
    fds.push(fs.openSync(out, 'wx', 0o600), fs.openSync(err, 'wx', 0o600))
    const runtime = globalThis[Symbol.for('pet.bili.runtime')]
    const candidate = typeof args[0] === 'string' ? path.resolve(args[0]) : ''
    const nested = runtime && candidate.startsWith(toolRoot + path.sep) && candidate.endsWith('.mjs')
    // --import follows ESM URL resolution; a Windows drive path is a scheme.
    const childArgs = nested ? ['--import', pathToFileURL(preload).href, ...args] : args
    const result = spawnSync(file, childArgs, { ...options, timeout: options.timeout ?? 120000,
      input: nested ? JSON.stringify(runtime) : undefined,
      windowsHide: true, stdio: [nested ? 'pipe' : 'ignore', ...fds] })
    for (const fd of fds.splice(0)) fs.closeSync(fd)
    const stdout = fs.readFileSync(out), stderr = fs.readFileSync(err)
    if (result.error || result.status !== 0 || stdout.length > (options.maxBuffer ?? 32 * 1024 * 1024)) {
      const e = result.error ?? new Error(`子进程失败 (${result.status}): ${stderr.toString('utf8').slice(0, 1000)}`)
      Object.assign(e, { status: result.status, stdout, stderr }); throw e
    }
    return options.encoding ? stdout.toString(options.encoding) : stdout
  } finally {
    for (const fd of fds) fs.closeSync(fd)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
