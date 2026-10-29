#!/bin/sh
# Build from a separately downloaded, pinned official FFmpeg source tree.
# This runs during development/CI, never at plugin runtime.
set -eu
source_dir=${1:?Pass an unpacked official FFmpeg n6.1.1 source directory}
output_dir=${2:?Pass an absolute output directory}
source_archive=${3:?Pass the pinned official FFmpeg n6.1.1 source tar.gz}
python3 - "$source_archive" <<'PY'
import hashlib, sys
from pathlib import Path
expected = '7c1ebea95d815e49c1e60c7ee816410dec73a81b8ac002b276780d2f9048e598'
if hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest() != expected:
    raise SystemExit('Official FFmpeg source archive SHA-256 mismatch')
PY
mkdir -p "$output_dir"
cd "$source_dir"
./configure --prefix="$output_dir" --disable-autodetect --disable-gpl --disable-nonfree \
  --enable-zlib --disable-doc --disable-debug --disable-everything --disable-programs --enable-ffmpeg \
  --disable-x86asm --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,flv,image2,image2pipe \
  --enable-muxer=image2,image2pipe,null,mp4 \
  --enable-decoder=h264,hevc,vp9,mjpeg,png,webp \
  --enable-parser=h264,hevc,vp9,mjpeg,png \
  --enable-encoder=mjpeg,png \
  --enable-filter=select,metadata,scale,crop,tile,null,format
make -j4 > "$output_dir/build.log" 2>&1
cp ffmpeg "$output_dir/ffmpeg"
cp COPYING.LGPLv2.1 "$output_dir/LICENSE"
"$output_dir/ffmpeg" -hide_banner -version > "$output_dir/version.txt"
python3 - "$source_archive" "$output_dir" <<'PY'
import hashlib, json, platform, shutil, sys
from pathlib import Path
archive, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
if archive != output / 'ffmpeg-source.tar.gz':
    shutil.copy2(archive, output / 'ffmpeg-source.tar.gz')
system = {'Darwin': 'darwin', 'Linux': 'linux', 'Windows': 'win32'}.get(platform.system(), platform.system().lower())
arch = {'x86_64': 'x64', 'AMD64': 'x64', 'aarch64': 'arm64'}.get(platform.machine(), platform.machine())
metadata = {'name': 'FFmpeg', 'version': 'n6.1.1',
    'sourceUrl': 'https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/refs/tags/n6.1.1',
    'sourceArchive': 'ffmpeg-source.tar.gz',
    'sourceSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'sha256': hashlib.sha256((output / 'ffmpeg').read_bytes()).hexdigest(),
    'license': 'LGPL-2.1-or-later', 'platform': system + '-' + arch,
    'buildScript': 'scripts/build-ffmpeg.sh',
    'configuration': (output / 'version.txt').read_text()}
(output / 'SOURCE.json').write_text(json.dumps(metadata, indent=2) + '\n')
PY
