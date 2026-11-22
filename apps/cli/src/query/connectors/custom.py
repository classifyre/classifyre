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
        from ...notebook.query import decode_filters, encode_filters
        from ...sources.custom.source import CustomSourceError

        (table,) = self.require(location, "table")
        instance = self._acquire()
        outcome: dict[str, Any] = {}
        try:
            yield from instance.query_scan(
                table,
                columns=list(location.columns),
                read=list(request.columns) if request.columns is not None else None,
                filters=encode_filters(request.predicates),
                max_rows=connector_max_rows(),
                deadline=request.deadline,
                outcome=outcome,
            )
        except CustomSourceError as exc:
            text = str(exc).strip()
            logger.warning("scan(%r) failed: %s", table, text)
            first = text.splitlines()[0][:300] if text else "scan() failed"
            code = "timeout" if "ran out of time" in first else "source_unavailable"
            raise ConnectorError(f"{self.where()}: {first}", code) from None
        finally:
            self._release(instance)
        request.stats.requests += int(outcome.get("requests") or 0)
        used = {str(f) for f in decode_filters(outcome.get("used"))}
        request.sent(p for p in request.predicates if str(p) in used)

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
