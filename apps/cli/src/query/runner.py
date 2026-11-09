"""``python -m src.main query <request.json>``: run one query, report back.

The result goes to the API as an Arrow IPC stream, posted to
``callbackUrl`` with the run's own token (``X-Query-Run-Token``). The job holds
no API key: the token is good for this one run's result and nothing else.
Whatever happens, one line starting with :data:`RESULT_MARKER` is printed, so
the API can still tell what went wrong when the callback never arrived.
"""

from __future__ import annotations

import base64
import json
import logging
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..utils.redaction import ENCRYPTED_CONFIG_PATHS, Redactor, _leaves_at_path

if TYPE_CHECKING:
    from .session import QueryRequest, QueryResult

logger = logging.getLogger(__name__)

RESULT_MARKER = "__CLASSIFYRE_QUERY_RESULT__"
TOKEN_HEADER = "X-Query-Run-Token"
META_HEADER = "X-Query-Run-Meta"
ARROW_STREAM = "application/vnd.apache.arrow.stream"


def _redactor(request_data: dict[str, Any]) -> Redactor:
    secrets: list[str] = []
    for source in request_data.get("sources") or []:
        recipe = source.get("recipe") if isinstance(source, dict) else None
        if isinstance(recipe, dict):
            for path in ENCRYPTED_CONFIG_PATHS:
                secrets.extend(str(leaf) for leaf in _leaves_at_path(recipe, path))
    token = request_data.get("callbackToken")
    if isinstance(token, str) and token:
        secrets.append(token)
    return Redactor(secrets)


def _error(code: str, message: str) -> dict[str, Any]:
    return {"status": "error", "error": {"code": code, "message": message}}


def _post(url: str, token: str | None, body: bytes, headers: dict[str, str]) -> None:
    import requests

    if token:
        headers = {**headers, TOKEN_HEADER: token}
    last: Exception | None = None
    for attempt in range(3):
        try:
            response = requests.post(url, data=body, headers=headers, timeout=(10, 60))
            if response.status_code < 500:
                if response.status_code >= 400:
                    logger.error("The API refused the query result: HTTP %s", response.status_code)
                return
            last = RuntimeError(f"HTTP {response.status_code}")
        except Exception as exc:  # network blip: retry
            last = exc
        time.sleep(0.5 * (attempt + 1))
    logger.error("Could not deliver the query result: %s", last)


def _report(request: QueryRequest | None, payload: dict[str, Any], arrow: bytes | None) -> None:
    if request is not None and request.callback_url:
        if arrow is not None:
            meta = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
            _post(
                request.callback_url,
                request.callback_token,
                arrow,
                {
                    # Every body is posted as a stream of bytes; what they are
                    # is in the meta (`format`), so the API needs one parser.
                    "Content-Type": ARROW_STREAM,
                    META_HEADER: meta,
                },
            )
        else:
            _post(
                request.callback_url,
                request.callback_token,
                json.dumps(payload).encode("utf-8"),
                {"Content-Type": "application/json"},
            )
    print(f"{RESULT_MARKER} {json.dumps(payload)}", flush=True)


def ensure_dependencies() -> None:
    """DuckDB and pyarrow (file-processing) and SQLGlot (lineage): optional
    groups of the CLI image, installed on first use into the shared uv cache."""
    from ..detectors.dependencies import require_module

    require_module("duckdb", "SQL query", ["file-processing"])
    require_module("pyarrow", "SQL query", ["file-processing"])
    require_module("sqlglot", "SQL query", ["lineage"])


def run_query(request_data: dict[str, Any]) -> tuple[dict[str, Any], QueryResult | None]:
    """Run a request; return the status payload and, on success, the result."""
    redact = _redactor(request_data)
    try:
        ensure_dependencies()
    except Exception as exc:
        return _error("engine_unavailable", redact(str(exc).splitlines()[0][:500])), None
    from .bindings import BindingError
    from .gate import QueryRefusedError
    from .session import QueryRequest, QuerySession, QueryTimeoutError

    request = QueryRequest.from_dict(request_data)
    try:
        with QuerySession(request) as session:
            result = session.run()
    except QueryRefusedError as exc:
        return _error(exc.code, redact(str(exc))), None
    except QueryTimeoutError as exc:
        return _error("timeout", str(exc)), None
    except BindingError as exc:
        return _error("source_unavailable", redact(str(exc))), None
    except Exception as exc:
        message = str(exc).strip().splitlines()
        text = message[0] if message else type(exc).__name__
        # DuckDB's own errors (a missing column, a type mismatch) are useful
        # to the person; they pass through the redactor in case a connection
        # string ever reaches one.
        return _error("execution_error", redact(text[:2000])), None
    payload = {
        "status": "success",
        "rowCount": result.row_count,
        "truncated": result.truncated,
        "truncatedReason": result.truncated_reason,
        "columns": result.columns,
        "timings": result.timings,
        "tables": result.tables,
        "bytes": len(result.arrow),
        "format": result.export_format or "arrow",
        "mediaType": result.media_type,
    }
    return payload, result


def run_query_command(path: str | None) -> int:
    if not path:
        print(f"{RESULT_MARKER} {json.dumps(_error('invalid_request', 'No request file.'))}")
        return 2
    try:
        request_data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"{RESULT_MARKER} {json.dumps(_error('invalid_request', str(exc)[:300]))}")
        return 2
    payload, result = run_query(request_data)
    from .session import QueryRequest

    request = QueryRequest.from_dict(request_data)
    _report(request, payload, result.arrow if result is not None else None)
    return 0 if payload["status"] == "success" else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(run_query_command(sys.argv[1] if len(sys.argv) > 1 else None))
