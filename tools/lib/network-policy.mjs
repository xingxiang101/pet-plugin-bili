// Market network contract. Keep this exact list in manifest.json and README.md.
// An API-provided URL is data, not permission to contact another host.
export const NETWORK_HOSTS = Object.freeze([
  'api.bilibili.com', 'passport.bilibili.com', 'api.vc.bilibili.com',
  'api.live.bilibili.com', 'live.bilibili.com', 'www.bilibili.com', 'comment.bilibili.com',
  'i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com', 'aisubtitle.hdslb.com',
  'upos-sz-estgcos.bilivideo.com', 'upos-sz-mirrorcos.bilivideo.com', 'upos-sz-mirrorcosb.bilivideo.com',
  'upos-sz-mirrorcoso1.bilivideo.com', 'upos-sz-mirrorcosov.bilivideo.com',
  'upos-sz-mirrorali.bilivideo.com', 'upos-sz-mirroralib.bilivideo.com',
  'upos-sz-mirroraliov.bilivideo.com', 'upos-sz-mirrorhw.bilivideo.com',
  'upos-sz-mirrorhwb.bilivideo.com', 'upos-sz-mirrorhwfn.bilivideo.com',
  'upos-sz-mirror08c.bilivideo.com', 'upos-sz-mirror08h.bilivideo.com',
  'upos-sz-mirror08ct.bilivideo.com', 'upos-hz-mirrorakam.akamaized.net',
  'broadcastlv.chat.bilibili.com', 'broadcast.chat.bilibili.com',
  'api.github.com', 'raw.githubusercontent.com',
])
const allowed = new Set(NETWORK_HOSTS)
const sockets = new Set(['broadcastlv.chat.bilibili.com', 'broadcast.chat.bilibili.com'])
const credentialHosts = new Set(['api.bilibili.com', 'passport.bilibili.com', 'api.vc.bilibili.com', 'api.live.bilibili.com', 'live.bilibili.com', 'www.bilibili.com', 'comment.bilibili.com'])
export const WEBHOOK_UNAVAILABLE = '市场版本暂未开放 Webhook 通知，请选择系统通知或主人 B 站私信。'

export class NetworkPolicyError extends Error {
  constructor(message) { super(message); this.name = 'NetworkPolicyError'; this.code = 'BILI_NETWORK_DENIED' }
}
export function assertNetworkUrl(input, { websocket = false } = {}) {
  let url
  try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url) }
  catch { throw new NetworkPolicyError('网络地址无效，已停止请求。') }
  if (!allowed.has(url.hostname)) throw new NetworkPolicyError(`市场版本未声明网络域名 ${url.hostname}，已停止请求。请向插件维护者反馈该域名。`)
  if (url.username || url.password || url.port || url.protocol !== (websocket ? 'wss:' : 'https:') || websocket && !sockets.has(url.hostname))
    throw new NetworkPolicyError('网络地址不符合市场版本限制：仅允许已声明域名的标准 HTTPS / WSS 地址。')
  url.hash = ''
  return url
}

/** Follow read redirects only, checking every target before dispatch. */
export async function declaredFetch(input, options = {}, transport = (...args) => globalThis.fetch(...args)) {
  let url = assertNetworkUrl(input)
  const original = input
  let init = { ...options, redirect: 'manual' }
  const initialHeaders = options.headers ?? input?.headers
  if (initialHeaders && !credentialHosts.has(url.hostname)) {
    const headers = new Headers(initialHeaders)
    for (const key of ['cookie', 'authorization', 'proxy-authorization']) headers.delete(key)
    init.headers = headers
  }
  const method = String(options.method ?? input?.method ?? 'GET').toUpperCase()
  const requestedRedirect = options.redirect ?? input?.redirect ?? 'follow'
  for (let hop = 0; ; hop++) {
    const response = await transport(hop === 0 ? original : url.href, init)
    // Native fetch is manual. Also refuse a transport that followed behind us.
    if (response.url && new URL(response.url).href !== url.href) {
      assertNetworkUrl(response.url)
      await response.body?.cancel().catch(() => {})
      throw new NetworkPolicyError('网络传输绕过了逐跳校验，已停止请求。')
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (!location) return response
    let next
    try { next = assertNetworkUrl(new URL(location, url)) }
    catch (error) {
      await response.body?.cancel().catch(() => {})
      if (error instanceof NetworkPolicyError) throw error
      throw new NetworkPolicyError('重定向地址无效，已停止请求。')
    }
    if (requestedRedirect === 'manual') return response
    await response.body?.cancel().catch(() => {})
    if (requestedRedirect === 'error' || !['GET', 'HEAD'].includes(method))
      throw new NetworkPolicyError('该请求不允许重定向，已停止请求；写操作不会自动转发。')
    if (hop >= 4) throw new NetworkPolicyError('网络重定向次数过多，已停止请求。')
    const headers = new Headers(init.headers ?? (hop === 0 ? input?.headers : undefined))
    if (next.origin !== url.origin) for (const key of ['cookie', 'authorization', 'proxy-authorization']) headers.delete(key)
    init = { ...init, method, headers }
    url = next
  }
}

export function declaredWebSocket(input, WebSocketClass = globalThis.WebSocket) {
  const url = assertNetworkUrl(input, { websocket: true })
  // Node's WHATWG WebSocket fails the handshake on HTTP redirects.
  return new WebSocketClass(url.href)
}

export function selectMediaUrl(segment) {
  const candidates = [segment?.url, ...(Array.isArray(segment?.backup_url) ? segment.backup_url : [])].filter(Boolean)
  let error
  for (const candidate of candidates) {
    try { return assertNetworkUrl(candidate).href } catch (e) { error ??= e }
  }
  if (error) throw error
  return null
}
