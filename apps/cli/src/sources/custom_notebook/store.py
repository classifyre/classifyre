"""Reading and writing notebook revisions through the API.

The notebook lives in Postgres, not in the recipe. Two reasons: a recipe is
validated against a schema that sets ``additionalProperties: false`` and would
have to grow a free-text field to carry code, and shipping a notebook through a
pod environment variable puts a hard ceiling on its size. The API already solves
exactly this for uploaded sandbox files, so this follows that path -
``CLASSIFYRE_OUTPUT_REST_URL`` plus the source id, with the run's own internal
key proving the caller is a job the API launched.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import requests

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SEC = 60

#: Set by the API when it launches a job, so a scan runs the revision that was
#: current when the run started rather than whatever was saved mid-run.
REVISION_ENV = "CLASSIFYRE_NOTEBOOK_REVISION"
INTERNAL_KEY_ENV = "CLASSIFYRE_INTERNAL_KEY"


class NotebookUnavailableError(RuntimeError):
    """Raised when the notebook for a source cannot be read."""


@dataclass(frozen=True)
class Notebook:
    revision: int
    content: str


def api_base_url() -> str:
    return (
        os.environ.get("CLASSIFYRE_OUTPUT_REST_URL")
        or os.environ.get("API_URL")
        or "http://localhost:8000"
    ).rstrip("/")


def _headers() -> dict[str, str]:
    key = os.environ.get(INTERNAL_KEY_ENV)
    return {"x-classifyre-internal-key": key} if key else {}


def pinned_revision() -> int | None:
    raw = os.environ.get(REVISION_ENV, "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        logger.warning("Ignoring malformed %s=%r", REVISION_ENV, raw)
        return None


def load(source_id: str, *, session: requests.Session | None = None) -> Notebook:
    """Fetch the notebook this run should execute."""
    if not source_id:
        raise NotebookUnavailableError("A custom source requires a source ID")

    revision = pinned_revision()
    url = f"{api_base_url()}/sources/{source_id}/notebook"
    params = {"revision": str(revision)} if revision is not None else None

    http = session or requests.Session()
    try:
        response = http.get(url, params=params, headers=_headers(), timeout=DEFAULT_TIMEOUT_SEC)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        raise NotebookUnavailableError(
            f"Could not read the notebook for source {source_id}: {exc}"
        ) from exc
    except ValueError as exc:
        raise NotebookUnavailableError(
            f"The API returned a non-JSON notebook for source {source_id}"
        ) from exc

    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise NotebookUnavailableError(
            f"Source {source_id} has no notebook yet. Open an editing session and "
            "save one before running a scan."
        )

    return Notebook(revision=int(payload.get("revision") or 0), content=content)


def save(
    source_id: str,
    content: str,
    *,
    message: str = "",
    session: requests.Session | None = None,
) -> Notebook | None:
    """Persist a new revision. Returns None when the content was unchanged."""
    http = session or requests.Session()
    url = f"{api_base_url()}/sources/{source_id}/notebook"
    try:
        response = http.put(
            url,
            json={"content": content, "message": message},
            headers=_headers(),
            timeout=DEFAULT_TIMEOUT_SEC,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        # A failed autosave must not take down the editing session; the author
        # keeps working against the file on disk and the next save retries.
        logger.error("Could not save notebook revision for %s: %s", source_id, exc)
        return None
    except ValueError:
        logger.error("API returned a non-JSON response saving notebook for %s", source_id)
        return None

    if payload.get("unchanged"):
        return None
    return Notebook(revision=int(payload.get("revision") or 0), content=content)
