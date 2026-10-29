import { loadCred } from '../lib/cred.mjs'
import { makeHeaders, resolveLatestReply } from '../lib/msgfeed.mjs'
let items
try { items = JSON.parse(process.argv[2] || '[]') } catch { throw Error('reply-context 需要收件箱条目的 JSON 数组') }
if (!Array.isArray(items) || items.length > 20) throw Error('一次最多回读 20 条新回复')
const headers = makeHeaders(loadCred()), result = []
for (const item of items) {
  const fields = [item.business, item.oid, item.root || '0', item.mid, item.parent || '0'].map(String)
  if (!fields.every(value => /^\d{1,30}$/.test(value))) throw Error('回复坐标无效，停止回读')
  const reply = await resolveLatestReply({ business: fields[0], oid: fields[1], root: fields[2], mid: fields[3], parentRpid: fields[4], headers })
  result.push({ ...item, body: reply?.text || '', resolved: reply, exact: reply?.exact === true,
    rpid: reply?.rpid || null, parent: reply?.exact ? reply.rpid : item.parent })
}
console.log(JSON.stringify({ items: result }))
