import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
const exec = promisify(execFile)
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function prepareBundledFfmpeg(directory = packageDir, platform = process.platform, arch = process.arch) {
  const root = path.resolve(directory, 'bin', `${platform}-${arch}`)
  const binary = path.join(root, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  if (!fs.existsSync(binary)) return null
  const canonicalRoot = path.join(fs.realpathSync(directory), 'bin', `${platform}-${arch}`)
  const metadataFile = path.join(root, 'SOURCE.json')
  if (fs.realpathSync(root) !== canonicalRoot || fs.lstatSync(binary).isSymbolicLink() || fs.lstatSync(metadataFile).isSymbolicLink()) throw Error('随包 FFmpeg 路径不允许符号链接')
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
  const fd = fs.openSync(binary, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) throw Error('随包 FFmpeg 不是普通文件')
    const actual = crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex')
    if (!/^[a-f0-9]{64}$/i.test(metadata.sha256 || '') || actual !== metadata.sha256.toLowerCase()) throw Error('随包 FFmpeg 摘要不匹配，请重新安装插件')
    // Restore only the verified inode. Never chmod a PATH/env-provided executable.
    if (platform !== 'win32' && !(stat.mode & 0o111)) fs.fchmodSync(fd, 0o755)
  } finally { fs.closeSync(fd) }
  return binary
}
export function findFfmpeg() {
  if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG
  const bundled = prepareBundledFfmpeg()
  if (bundled) return bundled
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(p => path.join(p, name)).find(p => fs.existsSync(p)) || null
}
export async function collectImages(text, dataDir, { signal } = {}) {
  const images = [], warnings = []
  const paths = [...text.matchAll(/^(?:SHEET|SUBS|STRIP|封面)\s*[:：]\s*(.+?)(?:\s+\([^\n]*\))?$/gm)].map(x => x[1].trim())
  const root = await fs.promises.realpath(dataDir)
  const ffmpeg = findFfmpeg()
  let total = 0
  for (const filename of [...new Set(paths)].slice(0, 4)) {
    try {
      const actual = await fs.promises.realpath(filename)
      if (!actual.startsWith(root + path.sep)) throw Error('图片不在本插件缓存目录')
      const stat = await fs.promises.stat(actual)
      if (stat.size > 20 * 1024 * 1024) throw Error('图片超出处理上限')
      let bytes = await fs.promises.readFile(actual)
      const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      if (!png && !jpg && !webp) throw Error('图片文件格式无效')
      let type = png ? '.png' : webp ? '.webp' : '.jpg'
      const perImage = Math.min(96 * 1024, Math.floor((360 * 1024 - total) / Math.max(1, paths.length - images.length)))
      if (bytes.length > perImage) {
        if (!ffmpeg) throw Error('图片超过 AI 输入预算且找不到 FFmpeg 进行压缩')
        let fit = false
        for (const [width, q] of [[1600, 10], [1280, 16], [960, 24], [720, 28]]) {
          const result = await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', actual,
            '-vf', `scale='min(${width},iw)':-1`, '-frames:v', '1', '-q:v', String(q), '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
          { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, timeout: 30000, windowsHide: true, signal })
          bytes = result.stdout
          if (bytes.length <= perImage) { fit = true; type = '.jpg'; break }
        }
        if (!fit) throw Error('压缩后图片仍超过 AI 输入预算，请使用更小的抽帧网格')
      }
      const mime = type === '.png' ? 'image/png' : type === '.webp' ? 'image/webp' : type === '.jpg' || type === '.jpeg' ? 'image/jpeg' : null
      if (!mime) throw Error('仅支持 PNG、JPEG、WebP')
      const data = `data:${mime};base64,${bytes.toString('base64')}`
      if (images.join('').length + data.length > 500 * 1024) throw Error('图片总量超过 AI 输入预算')
      total += bytes.length
      images.push(data)
    } catch (error) { if (signal?.aborted) throw error; warnings.push(`图片未传入模型：${error.message}`) }
  }
  return { images, warnings }
}
