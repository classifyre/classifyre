"""Dremio over its REST API, shaped so the tabular base can drive it.

Dremio speaks three protocols. Arrow Flight and JDBC/ODBC move rows fastest, but
each needs its own port, its own TLS story and (for JDBC) a driver. The REST API
is the one every deployment already exposes on the address people open in a
browser, it is the only one that serves the catalog tree and the lineage graph,
and it needs nothing beyond ``requests``. So everything goes through it, and the
only cost is that rows arrive as paged JSON rather than Arrow batches.

SQL is asynchronous here: submitting a statement returns a job id, the job is
polled until it settles, and its rows are then read 500 at a time.
:class:`DremioCursor` hides that behind the handful of DB-API methods
``BaseTabularSource`` calls, which is what lets sampling, AUTOMATIC paging and
full scans work without a Dremio-specific copy of each.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Iterator, Sequence
from typing import Any
from urllib.parse import quote

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

#: The job-results endpoint refuses a larger ``limit``.
RESULT_PAGE_SIZE = 500

#: Children requested per catalog page. Dremio ignores paging for folders that
#: live in a filesystem source and returns them whole.
CATALOG_PAGE_SIZE = 500

#: Rows read from one job before a full scan starts another.
#:
#: Results fetched over REST come out of Dremio's job-results store, which is
#: commonly capped (``planner.output_limit_size``, one million rows by default)
#: and truncates silently: the job reports COMPLETED and simply stops handing
#: out rows. A table read through a single job could therefore look fully
#: scanned while most of it was never seen. Reading in windows well under the
#: cap means a short window is real evidence that the table ended.
JOB_ROW_WINDOW = 500_000

_TERMINAL_FAILURES = {"FAILED", "CANCELED", "CANCELLED"}

_CLOUD_API_HOSTS = {"US": "api.dremio.cloud", "EU": "api.eu.dremio.cloud"}
_CLOUD_APP_HOSTS = {"US": "app.dremio.cloud", "EU": "app.eu.dremio.cloud"}


class DremioApiError(RuntimeError):
    """A Dremio API call failed. ``status_code`` is None for non-HTTP failures."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def cloud_api_url(region: str, project_id: str) -> str:
    host = _CLOUD_API_HOSTS.get(region.upper(), _CLOUD_API_HOSTS["US"])
    return f"https://{host}/v0/projects/{quote(project_id, safe='')}"


def cloud_app_url(region: str, project_id: str) -> str:
    host = _CLOUD_APP_HOSTS.get(region.upper(), _CLOUD_APP_HOSTS["US"])
    return f"https://{host}/sonar/{quote(project_id, safe='')}"


class DremioClient:
    """Authenticated access to one Dremio deployment's REST API.

    Two sign-in styles exist and they differ in more than the header. A personal
    access token is sent as-is and never expires mid-run. A username and
    password are traded for a session token at ``/apiv2/login`` — the only
    option on Community Edition, which has no PATs — and that token does
    expire, so a 401 triggers one fresh login before the call is given up on.
    """

    def __init__(
        self,
        *,
        api_url: str,
        login_url: str | None = None,
        token: str | None = None,
        username: str | None = None,
        password: str | None = None,
        verify_ssl: bool = True,
        timeout_seconds: int = 30,
        query_timeout_seconds: int = 300,
    ) -> None:
        self._api_url = api_url.rstrip("/")
        self._login_url = login_url
        self._token = token
        self._username = username
        self._password = password
        self._timeout = timeout_seconds
        self._query_timeout = query_timeout_seconds
        self._session_token: str | None = None
        self._auth_lock = threading.Lock()
        self._active_jobs: set[str] = set()
        self._jobs_lock = threading.Lock()
        self._aborted = threading.Event()

        self.session = requests.Session()
        self.session.verify = verify_ssl
        # Only GETs are replayed: a retried POST /sql would start a second job.
        retry = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=(429, 502, 503, 504),
            allowed_methods=("GET",),
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

    # ── Auth ─────────────────────────────────────────────────────────────

    def _login(self) -> str:
        if not (self._login_url and self._username and self._password):
            raise DremioApiError("Dremio username and password are required to sign in")
        try:
            response = self.session.post(
                self._login_url,
                json={"userName": self._username, "password": self._password},
                timeout=self._timeout,
            )
        except requests.RequestException as exc:
            raise DremioApiError(f"Could not reach Dremio to sign in: {exc}") from exc
        if response.status_code in (401, 403):
            raise DremioApiError("Dremio rejected the username or password", response.status_code)
        if not response.ok:
            # The body is deliberately not echoed: a login error page can quote
            # the submitted username back.
            raise DremioApiError(
                f"Dremio sign-in failed with HTTP {response.status_code}", response.status_code
            )
        token = (response.json() or {}).get("token")
        if not isinstance(token, str) or not token:
            raise DremioApiError("Dremio sign-in response did not include a token")
        return token

    def _authorization(self, *, refresh: bool = False) -> str:
        if self._token:
            return f"Bearer {self._token}"
        with self._auth_lock:
            if refresh or not self._session_token:
                self._session_token = self._login()
            # Session tokens from /apiv2/login use Dremio's own scheme.
            return f"_dremio{self._session_token}"

    # ── HTTP ─────────────────────────────────────────────────────────────

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self._api_url}/{path.lstrip('/')}"
        response: requests.Response | None = None
        for attempt in range(2):
            try:
                response = self.session.request(
                    method,
                    url,
                    headers={
                        "Authorization": self._authorization(refresh=attempt > 0),
                        "Accept": "application/json",
                    },
                    params=params,
                    json=json_payload,
                    timeout=self._timeout,
                )
            except requests.RequestException as exc:
                raise DremioApiError(f"Could not reach Dremio: {exc}") from exc
            # A session token that expired mid-run is worth exactly one retry.
            # A rejected PAT is not: asking again changes nothing.
            if response.status_code == 401 and not self._token and attempt == 0:
                continue
            break
        assert response is not None
        if not response.ok:
            raise DremioApiError(self._error_message(response), response.status_code)
        if response.status_code == 204 or not response.content:
            return {}
        payload = response.json()
        return payload if isinstance(payload, dict) else {"data": payload}

    @staticmethod
    def _error_message(response: requests.Response) -> str:
        detail = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                detail = str(body.get("errorMessage") or body.get("message") or "")
        except ValueError:
            detail = ""
        if response.status_code == 401:
            return "Dremio rejected the credentials (HTTP 401)"
        if response.status_code == 403 and not detail:
            return "Dremio denied access (HTTP 403)"
        suffix = f": {detail}" if detail else ""
        return f"Dremio API returned HTTP {response.status_code}{suffix}"

    # ── Catalog ──────────────────────────────────────────────────────────

    def list_roots(self) -> list[dict[str, Any]]:
        """Top-level sources, spaces and home spaces."""
        data = self.request("get", "/catalog").get("data")
        return [entry for entry in data or [] if isinstance(entry, dict)]

    def catalog_entity(self, entity_id: str) -> dict[str, Any]:
        """One catalog object by id, with every page of its children.

        Ids are not always UUIDs: an unpromoted folder inside a filesystem
        source is addressed as ``dremio:/source/folder``, which has to be
        escaped whole or the slashes read as more path segments.
        """
        return self._entity_with_children(f"/catalog/{quote(entity_id, safe='')}")

    def catalog_entity_by_path(self, path: Sequence[str]) -> dict[str, Any]:
        encoded = "/".join(quote(part, safe="") for part in path)
        return self._entity_with_children(f"/catalog/by-path/{encoded}")

    def _entity_with_children(self, path: str) -> dict[str, Any]:
        entity = self.request("get", path, params={"maxChildren": CATALOG_PAGE_SIZE})
        page = entity
        seen_tokens: set[str] = set()
        while True:
            token = page.get("nextPageToken")
            if not isinstance(token, str) or not token or token in seen_tokens:
                break
            seen_tokens.add(token)
            page = self.request(
                "get", path, params={"maxChildren": CATALOG_PAGE_SIZE, "pageToken": token}
            )
            more = page.get("children")
            if isinstance(more, list):
                entity.setdefault("children", []).extend(more)
        entity.pop("nextPageToken", None)
        return entity

    def lineage_graph(self, dataset_id: str) -> dict[str, Any]:
        """What a dataset reads from and feeds (Enterprise and Cloud only)."""
        return self.request("get", f"/catalog/{quote(dataset_id, safe='')}/graph")

    # ── SQL jobs ─────────────────────────────────────────────────────────

    def run_query(self, sql: str) -> str:
        """Submit ``sql``, wait for it to finish, and return the job id."""
        if self._aborted.is_set():
            raise DremioApiError("Dremio scan was aborted")
        job_id = self.request("post", "/sql", json_payload={"sql": sql}).get("id")
        if not isinstance(job_id, str) or not job_id:
            raise DremioApiError("Dremio did not return a job id for the query")

        with self._jobs_lock:
            self._active_jobs.add(job_id)
        try:
            self._wait_for_job(job_id)
        finally:
            with self._jobs_lock:
                self._active_jobs.discard(job_id)
        return job_id

    def _wait_for_job(self, job_id: str) -> None:
        deadline = time.monotonic() + self._query_timeout
        delay = 0.2
        while True:
            status = self.request("get", f"/job/{quote(job_id, safe='')}")
            state = str(status.get("jobState") or "").upper()
            if state == "COMPLETED":
                return
            if state in _TERMINAL_FAILURES:
                reason = status.get("errorMessage") or status.get("cancellationReason") or state
                raise DremioApiError(f"Dremio query {state.lower()}: {reason}")
            if self._aborted.is_set():
                self.cancel_job(job_id)
                raise DremioApiError("Dremio scan was aborted")
            if time.monotonic() >= deadline:
                self.cancel_job(job_id)
                raise DremioApiError(
                    f"Dremio query did not finish within {self._query_timeout}s and was cancelled"
                )
            # Sample queries usually settle in well under a second; a long scan
            # should not be polled at that rate for minutes.
            self._aborted.wait(delay)
            delay = min(delay * 1.5, 2.0)

    def job_results(self, job_id: str, offset: int, limit: int) -> dict[str, Any]:
        return self.request(
            "get",
            f"/job/{quote(job_id, safe='')}/results",
            params={"offset": offset, "limit": min(limit, RESULT_PAGE_SIZE)},
        )

    def cancel_job(self, job_id: str) -> None:
        try:
            self.request("post", f"/job/{quote(job_id, safe='')}/cancel")
        except Exception as exc:
            logger.debug("Could not cancel Dremio job %s: %s", job_id, exc)

    # ── Lifecycle ────────────────────────────────────────────────────────

    def abort(self) -> None:
        """Stop waiting on jobs and ask Dremio to cancel the ones in flight."""
        self._aborted.set()
        with self._jobs_lock:
            jobs = list(self._active_jobs)
        for job_id in jobs:
            self.cancel_job(job_id)

    def connect(self) -> DremioConnection:
        return DremioConnection(self)

    def close(self) -> None:
        self.session.close()


def _render_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    raise DremioApiError(f"Unsupported SQL parameter type: {type(value).__name__}")


def render_sql(sql: str, params: Sequence[Any] | None) -> str:
    """Inline ``%s`` parameters; the REST SQL endpoint takes finished text only."""
    if not params:
        return sql
    pieces = sql.split("%s")
    if len(pieces) - 1 != len(params):
        raise DremioApiError(
            f"SQL has {len(pieces) - 1} placeholder(s) but {len(params)} parameter(s) were given"
        )
    rendered = [pieces[0]]
    for value, tail in zip(params, pieces[1:], strict=True):
        rendered.append(_render_literal(value))
        rendered.append(tail)
    return "".join(rendered)


class DremioCursor:
    """The subset of a DB-API cursor the tabular base uses, over REST jobs."""

    def __init__(self, client: DremioClient) -> None:
        self._client = client
        self.description: list[tuple[Any, ...]] | None = None
        self._columns: list[str] = []
        self._rows: Iterator[tuple[Any, ...]] = iter(())

    def execute(self, sql: str, params: Sequence[Any] | None = None) -> None:
        self._open(lambda: self._job_rows(render_sql(sql, params)))

    def execute_windowed(self, sql: str, window: int = JOB_ROW_WINDOW) -> None:
        """Run an unbounded ``SELECT`` as a series of bounded jobs.

        See :data:`JOB_ROW_WINDOW` for why a full scan is not left to one job.
        """
        self._open(lambda: self._windowed_rows(sql, window))

    def _open(self, rows: Callable[[], Iterator[tuple[Any, ...]]]) -> None:
        self.description = None
        self._columns = []
        self._rows = rows()
        # The column list only exists once the first page is back, and callers
        # read ``description`` straight after ``execute``.
        first = next(self._rows, None)
        if first is not None:
            self._rows = _chain_one(first, self._rows)

    def _windowed_rows(self, sql: str, window: int) -> Iterator[tuple[Any, ...]]:
        offset = 0
        while True:
            seen = 0
            for row in self._job_rows(f"{sql} LIMIT {window} OFFSET {offset}"):
                seen += 1
                yield row
            if seen < window:
                return
            offset += seen

    def _job_rows(self, sql: str) -> Iterator[tuple[Any, ...]]:
        job_id = self._client.run_query(sql)
        offset = 0
        while True:
            page = self._client.job_results(job_id, offset, RESULT_PAGE_SIZE)
            if self.description is None:
                self._set_description(page.get("schema"))
            rows = page.get("rows")
            if not isinstance(rows, list) or not rows:
                return
            for row in rows:
                if isinstance(row, dict):
                    yield tuple(row.get(name) for name in self._columns)
            offset += len(rows)
            total = page.get("rowCount")
            if len(rows) < RESULT_PAGE_SIZE or (isinstance(total, int) and offset >= total):
                return

    def _set_description(self, schema: Any) -> None:
        columns: list[tuple[Any, ...]] = []
        for column in schema if isinstance(schema, list) else []:
            if not isinstance(column, dict) or not isinstance(column.get("name"), str):
                continue
            type_info = column.get("type")
            type_name = type_info.get("name") if isinstance(type_info, dict) else None
            columns.append((column["name"], type_name, None, None, None, None, None))
        self.description = columns
        self._columns = [column[0] for column in columns]

    def fetchmany(self, size: int = RESULT_PAGE_SIZE) -> list[tuple[Any, ...]]:
        rows: list[tuple[Any, ...]] = []
        for row in self._rows:
            rows.append(row)
            if len(rows) >= size:
                break
        return rows

    def fetchall(self) -> list[tuple[Any, ...]]:
        return list(self._rows)

    def fetchone(self) -> tuple[Any, ...] | None:
        return next(self._rows, None)

    def close(self) -> None:
        self._rows = iter(())

    def __enter__(self) -> DremioCursor:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def _chain_one(
    first: tuple[Any, ...], rest: Iterator[tuple[Any, ...]]
) -> Iterator[tuple[Any, ...]]:
    yield first
    yield from rest


class DremioConnection:
    """A handle that hands out cursors. The HTTP session belongs to the client."""

    def __init__(self, client: DremioClient) -> None:
        self._client = client
        self.open = True

    def cursor(self) -> DremioCursor:
        return DremioCursor(self._client)

    def close(self) -> None:
        self.open = False
