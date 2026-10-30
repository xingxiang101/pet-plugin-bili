#!/bin/sh
# Build from a separately downloaded, pinned official FFmpeg source tree.
# This runs during development/CI, never at plugin runtime.
set -eu
source_dir=${1:?Pass an unpacked official FFmpeg n6.1.1 source directory}
output_dir=${2:?Pass an absolute output directory}
source_archive=${3:?Pass the pinned official FFmpeg n6.1.1 source tar.gz}
zlib_archive=${4:-}
python3 - "$source_archive" <<'PY'
import hashlib, sys
from pathlib import Path
expected = '7c1ebea95d815e49c1e60c7ee816410dec73a81b8ac002b276780d2f9048e598'
if hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest() != expected:
    raise SystemExit('Official FFmpeg source archive SHA-256 mismatch')
PY
mkdir -p "$output_dir"
binary_name=ffmpeg
case "$(uname -s)" in
  Darwin)
    test "$(uname -m)" = arm64
    platform_id=darwin-arm64
    set --
    ;;
  MINGW*|MSYS*)
    test "${MSYSTEM:-}" = UCRT64
    test "$(uname -m)" = x86_64
    platform_id=win32-x64
    binary_name=ffmpeg.exe
    : "${zlib_archive:?Pass the pinned official zlib 1.3.2 tar.xz for Windows}"
    python3 - "$zlib_archive" <<'PY'
import hashlib, sys
from pathlib import Path
expected = 'd7a0654783a4da529d1bb793b7ad9c3318020af77667bcae35f95d0e42a792f3'
if hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest() != expected:
    raise SystemExit('Official zlib source archive SHA-256 mismatch')
PY
    zlib_build="$source_dir/bili-zlib"
    mkdir -p "$zlib_build"
    tar -xf "$zlib_archive" -C "$zlib_build" --strip-components=1
    zlib_prefix="$source_dir/bili-zlib-install"
    (cd "$zlib_build" && CHOST=x86_64-w64-mingw32 CC=gcc ./configure --static --prefix="$zlib_prefix" && make -j4 && make install) > "$output_dir/zlib-build.log" 2>&1
    cp "$zlib_build/LICENSE" "$output_dir/ZLIB-LICENSE"
    cp "$zlib_archive" "$output_dir/zlib-source.tar.xz"
    mkdir -p "$output_dir/licenses/gcc-runtime" "$output_dir/licenses/mingw-runtime" "$output_dir/licenses/winpthreads"
    gcc_license_found=false
    for license_dir in libgcc gcc-libs gcc; do
      if test -f "$MINGW_PREFIX/share/licenses/$license_dir/COPYING.RUNTIME"; then
        cp "$MINGW_PREFIX/share/licenses/$license_dir/COPYING.RUNTIME" "$output_dir/licenses/gcc-runtime/"
        cp "$MINGW_PREFIX/share/licenses/$license_dir/COPYING3" "$output_dir/licenses/gcc-runtime/"
        gcc_license_found=true
        break
      fi
    done
    test "$gcc_license_found" = true
    cp "$MINGW_PREFIX/share/licenses/crt/"* "$output_dir/licenses/mingw-runtime/"
    # MinGW time functions can link winpthreads even with FFmpeg pthreads off.
    cp "$MINGW_PREFIX/share/licenses/winpthreads/COPYING" "$output_dir/licenses/winpthreads/COPYING"
    pacman -Q > "$output_dir/build-toolchain.txt"
    set -- --target-os=mingw32 --arch=x86_64 --cc=gcc \
      --extra-cflags="-I$zlib_prefix/include" \
      --extra-ldflags="-L$zlib_prefix/lib -static -static-libgcc" \
      --pkg-config-flags=--static --disable-pthreads --enable-w32threads
    ;;
  *) echo 'Only native darwin-arm64 and win32-x64 release builds are supported' >&2; exit 1 ;;
esac
cd "$source_dir"
./configure --prefix="$output_dir" --disable-autodetect --disable-gpl --disable-nonfree \
  --disable-shared --enable-static --disable-network \
  --enable-zlib --disable-doc --disable-debug --disable-everything --disable-programs --enable-ffmpeg \
  --disable-x86asm --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,flv,image2,image2pipe \
  --enable-muxer=image2,image2pipe,null,mp4 \
  --enable-decoder=h264,hevc,vp9,mjpeg,png,webp \
  --enable-parser=h264,hevc,vp9,mjpeg,png \
  --enable-encoder=mjpeg,png \
  --enable-filter=select,metadata,scale,crop,tile,null,format "$@"
make -j4 > "$output_dir/build.log" 2>&1
cp "$binary_name" "$output_dir/$binary_name"
cp COPYING.LGPLv2.1 "$output_dir/LICENSE"
"$output_dir/$binary_name" -hide_banner -version > "$output_dir/version.txt"
"$output_dir/$binary_name" -hide_banner -protocols > "$output_dir/protocols.txt"
python3 - "$source_archive" "$output_dir" "$platform_id" "$binary_name" <<'PY'
import hashlib, json, re, shutil, subprocess, sys
from pathlib import Path
archive, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
platform_id, binary_name = sys.argv[3:]
if archive != output / 'ffmpeg-source.tar.gz':
    shutil.copy2(archive, output / 'ffmpeg-source.tar.gz')
protocols = {line.strip() for line in (output / 'protocols.txt').read_text().splitlines() if line.startswith('  ')}
if protocols != {'file', 'pipe'}:
    raise SystemExit('Release FFmpeg must support only file and pipe protocols: ' + str(protocols))
dependencies = []
if platform_id == 'win32-x64':
    headers = subprocess.check_output(['objdump', '-f', str(output / binary_name)], text=True)
    if 'pei-x86-64' not in headers:
        raise SystemExit('Windows binary is not PE x86-64')
    imports = subprocess.check_output(['objdump', '-p', str(output / binary_name)], text=True)
    dlls = sorted(set(re.findall(r'DLL Name:\s*(\S+)', imports, re.I)))
    allowed = {'advapi32.dll', 'bcrypt.dll', 'kernel32.dll', 'msvcrt.dll', 'ntdll.dll',
               'ole32.dll', 'shell32.dll', 'user32.dll', 'ucrtbase.dll', 'ws2_32.dll'}
    if not dlls or any(name.lower() not in allowed and not re.fullmatch(r'api-ms-win-crt-[a-z0-9-]+\.dll', name, re.I) for name in dlls):
        raise SystemExit('Windows FFmpeg has a non-system DLL dependency: ' + str(dlls))
    (output / 'dependencies.json').write_text(json.dumps({'platform': platform_id, 'systemDlls': dlls}, indent=2) + '\n')
    packages = dict(line.split(maxsplit=1) for line in (output / 'build-toolchain.txt').read_text().splitlines())
    pthread_package = 'mingw-w64-ucrt-x86_64-winpthreads'
    pthread_version = packages[pthread_package]
    revision = re.search(r'\.g([0-9a-f]{7,40})(?:-|$)', pthread_version)
    release = re.fullmatch(r'(\d+\.\d+\.\d+)-\d+', pthread_version)
    if not revision and not release:
        raise SystemExit('Cannot resolve winpthreads source from the installed package version: ' + pthread_version)
    pthread_ref = revision.group(1) if revision else 'v' + release.group(1)
    pthread_license = 'licenses/winpthreads/COPYING'
    pthread_text = (output / pthread_license).read_text()
    if 'Permission is hereby granted' not in pthread_text or 'Lockless Inc.' not in pthread_text:
        raise SystemExit('winpthreads COPYING must retain both MIT and BSD copyright notices')
    dependencies = [{'name': 'zlib', 'version': '1.3.2', 'license': 'Zlib', 'licenseFile': 'ZLIB-LICENSE',
        'sourceUrl': 'https://github.com/madler/zlib/releases/download/v1.3.2/zlib-1.3.2.tar.xz',
        'sourceArchive': 'zlib-source.tar.xz',
        'sourceSha256': hashlib.sha256((output / 'zlib-source.tar.xz').read_bytes()).hexdigest()},
        {'name': 'GCC runtime', 'version': subprocess.check_output(['gcc', '-dumpfullversion'], text=True).strip(),
         'license': 'GPL-3.0-or-later WITH GCC-exception-3.1', 'licenseFile': 'licenses/gcc-runtime/COPYING.RUNTIME',
         'sourceUrl': 'https://gcc.gnu.org/releases.html', 'packagesFile': 'build-toolchain.txt'},
        {'name': 'MinGW-w64 runtime', 'licenseFile': 'licenses/mingw-runtime/COPYING',
         'sourceUrl': 'https://www.mingw-w64.org/', 'packagesFile': 'build-toolchain.txt'},
        {'name': 'winpthreads', 'version': pthread_version, 'packageName': pthread_package,
         'license': 'MIT AND BSD-3-Clause', 'licenseFile': pthread_license,
         'licenseSha256': hashlib.sha256((output / pthread_license).read_bytes()).hexdigest(),
         'sourceRef': pthread_ref,
         'sourceUrl': 'https://github.com/mingw-w64/mingw-w64/tree/' + pthread_ref + '/mingw-w64-libraries/winpthreads',
         'packagesFile': 'build-toolchain.txt'}]
else:
    if subprocess.check_output(['lipo', '-archs', str(output / binary_name)], text=True).strip() != 'arm64':
        raise SystemExit('macOS binary must contain only arm64')
    libraries = subprocess.check_output(['otool', '-L', str(output / binary_name)], text=True).splitlines()[1:]
    for line in libraries:
        library = line.strip().split(' (', 1)[0]
        if not library.startswith(('/usr/lib/', '/System/Library/')):
            raise SystemExit('macOS FFmpeg has a non-system dynamic dependency: ' + library)
metadata = {'name': 'FFmpeg', 'version': 'n6.1.1',
    'sourceUrl': 'https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/refs/tags/n6.1.1',
    'sourceArchive': 'ffmpeg-source.tar.gz',
    'sourceSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'sha256': hashlib.sha256((output / binary_name).read_bytes()).hexdigest(),
    'license': 'LGPL-2.1-or-later', 'platform': platform_id,
    'buildScript': 'scripts/build-ffmpeg.sh',
    'staticDependencies': dependencies,
    'configuration': (output / 'version.txt').read_text()}
(output / 'SOURCE.json').write_text(json.dumps(metadata, indent=2) + '\n')
PY
