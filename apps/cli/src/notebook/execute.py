"""Run a notebook once, in this process, and report what the target produced.

The replay rule (and the reason this is simple): **running cell N means running
the current source of cells 1..N**, never the historical order in which someone
clicked Run. So the code on screen, the code that executes, and the code that
ships to production are the same text -- which is what removes the class of
notebook bug where a result depends on a cell that has since been edited away.

The cost is real and accepted: rebuilding state is not free, and a cell with a
side effect is replayed along with everything else. Caching that away would put
hidden state back.
"""

from __future__ import annotations

import ast
import io
import linecache
import time
import traceback
from collections.abc import Callable, Generator, Iterable, Mapping, Sequence
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from typing import Any, cast

from . import outputs as out
from .contract import validate_module
from .protocol import (
    CONTRACT_MODES,
    CellResult,
    ExecutionError,
    ExecutionMode,
    ExecutionResponse,
    ExecutionStatus,
)
from .redact import Redactor
from .sdk import Context, iter_assets, namespace
from .serialize import ModuleSource, cell_id_of, cell_source_of, code_cells, to_module_source


class _CellError(Exception):
    """A cell raised. Carries the cell so the frontend can point at it."""

    def __init__(self, cell_id: str, error: ExecutionError) -> None:
        self.cell_id = cell_id
        self.error = error
        super().__init__(error.message)


def _interactive_shell() -> Any | None:
    """IPython's shell, if the `interactive` dependency group is installed.

    It is what makes a bare `df` on the last line display as a table instead of
    being discarded, so it is worth having -- but a plain `exec` still runs the
    notebook correctly, and production never needs it at all.
    """
    try:
        from IPython.core.interactiveshell import InteractiveShell
    except ImportError:
        return None

    shell = InteractiveShell.instance()
    if shell.display_formatter is not None:
        shell.display_formatter.active_types = list(out.RENDERABLE_MIME_TYPES)

    # IPython's display hook does two jobs: it records the last expression on
    # the ExecutionResult, and it prints "Out[3]: ..." to stdout. We want the
    # first and not the second -- a result belongs in a typed display output,
    # not smuggled into the stdout stream as text with a prompt glued on. So the
    # writing half is disabled and the recording half left alone.
    shell.displayhook.write_output_prompt = lambda: None  # type: ignore[method-assign,unused-ignore]
    shell.displayhook.write_format_data = (  # type: ignore[method-assign,unused-ignore]
        lambda format_dict, md_dict=None: None  # noqa: ARG005 - inert by design
    )
    # Nothing reads `_`/`__`/`_oh` here, and caching them would pin every
    # intermediate result of a replay in memory.
    shell.displayhook.cache_size = 0
    return shell


def _prepare_namespace(shell: Any | None, context: Context) -> dict[str, Any]:
    """The globals every cell shares.

    With IPython the shell *owns* its namespace -- it keeps `_`, `Out`, `In` and
    the display cache in there -- so the notebook's names are merged into it
    rather than replacing it. Swapping the dict out breaks the display hook.
    """
    injected = namespace(context)
    if shell is None:
        return injected
    shell.user_ns.update(injected)
    return cast(dict[str, Any], shell.user_ns)


def _configure_matplotlib() -> None:
    """Force a headless backend before any cell imports pyplot.

    Without this, a plotting cell tries to open a window and either hangs or
    dies -- there is no display in a Job pod.
    """
    try:
        import matplotlib
    except ImportError:
        return
    matplotlib.use("Agg", force=True)


def _drain_matplotlib_figures() -> list[dict[str, Any]]:
    """Turn any figures a cell left open into PNG outputs, then close them.

    This is what the inline backend does in Jupyter. Doing it explicitly means a
    cell that ends with `plt.plot(...)` and no `show()` still produces a picture,
    and that figures do not accumulate across the replay.
    """
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return []

    results: list[dict[str, Any]] = []
    for number in plt.get_fignums():
        figure = plt.figure(number)
        buffer = io.BytesIO()
        try:
            figure.savefig(buffer, format="png", bbox_inches="tight")
        except Exception:  # a broken figure must not fail the cell
            continue
        finally:
            plt.close(figure)
        results.append(out.png_output(buffer.getvalue()))
    return results


@contextmanager
def _captured(shell: Any | None) -> Generator[Any, None, None]:
    """Capture stdout, stderr and rich displays for one cell."""
    if shell is not None:
        from IPython.utils.capture import capture_output

        with capture_output(display=True) as captured:
            yield captured
        return

    stdout, stderr = io.StringIO(), io.StringIO()
    with redirect_stdout(stdout), redirect_stderr(stderr):
        yield _PlainCapture(stdout, stderr)


class _PlainCapture:
    """The no-IPython shape of a capture result."""

    def __init__(self, stdout: io.StringIO, stderr: io.StringIO) -> None:
        self._stdout = stdout
        self._stderr = stderr
        self.outputs: list[Any] = []

    @property
    def stdout(self) -> str:
        return self._stdout.getvalue()

    @property
    def stderr(self) -> str:
        return self._stderr.getvalue()


def _collect(
    captured: Any,
    redactor: Redactor,
    *,
    shell: Any | None = None,
    expression_value: Any = None,
) -> list[dict[str, Any]]:
    """Ordered outputs from one captured cell.

    Order matters and mirrors what happened: streams as they were written, then
    anything the cell displayed explicitly, then figures it left open, and last
    the value of its final expression.
    """
    collected: list[dict[str, Any]] = []

    if getattr(captured, "stdout", ""):
        collected.append(out.stream_output("stdout", redactor.redact(captured.stdout)))
    if getattr(captured, "stderr", ""):
        collected.append(out.stream_output("stderr", redactor.redact(captured.stderr)))

    for display in getattr(captured, "outputs", []) or []:
        data = getattr(display, "data", None)
        if isinstance(data, Mapping):
            collected.append(out.display_output(redactor.redact_deep(dict(data))))

    collected.extend(_drain_matplotlib_figures())

    if expression_value is not None:
        collected.append(_format_value(expression_value, shell, redactor))

    return collected


def _format_value(value: Any, shell: Any | None, redactor: Redactor) -> dict[str, Any]:
    """A cell's final expression as a MIME bundle.

    Letting the object describe itself -- `_repr_html_` for a DataFrame,
    `_repr_png_` for a figure -- is what keeps this from needing a branch per
    library.
    """
    if shell is not None:
        try:
            data, metadata = shell.display_formatter.format(value)
        except Exception:
            data, metadata = {}, {}
        if data:
            return out.display_output(redactor.redact_deep(dict(data)), metadata)
    return out.display_output(redactor.redact_deep(out.bundle_from_object(value)))


NOTEBOOK_FILENAME = "notebook.py"

#: A cell compiled on its own carries a synthetic filename, so a frame from one
#: is already cell-relative -- unlike a frame from the assembled module, whose
#: line number has to be mapped back through the span table.
_CELL_FILENAME_PREFIXES = ("<ipython-input", "<ipython-cell", "<cell")


def cell_filename(cell_id: str) -> str:
    return f"<cell {cell_id}>"


def _is_notebook_frame(frame: traceback.FrameSummary) -> bool:
    return frame.filename == NOTEBOOK_FILENAME or frame.filename.startswith(_CELL_FILENAME_PREFIXES)


def _format_exception(
    exc: BaseException,
    module: ModuleSource,
    redactor: Redactor,
    *,
    running_cell_id: str | None = None,
) -> tuple[ExecutionError, str | None]:
    """Render an exception in cell coordinates, not module coordinates.

    The author is looking at a cell, so a module line number or a frame inside
    IPython is worse than useless -- it points at code they did not write. Only
    notebook frames are kept, relabelled with the cell they came from.
    """
    frames = traceback.extract_tb(exc.__traceback__)
    cell_id: str | None = None
    cell_line: int | None = None

    # Innermost first: the deepest notebook frame is where the author looks.
    for frame in reversed(frames):
        if not _is_notebook_frame(frame):
            continue
        if frame.filename == NOTEBOOK_FILENAME:
            located_cell, located_line = module.locate(frame.lineno or 0)
        else:
            located_cell, located_line = running_cell_id, frame.lineno
        if located_cell is not None:
            cell_id, cell_line = located_cell, located_line
            break

    rendered = _render_traceback(exc, frames, module, running_cell_id)
    error = ExecutionError(
        type=type(exc).__name__,
        message=redactor.redact(str(exc)),
        traceback=[redactor.redact(line) for line in rendered],
        cell_id=cell_id or running_cell_id,
        line=cell_line,
    )
    return error, cell_id or running_cell_id


def _render_traceback(
    exc: BaseException,
    frames: list[traceback.FrameSummary],
    module: ModuleSource,
    running_cell_id: str | None,
) -> list[str]:
    """Traceback lines with the runtime's own frames stripped out."""
    relabelled: list[traceback.FrameSummary] = []
    for frame in frames:
        if not _is_notebook_frame(frame):
            continue
        if frame.filename == NOTEBOOK_FILENAME:
            located_cell, located_line = module.locate(frame.lineno or 0)
        else:
            located_cell, located_line = running_cell_id, frame.lineno
        relabelled.append(
            traceback.FrameSummary(
                filename=f"cell {located_cell}" if located_cell else frame.filename,
                lineno=located_line or frame.lineno,
                name=frame.name,
                line=frame.line,
            )
        )

    if not relabelled:
        # Nothing of the author's is in the traceback -- the failure is in a
        # library they called. Show it whole rather than showing nothing.
        return traceback.format_exception(type(exc), exc, exc.__traceback__)

    return [
        "Traceback (most recent call last):\n",
        *traceback.format_list(relabelled),
        *traceback.format_exception_only(type(exc), exc),
    ]


def _run_one_cell(
    shell: Any | None,
    globals_: dict[str, Any],
    cell: Any,
    module: ModuleSource,
    redactor: Redactor,
    *,
    keep_output: bool,
) -> CellResult:
    cell_id = cell_id_of(cell)
    source = cell_source_of(cell)
    started = time.monotonic()

    expression_value: Any = None
    with _captured(shell) as captured:
        if shell is not None:
            # silent=True for a replayed cell skips the display hook entirely,
            # so an expensive repr is never computed for output we discard.
            result = shell.run_cell(source, store_history=False, silent=not keep_output)
            failure = result.error_before_exec or result.error_in_exec
            expression_value = result.result
        else:
            failure = None
            try:
                expression_value = _exec_cell(source, cell_filename(cell_id), globals_)
            except BaseException as exc:  # reported to the author, not swallowed
                failure = exc

    duration_ms = int((time.monotonic() - started) * 1000)
    collected = (
        _collect(captured, redactor, shell=shell, expression_value=expression_value)
        if keep_output
        else []
    )

    if failure is not None:
        error, located = _format_exception(failure, module, redactor, running_cell_id=cell_id)
        raise _CellError(located or cell_id, error)

    return CellResult(
        cell_id=cell_id,
        status=ExecutionStatus.SUCCESS,
        duration_ms=duration_ms,
        outputs=collected,
    )


def _exec_cell(source: str, filename: str, globals_: dict[str, Any]) -> Any:
    """Run one cell without IPython, returning its final expression's value.

    Plain ``exec`` throws the last expression away, which would make a cell
    ending in ``df.head()`` silently produce nothing. Splitting the trailing
    expression off and ``eval``-ing it reproduces the one notebook behaviour
    that actually matters when the interactive extra is unavailable.
    """
    # Register the source so tracebacks can quote the offending line. IPython
    # does the same for its own cells; without it the fallback engine produces
    # tracebacks with locations but no code.
    linecache.cache[filename] = (
        len(source),
        None,
        source.splitlines(keepends=True),
        filename,
    )

    tree = ast.parse(source, filename=filename)
    last = tree.body[-1] if tree.body else None
    if isinstance(last, ast.Expr):
        tree.body.pop()
        exec(compile(tree, filename, "exec"), globals_)
        expression = ast.Expression(body=last.value)
        ast.copy_location(expression, last)
        return eval(compile(expression, filename, "eval"), globals_)

    exec(compile(tree, filename, "exec"), globals_)
    return None


def _cells_to_run(
    cells: Sequence[Any],
    mode: ExecutionMode,
    target_cell_id: str | None,
) -> tuple[list[Any], str | None]:
    """Which cells this mode replays, and which one's output is the answer."""
    runnable = code_cells(cells)

    if mode is not ExecutionMode.CELL:
        return runnable, None

    for index, cell in enumerate(runnable):
        if cell_id_of(cell) == target_cell_id:
            return runnable[: index + 1], target_cell_id

    raise ValueError(f"No code cell with id {target_cell_id!r}")


def execute_notebook(
    cells: Sequence[Any],
    *,
    mode: ExecutionMode = ExecutionMode.ALL,
    target_cell_id: str | None = None,
    context: Context | None = None,
    redactor: Redactor | None = None,
    max_output_bytes: int = 0,
    max_assets: int = 10,
    execution_id: str | None = None,
    revision: int | None = None,
    on_asset: Callable[[Any], None] | None = None,
) -> ExecutionResponse:
    """Replay the notebook and report what the requested mode produced."""
    context = context or Context()
    redactor = redactor or Redactor()
    module = to_module_source(cells)
    started = time.monotonic()

    response = ExecutionResponse(
        status=ExecutionStatus.SUCCESS,
        mode=mode,
        execution_id=execution_id,
        revision=revision,
        target_cell_id=target_cell_id,
    )

    if mode is ExecutionMode.VALIDATE:
        report = validate_module(module)
        response.status = ExecutionStatus.SUCCESS if report.ok else ExecutionStatus.ERROR
        response.contract = report.to_dict()
        if not report.ok:
            violation = report.violations[0]
            response.error = ExecutionError(
                type="NotebookContractError",
                message=violation.message,
                cell_id=violation.cell_id,
                line=violation.line,
            )
        response.duration_ms = int((time.monotonic() - started) * 1000)
        return response

    # `cell` and `all` intentionally skip the contract check: an author must be
    # able to run a cell while extract() is still half-written. The modes that
    # actually call those functions do check.
    if mode in CONTRACT_MODES:
        report = validate_module(module)
        if not report.ok:
            response.status = ExecutionStatus.ERROR
            response.contract = report.to_dict()
            response.error = ExecutionError(
                type="NotebookContractError",
                message=report.violations[0].message,
                cell_id=report.violations[0].cell_id,
                line=report.violations[0].line,
            )
            response.duration_ms = int((time.monotonic() - started) * 1000)
            return response

    try:
        to_run, answer_cell = _cells_to_run(cells, mode, target_cell_id)
    except ValueError as exc:
        response.status = ExecutionStatus.ERROR
        response.error = ExecutionError(type="ValueError", message=str(exc))
        return response

    _configure_matplotlib()
    shell = _interactive_shell()
    globals_ = _prepare_namespace(shell, context)

    try:
        for cell in to_run:
            # In `cell` mode the preceding cells are scaffolding, not results:
            # showing "loading data…" under cell 3 because cell 1 printed it
            # would be noise the author did not ask for.
            keep_output = mode is not ExecutionMode.CELL or cell_id_of(cell) == answer_cell
            result = _run_one_cell(shell, globals_, cell, module, redactor, keep_output=keep_output)
            if keep_output:
                result.outputs = out.cap_outputs(result.outputs, max_output_bytes)
                response.cells.append(result)

        if mode is ExecutionMode.TEST_CONNECTION:
            response.result = _call_test_connection(globals_, redactor)
        elif mode is ExecutionMode.PREVIEW_EXTRACT:
            response.assets = _call_extract(globals_, redactor, max_assets, on_asset)

    except _CellError as failure:
        response.status = ExecutionStatus.ERROR
        response.failed_cell_id = failure.cell_id
        response.error = failure.error
    except BaseException as exc:  # reported to the author, not swallowed
        error, cell_id = _format_exception(exc, module, redactor)
        response.status = ExecutionStatus.ERROR
        response.failed_cell_id = cell_id
        response.error = error

    response.duration_ms = int((time.monotonic() - started) * 1000)
    return response


def _call_test_connection(globals_: dict[str, Any], redactor: Redactor) -> dict[str, Any]:
    verdict = globals_["test_connection"]()
    if not isinstance(verdict, Mapping):
        return {
            "status": "FAILURE",
            "message": (
                "test_connection() must return a dict like "
                '{"status": "SUCCESS", "message": "..."} '
                f"but returned {type(verdict).__name__}"
            ),
        }
    status = str(verdict.get("status", "")).upper()
    return {
        "status": status if status in {"SUCCESS", "FAILURE"} else "FAILURE",
        "message": redactor.redact(str(verdict.get("message", ""))),
    }


def _call_extract(
    globals_: dict[str, Any],
    redactor: Redactor,
    max_assets: int,
    on_asset: Callable[[Any], None] | None,
) -> list[dict[str, Any]]:
    """Pull a bounded sample so the author can see the shape before scanning."""
    sample: list[dict[str, Any]] = []
    for asset in iter_assets(globals_["extract"]()):
        if on_asset is not None:
            on_asset(asset)
        sample.append(
            redactor.redact_deep(
                {
                    "id": asset.id,
                    "name": asset.name,
                    "url": asset.url,
                    "kind": asset.kind,
                    "contentType": asset.content_type or "auto",
                    "contentPreview": asset.content[:2000],
                    "contentLength": len(asset.content),
                    "metadata": asset.metadata,
                    "links": asset.links,
                }
            )
        )
        if len(sample) >= max_assets:
            break
    return sample


def preview_assets(cells: Iterable[Any], **kwargs: Any) -> ExecutionResponse:
    """Convenience wrapper for the preview path."""
    return execute_notebook(list(cells), mode=ExecutionMode.PREVIEW_EXTRACT, **kwargs)
