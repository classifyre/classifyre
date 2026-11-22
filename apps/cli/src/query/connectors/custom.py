"""CUSTOM sources whose notebook defines ``tables()`` and ``scan()``: the
``custom`` tier (docs/prd/QC-query-connectors.md §5.8).

``<source>.main.<table>``: the columns ``tables()`` declared, recorded by the
last scan. Each scan of the table runs ``scan(table, request)`` in the
notebook's child process (``src/sources/custom/runner.py``: scrubbed
environment, no API credentials, no namespace calls while a query runs),
which sends its rows back as Arrow. What the notebook does with the
request's filters only decides how much it reads: every row is filtered
again here (:mod:`.arrow`).

The notebook is code the source's editors wrote, run for whoever may read the
table: queries of CUSTOM sources always run as Jobs, never in the shared query
worker (``DEFAULT_JOB_ONLY_SOURCES``), so it shares a pod with no other query.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterator
from typing import Any

from .arrow import ArrowConnector, ConnectorError, ScanRequest, connector_max_rows
from .base import SourceContext, TableLocation

logger = logging.getLogger(__name__)


class CustomConnector(ArrowConnector):
    tier = "custom"
    product = "The notebook"

    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)
        # One notebook process per scan running at once: two scans of one
        # query (a self-join) must not read each other's rows off one pipe.
        self._lock = threading.Lock()
        self._idle: list[Any] = []
        self._extra: list[Any] = []
        self._first_taken = False

    def label(self) -> str | None:
        return None

    def where(self) -> str:
        return f"The notebook of {self.source.alias}"

    def scan(self, location: TableLocation, request: ScanRequest) -> Iterator[Any]:
        from ...notebook.query import ScanCall, decode_filters
        from ...sources.custom.source import CustomSourceError, NotebookTimeoutError

        (table,) = self.require(location, "table")
        call = ScanCall(
            table=table,
            columns=location.columns,
            projection=request.columns,
            filters=request.predicates,
            max_rows=connector_max_rows(),
            seconds_left=max(0.0, request.deadline - time.monotonic()),
        )
        instance = self._acquire()
        try:
            outcome = yield from instance.query_scan(call, request.deadline)
        except CustomSourceError as exc:
            # The one place that decides what the person sees: only text known
            # to hold no data (exc.shown); the rest, redacted, goes to the log.
            logger.warning("scan(%r) failed: %s", table, str(exc).strip())
            shown = (exc.shown or "").strip().splitlines()
            message = (
                shown[0][:300]
                if shown
                else ("the notebook stopped unexpectedly; its message is in the query's log.")
            )
            code = "timeout" if isinstance(exc, NotebookTimeoutError) else "source_unavailable"
            raise ConnectorError(f"{self.where()}: {message}", code) from None
        finally:
            self._release(instance)
        request.stats.requests += int(outcome.get("requests") or 0)
        used = decode_filters(outcome.get("used"))
        request.sent(p for p in request.predicates if p in used)

    def _acquire(self) -> Any:
        with self._lock:
            if self._idle:
                return self._idle.pop()
            if not self._first_taken:
                self._first_taken = True
                return self.source.instance()  # closed by the session's binding
        from ...sources import get_source

        extra = get_source(dict(self.source.recipe), source_id=self.source.source_id)
        with self._lock:
            self._extra.append(extra)
        return extra

    def _release(self, instance: Any) -> None:
        with self._lock:
            self._idle.append(instance)

    def close(self) -> None:
        super().close()
        with self._lock:
            extra, self._extra, self._idle = self._extra, [], []
        for instance in extra:
            try:
                instance.cleanup()
            except Exception:  # pragma: no cover - best effort
                pass
