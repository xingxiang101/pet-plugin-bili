import { COMMANDS } from './commands.mjs'

export function helpText() {
  return [
    '用法: bili <命令> [参数...]',
    '',
    '命令:',
    ...Object.entries(COMMANDS).map(([name, [, desc]]) => `  ${name.padEnd(16)} ${desc}`),
    '',
    '安全约定（脚本里也强制）:',
    '  · 写操作必须显式给 --dry（只打印请求）或 --go（真的发）',
    '  · 先跑 session 确认账号；写操作后用 check-*/thread/history 回读复核',
    '  · 待审回复到 B 站生活面板审核',
    '  · 一次一条。批量、定时、多房间铺量不是这套工具的用途',
  ].join('\n')
}
