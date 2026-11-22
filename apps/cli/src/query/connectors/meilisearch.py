"""Meilisearch indexes, read live (docs/prd/QC-query-connectors.md §5.5).

``<source>.indexes.<index>``: one row per document, the columns the scan
recorded (top-level fields; objects as JSON text, lists of scalars as
lists). Documents come from ``POST /indexes/{uid}/documents/fetch``
(Meilisearch 1.2+), which pages by ``offset`` with no total-hits cap, asking
only for the ``fields`` the query reads. Conditions on the index's
filterable attributes go to Meilisearch as its ``filter``; it may return
more than they select, never less, and DuckDB filters again. Checked on
Meilisearch 1.13: string equality ignores case (``= "drama"`` also matches
``Drama``), ``= 5`` also matches the text ``"5"``, ``!=`` keeps documents
without the field, and JSON string escapes (``\\``, ``\"``, ``\n``) are
read as JSON reads them. Because equality ignores case, ``!=`` on text would
drop rows SQL keeps (``!= "drama"`` drops ``Drama``): it is sent for numbers
and booleans only.

Servers before 1.2 have no ``/documents/fetch``: they are read with
``GET /indexes/{uid}/documents`` and no filter.

The session, API key, TLS setting and timeout are the scan's own
(:class:`~src.sources.meilisearch.source.MeilisearchSource`).
"""

from __future__ import annotations

import fnmatch
import json
import re
from collections.abc import Iterator
from typing import Any

from .arrow import ArrowConnector, ConnectorError, Predicate, ScanRequest
from .base import SourceContext, TableLocation

#: Documents per request.
PAGE_SIZE = 1000

#: Attribute names Meilisearch's filter syntax takes unquoted.
_PLAIN_ATTRIBUTE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")
_EQUALITY = {"=", "!=", "in"}
_COMPARISON = {"<", "<=", ">", ">="}


class MeilisearchConnector(ArrowConnector):
    product = "Meilisearch"

    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)
        self._session: Any = None

    def scan(self, location: TableLocation, request: ScanRequest) -> Iterator[Any]:
        (uid,) = self.require(location, "table")
        client = self.source.instance()
        if self._session is None:
            self._session = client._session()
        base = f"{client._base_url()}/indexes/{uid}"
        timeout = float(client._request_timeout())
        fields = list(request.columns) if request.columns is not None else None
        allowed = self._filterable(base, request, timeout)
        filter_text, sent = meilisearch_filter(request.predicates, allowed)
        offset = 0
        fetch = True
        while True:
            if fetch:
                body: dict[str, Any] = {"offset": offset, "limit": PAGE_SIZE}
                if fields is not None:
                    body["fields"] = fields
                if filter_text:
                    body["filter"] = filter_text
                response = self._call(
                    "post", f"{base}/documents/fetch", request, timeout, json=body
                )
                if response.status_code == 404 and offset == 0:
                    # Before Meilisearch 1.2: no fetch, no filter (and none
                    # reported as sent).
                    fetch = False
                    continue
                if offset == 0 and response.status_code < 400:
                    request.sent(sent)
            else:
                params: dict[str, Any] = {"offset": offset, "limit": PAGE_SIZE}
                if fields is not None:
                    params["fields"] = ",".join(fields)
                response = self._call("get", f"{base}/documents", request, timeout, params=params)
            self._check(response)
            data = response.json()
            docs = data.get("results") if isinstance(data, dict) else None
            if not isinstance(docs, list):
                raise ConnectorError(f"{self.where()} sent documents in an unknown form.")
            if docs:
                yield docs
            offset += len(docs)
            total = data.get("total") if isinstance(data, dict) else None
            if len(docs) < PAGE_SIZE or (isinstance(total, int) and offset >= total):
                return

    def _filterable(self, base: str, request: ScanRequest, timeout: float) -> dict[str, set[str]]:
        """Attribute → the operators its filter allows; read once per scan
        with conditions to send."""
        if not request.predicates:
            return {}
        response = self._call("get", f"{base}/settings/filterable-attributes", request, timeout)
        if response.status_code >= 400:
            return {}
        try:
            settings = response.json()
        except ValueError:
            return {}
        names = {p.column for p in request.predicates}
        return filterable_operators(settings, names)

    def _call(
        self, method: str, url: str, request: ScanRequest, timeout: float, **kwargs: Any
    ) -> Any:
        import requests

        try:
            response = getattr(self._session, method)(
                url, timeout=request.timeout(timeout), **kwargs
            )
        except requests.exceptions.Timeout:
            raise ConnectorError(f"{self.where()} did not answer in time.") from None
        except requests.exceptions.RequestException:
            raise ConnectorError(f"{self.where()} is unreachable.") from None
        request.stats.requests += 1
        return response

    def _check(self, response: Any) -> None:
        if response.status_code >= 400:
            # Never the body: it may echo the filter, documents or the key.
            raise ConnectorError(f"{self.where()} returned HTTP {response.status_code}.")

    def close(self) -> None:
        super().close()
        if self._session is not None:
            try:
                self._session.close()
            except Exception:  # pragma: no cover - best effort
                pass
            self._session = None


def filterable_operators(settings: Any, names: set[str]) -> dict[str, set[str]]:
    """Which of ``names`` Meilisearch filters on, and with which operators.

    Settings are a list of attribute names (Meilisearch < 1.14) or of
    ``{attributePatterns, features: {filter: {equality, comparison}}}``.
    """
    out: dict[str, set[str]] = {}
    if not isinstance(settings, list):
        return out
    for entry in settings:
        if isinstance(entry, str):
            patterns, ops = [entry], _EQUALITY | _COMPARISON
        elif isinstance(entry, dict):
            patterns = [p for p in entry.get("attributePatterns") or [] if isinstance(p, str)]
            features = entry.get("features")
            filt = features.get("filter") if isinstance(features, dict) else None
            if not isinstance(filt, dict):
                filt = {"equality": True, "comparison": False}
            ops = set()
            if filt.get("equality", True):
                ops |= _EQUALITY
            if filt.get("comparison", False):
                ops |= _COMPARISON
        else:
            continue
        for name in names:
            if any(fnmatch.fnmatchcase(name, pattern) for pattern in patterns):
                out.setdefault(name, set()).update(ops)
    return out


def meilisearch_filter(
    predicates: tuple[Predicate, ...], allowed: dict[str, set[str]]
) -> tuple[str | None, list[Predicate]]:
    """Meilisearch's ``filter`` for the predicates it can apply, AND-ed, and those predicates."""
    parts: list[str] = []
    sent: list[Predicate] = []
    for predicate in predicates:
        name = predicate.column
        if predicate.op not in allowed.get(name, set()) or not _PLAIN_ATTRIBUTE.match(name):
            continue
        if predicate.op == "in":
            values = [_value(v) for v in predicate.value]
            if None in values or not values:
                continue
            parts.append(f"{name} IN [{', '.join(v for v in values if v is not None)}]")
            sent.append(predicate)
            continue
        value = _value(predicate.value)
        if value is None:
            continue
        if predicate.op in _COMPARISON and not _is_number(predicate.value):
            continue
        if predicate.op == "!=" and isinstance(predicate.value, str):
            # Case-insensitive equality: != on text would drop rows.
            continue
        parts.append(f"{name} {predicate.op} {value}")
        sent.append(predicate)
    return " AND ".join(parts) or None, sent


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _value(value: Any) -> str | None:
    """A literal in Meilisearch's filter syntax; None when it has none."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if _is_number(value):
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    return None
