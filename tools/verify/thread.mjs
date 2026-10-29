import { guardedFetch as fetch } from '../lib/traffic.mjs'
import { exactJson } from '../lib/json-exact.mjs'
import { replyReadOptions } from '../lib/reply-read-options.mjs'
// Dump the whole thread under our root comment: who said what, and how it nests.
let options
try { options = replyReadOptions(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exit(2) }
const [AID, BVID, ROOT] = options.positionals
if (!/^\d+$/.test(AID || '') || !/^\d+$/.test(ROOT || '')) { console.error('用法: thread <oid> <bvid或空字符串> <root> [--type 1|11|17] [--referer B站URL]'); process.exit(2) }
const REF = options.referer || (BVID ? `https://www.bilibili.com/video/${BVID}/` : 'https://www.bilibili.com/')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
// ⚠️ 楼中楼一页只给 20 条：只读第 1 页会**静默漏报**（超过 20 条时看不见）→ 翻页取全（2026-10-18 修）
async function fetchAll() {
  const all = []
  let root = null
  for (let pn = 1; pn <= 10; pn += 1) {
    const r = await fetch(`https://api.bilibili.com/x/v2/reply/reply?type=${options.type}&oid=${AID}&root=${ROOT}&pn=${pn}&ps=20`, {
      headers: { 'user-agent': UA, referer: REF, 'accept-language': 'zh-CN,zh;q=0.9' },
    })
    const j = await exactJson(r)
    if (j.code !== 0) return { code: j.code, message: j.message, data: { root, replies: all } }
    const rs = j.data?.replies ?? []
    root = root ?? j.data?.root
    all.push(...rs)
    if (rs.length < 20) break          // 不满一页 = 到底了
  }
  return { code: 0, data: { root, replies: all } }
}
const d = await fetchAll()
// 2026-10-21 修（外部审计 #7）：接口失败还 exit 0 → agent 会误判成「查到了、只是空的」✗
if (d.code !== 0) { console.log(`code=${d.code} message=${d.message}`); process.exit(4) }
const root = d.data?.root
if (!root) { console.error('未回读到线程根评论；不能据此确认已发布'); process.exit(4) }
console.log('=== 线程根（顶层评论） ===')
console.log(`  ${root.member.uname} (mid ${root.member.mid})  rpid=${root.rpid}  rcount=${root.rcount}`)
console.log(`  ${root.content.message}`)
const members = root.content?.members ?? []
if (members.length) console.log(`  @到: ${members.map((m) => `${m.uname}(mid ${m.mid})`).join(', ')}`)
console.log('')
console.log(`=== 楼中楼（${(d.data?.replies ?? []).length} 条） ===`)
for (const c of d.data?.replies ?? []) {
  const isMine = c.member.mid === root.member.mid
  console.log(`  [${isMine ? '小号' : '主号'}] ${c.member.uname}  rpid=${c.rpid}  parent=${c.parent}  ${new Date(c.ctime * 1000).toLocaleTimeString('zh-CN')}`)
  console.log(`       ${c.content.message}`)
  const m2 = c.content?.members ?? []
  if (m2.length) console.log(`       @到: ${m2.map((x) => `${x.uname}(mid ${x.mid})`).join(', ')}`)
}
console.log('')
console.log(`线程链接: ${REF.replace(/#.*$/, '')}#reply${root.rpid}`)
