// Runs independently while the CLI thread blocks in FFmpeg/spawnSync.
import { workerData } from 'node:worker_threads'
import { execFileSync } from 'node:child_process'
const { parentPid, groupPid } = workerData
function stopOrphan() {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(groupPid), '/T', '/F'], { windowsHide: true, timeout: 10000, stdio: 'ignore' }) } catch {}
    process.kill(groupPid, 'SIGKILL')
  } else {
    try { process.kill(-groupPid, 'SIGKILL') } catch { process.kill(groupPid, 'SIGKILL') }
  }
}
setInterval(() => {
  try {
    if (process.platform !== 'win32' && process.ppid !== parentPid) { stopOrphan(); return }
    process.kill(parentPid, 0)
  } catch (error) { if (error.code === 'ESRCH') stopOrphan() }
}, 500)
