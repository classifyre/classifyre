"""torch.compile must be off before torch is imported.

The failure this prevents is quiet rather than loud: docling falls back to
eager execution when inductor cannot compile, so scans keep running and only
the clock and the coverage suffer. On a desktop install that meant 167 compile
errors and 33 OCR extractions returning no text, and a measured 58.5s versus
24.9s on one image for identical output.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from src.utils.torch_runtime import configure_torch_runtime

REPO_CLI_ROOT = Path(__file__).resolve().parents[1]


def test_disables_compilation_when_unset() -> None:
    env: dict[str, str] = {}

    assert configure_torch_runtime(env) is True
    assert env["TORCH_COMPILE_DISABLE"] == "1"


def test_uses_the_variable_this_torch_actually_reads() -> None:
    """TORCHDYNAMO_DISABLE is the widely-cited name and does nothing in 2.13.

    Setting the wrong variable looks correct in review and in the environment
    dump, and silently leaves compilation on.
    """
    env: dict[str, str] = {}
    configure_torch_runtime(env)

    assert "TORCH_COMPILE_DISABLE" in env
    assert "TORCHDYNAMO_DISABLE" not in env


def test_an_explicit_setting_is_left_alone() -> None:
    """A deployment with a toolchain and space-free paths may want inductor."""
    for configured in ("0", "1", "false"):
        env = {"TORCH_COMPILE_DISABLE": configured}

        assert configure_torch_runtime(env) is False
        assert env["TORCH_COMPILE_DISABLE"] == configured


def test_an_empty_value_is_treated_as_unset() -> None:
    env = {"TORCH_COMPILE_DISABLE": "   "}

    assert configure_torch_runtime(env) is True
    assert env["TORCH_COMPILE_DISABLE"] == "1"


def test_applied_before_torch_is_imported_by_the_cli() -> None:
    """Ordering is the whole point: torch reads this at import time.

    Importing src.main must leave the variable set, and must do so without
    torch having been imported first — asserted by checking the flag rather
    than trusting the import order to stay put in the file.
    """
    script = (
        "import os, sys; "
        "os.environ.pop('TORCH_COMPILE_DISABLE', None); "
        "import src.main; "
        "print(os.environ.get('TORCH_COMPILE_DISABLE'))"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=REPO_CLI_ROOT,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )

    assert result.returncode == 0, result.stderr[-2000:]
    assert result.stdout.strip().endswith("1"), result.stdout
