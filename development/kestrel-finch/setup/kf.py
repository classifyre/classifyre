"""A small client for the Kestrel & Finch showcase: sign in as a persona, call
the workspace API, run SQL and read the Arrow result.

    uv run --with httpx --with pyarrow python development/kestrel-finch/setup/<script>.py
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx
import pyarrow as pa
import pyarrow.ipc

API = os.environ.get("API_URL", "http://127.0.0.1:8811")
KC = os.environ.get("KC_URL", "http://localhost:8280/iam")
WS = os.environ.get("WORKSPACE", "kestrel-finch")
ORG = "kestrel-finch"
PASSWORD = os.environ.get("KF_PASSWORD", "Kestrel-Demo-2026")

#: username → (display name, group path, what they do)
PERSONAS = {
    "ines.kovac": ("Ines Kovač", "/admins", "Head of IT, tenant admin"),
    "tomasz.wierzbicki": ("Tomasz Wierzbicki", "/data-platform", "Data engineer, owns the sources"),
    "henrike.sauer": ("Henrike Sauer", "/privacy-office", "Data protection officer, steward"),
    "lukas.brandner": ("Lukas Brandner", "/sales/sales-dach", "Sales rep, Austria/Germany/Switzerland"),
    "sigrid.halvorsen": ("Sigrid Halvorsen", "/sales/sales-nordics", "Sales rep, Nordics"),
    "amelie.fontaine": ("Amélie Fontaine", "/marketing", "CRM marketing manager"),
    "kwame.mensah": ("Kwame Mensah", "/customer-care", "Customer care lead"),
    "olga.lindqvist": ("Olga Lindqvist", "/finance", "Accounts receivable"),
    "ravi.iyer": ("Ravi Iyer", "/bi-analysts", "BI analyst (Metabase)"),
    "jonas.eklund": ("Jonas Eklund", "/agency-northlight", "External agency, campaign analytics"),
}

_TOKENS: dict[str, tuple[str, float]] = {}


def token(username: str) -> str:
    cached = _TOKENS.get(username)
    if cached and cached[1] > time.time() + 30:
        return cached[0]
    response = httpx.post(
        f"{KC}/realms/classifyre/protocol/openid-connect/token",
        data={"client_id": "lab-cli", "username": username, "password": PASSWORD,
              "grant_type": "password", "scope": f"openid organization:{ORG}"},
        timeout=30,
    )
    response.raise_for_status()
    body = response.json()
    _TOKENS[username] = (body["access_token"], time.time() + body.get("expires_in", 300))
    return body["access_token"]


class ApiError(RuntimeError):
    def __init__(self, status: int, text: str, where: str) -> None:
        super().__init__(f"{where} → {status} {text[:600]}")
        self.status = status
        self.text = text


class Api:
    """The workspace API as one person."""

    def __init__(self, username: str, workspace: str | None = WS) -> None:
        self.username = username
        self.workspace = workspace

    def _url(self, path: str, ns: bool) -> str:
        if ns and self.workspace:
            return f"{API}/{self.workspace}/{path.lstrip('/')}"
        return f"{API}/{path.lstrip('/')}"

    def raw(self, method: str, path: str, ns: bool = True, **kwargs: Any) -> httpx.Response:
        headers = {"Authorization": f"Bearer {token(self.username)}", **kwargs.pop("headers", {})}
        return httpx.request(method, self._url(path, ns), headers=headers, timeout=120, **kwargs)

    def call(self, method: str, path: str, ns: bool = True, **kwargs: Any) -> Any:
        response = self.raw(method, path, ns, **kwargs)
        if response.status_code >= 400:
            raise ApiError(response.status_code, response.text, f"{self.username} {method} {path}")
        return response.json() if response.content else None

    def catalog(self) -> dict[str, dict[str, Any]]:
        data = self.call("GET", "data-query/catalog")
        return {t["sqlName"]: t for s in data["sources"] for t in s["tables"]}

    def run(self, sql: str, timeout: float = 180, **extra: Any) -> dict[str, Any]:
        """Runs SQL; returns the final run (status, error, masks, rowFilters…)."""
        run = self.call("POST", "query-runs", json={"sql": sql, **extra})
        deadline = time.monotonic() + timeout
        while True:
            state = self.call("GET", f"query-runs/{run['id']}")
            if state.get("status") not in ("PENDING", "RUNNING"):
                return state
            if time.monotonic() > deadline:
                raise TimeoutError(f"query did not finish: {sql[:80]}")
            time.sleep(0.3)

    def query(self, sql: str, timeout: float = 180) -> tuple[list[str], list[dict[str, Any]], dict[str, Any]]:
        state = self.run(sql, timeout)
        if state.get("status") != "SUCCESS":
            raise ApiError(0, f"{state.get('status')}: {state.get('error') or state.get('errorMessage')}",
                           f"{self.username} query")
        raw = self.raw("GET", f"query-runs/{state['id']}/result")
        raw.raise_for_status()
        table = pa.ipc.open_stream(raw.content).read_all()
        return table.column_names, table.to_pylist(), state


def as_admin() -> Api:
    return Api("ines.kovac")
