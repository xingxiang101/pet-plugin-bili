import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Only the dependency-probe subprocess is replaced. A real Node descendant
// blocks the real CLI's spawnSync, so taskkill /T and the orphan watchdog must
// clean up an actual process tree on Windows as well as POSIX process groups.
export function blockingSubprocessFixture(directory) {
  const pidFile = path.join(directory, 'blocked-child.pid')
  const executable = path.join(directory, process.platform === 'win32' ? 'fixture-ffmpeg.exe' : 'fixture-ffmpeg')
  const script = path.join(directory, 'blocked-child.mjs')
  const preload = path.join(directory, 'block-subprocess-preload.mjs')
  fs.writeFileSync(executable, 'test-only executable marker')
  fs.writeFileSync(script, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`)
  fs.writeFileSync(preload, `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const native=cp.spawnSync;
cp.spawnSync=(file,args,options)=>file===${JSON.stringify(executable)}?native(process.execPath,[${JSON.stringify(script)}],options):native(file,args,options);
syncBuiltinESMExports();`)
  return { pidFile, env: { FFMPEG: executable, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() } }
}
