export function replyReadOptions(args) {
  const positionals = []
  let type = '1', referer = ''
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type') type = String(args[++i] || '')
    else if (args[i] === '--referer') referer = String(args[++i] || '')
    else if (args[i].startsWith('--')) throw Error('不支持的回读参数：' + args[i])
    else positionals.push(args[i])
  }
  if (!['1', '11', '17'].includes(type)) throw Error('评论 type 只支持 1、11、17')
  if (referer) {
    const url = new URL(referer)
    if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)bilibili\.com$/.test(url.hostname)) throw Error('回读 referer 必须是 B 站 HTTPS 页面')
  }
  return { positionals, type, referer }
}
