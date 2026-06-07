"""Tests for the safe runtime uv-sync (lock + accumulation + self-heal)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from src.utils import uv_sync


@pytest.fixture
def fresh_uv_sync(tmp_path, monkeypatch):
    """Isolate uv_sync state per test: tmp state dir + cleared in-process caches."""
    monkeypatch.setenv("CLASSIFYRE_UV_SYNC_STATE_DIR", str(tmp_path))
    monkeypatch.setenv("CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS", "1")
    uv_sync._synced_groups.clear()
    uv_sync._failed_groups.clear()
    yield tmp_path
    uv_sync._synced_groups.clear()
    uv_sync._failed_groups.clear()


def _ok_run():
    result = MagicMock()
    result.returncode = 0
    result.stdout = ""
    result.stderr = ""
    return result


def _state_groups(state_dir) -> set[str]:
    path = state_dir / uv_sync._STATE_FILENAME
    if not path.exists():
        return set()
    return set(json.loads(path.read_text()))


def test_sync_group_runs_uv_persists_and_clears_marker(fresh_uv_sync):
    state_dir = fresh_uv_sync
    with patch("src.utils.uv_sync.subprocess.run", return_value=_ok_run()) as run:
        ok, detail = uv_sync.sync_group("privacy")

    assert ok and detail is None
    cmd = run.call_args.args[0]
    assert "sync" in cmd and "--group" in cmd and "privacy" in cmd
    assert _state_groups(state_dir) == {"privacy"}
    # in-progress marker removed on success
    assert not (state_dir / uv_sync._INPROGRESS_FILENAME).exists()


def test_sync_group_accumulates_persisted_groups(fresh_uv_sync):
    state_dir = fresh_uv_sync
    # Another process already installed "security".
    (state_dir / uv_sync._STATE_FILENAME).write_text(json.dumps(["security"]))

    with patch("src.utils.uv_sync.subprocess.run", return_value=_ok_run()) as run:
        ok, _ = uv_sync.sync_group("privacy")

    assert ok
    cmd = run.call_args.args[0]
    # The sync must re-pass BOTH groups so security isn't uninstalled.
    assert "privacy" in cmd and "security" in cmd
    assert _state_groups(state_dir) == {"privacy", "security"}


def test_sync_group_skips_when_already_persisted(fresh_uv_sync):
    state_dir = fresh_uv_sync
    (state_dir / uv_sync._STATE_FILENAME).write_text(json.dumps(["privacy"]))

    with patch("src.utils.uv_sync.subprocess.run", return_value=_ok_run()) as run:
        ok, _ = uv_sync.sync_group("privacy")

    assert ok
    run.assert_not_called()  # already installed by another process


def test_sync_group_self_heals_after_interrupted_sync(fresh_uv_sync):
    state_dir = fresh_uv_sync
    # Leftover marker == a previous sync was killed mid-write.
    (state_dir / uv_sync._INPROGRESS_FILENAME).write_text("privacy")
    (state_dir / uv_sync._STATE_FILENAME).write_text(json.dumps(["privacy"]))

    with patch("src.utils.uv_sync.subprocess.run", return_value=_ok_run()) as run:
        ok, _ = uv_sync.sync_group("privacy")

    assert ok
    cmd = run.call_args.args[0]
    assert "--reinstall" in cmd  # repaired despite being "already installed"
    assert not (state_dir / uv_sync._INPROGRESS_FILENAME).exists()


@pytest.mark.usefixtures("fresh_uv_sync")
def test_sync_group_in_process_fast_path():
    with patch("src.utils.uv_sync.subprocess.run", return_value=_ok_run()) as run:
        uv_sync.sync_group("privacy")
        uv_sync.sync_group("privacy")  # second call must not re-run uv
    assert run.call_count == 1


@pytest.mark.usefixtures("fresh_uv_sync")
def test_sync_group_records_failure():
    bad = MagicMock()
    bad.returncode = 1
    bad.stdout = ""
    bad.stderr = "boom"
    with patch("src.utils.uv_sync.subprocess.run", return_value=bad) as run:
        ok, detail = uv_sync.sync_group("privacy")
        ok2, detail2 = uv_sync.sync_group("privacy")  # cached failure, no re-run

    assert not ok and "boom" in detail
    assert not ok2 and detail2 == detail
    assert run.call_count == 1


@pytest.mark.usefixtures("fresh_uv_sync")
def test_warm_groups_installs_each():
    with patch("src.utils.uv_sync.subprocess.run", return_value=_ok_run()) as run:
        ok, _ = uv_sync.warm_groups(["privacy", "security", ""])
    assert ok
    # one sync per non-empty group
    assert run.call_count == 2


@pytest.mark.usefixtures("fresh_uv_sync")
def test_warm_groups_noop_when_auto_install_disabled(monkeypatch):
    monkeypatch.setenv("CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS", "0")
    with patch("src.utils.uv_sync.subprocess.run", return_value=_ok_run()) as run:
        ok, _ = uv_sync.warm_groups(["privacy"])
    assert ok
    run.assert_not_called()
