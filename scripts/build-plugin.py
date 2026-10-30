#!/usr/bin/env python3
"""Build a deterministic plugin ZIP; never download code during plugin execution."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
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
bundled_platforms = sorted({p.parent.name for p in ffmpeg_files})
declared_platforms = manifest.get('platforms')
if declared_platforms is not None and (not isinstance(declared_platforms, list) or
        not declared_platforms or any(not isinstance(value, str) for value in declared_platforms) or
        len(set(declared_platforms)) != len(declared_platforms)):
    parser.error('Manifest platforms must be a nonempty list of unique platform strings')
if not args.system_ffmpeg and declared_platforms is not None and sorted(declared_platforms) != bundled_platforms:
    parser.error('Manifest platforms differ from the bundled FFmpeg platforms')
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
# Include only files statically reachable from production library entry points.
# npm's package-level tree also includes unused CLI dependencies with dynamic
# module loaders; those are not part of the plugin's QR rendering runtime.
modules = checked_path(ROOT / 'node_modules', directory=True)
listing = json.loads(subprocess.check_output(['node', str(ROOT / 'scripts/production-dependencies.cjs')], cwd=ROOT, text=True))
files.extend(checked_path(Path(filename), boundary=modules) for filename in listing)
files = sorted(set(checked_path(source) for source in files))
def check_code(relative, content):
    if Path(relative).suffix not in ('.js', '.cjs', '.mjs', '.html'):
        return
    source = content.decode('utf-8')
    if re.search(r'\beval\s*\(|\bnew\s+Function\s*\(', source):
        parser.error('Forbidden code evaluation in install ZIP: ' + relative)
    for call in re.finditer(r'\brequire\s*\(', source):
        if not re.match(r'''\s*(['"])([^'"\\\r\n]+)\1\s*\)''', source[call.end():]):
            parser.error('Dynamic require in install ZIP: ' + relative)

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
        content = source.read_bytes()
        check_code(relative, content)
        archive.writestr(info, content)
# Verify the exact serialized archive too, rather than just the dependency graph.
with zipfile.ZipFile(filename) as archive:
    for relative in archive.namelist():
        check_code(relative, archive.read(relative))
digest = hashlib.sha256(filename.read_bytes()).hexdigest()
metadata = {'file': filename.name, 'sha256': digest, 'bytes': filename.stat().st_size,
            'nodeAccess': True, 'systemFfmpegRequired': args.system_ffmpeg,
            'platforms': bundled_platforms,
            'status': 'local-candidate-unpublished'}
(out / 'build.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(metadata, ensure_ascii=False))
