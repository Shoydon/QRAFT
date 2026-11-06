#!/usr/bin/env python3
"""Download and check the exact research dependency; no Git changes or RPC calls."""
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile
import urllib.request

COMMIT = "0d803737b681774186cd283b1fd2d8e493655c82"
SHA256 = "e8c462766050682142c624e9b2ab023aecb4de02f3310ad2206c0d0237bfcd3a"
ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor"
VENDOR.mkdir(exist_ok=True)
ARCHIVE = VENDOR / "plonky3.tar.gz"
if not ARCHIVE.exists():
    request = urllib.request.Request(
        f"https://codeload.github.com/Plonky3/Plonky3/tar.gz/{COMMIT}",
        headers={"User-Agent": "QRAFT-pinned-research"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read(100_000_001)
    if len(data) > 100_000_000 or hashlib.sha256(data).hexdigest() != SHA256:
        raise SystemExit("Upstream archive size/hash mismatch")
    fd, name = tempfile.mkstemp(prefix="archive-", dir=VENDOR)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
        os.replace(name, ARCHIVE)
    finally:
        Path(name).unlink(missing_ok=True)
data = ARCHIVE.read_bytes()
if hashlib.sha256(data).hexdigest() != SHA256:
    raise SystemExit("Cached upstream archive hash mismatch")
destination = VENDOR / "plonky3"
expected = {}
with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
    for member in archive:
        path = PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or len(path.parts) < 1:
            raise SystemExit("Unsafe upstream archive path")
        if member.isdir():
            continue
        if not member.isfile() or len(path.parts) < 2:
            raise SystemExit("Unsupported upstream archive entry")
        relative = Path(*path.parts[1:])
        expected[relative] = archive.extractfile(member).read()
if destination.exists():
    actual = set()
    for path in destination.rglob("*"):
        if path.is_symlink():
            raise SystemExit("Unexpected upstream symlink")
        if path.is_file():
            relative = path.relative_to(destination)
            actual.add(relative)
            if relative not in expected or path.read_bytes() != expected[relative]:
                raise SystemExit(f"Changed upstream file: {relative}")
    if actual != set(expected):
        raise SystemExit("Incomplete upstream source; remove cache to rebuild")
else:
    with tempfile.TemporaryDirectory(prefix="source-", dir=VENDOR) as temporary:
        staged = Path(temporary) / "plonky3"
        staged.mkdir()
        for relative, contents in expected.items():
            target = staged / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
        os.replace(staged, destination)
print(f"Verified Plonky3 {COMMIT}: {len(expected)} source files, archive SHA256 {SHA256}")
