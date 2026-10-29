import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { fork, execFile } from 'node:child_process'
import { COMMANDS } from '../tools/lib/commands.mjs'
import { normalizeCommandArgs } from '../tools/lib/cli-args.mjs'
import { collectImages, findFfmpeg } from './media.mjs'
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))
const KEY = 'bili.credentials'
const hash = v => crypto.createHash('sha256').update(v).digest('hex').slice(0, 24)
const json = value => typeof value === 'string' ? JSON.parse(value) : value
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
function boundedText(value) {
  const bytes = Buffer.from(value)
  return bytes.length <= 48 * 1024 ? value : bytes.subarray(0, 24 * 1024).toString('utf8') + '\n[中间输出已截断；可用更小范围重新查询]\n' + bytes.subarray(-24 * 1024).toString('utf8')
}
const FILE_FLAGS = new Set(['--image', '--file', '--text-file', '--textFile', '--out', '--out-dir', '--outDir'])

export async function createEngine({ pet, dataDir: explicitRoot, secretKey = KEY, notifySecretKey = 'bili.notify', scopeKey = 'default' } = {}) {
  if (!pet?.secrets?.get || !pet?.storage?.get) throw Error('插件加密仓与存储不可用')
  const storageKey = 'bili.engine.' + hash(String(scopeKey)) + '.rootId'
  let rootId = await pet.storage.get(storageKey)
  if (!/^[a-f0-9-]{36}$/.test(String(rootId || ''))) {
    rootId = crypto.randomUUID()
    await pet.storage.set(storageKey, rootId)
  }
  const root = path.resolve(explicitRoot ? path.join(explicitRoot, hash(String(scopeKey))) : path.join(os.homedir(), '.desktop-pet-plugin-data', 'bilibili', rootId))
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 })
  let currentDir, accountRevision = 0, disposed = false
  const jobs = new Map()
  async function credentials() {
    const raw = await pet.secrets.get(secretKey)
    try { return raw ? json(raw) : {} } catch { throw Error('加密仓中的 B 站登录信息无效，请重新登录') }
  }
  async function selectAccount(cred) {
    const account = String(cred.mid || cred.account?.mid || (cred.sessdata ? hash(String(cred.sessdata)) : 'anonymous'))
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(account)) throw Error('无效账号标识')
    const directory = path.join(root, account)
    await fs.promises.mkdir(path.join(directory, '.bili-ai'), { recursive: true, mode: 0o700 })
    await fs.promises.mkdir(path.join(directory, '.dsh'), { recursive: true, mode: 0o700 })
    return directory
  }
  currentDir = await selectAccount(await credentials())
  function rejectSymlinks(dest, dir = currentDir) {
    let part = dir
    for (const segment of ['', ...path.relative(dir, dest).split(path.sep)]) {
      part = path.join(part, segment)
      try { if (fs.lstatSync(part).isSymbolicLink()) throw Error('数据路径不允许符号链接') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  function relativeFile(relative) {
    if (typeof relative !== 'string' || relative.length > 200 || relative.includes('\0')) throw Error('无效数据路径')
    const dest = path.resolve(currentDir, relative)
    if (!dest.startsWith(currentDir + path.sep) || /(?:credentials|secrets)\.json$/i.test(dest)) throw Error('数据路径超出范围')
    rejectSymlinks(dest)
    return dest
  }
  async function readState(relative) {
    try { const raw = await fs.promises.readFile(relativeFile(relative), 'utf8'); return relative.endsWith('.json') ? JSON.parse(raw) : raw }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  async function writeState(relative, value) {
    const file = relativeFile(relative)
    const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw Error('状态文件超出上限')
    await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = file + '.' + crypto.randomUUID() + '.tmp'
    await fs.promises.writeFile(tmp, raw, { mode: 0o600 })
    await fs.promises.rename(tmp, file)
  }
  async function importFile(source) {
    if (disposed) throw Error('插件已停用')
    const revision = accountRevision, directory = currentDir
    if (typeof source !== 'string' || !path.isAbsolute(source) || !pet.files?.stat) throw Error('请先通过文件选择器授权文件')
    const granted = await pet.files.stat(source)
    if (!granted?.exists || !granted.isFile) throw Error('文件未授权或不可读取')
    const extension = path.extname(source).toLowerCase()
    if (!['.png','.jpg','.jpeg','.gif','.webp','.json','.txt','.md'].includes(extension)) throw Error('仅可导入图片、JSON 或文本文件')
    const limit = ['.json','.txt','.md'].includes(extension) ? 2 * 1024 * 1024 : 10 * 1024 * 1024
    if (fs.lstatSync(source).isSymbolicLink()) throw Error('不能导入符号链接')
    const handle = await fs.promises.open(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    let bytes
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > limit) throw Error('导入文件超过大小上限或不是普通文件')
      const buffer = Buffer.alloc(Math.min(limit, stat.size) + 1)
      let length = 0
      for (;;) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
        if (!bytesRead) break
        length += bytesRead
        if (length === buffer.length) throw Error('文件在导入时变化或超过大小上限')
      }
      bytes = buffer.subarray(0, length)
    } finally { await handle.close() }
    if (disposed || revision !== accountRevision || directory !== currentDir) throw Error('账号已变化，未导入文件')
    const name = path.basename(source)
    const relative = '.dsh/imports/' + crypto.randomUUID() + '-' + name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100)
    const target = relativeFile(relative)
    await fs.promises.mkdir(path.dirname(target), {recursive:true,mode:0o700})
    await fs.promises.writeFile(target, bytes, {mode:0o600,flag:'wx'})
    return {path:target,name,bytes:bytes.length}
  }
  const configRelative = '.dsh/bili-whale.config.json'
  function redact(text, runtime) {
    let value = String(text)
    const secrets = ['sessdata', 'bili_jct', 'buvid3'].map(key => runtime?.credentials?.[key]).concat(runtime?.notifySecrets?.url)
    for (const secret of secrets) {
      if (typeof secret !== 'string' || secret.length < 6) continue
      for (const item of new Set([secret, encodeURIComponent(secret)])) value = value.split(item).join('[已隐藏]')
    }
    return value
  }
  function snapshot(job) {
    return { id: job.id, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt,
      ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) }
  }
  function kill(job) {
    const child = job.child
    if (!child?.pid) return
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
    else { try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} } }
  }
  function cancel(id) {
    const job = jobs.get(id)
    if (!job || TERMINAL.has(job.status)) return false
    job.status = 'cancelled'; job.updatedAt = Date.now(); job.abort.abort(); kill(job)
    job.finish({ text: '作业已取消', images: [], exitCode: null, cancelled: true })
    return true
  }
  function validate(args, dir) {
    if (!Array.isArray(args) || !args.length || args.length > 128 || args.some(a => typeof a !== 'string' || a.includes('\0') || a.length > 20000)) throw Error('命令参数无效')
    if (!Object.hasOwn(COMMANDS, args[0])) throw Error('不支持的命令；仅可调用已登记的 B 站工具')
    for (let i = 1; i < args.length; i++) {
      const arg = args[i]
      const positionalFile = (args[0] === 'dynamic-edit' && i === 2) || (args[0] === 'ai-share' && args[1] === 'record' && i === 3) || (args[0] === 'watch-video' && i === 3 && !arg.startsWith('--'))
      if (positionalFile || FILE_FLAGS.has(args[i - 1]) || path.isAbsolute(arg)) {
        const resolved = path.resolve(dir, arg)
        if (!resolved.startsWith(dir + path.sep)) throw Error('工具文件只允许使用当前插件账号的缓存目录')
        rejectSymlinks(resolved, dir)
      }
    }
  }
  async function start(args, { signal, timeoutMs } = {}) {
    if (disposed) throw Error('插件已停用')
    if (signal?.aborted) throw Error('作业已取消')
    const revision = accountRevision
    const cred = await credentials(), dir = await selectAccount(cred)
    if (revision !== accountRevision || disposed) throw Error('账号已变化，未启动旧作业')
    currentDir = dir
    if (!Array.isArray(args) || !args.length || args.length > 128 || args.some(a => typeof a !== 'string' || a.includes('\0') || a.length > 20000)) throw Error('命令参数无效')
    args = normalizeCommandArgs(args)
    validate(args, dir)
    if ([...jobs.values()].filter(j => j.status === 'running').length >= 3) throw Error('后台作业已满，请稍后再试')
    const id = crypto.randomUUID(), abort = new AbortController()
    let finish
    const done = new Promise(resolve => { finish = resolve })
    const job = { id, status: 'running', createdAt: Date.now(), updatedAt: Date.now(), abort, done, finish }
    jobs.set(id, job)
    for (const [key, old] of jobs) if (jobs.size > 64 && TERMINAL.has(old.status)) jobs.delete(key)
    let notifySecrets = {}
    try { notifySecrets = json(await pet.secrets.get(notifySecretKey) || '{}') } catch {}
    const runtime = { credentials: cred, notifySecrets }
    if (disposed || revision !== accountRevision || signal?.aborted || job.status === 'cancelled') { cancel(id); return id }
    const env = { ...process.env, HOME: dir, USERPROFILE: dir, DSH_HOME: path.join(dir, '.dsh'), BILI_WHALE_CONFIG: path.join(dir, configRelative), BILI_PLUGIN_WORKER: '1' }
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
    // A dedicated process group owns FFmpeg and nested commands for cancellation.
    let child
    try { child = fork(worker, [], { execPath: process.execPath, execArgv: [], env,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }) } catch (error) {
      job.status = 'failed'; job.error = redact(error.message, runtime); job.updatedAt = Date.now(); finish({text:job.error,images:[],exitCode:null}); return id
    }
    job.child = child
    let output = '', truncated = false
    const collect = chunk => {
      if (Buffer.byteLength(output) + chunk.length > 512 * 1024) { truncated = true; return }
      output += chunk.toString('utf8')
    }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    const onAbort = () => cancel(id)
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { job.error = '作业超时；发送结果请先回读核查，不自动重发'; cancel(id) }, Math.max(1000, Math.min(Number(timeoutMs) || 30 * 60000, 45 * 60000)))
    timer.unref?.()
    child.once('error', error => { job.error = redact(error.message, runtime); job.status = 'failed' })
    child.once('close', async code => {
      job.child = null
      if (job.status === 'cancelled') { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); return }
      try {
        const media = await collectImages(output, dir, { signal: abort.signal })
        if (job.status === 'cancelled') return
        job.result = { text: boundedText(redact(output + (truncated ? '\n[输出已截断]' : '') + (media.warnings.length ? '\n' + media.warnings.join('\n') : ''), runtime)), images: media.images, exitCode: code }
        // CLI exit 1 is the normal no-hit contract used by listeners.
        job.status = code === 0 || (code === 1 && /"hit"\s*:\s*false/.test(output)) ? 'completed' : 'failed'
        if (job.status === 'failed' && !job.error) job.error = `工具退出码 ${code}；${job.result.text.slice(-600)}`
      } catch (error) { if (job.status !== 'cancelled') { job.error = redact(error.message, runtime); job.status = 'failed' } }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }

      job.updatedAt = Date.now(); finish(job.result || { text: job.error || '', images: [], exitCode: code })
    })
    try { child.send({ type: 'run', args, dataDir: dir, runtime }) } catch (error) { job.error = redact(error.message, runtime); cancel(id) }
    return id
  }
  async function run(args, options) {
    const id = await start(args, options)
    const job = jobs.get(id)
    return await job.done
  }
  async function accountChanged() {
    accountRevision++
    for (const [id] of jobs) cancel(id)
    const revision = accountRevision
    const directory = await selectAccount(await credentials())
    if (revision === accountRevision && !disposed) currentDir = directory
  }
  return {
    get dataDir() { return currentDir }, get configPath() { return path.join(currentDir, configRelative) },
    get rootDir() { return root },
    start, run, get(id) { const job = jobs.get(id); return job ? snapshot(job) : null }, cancel,
    getConfig: async () => await readState(configRelative) || {},
    setConfig: async config => {
      const safe = structuredClone(config)
      if (safe?.notify) { delete safe.notify.url; delete safe.notify.token }
      await writeState(configRelative, safe)
    },
    readState, writeState, importFile, accountChanged,
    dependencies: () => ({ ffmpeg: { ok: !!findFfmpeg(), path: findFfmpeg() }, node: process.versions.node }),
    dispose() { disposed = true; accountRevision++; for (const [id] of jobs) cancel(id) }
  }
}
