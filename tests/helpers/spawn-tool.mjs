import { spawnSync as nativeSync, spawn as nativeSpawn } from 'node:child_process'
const fixture = new URL('./credentials-fixture.mjs', import.meta.url).href
function optionsWithFixture(options = {}) {
  const env = { ...process.env, ...options.env }
  env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --import=${fixture}`.trim()
  return { ...options, env }
}
export function spawnSync(file, args, options) { return nativeSync(file, args, optionsWithFixture(options)) }
export function spawn(file, args, options) { return nativeSpawn(file, args, optionsWithFixture(options)) }
