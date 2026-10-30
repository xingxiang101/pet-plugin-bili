#!/usr/bin/env python3
"""Validate the actual multi-platform ZIP and optionally stage it for native tests."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = ['darwin-arm64', 'win32-x64']
SOURCE_SHA = '7c1ebea95d815e49c1e60c7ee816410dec73a81b8ac002b276780d2f9048e598'
ZLIB_SHA = 'd7a0654783a4da529d1bb793b7ad9c3318020af77667bcae35f95d0e42a792f3'
parser = argparse.ArgumentParser()
parser.add_argument('--write-receipt', action='store_true')
parser.add_argument('--extract', type=Path)
parser.add_argument('--install-test-binaries', action='store_true')
args = parser.parse_args()
manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
package = ROOT / 'dist' / ('bili-' + manifest['version'] + '.zip')
digest = hashlib.sha256(package.read_bytes()).hexdigest()
if manifest.get('platforms') != PLATFORMS:
    raise SystemExit('Release manifest must declare exactly macOS arm64 and Windows x64')
if args.write_receipt:
    build = json.loads((ROOT / 'dist/build.json').read_text(encoding='utf-8'))
    if (build['sha256'] != digest or build['bytes'] != package.stat().st_size or
            build['platforms'] != PLATFORMS or build['systemFfmpegRequired'] or not build['nodeAccess']):
        raise SystemExit('Final package metadata mismatch')
else:
    checksum = package.with_suffix('.zip.sha256').read_text(encoding='utf-8').strip().split()
    receipt = json.loads((ROOT / 'dist/release.json').read_text(encoding='utf-8'))
    if (checksum != [digest, package.name] or receipt['sha256'] != digest or
            receipt['bytes'] != package.stat().st_size or receipt['file'] != package.name or
            receipt['platforms'] != PLATFORMS or receipt['sourceSha'] != os.environ.get('GITHUB_SHA', receipt['sourceSha'])):
        raise SystemExit('Downloaded package differs from the candidate checksum or provenance')
with zipfile.ZipFile(package) as archive:
    entries = archive.infolist()
    names = {info.filename for info in entries}
    if len(names) != len(entries):
        raise SystemExit('Duplicate ZIP entries')
    for info in entries:
        item = PurePosixPath(info.filename)
        if (item.is_absolute() or '..' in item.parts or '\\' in info.filename or ':' in info.filename or
                stat.S_ISLNK(info.external_attr >> 16)):
            raise SystemExit('Unsafe ZIP entry: ' + info.filename)
    required = {manifest['entry']['tool'], manifest['entry']['panel']['src'],
                'lib/auth.js', 'lib/credential-values.js', 'node_modules/qrcode/lib/index.js',
                'scripts/build-ffmpeg.sh', 'LICENSE', 'NOTICE.md'}
    if not required.issubset(names) or json.loads(archive.read('manifest.json')) != manifest:
        raise SystemExit('Final ZIP is missing runtime assets or has a different manifest')
    if any(name.startswith(('artifacts/', 'dist/', 'node_modules/ffmpeg-static/')) for name in names):
        raise SystemExit('Development assets leaked into the install ZIP')
    for platform_id in PLATFORMS:
        prefix = 'bin/' + platform_id + '/'
        binary = 'ffmpeg.exe' if platform_id.startswith('win32-') else 'ffmpeg'
        required = {prefix + name for name in (binary, 'LICENSE', 'SOURCE.json', 'version.txt', 'ffmpeg-source.tar.gz', 'protocols.txt')}
        if not required.issubset(names):
            raise SystemExit('Missing bundled FFmpeg or provenance for ' + platform_id)
        source = json.loads(archive.read(prefix + 'SOURCE.json'))
        if (source['platform'] != platform_id or source['buildScript'] != 'scripts/build-ffmpeg.sh' or
                source['sourceSha256'] != SOURCE_SHA or
                hashlib.sha256(archive.read(prefix + binary)).hexdigest() != source['sha256'] or
                hashlib.sha256(archive.read(prefix + source['sourceArchive'])).hexdigest() != SOURCE_SHA):
            raise SystemExit('Packaged FFmpeg provenance mismatch: ' + platform_id)
        if not archive.getinfo(prefix + binary).external_attr >> 16 & 0o111:
            raise SystemExit('Packaged FFmpeg is not executable')
        configuration = archive.read(prefix + 'version.txt').decode()
        if '--enable-gpl' in configuration or '--enable-nonfree' in configuration or '--disable-network' not in configuration:
            raise SystemExit('FFmpeg build configuration is not the approved LGPL offline configuration')
        protocols = {line.strip() for line in archive.read(prefix + 'protocols.txt').decode().splitlines() if line.startswith('  ')}
        if protocols != {'file', 'pipe'}:
            raise SystemExit('FFmpeg protocol allowlist differs from file/pipe')
        if platform_id == 'win32-x64':
            required = {'ZLIB-LICENSE', 'zlib-source.tar.xz', 'dependencies.json', 'build-toolchain.txt',
                        'licenses/gcc-runtime/COPYING3', 'licenses/gcc-runtime/COPYING.RUNTIME',
                        'licenses/mingw-runtime/COPYING'}
            if not {prefix + name for name in required}.issubset(names):
                raise SystemExit('Windows static dependency licenses/source are missing')
            if hashlib.sha256(archive.read(prefix + 'zlib-source.tar.xz')).hexdigest() != ZLIB_SHA:
                raise SystemExit('Windows zlib source checksum mismatch')
    if args.extract:
        destination = args.extract.resolve()
        if destination.exists():
            raise SystemExit('Native test extraction directory must be new')
        destination.mkdir(parents=True)
        archive.extractall(destination)
        for info in entries:
            target = destination / info.filename
            if target.is_file():
                target.chmod((info.external_attr >> 16) & 0o777 or 0o644)
        if args.install_test_binaries:
            shutil.copytree(destination / 'bin', ROOT / 'bin', dirs_exist_ok=True)
    elif args.install_test_binaries:
        raise SystemExit('--install-test-binaries requires --extract')
if args.write_receipt:
    package.with_suffix('.zip.sha256').write_text(digest + '  ' + package.name + '\n', encoding='utf-8')
    receipt = {'schemaVersion': 1, 'repository': os.environ['GITHUB_REPOSITORY'],
               'sourceSha': os.environ['GITHUB_SHA'], 'workflowRunId': os.environ['GITHUB_RUN_ID'],
               'pluginId': manifest['id'], 'version': manifest['version'], 'file': package.name,
               'sha256': digest, 'bytes': package.stat().st_size, 'platforms': PLATFORMS,
               'minHostVersion': manifest['minHostVersion'], 'nodeAccess': True,
               'status': 'ci-candidate', 'hostCompatibility': 'separate-host-validation-required'}
    (ROOT / 'dist/release.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    (ROOT / 'dist/RELEASE_NOTES.md').write_text(
        'B 站生活 ' + manifest['version'] + ' — macOS arm64 and Windows x64 testing candidate.\n\n'
        'One install ZIP includes native LGPL FFmpeg binaries, their pinned original source, '
        'Windows static dependency source/licenses, and build provenance. Native plugin checks run on both platforms.\n\n'
        'Requires a compatible desktop-pet ' + manifest['minHostVersion'] + '+ testing build with '
        'background AI and completed chat reply delivery. Host validation and desktop-pet marketplace '
        'registration are separate from this plugin build receipt.\n\n'
        'Source commit: `' + os.environ['GITHUB_SHA'] + '`. '
        'See `release.json` for the package digest and CI run identity.\n', encoding='utf-8')
print(json.dumps({'file': package.name, 'sha256': digest, 'platforms': PLATFORMS, 'verified': True}))
