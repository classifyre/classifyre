"""The `notebook` command: one request in, one JSON result out, then exit.

Deliberately the same shape as `test`: a short-lived process the API can run
either as a local subprocess or as a Kubernetes Job, with no server, no port and
no state to clean up. The only wrinkle is that a Job's answer comes back through
its pod log, interleaved with everything else that wrote to the stream -- hence
the result marker.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
from typing import Any

from .execute import execute_notebook
from .files import local_folders
from .groups import warm_declared_groups
from .packages import install as install_packages
from .protocol import (
    RESULT_PREFIX,
    ExecutionError,
    ExecutionMode,
    ExecutionRequest,
    ExecutionResponse,
    ExecutionStatus,
)
from .redact import RedactingStream, Redactor
from .sdk import Context

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 900


def _section(recipe: dict[str, Any], *path: str) -> dict[str, Any]:
    node: Any = recipe
    for key in path:
        node = (node or {}).get(key) if isinstance(node, dict) else None
    return node if isinstance(node, dict) else {}


def _string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(key): str(item) for key, item in value.items() if item is not None}


#: Where the API put this source's uploaded files before starting us. Set for an
#: execution that runs cells; absent for one that only validates.
NOTEBOOK_FILES_DIR_ENV = "CLASSIFYRE_NOTEBOOK_FILES_DIR"


def build_context(recipe: dict[str, Any], *, should_abort: Any = None) -> Context:
    """The `ctx` a notebook sees, assembled from its recipe.

    Authoring and scanning have to agree here: a cell that reads ``ctx.files``
    while someone is writing it must see the same files the scan will, or the
    notebook is tested against a different source than it runs against.
    """
    return Context(
        variables=_string_map(_section(recipe, "optional").get("variables")),
        secrets=_string_map(_section(recipe, "masked").get("secrets")),
        sampling=_section(recipe, "sampling"),
        files_dir=os.environ.get(NOTEBOOK_FILES_DIR_ENV) or None,
        folders=local_folders(recipe),
        should_abort=should_abort,
    )


def resolve_timeout(request: ExecutionRequest) -> int:
    limits = _section(request.recipe, "optional", "limits")
    try:
        return int(limits.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS)
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT_SECONDS


class _TimeoutError(Exception):
    pass


def _install_timeout(seconds: int) -> None:
    """Fail loudly at the deadline instead of being killed silently.

    The API will terminate the process anyway, but a process that reports its
    own timeout can say which cell was running -- which is the part the author
    needs.
    """
    if seconds <= 0 or not hasattr(signal, "SIGALRM"):
        return

    def _raise(_signum: int, _frame: Any) -> None:
        raise _TimeoutError(f"Execution exceeded the {seconds}s limit and was stopped.")

    signal.signal(signal.SIGALRM, _raise)
    signal.alarm(seconds)


def _clear_timeout() -> None:
    if hasattr(signal, "SIGALRM"):
        signal.alarm(0)


#: Installed once per process, before any cell runs. Resolving dependencies on
#: every Run click is what makes an interactive notebook feel broken, so this is
#: deliberately not per-cell -- and it is best-effort: without IPython the
#: executor falls back to a plain-exec engine that still runs the notebook.
INTERACTIVE_GROUP = "interactive"


def warm_interactive_group() -> None:
    try:
        from ..utils.uv_sync import warm_groups
    except ImportError:
        return
    try:
        ok, detail = warm_groups([INTERACTIVE_GROUP])
    except Exception as exc:
        logger.debug("Could not warm the %s group: %s", INTERACTIVE_GROUP, exc)
        return
    if not ok and detail:
        logger.info(
            "Rich cell output is unavailable (%s group not installed): %s",
            INTERACTIVE_GROUP,
            detail,
        )


def run_request(raw_request: dict[str, Any]) -> ExecutionResponse:
    """Execute one notebook request."""
    request = ExecutionRequest.from_dict(raw_request)
    recipe = request.recipe
    notebook = _section(recipe, "required", "notebook")
    cells = notebook.get("cells") or []
    revision = request.revision or notebook.get("revision")

    redactor = Redactor.from_recipe(recipe)
    # stderr carries CLI logging straight into runner-log storage, so it is
    # wrapped for the whole process rather than per cell.
    sys.stderr = RedactingStream(sys.stderr, redactor)

    warm_interactive_group()
    # What the notebook imports from the runtime's own optional groups. Warmed
    # before the declared packages below because `uv sync --frozen` prunes
    # anything `uv pip install` added -- the reverse order uninstalls them.
    warm_declared_groups(cells)

    # Before any cell: a connector's client library has to be importable by the
    # first line that imports it, and resolving on every Run would make the
    # editor feel broken.
    install_report = install_packages(_section(recipe, "optional").get("packages"))
    if install_report.error:
        return ExecutionResponse.failure(
            request.mode,
            ExecutionError(
                type="PackageInstallFailed",
                message=f"Could not install the notebook's packages. {install_report.error}",
            ),
            execution_id=request.execution_id,
            revision=revision,
            target_cell_id=request.target_cell_id,
        )

    timeout = resolve_timeout(request)
    _install_timeout(timeout)
    try:
        return execute_notebook(
            cells,
            mode=request.mode,
            target_cell_id=request.target_cell_id,
            context=build_context(recipe),
            redactor=redactor,
            max_output_bytes=request.max_output_bytes,
            max_assets=request.max_assets,
            execution_id=request.execution_id,
            revision=revision,
        )
    except _TimeoutError as exc:
        return ExecutionResponse.failure(
            request.mode,
            ExecutionError(type="ExecutionTimeout", message=str(exc)),
            execution_id=request.execution_id,
            revision=revision,
            target_cell_id=request.target_cell_id,
        )
    finally:
        _clear_timeout()


def emit(response: ExecutionResponse) -> None:
    """Write the result where a log reader can find it.

    Prefixed and on one line because in Kubernetes this arrives as part of a pod
    log: the API has to pick the answer out of a stream that also carries
    logging, warnings and whatever the notebook printed.
    """
    print(f"{RESULT_PREFIX}{json.dumps(response.to_dict())}", flush=True)


def run_notebook_command(args: Any) -> int:
    """Entry point for `python -m src.main notebook <request.json>`."""
    if not args.recipe:
        logger.error("notebook requires a path to a request JSON file")
        return 2

    try:
        with open(args.recipe, encoding="utf-8") as handle:
            raw_request = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        emit(
            ExecutionResponse.failure(
                ExecutionMode.ALL,
                ExecutionError(type="InvalidRequest", message=f"Could not read request: {exc}"),
            )
        )
        return 2

    try:
        response = run_request(raw_request)
    except ValueError as exc:
        emit(
            ExecutionResponse.failure(
                ExecutionMode.ALL,
                ExecutionError(type="InvalidRequest", message=str(exc)),
            )
        )
        return 2

    emit(response)
    # A failing cell is a normal outcome the API reads off the payload, not a
    # crash -- so only an unusable request exits non-zero.
    return 0 if response.status is ExecutionStatus.SUCCESS else 1
