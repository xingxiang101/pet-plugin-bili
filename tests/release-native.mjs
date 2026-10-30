// Native acceptance of the exact extracted release, independent of the private
// host. Media bytes use a real loopback HTTP server and the packaged FFmpeg.
// Bilibili metadata and the host AI/delivery APIs are bounded fixtures. This
// does not claim a production Bilibili login, real model result or rendered UI.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

assert.ok(process.env.BILI_RELEASE_DIR, 'BILI_RELEASE_DIR must be the verified ZIP extraction directory')
const release = fs.realpathSync(process.env.BILI_RELEASE_DIR)
const source = fileURLToPath(new URL('..', import.meta.url))
assert.notEqual(release, fs.realpathSync(source), 'exercise the installed package, not the source checkout')
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'manifest.json'), 'utf8'))
const platform = `${process.platform}-${process.arch}`
assert.ok(manifest.platforms.includes(platform), 'the release must declare the actual native runner')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-native-'))
const dataDir = path.join(temp, '缓存 with spaces')
fs.mkdirSync(dataDir)
const report = { platform, version: manifest.version, fixture: 'loopback-media-and-host-ai-contract', checks: [] }
const check = (value, label) => { assert.ok(value, label); report.checks.push(label) }
const previous = { NODE_OPTIONS: process.env.NODE_OPTIONS, FFMPEG: process.env.FFMPEG }
let server, engine, controller
try {
  const { findFfmpeg } = await import(pathToFileURL(path.join(release, 'src/media.mjs')).href)
  delete process.env.FFMPEG
  const binary = path.join(release, 'bin', platform, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  check(findFfmpeg() === binary, 'the installed package selects its own native FFmpeg')
  const binaryBytes = fs.readFileSync(binary)
  const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(binary), 'SOURCE.json'), 'utf8'))
  report.binarySha256 = crypto.createHash('sha256').update(binaryBytes).digest('hex')
  assert.equal(report.binarySha256, meta.sha256)
  if (process.platform === 'win32') {
    check(binaryBytes.subarray(0, 2).toString() === 'MZ', 'Windows executes a PE binary')
    const dependency = meta.staticDependencies.find(item => item.name === 'winpthreads')
    assert.equal(dependency?.licenseFile, 'licenses/winpthreads/COPYING')
    assert.equal(dependency.license, 'MIT AND BSD-3-Clause')
    const license = fs.readFileSync(path.join(path.dirname(binary), dependency.licenseFile))
    assert.equal(crypto.createHash('sha256').update(license).digest('hex'), dependency.licenseSha256)
    check(license.includes('Permission is hereby granted') && license.includes('Lockless Inc.'), 'the installed Windows binary includes its winpthreads MIT and BSD licenses')
  }
  const protocols = execFileSync(binary, ['-hide_banner', '-protocols'], { encoding: 'utf8', windowsHide: true })
  const names = protocols.split(/\r?\n/).map(line => line.trim()).filter(line => /^[a-z0-9_]+$/.test(line))
  check(names.length > 0 && names.every(name => ['file', 'pipe'].includes(name)), 'packaged FFmpeg exposes only file and pipe protocols')

  const load = createRequire(path.join(release, 'package.json'))
  const qr = await load('qrcode').toDataURL('https://passport.bilibili.com/scan?key=native-fixture', { width: 220 })
  const png = load('pngjs').PNG.sync.read(Buffer.from(qr.split(',')[1], 'base64'))
  check(load.resolve('qrcode').startsWith(release + path.sep) && png.width === 220 && png.height === 220, 'the installed production dependency closure generates a QR image')

  const video = path.join(dataDir, '测试 source.mp4')
  const generator = path.join(source, 'node_modules/ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  execFileSync(generator, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=4', '-t', '4', '-pix_fmt', 'yuv420p', video], { timeout: 30000, windowsHide: true })
  let downloads = 0
  server = createServer((req, res) => {
    assert.equal(req.url, '/source.mp4'); assert.equal(req.method, 'GET'); downloads++
    res.setHeader('content-type', 'video/mp4'); fs.createReadStream(video).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const media = `http://127.0.0.1:${server.address().port}/source.mp4`
  const cdn = 'https://upos-sz-mirrorcos.bilivideo.com/native-source.mp4'
  const preload = path.join(temp, 'media-fixture.mjs')
  fs.writeFileSync(preload, `const native=globalThis.fetch;globalThis.fetch=async(input,options={})=>{
    const url=new URL(input);if(options.method&&options.method!=='GET')throw Error('native fixture forbids Bilibili writes');
    if(url.pathname.endsWith('/nav'))return Response.json({code:0,data:{wbi_img:{img_url:'https://i0.hdslb.com/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i0.hdslb.com/4932caff0ff746eab6f01bf08b70ac45.png'}}});
    if(url.pathname.endsWith('/view'))return Response.json({code:0,data:{cid:12,title:'Native release video fixture',duration:4,owner:{name:'fixture'}}});
    if(url.pathname.endsWith('/playurl'))return Response.json({code:0,data:{quality:64,durl:[{url:${JSON.stringify(cdn)}}]}});
    if(url.href===${JSON.stringify(cdn)}){const r=await native(${JSON.stringify(media)},options);return new Response(r.body,{status:r.status,headers:r.headers})}
    throw Error('Unexpected native fixture URL '+url.href)
  }`)
  process.env.NODE_OPTIONS = '--import=' + pathToFileURL(preload).href
  const values = new Map(), secrets = new Map([['bili.credentials.native', JSON.stringify({ mid: '111', sessdata: 'synthetic-native-session', bili_jct: 'a'.repeat(32) })]])
  const prompts = [], deliveries = [], registered = new Map()
  const reply = '合成视频中的彩色图案已通过实际抽帧读取。这里没有音频转写。'
  const pet = {
    storage: { get: async (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback, set: async (key, value) => values.set(key, structuredClone(value)) },
    secrets: { get: async key => secrets.get(key), set: async (key, value) => secrets.set(key, value), delete: async key => secrets.delete(key) },
    tools: { register: item => registered.set(item.name, item) },
    ai: { start: async (prompt, options) => { prompts.push({ prompt, options }); return { id: 'native-model-fixture' } }, get: async () => ({ status: 'completed', text: reply }), deliver: async id => { deliveries.push(id); return true }, cancel: async () => true },
    scheduler: { every: async () => 'fixture-timer', cancel: async () => true },
  }
  const { createEngine } = await import(pathToFileURL(path.join(release, 'src/engine.mjs')).href)
  const { createController } = await import(pathToFileURL(path.join(release, 'src/controller.mjs')).href)
  engine = await createEngine({ pet, dataDir, scopeKey: 'native', secretKey: 'bili.credentials.native' })
  controller = await createController({ pet, engine, scopeKey: 'native' })
  controller.registerTools()
  const accepted = await registered.get('bili_watch_video').handler({ target: 'https://www.bilibili.com/video/BV1234567890/', question: '画面是什么？' }, { source: 'chat' })
  const request = JSON.parse(accepted.text)
  check(!!request.taskId, 'the chat tool immediately accepts an asynchronous watch task')
  const deadline = Date.now() + 90000
  let task
  while (Date.now() < deadline) {
    task = (await controller.getState()).tasks.find(item => item.id === request.taskId)
    if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(task?.status, 'completed', JSON.stringify(task))
  check(downloads === 1, 'video bytes are downloaded once through the real loopback HTTP server')
  check(prompts.length === 1 && prompts[0].options.images?.length > 0, 'the controller sends actual extracted images to one AI task')
  const images = prompts[0].options.images
  check(images.every(image => { const bytes = Buffer.from(image.split(',')[1], 'base64'); return image.startsWith('data:image/jpeg;base64,') && bytes[0] === 255 && bytes[1] === 216 && bytes.length > 1000 }), 'native FFmpeg yields nonempty JPEG frame material')
  check(images.join('').length <= 500 * 1024, 'image material remains within the model payload budget')
  assert.deepEqual(prompts[0].options.tools, [])
  check(prompts[0].prompt.includes('画面是什么？') && prompts[0].prompt.includes('Native release video fixture'), 'the original question and actual media text reach the AI contract')
  assert.deepEqual(deliveries, ['native-model-fixture'])
  check(task.delivery === 'chat', 'the final task is delivered to the chat contract exactly once')
  for (const file of ['.dsh/whale-diary.md', '.dsh/whale-diary-private.md']) assert.ok(String(await engine.readState(file)).includes(reply))
  check(true, 'both pet journals persist the completed reply')
  check(fs.readdirSync(path.join(engine.dataDir, '.dsh/shots/video')).some(name => name.endsWith('.mp4')), 'a cache path containing spaces and non-ASCII text works on this OS')
  report.ok = true
  console.log(`PASS native release ${platform}: ${report.checks.length} checks`)
} catch (error) {
  report.ok = false; report.error = error.stack; throw error
} finally {
  await controller?.dispose(); engine?.dispose()
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  const artifacts = path.join(source, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true })
  fs.writeFileSync(path.join(artifacts, `release-native-${platform}.json`), JSON.stringify(report, null, 2) + '\n')
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
