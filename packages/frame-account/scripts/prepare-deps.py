#!/usr/bin/env python3
"""Fetch/verify pinned local compiler and OpenZeppelin sources; no global install.
Existing files are verified, never silently replaced on a hash mismatch.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import pathlib
import platform
import stat
import tarfile
import tempfile
import urllib.request

RELEASE = 'https://github.com/chiranjeev13/solidity/releases/download/v0.8.36-eip8141.1/'
COMPILERS = {
    'macos-arm64': ('solc-eip8141-macos-arm64', '5fc52ee37b251d14429056e4fe0a7d54b99f4c28a230ac4c8d069f284c8a4a2b'),
    'linux-amd64': ('solc-eip8141-linux-amd64', 'cd2eb6c4a55cc0143e2b3a92701930ed3a38263e3af9d0efe3539ceb50ee1645'),
}
OZ_URL = 'https://registry.npmjs.org/@openzeppelin/contracts/-/contracts-5.6.1.tgz'
OZ_SHA256 = 'bd202ef9a2fd09f6005edc18437b4d3090841d0f676c01c814ee9608581d2e63'
OZ_INTEGRITY = 'sha512-Ly6SlsVJ3mj+b18W3R8gNufB7dTICT105fJhodGAGgyC2oqnBAhqSiNDJ8V8DLY05cCz81GLI0CU5vNYA1EC/w=='
MAX_DOWNLOAD = 50 << 20


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_file(path, data, executable=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise RuntimeError('Refusing symlink output: ' + str(path))
    if path.exists():
        if path.read_bytes() != data:
            raise RuntimeError('Existing dependency differs; review before replacing: ' + str(path))
    else:
        fd, temporary = tempfile.mkstemp(prefix='.dependency-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(data)
            os.chmod(temporary, 0o755 if executable else 0o644)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    if executable:
        path.chmod(path.stat().st_mode | stat.S_IXUSR)


def cached_download(path, url, expected, offline):
    if path.exists():
        if path.is_symlink() or not path.is_file():
            raise RuntimeError('Unexpected cached dependency type: ' + str(path))
        data = path.read_bytes()
    else:
        if offline:
            raise RuntimeError('Missing cached dependency in offline mode: ' + str(path))
        request = urllib.request.Request(url, headers={'User-Agent': 'Qraft-pinned-build/1'})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(MAX_DOWNLOAD + 1)
        if len(data) > MAX_DOWNLOAD:
            raise RuntimeError('Dependency download too large')
    if digest(data) != expected:
        raise RuntimeError('SHA256 mismatch for ' + str(path))
    atomic_file(path, data)
    return data


def unpack_checked(data, destination):
    count, total = 0, 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive:
            parts = pathlib.PurePosixPath(member.name).parts
            if not parts or parts[0] != 'package' or any(p in ('..', '') for p in parts) or member.name.startswith('/'):
                raise RuntimeError('Unexpected package archive path')
            if member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
                raise RuntimeError('Package archive contains unsupported entry')
            relative = pathlib.Path(*parts[1:])
            output = destination / relative
            # Reject pre-existing links in every traversed component, not just files.
            current = destination
            for part in relative.parts:
                if current.is_symlink():
                    raise RuntimeError('Dependency directory contains symlink')
                current = current / part
            if output.is_symlink():
                raise RuntimeError('Dependency output is symlink')
            if member.isdir():
                output.mkdir(parents=True, exist_ok=True)
                continue
            total += member.size
            count += 1
            if total > MAX_DOWNLOAD or count > 10000 or member.size > (8 << 20):
                raise RuntimeError('Expanded package exceeds bounds')
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError('Missing package member')
            content = source.read(member.size + 1)
            if len(content) != member.size:
                raise RuntimeError('Wrong package member length')
            atomic_file(output, content)
    if not count:
        raise RuntimeError('Empty dependency archive')
    if json.loads((destination / 'package.json').read_text())['version'] != '5.6.1':
        raise RuntimeError('OpenZeppelin version mismatch')
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=pathlib.Path)
    parser.add_argument('--platform', choices=['auto', *COMPILERS], default='auto')
    parser.add_argument('--offline', action='store_true')
    options = parser.parse_args()
    project = pathlib.Path(__file__).resolve().parents[3]
    cache = options.cache_dir or project / '.local/frame-account-tools'
    selected = options.platform
    if selected == 'auto':
        selected = {('Darwin', 'arm64'): 'macos-arm64', ('Linux', 'x86_64'): 'linux-amd64'}.get((platform.system(), platform.machine()))
    if selected not in COMPILERS:
        raise RuntimeError('No verified compiler artifact for this platform; use explicit supported --platform')
    name, sha = COMPILERS[selected]
    compiler = cache / 'solc-eip8141'
    archive_path = cache / 'openzeppelin-contracts-5.6.1.tgz'
    binary = cached_download(compiler, RELEASE + name, sha, options.offline)
    atomic_file(compiler, binary, executable=True)
    archive = cached_download(archive_path, OZ_URL, OZ_SHA256, options.offline)
    if 'sha512-' + base64.b64encode(hashlib.sha512(archive).digest()).decode() != OZ_INTEGRITY:
        raise RuntimeError('OpenZeppelin npm integrity mismatch')
    files = unpack_checked(archive, cache / 'openzeppelin')
    manifest = {'compiler': {'url': RELEASE + name, 'sha256': sha}, 'openzeppelin': {'version': '5.6.1', 'url': OZ_URL, 'sha256': OZ_SHA256, 'integrity': OZ_INTEGRITY}}
    # The manifest is public reproducibility metadata, not a mutable dependency authority.
    encoded = (json.dumps(manifest, indent=2) + '\n').encode()
    manifest_path = cache / 'dependencies.json'
    if manifest_path.exists() and json.loads(manifest_path.read_text()) != manifest:
        raise RuntimeError('Existing dependency manifest differs; review platform/cache selection')
    if not manifest_path.exists():
        atomic_file(manifest_path, encoded)
    print(json.dumps({'compiler': str(compiler), 'compilerSha256': sha, 'openzeppelin': str(cache / 'openzeppelin'), 'verifiedPackageFiles': files, 'globalInstall': False}))


if __name__ == '__main__':
    main()
