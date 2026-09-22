"""Notebook log lines carry a level the run log can read (GENESIS field report P11)."""

from __future__ import annotations

import pytest

from src.notebook.sdk import Context
from src.sources.custom.runner import NotebookRuntime


def test_an_unprefixed_notebook_line_is_logged_as_info(capsys: pytest.CaptureFixture[str]) -> None:
    NotebookRuntime._log("registry: 476 Kreis codes")
    assert capsys.readouterr().err == "INFO:notebook: registry: 476 Kreis codes\n"


@pytest.mark.parametrize("line", ["WARNING: cursor replaced", "ERROR:x: boom", "[DEBUG] detail"])
def test_a_line_that_names_its_level_keeps_it(
    line: str, capsys: pytest.CaptureFixture[str]
) -> None:
    NotebookRuntime._log(line)
    assert capsys.readouterr().err == line + "\n"


def test_ctx_log_takes_a_level() -> None:
    lines: list[str] = []
    ctx = Context(logger=lines.append)
    ctx.log("cursor", "replaced", level="warning")
    ctx.log("plain")
    assert lines == ["WARNING: cursor replaced", "plain"]
