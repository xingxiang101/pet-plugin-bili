import { loadCred } from '../lib/cred.mjs'
import { pullFeed, makeHeaders } from '../lib/msgfeed.mjs'
const cred = loadCred()
const headers = makeHeaders(cred)
const items = []
for (const type of ['reply', 'at']) {
  const list = await pullFeed(type, { headers, pages: 1 })
  for (const item of Array.isArray(list) ? list : list?.items || []) items.push({ ...item, channel: type })
}
console.log(JSON.stringify({ items }))
