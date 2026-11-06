#!/usr/bin/env python3
"""Offline mutation tests for the pinned dependency cache, in an isolated directory."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class IntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = Path(__file__).resolve().parents[1]
        cls.temporary = tempfile.TemporaryDirectory(prefix="qraft-source-integrity-")
        cls.root = Path(cls.temporary.name)
        (cls.root / "scripts").mkdir()
        (cls.root / "vendor").mkdir()
        shutil.copy2(source / "scripts/prepare-upstream.py", cls.root / "scripts/prepare-upstream.py")
        shutil.copy2(source / "vendor/plonky3.tar.gz", cls.root / "vendor/plonky3.tar.gz")
        cls.command = [sys.executable, str(cls.root / "scripts/prepare-upstream.py")]
        subprocess.run(cls.command, check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def run_preparation(self, success, expected):
        result = subprocess.run(self.command, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        self.assertIn(expected, result.stdout + result.stderr)

    def test_reuses_exact_source(self):
        self.run_preparation(True, "1389 source files")

    def test_changed_source_rejected(self):
        path = self.root / "vendor/plonky3/README.md"
        original = path.read_bytes()
        try:
            path.write_bytes(original + b"\nchanged\n")
            self.run_preparation(False, "Changed upstream file")
        finally:
            path.write_bytes(original)

    def test_extra_source_rejected(self):
        path = self.root / "vendor/plonky3/unexpected.rs"
        try:
            path.write_text("unexpected")
            self.run_preparation(False, "Changed upstream file")
        finally:
            path.unlink(missing_ok=True)

    def test_symlink_rejected(self):
        path = self.root / "vendor/plonky3/unexpected-link"
        try:
            path.symlink_to(self.root / "vendor/plonky3/README.md")
            self.run_preparation(False, "Unexpected upstream symlink")
        finally:
            path.unlink(missing_ok=True)

    def test_corrupt_archive_rejected(self):
        path = self.root / "vendor/plonky3.tar.gz"
        original = path.read_bytes()
        try:
            changed = bytearray(original)
            changed[len(changed) // 2] ^= 1
            path.write_bytes(changed)
            self.run_preparation(False, "Cached upstream archive hash mismatch")
        finally:
            path.write_bytes(original)


if __name__ == "__main__":
    unittest.main()
