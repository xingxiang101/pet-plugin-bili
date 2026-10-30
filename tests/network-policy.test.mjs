import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { NETWORK_HOSTS, assertNetworkUrl, declaredFetch, declaredWebSocket, selectMediaUrl } from '../tools/lib/network-policy.mjs'
import { guardedFetch } from '../tools/lib/traffic.mjs'
import { apiGet } from '../tools/lib/bili-api.mjs'

const api = 'https://api.bilibili.com/x/web-interface/nav'
const media = 'https://upos-sz-mirrorcos.bilivideo.com/video.mp4?deadline=123'
test('manifest and README declare every permitted hostname exactly, without wildcards', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
  const hosts = manifest.permissions.filter(p => p.startsWith('net:')).map(p => p.slice(4))
  assert.deepEqual(hosts, [...NETWORK_HOSTS])
  assert.equal(new Set(hosts).size, hosts.length)
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  for (const host of hosts) { assert.doesNotMatch(host, /[*/]/); assert.ok(readme.includes('`' + host + '`'), host) }
})

test('undeclared, local, suffix-spoofed and nonstandard URLs never reach the transport', async () => {
  let calls = 0
  for (const url of ['https://example.com/video', 'http://127.0.0.1/file', 'https://localhost/file',
    'https://api.bilibili.com.evil.test/x', 'https://new-node.bilivideo.com/video',
    'http://api.bilibili.com/x', 'https://api.bilibili.com:8443/x', 'https://user:secret@api.bilibili.com/x']) {
    await assert.rejects(declaredFetch(url, {}, async () => { calls++; return new Response('') }), /未声明|限制/)
  }
  assert.equal(calls, 0)
})

test('API, subtitle, picture, video and explicit repository requests remain usable', async () => {
  const seen = []
  const transport = async (url, options) => { seen.push({ url: String(url), options }); return new Response('material') }
  for (const url of [api, media, 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/subtitle.json',
    'https://i0.hdslb.com/bfs/cover.jpg', 'https://api.github.com/repos/owner/repo',
    'https://raw.githubusercontent.com/owner/repo/main/README.md']) {
    assert.equal(await (await declaredFetch(url, { headers: { cookie: 'SESSDATA=private', authorization: 'private' } }, transport)).text(), 'material')
  }
  assert.equal(seen.length, 6)
  assert.equal(new Headers(seen[0].options.headers).get('cookie'), 'SESSDATA=private')
  for (const row of seen.slice(1)) {
    assert.equal(new Headers(row.options.headers).get('cookie'), null)
    assert.equal(new Headers(row.options.headers).get('authorization'), null)
    assert.equal(row.options.redirect, 'manual')
  }
})

test('redirect target must be declared before a second request, including manual mode', async () => {
  for (const target of ['https://unknown.test/file', 'http://127.0.0.1/file', 'https://api.bilibili.com.evil.test/file']) {
    for (const redirect of ['follow', 'manual']) {
      const calls = []
      const transport = async (url, options) => { calls.push([String(url), options.redirect]); return new Response('', { status: 302, headers: { location: target } }) }
      await assert.rejects(declaredFetch(api, { redirect }, transport), /未声明/)
      assert.deepEqual(calls, [[api, 'manual']])
    }
  }
})

test('declared read redirects preserve signed query but strip cross-origin credentials', async () => {
  const calls = []
  const transport = async (url, options) => {
    calls.push({ url: String(url), headers: new Headers(options.headers) })
    return calls.length === 1 ? new Response('', { status: 302, headers: { location: media } }) : new Response('video bytes')
  }
  const response = await declaredFetch(api, { headers: { cookie: 'private', authorization: 'private', range: 'bytes=0-' } }, transport)
  assert.equal(await response.text(), 'video bytes')
  assert.equal(calls[1].url, media)
  assert.equal(calls[1].headers.get('cookie'), null)
  assert.equal(calls[1].headers.get('authorization'), null)
  assert.equal(calls[1].headers.get('range'), 'bytes=0-')
})

test('relative redirects work, loops stop and writes never get replayed', async () => {
  let calls = 0
  await declaredFetch(api, {}, async () => ++calls === 1 ? new Response('', { status: 302, headers: { location: '/x/new' } }) : new Response('ok'))
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(declaredFetch(api, {}, async () => { calls++; return new Response('', { status: 302, headers: { location: '/x/loop' } }) }), /次数过多/)
  assert.equal(calls, 5)
  for (const status of [301, 302, 303, 307, 308]) {
    calls = 0
    await assert.rejects(declaredFetch(api, { method: 'POST', body: 'message=private' }, async () => { calls++; return new Response('', { status, headers: { location: '/x/new' } }) }), /写操作不会自动转发/)
    assert.equal(calls, 1)
  }
})

test('a transport cannot silently follow a redirect', async () => {
  const response = new Response('')
  Object.defineProperty(response, 'url', { value: media })
  await assert.rejects(declaredFetch(api, {}, async () => response), /绕过了逐跳校验/)
})

test('only the exact declared secure live nodes can create sockets', () => {
  const urls = []
  class Socket { constructor(url) { urls.push(url) } }
  declaredWebSocket('wss://broadcastlv.chat.bilibili.com:443/sub', Socket)
  assert.deepEqual(urls, ['wss://broadcastlv.chat.bilibili.com/sub'])
  for (const url of ['wss://new-node.chat.bilibili.com/sub', 'wss://broadcastlv.chat.bilibili.com.evil.test/sub', 'wss://api.bilibili.com/sub', 'ws://broadcastlv.chat.bilibili.com/sub', 'wss://broadcastlv.chat.bilibili.com:2245/sub'])
    assert.throws(() => declaredWebSocket(url, Socket), /未声明|限制/)
  assert.equal(urls.length, 1)
})

test('media selection uses a declared backup without contacting an unknown primary', () => {
  assert.equal(selectMediaUrl({ url: 'https://unknown.test/video', backup_url: [media] }), media)
  assert.throws(() => selectMediaUrl({ url: 'https://unknown.test/video' }), /unknown.test/)
  assert.equal(selectMediaUrl(undefined), null)
  assert.equal(assertNetworkUrl(media).hostname, 'upos-sz-mirrorcos.bilivideo.com')
})

test('legacy traffic-test mode cannot bypass network declarations', async () => {
  const oldFlag = process.env.BILI_TRAFFIC_TEST, oldFetch = globalThis.fetch
  let calls = 0
  process.env.BILI_TRAFFIC_TEST = '1'
  globalThis.fetch = async () => { calls++; return new Response('') }
  try { await assert.rejects(guardedFetch('https://unknown.test/video'), /未声明/); assert.equal(calls, 0) }
  finally { globalThis.fetch = oldFetch; if (oldFlag === undefined) delete process.env.BILI_TRAFFIC_TEST; else process.env.BILI_TRAFFIC_TEST = oldFlag }
})

test('API readers preserve the domain rejection instead of reporting an empty subtitle', async () => {
  const result = await apiGet('https://unregistered-subtitles.test/captions.json')
  assert.equal(result.code, -1)
  assert.match(result.message, /未声明网络域名 unregistered-subtitles.test/)
})

test('legacy webhook config fails visibly before any transport call, even for a declared URL', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-network-policy-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const config = path.join(directory, 'config.json'), hook = path.join(directory, 'fetch.mjs'), marker = path.join(directory, 'network-called')
  fs.writeFileSync(config, JSON.stringify({ notify: { type: 'webhook', url: api } }))
  fs.writeFileSync(hook, `import fs from 'node:fs';globalThis.fetch=async()=>{fs.writeFileSync(${JSON.stringify(marker)},'called');return new Response('{}')}`)
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, fileURLToPath(new URL('../tools/commands/notify.mjs', import.meta.url)), 'test notice'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, HOME: directory, USERPROFILE: directory, BILI_WHALE_CONFIG: config },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /市场版本暂未开放 Webhook/)
  assert.equal(fs.existsSync(marker), false)
})
