// One locator for the tool worker and AI image encoder: explicit user path,
// verified platform-specific bundled binary, then PATH. No runtime downloads.
import { execFileSync } from './capture.mjs'
import { findFfmpeg } from '../../src/media.mjs'
export function ffmpegPath() { return findFfmpeg() }
export function requireFfmpeg() {
  const executable = ffmpegPath()
  if (executable) return executable
  throw Error('找不到 FFmpeg。请安装适配当前系统与芯片的插件包，或设置 FFMPEG 为已安装 FFmpeg 的绝对路径。')
}
export function ffmpegInfo() {
  let executable = null
  try {
    executable = ffmpegPath()
    if (!executable) return { ok: false, path: null, version: null }
    const out = execFileSync(executable, ['-hide_banner', '-version'], { encoding: 'utf8' })
    return { ok: true, path: executable, version: out.split('\n')[0].trim() }
  } catch (error) { return { ok: false, path: executable, version: null, error: String(error.message).slice(0, 200) } }
}
