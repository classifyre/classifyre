"""Backpressure contract between the CLI and the API.

The API sheds ingestion with 503 when its heap is near the V8 ceiling
(AssetService.bulkIngest / CliBackpressureGuard). That is only safe if the CLI
treats a 503 as "hold, then send this again" rather than as a failure: bulk
ingest is an idempotent upsert, so a retry costs a round trip, while giving up
silently discards assets and findings that were already extracted.

These tests pin that contract with a real socket server, because the thing that
can break it is the urllib3 Retry configuration, not our own code — and a
misconfiguration there (a `total` lower than `status`, a status code missing
from the forcelist) fails open, quietly, in exactly the case that matters.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import ClassVar

import pytest
import requests
from requests.adapters import HTTPAdapter

from src.outputs.rest import _RETRY_POLICY, _STATUS_RETRIES


class _FlakyHandler(BaseHTTPRequestHandler):
    """Answers 503 for the first `unavailable_responses` calls, then 200."""

    unavailable_responses: ClassVar[int] = 0
    received_bodies: ClassVar[list[dict]] = []
    calls: ClassVar[int] = 0

    def do_POST(self) -> None:
        type(self).calls += 1
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        if type(self).calls <= type(self).unavailable_responses:
            self.send_response(503)
            # Keeps the test fast: the CLI honours Retry-After, so the server
            # picks the schedule instead of the ~2/4/8/16s exponential ramp.
            # Note "0" would NOT work — urllib3 treats a falsy Retry-After as
            # absent and falls back to its own backoff.
            self.send_header("Retry-After", "1")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        type(self).received_bodies.append(json.loads(body))
        payload = b'{"ok": true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args: object) -> None:
        pass


@pytest.fixture
def flaky_server():
    def _start(unavailable_responses: int):
        _FlakyHandler.unavailable_responses = unavailable_responses
        _FlakyHandler.received_bodies = []
        _FlakyHandler.calls = 0
        server = HTTPServer(("127.0.0.1", 0), _FlakyHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server

    servers: list[HTTPServer] = []

    def _factory(unavailable_responses: int) -> HTTPServer:
        server = _start(unavailable_responses)
        servers.append(server)
        return server

    yield _factory

    for server in servers:
        server.shutdown()
        server.server_close()


def _session() -> requests.Session:
    """A session wired exactly as RestOutput wires its own."""
    session = requests.Session()
    adapter = HTTPAdapter(max_retries=_RETRY_POLICY)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def test_batch_survives_sustained_backpressure(flaky_server) -> None:
    """The batch still lands after more 503s than the old budget allowed.

    Nine is chosen deliberately: the previous policy was `total=8`, so this
    exact scenario used to end with the assets discarded.
    """
    server = flaky_server(9)
    url = f"http://127.0.0.1:{server.server_port}/assets/bulk"
    batch = {"assets": [{"unique_id": "a1"}, {"unique_id": "a2"}]}

    response = _session().post(url, json=batch, timeout=10)

    assert response.status_code == 200
    # The point of the whole exercise: the data arrived, unchanged, exactly
    # once as far as the server's successful handling is concerned.
    assert _FlakyHandler.received_bodies == [batch]


def test_status_budget_is_not_capped_by_total() -> None:
    """`total` must not silently shorten the status budget.

    urllib3 applies whichever limit is lowest, so a `total` of 8 would make a
    `status` of 32 a lie — which is how the retry budget read as generous while
    actually expiring after ~3 minutes. Asserted as configuration rather than
    behaviour because waiting out 32 real backoffs would take ~28 minutes.
    """
    assert _RETRY_POLICY.total is None
    assert _RETRY_POLICY.status == _STATUS_RETRIES
    assert _STATUS_RETRIES >= 16

    # The wall-clock patience that budget buys, at backoff_max per attempt
    # once the ramp saturates.
    patience_s = sum(
        min(_RETRY_POLICY.backoff_factor * (2**i), _RETRY_POLICY.backoff_max)
        for i in range(_RETRY_POLICY.status)
    )
    assert patience_s > 20 * 60


def test_backpressure_codes_are_all_retried() -> None:
    for status in (408, 429, 502, 503, 504):
        assert status in _RETRY_POLICY.status_forcelist

    # Ingest is POST; urllib3 retries only idempotent methods unless told
    # otherwise, and bulk ingest is an upsert so replay is safe.
    assert "POST" in _RETRY_POLICY.allowed_methods
    assert _RETRY_POLICY.respect_retry_after_header is True


def test_client_errors_are_not_retried() -> None:
    """A rejected payload must fail fast, not be resent 32 times."""
    for status in (400, 404, 422):
        assert status not in _RETRY_POLICY.status_forcelist
