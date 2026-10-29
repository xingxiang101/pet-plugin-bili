#!/usr/bin/env node
// 统一入口：node bili.mjs <命令> [参数...]
// 只是把你转到 commands/ 或 verify/ 下的具体脚本，参数原样透传。
import { execFileSync } from './lib/capture.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NODE_EXE } from './lib/nodebin.mjs'   // 2026-10-21：别用 process.execPath（Electron 里它是主程序 ✗）

const here = path.dirname(fileURLToPath(import.meta.url))
import { COMMANDS as map } from './lib/commands.mjs'
import { helpText } from './lib/help.mjs'

const [cmd, ...rest] = process.argv.slice(2)
if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
  console.log(helpText())
  process.exit(cmd ? 0 : 2)
}
// 2026-10-21 修 Issue #5：这 9 个脚本只认位置参数（argv[2]/argv[3]/…），
//   但 help 和 README 教的是 --key 形式 → 参数原样透传进去后，脚本拿到的是字符串 "--bvid"，
//   拼出的 URL 变成 ?bvid=--bvid → B站回 -400，看起来特别像 WBI 失效 / cookie 过期（极易误判 ✗）
//   这里做一层翻译：只在"给出的键正好是期望顺序的前缀"时才转位置参数；给不全就不动，
//   让脚本原来的报错照旧暴露出来（不猜、不静默 ✗）
import { translateNamed } from './lib/cli-args.mjs'

const entry = map[cmd]
if (!entry) {
  console.error(`未知命令: ${cmd}\n跑 "node bili.mjs help" 看清单。`)
  process.exit(2)
}
try {
  process.stdout.write(execFileSync(NODE_EXE, [path.join(here, entry[0]), ...translateNamed(cmd, rest)], { encoding: 'utf8' }))
} catch (error) {
  if (error.stdout) process.stdout.write(String(error.stdout))
  if (error.stderr) process.stderr.write(String(error.stderr))
  process.exit(error.status ?? 1)
}
