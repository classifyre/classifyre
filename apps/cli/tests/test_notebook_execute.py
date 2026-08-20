"""Replay semantics, output policy, and error attribution.

These are the behaviours the notebook UX is built on: what "run cell 3" means,
whose output the user sees, and which cell gets highlighted when it breaks.
"""

from __future__ import annotations

import pytest

from src.notebook.contract import (
    MISSING_FUNCTION,
    NOT_A_FUNCTION,
    SYNTAX_ERROR,
    validate_notebook,
)
from src.notebook.execute import execute_notebook
from src.notebook.outputs import cap_outputs, stream_output
from src.notebook.protocol import ExecutionMode, ExecutionStatus
from src.notebook.redact import Redactor
from src.notebook.scaffold import scaffold_cells
from src.notebook.sdk import Context


def _cell(cell_id: str, source: str, cell_type: str = "code") -> dict[str, str]:
    return {"id": cell_id, "type": cell_type, "source": source}


def _texts(result) -> str:
    return "".join(
        output.get("text", "")
        for cell in result.cells
        for output in cell.outputs
        if output["type"] == "stream"
    )


# -- replay ------------------------------------------------------------------


def test_run_cell_replays_current_source_of_preceding_cells() -> None:
    cells = [
        _cell("a", "x = 1\n"),
        _cell("b", "x = x + 41\n"),
        _cell("c", "x\n"),
    ]
    result = execute_notebook(cells, mode=ExecutionMode.CELL, target_cell_id="c")
    assert result.status is ExecutionStatus.SUCCESS
    assert result.cells[-1].outputs[-1]["data"]["text/plain"] == "42"


def test_run_cell_does_not_run_cells_after_the_target() -> None:
    cells = [
        _cell("a", "x = 1\n"),
        _cell("b", "x\n"),
        _cell("c", "raise AssertionError('cell c must not run')\n"),
    ]
    result = execute_notebook(cells, mode=ExecutionMode.CELL, target_cell_id="b")
    assert result.status is ExecutionStatus.SUCCESS


def test_markdown_cells_are_never_executed() -> None:
    cells = [
        _cell("doc", "this is prose, not python", "markdown"),
        _cell("a", "x = 1\nx\n"),
    ]
    result = execute_notebook(cells, mode=ExecutionMode.ALL)
    assert result.status is ExecutionStatus.SUCCESS
    assert [cell.cell_id for cell in result.cells] == ["a"]


# -- output policy -----------------------------------------------------------


def test_cell_mode_hides_output_of_replayed_cells() -> None:
    cells = [
        _cell("a", "print('loading data')\n"),
        _cell("b", "print('cleaning')\n"),
        _cell("c", "print('done')\n"),
    ]
    result = execute_notebook(cells, mode=ExecutionMode.CELL, target_cell_id="c")
    assert [cell.cell_id for cell in result.cells] == ["c"]
    assert "loading data" not in _texts(result)
    assert "cleaning" not in _texts(result)
    assert "done" in _texts(result)


def test_run_all_keeps_every_cell_output() -> None:
    cells = [
        _cell("a", "print('loading data')\n"),
        _cell("b", "print('cleaning')\n"),
    ]
    result = execute_notebook(cells, mode=ExecutionMode.ALL)
    assert [cell.cell_id for cell in result.cells] == ["a", "b"]
    assert "loading data" in _texts(result)
    assert "cleaning" in _texts(result)


def test_stdout_and_stderr_are_separate_streams() -> None:
    cells = [_cell("a", "import sys\nprint('out')\nprint('err', file=sys.stderr)\n")]
    result = execute_notebook(cells, mode=ExecutionMode.ALL)
    names = {output["name"] for output in result.cells[0].outputs if output["type"] == "stream"}
    assert names == {"stdout", "stderr"}


def test_last_expression_becomes_a_display_output_not_stdout() -> None:
    result = execute_notebook([_cell("a", "'hello'\n")], mode=ExecutionMode.ALL)
    outputs = result.cells[0].outputs
    assert [output["type"] for output in outputs] == ["display"]
    assert outputs[0]["data"]["text/plain"] == "'hello'"


def test_assignment_produces_no_display_output() -> None:
    result = execute_notebook([_cell("a", "x = 1\n")], mode=ExecutionMode.ALL)
    assert result.cells[0].outputs == []


def test_html_repr_is_offered_alongside_plain_text() -> None:
    cells = [
        _cell(
            "a",
            "class Table:\n"
            "    def _repr_html_(self):\n"
            "        return '<table><tr><td>1</td></tr></table>'\n"
            "\n"
            "Table()\n",
        )
    ]
    result = execute_notebook(cells, mode=ExecutionMode.ALL)
    data = result.cells[0].outputs[-1]["data"]
    assert "<table>" in data["text/html"]
    assert "text/plain" in data


# -- errors ------------------------------------------------------------------


def test_failure_during_replay_names_the_failing_cell_not_the_target() -> None:
    cells = [
        _cell("load", "d = {'x': 1}\n"),
        _cell("clean", "v = d['revenue']\n"),
        _cell("show", "v\n"),
    ]
    result = execute_notebook(cells, mode=ExecutionMode.CELL, target_cell_id="show")
    assert result.status is ExecutionStatus.ERROR
    assert result.failed_cell_id == "clean"
    assert result.target_cell_id == "show"
    assert result.error is not None
    assert result.error.type == "KeyError"


def test_traceback_is_reported_in_cell_coordinates() -> None:
    cells = [
        _cell("boom", "def pick(row):\n    return row['missing']\n\npick({})\n"),
    ]
    result = execute_notebook(cells, mode=ExecutionMode.ALL)
    assert result.error is not None
    assert result.error.cell_id == "boom"
    # The innermost frame is inside pick(), on the cell's second line.
    assert result.error.line == 2
    rendered = "".join(result.error.traceback)
    assert "cell boom" in rendered
    # The runtime's own frames must not be shown to the author.
    assert "interactiveshell" not in rendered
    assert "execute.py" not in rendered


# -- secrets -----------------------------------------------------------------


def test_secret_values_are_redacted_from_output() -> None:
    secret = "tok-abcdef-123456"
    cells = [_cell("a", "print('token is', ctx.secret('api_token'))\n")]
    result = execute_notebook(
        cells,
        mode=ExecutionMode.ALL,
        context=Context(secrets={"api_token": secret}),
        redactor=Redactor([secret]),
    )
    text = _texts(result)
    assert secret not in text
    assert "••••" in text


def test_secret_values_are_redacted_from_tracebacks() -> None:
    secret = "tok-abcdef-123456"
    cells = [_cell("a", "raise ValueError(ctx.secret('api_token'))\n")]
    result = execute_notebook(
        cells,
        mode=ExecutionMode.ALL,
        context=Context(secrets={"api_token": secret}),
        redactor=Redactor([secret]),
    )
    assert result.error is not None
    assert secret not in result.error.message
    assert secret not in "".join(result.error.traceback)


def test_short_values_are_not_redacted() -> None:
    # Redacting "1" would blank out every digit in the output and hide the very
    # thing the author is trying to read.
    redactor = Redactor(["1", "ok"])
    assert redactor.redact("value 1 is ok") == "value 1 is ok"


# -- contract ----------------------------------------------------------------


def test_scaffold_satisfies_the_contract() -> None:
    report = validate_notebook(scaffold_cells())
    assert report.ok
    assert {"test_connection", "extract"} <= report.defined_functions


@pytest.mark.parametrize("missing", ["test_connection", "extract"])
def test_missing_required_function_is_reported(missing: str) -> None:
    cells = [cell for cell in scaffold_cells() if missing.replace("_", "-") not in cell["id"]]
    report = validate_notebook(cells)
    assert not report.ok
    assert report.violations[0].kind == MISSING_FUNCTION
    assert missing in report.violations[0].message


def test_non_function_binding_is_a_distinct_error() -> None:
    report = validate_notebook(
        [_cell("a", "def test_connection():\n    return {}\n\nextract = 3\n")]
    )
    assert not report.ok
    assert report.violations[0].kind == NOT_A_FUNCTION


def test_syntax_error_is_mapped_to_the_owning_cell() -> None:
    cells = [_cell("good", "x = 1\n"), _cell("bad", "def broken(\n")]
    report = validate_notebook(cells)
    assert not report.ok
    assert report.violations[0].kind == SYNTAX_ERROR
    assert report.violations[0].cell_id == "bad"


def test_ipython_magics_are_rejected_as_invalid_python() -> None:
    # Production runs the assembled module with plain `python`, so a cell that
    # only works under IPython would break the moment it ships.
    for magic in ("%time sum(range(10))\n", "!pip install requests\n"):
        report = validate_notebook([_cell("m", magic)])
        assert not report.ok, magic
        assert report.violations[0].kind == SYNTAX_ERROR


def test_duplicate_cell_ids_are_rejected() -> None:
    report = validate_notebook([_cell("same", "x = 1\n"), _cell("same", "y = 2\n")])
    assert not report.ok
    assert report.violations[0].cell_id == "same"


# -- modes that call the contract --------------------------------------------


def test_test_connection_mode_returns_the_notebook_verdict() -> None:
    result = execute_notebook(scaffold_cells(), mode=ExecutionMode.TEST_CONNECTION)
    assert result.status is ExecutionStatus.SUCCESS
    assert result.result == {"status": "SUCCESS", "message": "Ready."}


def test_test_connection_rejects_a_non_dict_return() -> None:
    cells = [
        _cell("a", "def test_connection():\n    return 'fine'\n"),
        _cell("b", "def extract():\n    return []\n"),
    ]
    result = execute_notebook(cells, mode=ExecutionMode.TEST_CONNECTION)
    assert result.result is not None
    assert result.result["status"] == "FAILURE"
    assert "must return a dict" in result.result["message"]


def test_preview_extract_is_bounded() -> None:
    cells = [
        _cell("a", "def test_connection():\n    return {'status': 'SUCCESS'}\n"),
        _cell(
            "b",
            "def extract():\n"
            "    for i in range(1000):\n"
            "        yield Asset(id=str(i), name=f'row {i}', content='x')\n",
        ),
    ]
    result = execute_notebook(cells, mode=ExecutionMode.PREVIEW_EXTRACT, max_assets=3)
    assert result.status is ExecutionStatus.SUCCESS
    assert len(result.assets) == 3


def test_modes_that_call_the_contract_check_it_first() -> None:
    cells = [_cell("a", "def test_connection():\n    return {'status': 'SUCCESS'}\n")]
    result = execute_notebook(cells, mode=ExecutionMode.PREVIEW_EXTRACT)
    assert result.status is ExecutionStatus.ERROR
    assert result.contract is not None
    assert result.contract["ok"] is False


def test_running_a_cell_does_not_require_a_complete_notebook() -> None:
    # An author must be able to run a cell while extract() is still unwritten.
    cells = [_cell("a", "print('still drafting')\n")]
    result = execute_notebook(cells, mode=ExecutionMode.ALL)
    assert result.status is ExecutionStatus.SUCCESS


# -- output caps -------------------------------------------------------------


def test_cap_outputs_truncates_instead_of_dropping_everything() -> None:
    outputs = [stream_output("stdout", "a" * 100), stream_output("stdout", "b" * 100)]
    capped = cap_outputs(outputs, 120)
    assert capped[0]["text"] == "a" * 100
    assert "truncated" in capped[1]["text"]


def test_cap_outputs_is_a_no_op_under_the_limit() -> None:
    outputs = [stream_output("stdout", "short")]
    assert cap_outputs(outputs, 1000) == outputs


# -- both engines ------------------------------------------------------------
#
# IPython is an optional extra. When it is missing the notebook still has to
# run, report the same errors and produce the same outputs -- otherwise the
# degraded path is a second, untested implementation.


@pytest.fixture
def without_ipython(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("src.notebook.execute._interactive_shell", lambda: None)


@pytest.mark.usefixtures("without_ipython")
def test_fallback_engine_runs_cells() -> None:
    cells = [_cell("a", "x = 1\n"), _cell("b", "print('ran')\nx + 41\n")]
    result = execute_notebook(cells, mode=ExecutionMode.ALL)
    assert result.status is ExecutionStatus.SUCCESS
    assert "ran" in _texts(result)


@pytest.mark.usefixtures("without_ipython")
def test_fallback_engine_keeps_the_last_expression() -> None:
    # Plain exec() discards it, which would make a cell ending in df.head()
    # silently produce nothing.
    result = execute_notebook([_cell("a", "40 + 2\n")], mode=ExecutionMode.ALL)
    assert result.cells[0].outputs[-1]["data"]["text/plain"] == "42"


@pytest.mark.usefixtures("without_ipython")
def test_fallback_engine_attributes_failures_to_the_right_cell() -> None:
    cells = [
        _cell("load", "d = {}\n"),
        _cell("clean", "v = d['missing']\n"),
        _cell("show", "v\n"),
    ]
    result = execute_notebook(cells, mode=ExecutionMode.CELL, target_cell_id="show")
    assert result.failed_cell_id == "clean"
    assert result.error is not None
    assert result.error.cell_id == "clean"


@pytest.mark.usefixtures("without_ipython")
def test_fallback_engine_hides_replayed_output() -> None:
    cells = [_cell("a", "print('hidden')\n"), _cell("b", "print('shown')\n")]
    result = execute_notebook(cells, mode=ExecutionMode.CELL, target_cell_id="b")
    assert "hidden" not in _texts(result)
    assert "shown" in _texts(result)
