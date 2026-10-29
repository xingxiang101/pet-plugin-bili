// Nested fixed CLI commands receive secrets through stdin, never argv/env/files.
import fs from 'node:fs'
if (process.env.BILI_PLUGIN_WORKER === '1' && !globalThis[Symbol.for('pet.bili.runtime')]) {
  const input = fs.readFileSync(0, 'utf8')
  if (input.length > 64 * 1024) throw Error('运行凭据超出限制')
  globalThis[Symbol.for('pet.bili.runtime')] = JSON.parse(input)
}
