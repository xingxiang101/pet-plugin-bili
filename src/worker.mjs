import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { COMMANDS } from '../tools/lib/commands.mjs'
import { translateNamed } from '../tools/lib/cli-args.mjs'
const watchdog = new Worker(new URL('./worker-watchdog.mjs', import.meta.url), { workerData: { parentPid: process.ppid, groupPid: process.pid } })
watchdog.unref()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.once('message', async message => {
  try {
    if (message?.type !== 'run' || !Array.isArray(message.args)) throw Error('无效作业')
    const [command, ...args] = message.args
    const entry = COMMANDS[command]
    if (!Object.hasOwn(COMMANDS, command) || !entry) throw Error('不支持的命令')
    globalThis[Symbol.for('pet.bili.runtime')] = message.runtime
    const file = path.join(root, 'tools', entry[0])
    process.argv = [process.execPath, file, ...translateNamed(command, args)]
    process.chdir(message.dataDir)
    // The IPC handle must not keep one-shot commands alive. Parent tracks exit.
    process.channel?.unref()
    await import(pathToFileURL(file).href)
  } catch (error) {
    console.error(String(error?.message || error))
    process.exitCode = 3
    process.channel?.unref()
  }
})
