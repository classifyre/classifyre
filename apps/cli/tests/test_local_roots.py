"""Local folders a source may point at (src/utils/local_roots.py)."""

from __future__ import annotations

from pathlib import Path

import pytest

from src.utils.local_roots import LocalRootRefusedError, refuse_local_root


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/var/lib/classifyre",
        "/var/lib/classifyre/sql-tls",
        "/var/lib",
        "/app/apps/cli",
        "/etc",
    ],
)
def test_the_image_s_own_state_and_the_system_are_never_a_source(path: str) -> None:
    # In the all-in-one image /var/lib/classifyre holds masked-config.key,
    # which decrypts every workspace's credentials (re-review 2026-11-22).
    with pytest.raises(LocalRootRefusedError):
        refuse_local_root(path)


def test_the_allowlist_admits_only_folders_inside_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = tmp_path / "data"
    (data / "case-files").mkdir(parents=True)
    monkeypatch.setenv("CLASSIFYRE_QUERY_LOCAL_ROOTS", str(data))
    refuse_local_root(str(data / "case-files"))
    with pytest.raises(LocalRootRefusedError, match="not under a folder mounted"):
        refuse_local_root(str(tmp_path))


def test_a_local_folder_scan_refuses_the_image_s_state(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.sources.local_folder.source import LocalFolderSource

    monkeypatch.delenv("CLASSIFYRE_QUERY_LOCAL_ROOTS", raising=False)
    source = LocalFolderSource({"type": "LOCAL_FOLDER", "required": {"path": "/etc"}})
    with pytest.raises(LocalRootRefusedError, match="may not be read by Classifyre"):
        source._root()
