// Test-only fixture adapter. Production code never reads credential files.
// A getter preserves original tests that rotate fake cookies while asserting state.
import fs from 'node:fs'
import path from 'node:path'
if (!globalThis[Symbol.for('pet.bili.runtime')]) {
  globalThis[Symbol.for('pet.bili.runtime')] = {
    get credentials() {
      try { return JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || process.env.HOME, '.bili-ai', 'credentials.json'), 'utf8')) }
      catch { return {} }
    }
  }
}
