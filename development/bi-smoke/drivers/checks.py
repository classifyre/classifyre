"""Shared helpers for the driver checks: the spec, one result line per check.

Every check prints exactly one line

    __BI_SMOKE__ {"id": "D4", "ok": true, "ms": 812, "detail": "...", "columns": [...], "rows": [...]}

which bi_smoke.py collects from the Job's log and compares with the REST
reference. Values are sent as text (``repr`` of what the driver returned is in
``types``), so the orchestrator decides what "equal" means in one place.
"""

from __future__ import annotations

import datetime as dt
import decimal
import json
import sys
import time
import traceback
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

MARKER = "__BI_SMOKE__"
SPEC_PATH = "/spec/spec.json"


def spec() -> dict[str, Any]:
    with open(sys.argv[1] if len(sys.argv) > 1 else SPEC_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def text(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, decimal.Decimal):
        return format(value, "f")
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    return str(value)


def emit(check_id: str, ok: bool, ms: int, detail: str = "", **extra: Any) -> None:
    line = {"id": check_id, "ok": ok, "ms": ms, "detail": detail[:2000], **extra}
    print(f"{MARKER} {json.dumps(line, default=text)}", flush=True)


@contextmanager
def check(check_id: str) -> Iterator[dict[str, Any]]:
    """Run one check; whatever it raises becomes a failed line, never a crash."""
    started = time.monotonic()
    out: dict[str, Any] = {"ok": True, "detail": ""}
    try:
        yield out
    except Exception as error:  # noqa: BLE001 - every failure is a finding
        out["ok"] = False
        out["detail"] = f"{type(error).__name__}: {error}"
        out.setdefault("trace", traceback.format_exc(limit=3))
    finally:
        ms = int((time.monotonic() - started) * 1000)
        extra = {k: v for k, v in out.items() if k not in ("ok", "detail")}
        emit(check_id, bool(out["ok"]), ms, str(out["detail"]), **extra)


def rows_of(cursor: Any, limit: int = 500) -> tuple[list[str], list[str], list[list[Any]]]:
    columns = [d[0] for d in cursor.description or []]
    rows = cursor.fetchmany(limit) if limit else cursor.fetchall()
    types = sorted({type(v).__name__ for row in rows for v in row})
    return columns, types, [[text(v) for v in row] for row in rows]


def run_all(checks: list[tuple[str, Callable[[dict[str, Any]], None]]]) -> None:
    for check_id, fn in checks:
        with check(check_id) as out:
            fn(out)
