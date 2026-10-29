#!/usr/bin/env python3
"""Build a deterministic plugin ZIP; never download code during plugin execution."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--system-ffmpeg', action='store_true', help='Development package requiring a preinstalled FFmpeg')
args = parser.parse_args()
manifest = json.loads((ROOT / 'manifest.json').read_text())
def checked_path(source, boundary=ROOT, directory=False):
    source = Path(source).absolute()
    boundary = Path(boundary).resolve(strict=True)
    if not source.is_relative_to(boundary):
        parser.error('Asset path escapes its allowed directory: ' + str(source))
    cursor = boundary
    for segment in source.relative_to(boundary).parts:
        cursor = cursor / segment
        if cursor.is_symlink():
            parser.error('Symlink is not a releasable asset: ' + str(cursor))
    resolved = source.resolve(strict=True)
    if not resolved.is_relative_to(boundary):
        parser.error('Resolved asset escapes its allowed directory: ' + str(source))
    if directory and not resolved.is_dir():
        parser.error('Expected an asset directory: ' + str(source))
    if not directory and not resolved.is_file():
        parser.error('Expected an asset file: ' + str(source))
    return source


ffmpeg_files = sorted(p for p in (ROOT / 'bin').glob('*/ffmpeg*') if p.name in ('ffmpeg', 'ffmpeg.exe'))
if not args.system_ffmpeg and not ffmpeg_files:
    parser.error('No bundled FFmpeg. Build an audited binary first, or explicitly pass --system-ffmpeg for a development package.')
for binary in ffmpeg_files:
    checked_path(binary)
    for required in ('LICENSE', 'SOURCE.json', 'version.txt'):
        if not (binary.parent / required).is_file():
            parser.error('Missing FFmpeg provenance: ' + str(binary.parent / required))
        checked_path(binary.parent / required)
    metadata = json.loads((binary.parent / 'SOURCE.json').read_text())
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    if metadata.get('sha256') != digest:
        parser.error('Bundled FFmpeg digest differs from SOURCE.json: ' + str(binary))
    archive_name = metadata.get('sourceArchive', '')
    if not archive_name or Path(archive_name).name != archive_name:
        parser.error('FFmpeg source archive must be bundled beside the binary')
    archive = checked_path(binary.parent / archive_name)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != metadata.get('sourceSha256'):
        parser.error('FFmpeg source archive digest differs from SOURCE.json')
    if metadata.get('platform') != binary.parent.name or metadata.get('buildScript') != 'scripts/build-ffmpeg.sh':
        parser.error('FFmpeg platform or reproducible build script differs from the packaged assets')
    version = (binary.parent / 'version.txt').read_text()
    if '--enable-nonfree' in version or '--enable-gpl' in version:
        parser.error('This package configuration requires the prepared LGPL build, not a nonfree/GPL local binary.')
files = [ROOT / name for name in ('index.cjs', 'manifest.json', 'LICENSE', 'NOTICE.md', 'README.md', 'UPSTREAM-README.md', 'package.json', 'scripts/build-ffmpeg.sh')]
for dirname in ('src', 'panel', 'tools', 'bin'):
    directory = ROOT / dirname
    if not directory.exists():
        continue
    checked_path(directory, directory=True)
    for parent, directories, names in os.walk(directory, followlinks=False):
        for child in directories:
            checked_path(Path(parent) / child, directory=True)
        files.extend(checked_path(Path(parent) / child) for child in names)
# Only pure credential parsing and QR auth are runtime code. The original DSH
# disk store remains in the repository for upstream regression tests, not ZIPs.
files.extend(ROOT / 'lib' / name for name in ('auth.js', 'credential-values.js'))
# Include production dependencies only; dev FFmpeg must never leak into releases.
modules = checked_path(ROOT / 'node_modules', directory=True)
listing = subprocess.check_output(['npm', 'ls', '--omit=dev', '--all', '--parseable'], cwd=ROOT, text=True).splitlines()[1:]
for dirname in listing:
    directory = checked_path(Path(dirname), boundary=modules, directory=True)
    for parent, directories, names in os.walk(directory, followlinks=False):
        for child in directories:
            checked_path(Path(parent) / child, boundary=modules, directory=True)
        files.extend(checked_path(Path(parent) / child, boundary=modules) for child in names if 'test' not in Path(parent).parts and 'tests' not in Path(parent).parts)
files = sorted(set(checked_path(source) for source in files))
out = ROOT / 'dist'; out.mkdir(exist_ok=True)
filename = out / ('bili-' + manifest['version'] + '.zip')
with zipfile.ZipFile(filename, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for source in files:
        if source.is_symlink():
            parser.error('Symlink is not a releasable asset: ' + str(source))
        relative = source.relative_to(ROOT).as_posix()
        if relative.endswith(('.log', '.mp4')) or relative == 'package-lock.json':
            continue
        info = zipfile.ZipInfo(relative, date_time=(2026, 10, 29, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = (0o100755 if os.access(source, os.X_OK) else 0o100644) << 16
        archive.writestr(info, source.read_bytes())
digest = hashlib.sha256(filename.read_bytes()).hexdigest()
metadata = {'file': filename.name, 'sha256': digest, 'bytes': filename.stat().st_size,
            'nodeAccess': True, 'systemFfmpegRequired': args.system_ffmpeg,
            'platforms': sorted(p.name for p in (ROOT / 'bin').glob('*') if p.is_dir()),
            'status': 'local-candidate-unpublished'}
(out / 'build.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(metadata, ensure_ascii=False))
