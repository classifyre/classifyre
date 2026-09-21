"""The CUSTOM source: a connector whose implementation is a user's notebook.

The notebook defines four plain functions. Everything a source is otherwise
expected to do -- stable hashes, checksums, link resolution, metadata validation,
sampling windows, content caching -- is done here, so a connector author writes
``yield Asset(...)`` and never sees ``SingleAssetScanResults``.

User code runs in a child process (``runner.py``) with a scrubbed environment.
That process, not an AST check, is what keeps a notebook away from this one's
credentials. Uploaded files are downloaded *here* for the same reason: fetching
them needs the API base URL, and the notebook gets the directory rather than the
means to reach the API itself.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import os
import select
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import AsyncGenerator, Mapping
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests

from ...graph.edges import Ref, edge_from_payload
from ...models.generated_input import CustomInput, SamplingStrategy
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    Location,
    SingleAssetScanResults,
)
from ...notebook.contract import NotebookContractError, validate_notebook
from ...notebook.groups import warm_declared_groups
from ...notebook.packages import install as install_packages
from ...outputs.rest import internal_key_headers
from ...utils.hashing import hash_id, unhash_id
from ...utils.redaction import Redactor, redact_generic
from ...utils.source_files import api_base_url, download_source_files
from ...utils.urn import normalize_urn_or_none
from ..base import BaseSource
from .env import scrubbed_environment

logger = logging.getLogger(__name__)

#: Asset kinds declared for CUSTOM in the x-asset-metadata catalog. A notebook
#: that uses anything else is corrected rather than failed: losing a four-hour
#: scan at asset 40,000 over a typo in `kind` is a worse outcome than a warning.
KNOWN_KINDS = frozenset({"record", "document", "page", "file", "table"})
FALLBACK_KIND = "record"

#: `metadata["content_reference"]` for an `Asset(extract=False)` that gave no reason.
DEFAULT_REFERENCE_REASON = "Recorded without content extraction"

#: How long a terminated child gets to leave its loop before it is killed.
ABORT_GRACE_SECONDS = 5

#: How long to wait for the notebook's definitions to execute.
STARTUP_TIMEOUT_SECONDS = 120

#: Read timeout for one ctx.query_assets() call; the API bounds the query at 15 s.
ASSET_QUERY_TIMEOUT_SECONDS = 60


class CustomSourceError(RuntimeError):
    """The notebook could not be loaded or run."""


class CustomSource(BaseSource):
    source_type = "custom"

    # A notebook connector re-yields its whole cohort every run, and until this
    # was turned on every re-yielded asset was re-detected from scratch: the
    # Firmenbuch AI-analysis source spent 68 minutes per run re-reading 326
    # filings that had not changed since the run before, and the PDF source 67
    # minutes re-converting 672 documents. Detection, not fetching, is where a
    # notebook run's time goes, and that is exactly what the cache skips.
    SUPPORTS_SCAN_CACHE = True

    # "metadata", not "content": the strength of that mode depends on the
    # checksum being a real content digest rather than a proxy, and here it is —
    # `_to_scan_result` hashes the full text (plus the raw bytes when the
    # notebook fetched a file), the resolved metadata and the tags. There is no
    # mtime/size stand-in to be fooled by, so an unchanged checksum is proof and
    # nothing has to be re-read to establish it.
    SCAN_CACHE_VERIFY = "metadata"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        # Redacts this run's secrets from every error and log line below.
        # The child already redacts what it sends back; this covers what the
        # parent adds (query refusals, install output, unexpected frames).
        self._redactor = Redactor.from_recipe(self.recipe)
        # Local runs keep runner_id None (not "local-run"): ctx.query_assets()
        # needs a scan run, and the guard below only fires on a missing id. A
        # placeholder would sail past it and query as run "local-run".
        self.config = CustomInput.model_validate(recipe)

        self._cells = [cell.model_dump(mode="json") for cell in self.config.required.notebook.cells]
        self._process: subprocess.Popen[str] | None = None
        self._content_dir: Path | None = None
        self._files_dir: Path | None = None
        self._id_by_hash: dict[str, str] = {}
        self._url_by_hash: dict[str, str] = {}
        self._mime_by_hash: dict[str, str] = {}
        self._tags_by_hash: dict[str, dict[str, str]] = {}
        #: Per-tag severity the notebook asked for, keyed like _tags_by_hash.
        #: Only the keys a Tag(..., severity=) named appear here.
        self._tag_severities_by_hash: dict[str, dict[str, str]] = {}
        # Parsed once: asked per asset in phase 2, and the cells never change mid-run.
        self._defined_functions: frozenset[str] | None = None
        # Assets the notebook recorded with extract=False, until they are processed.
        self._reference_hashes: set[str] = set()
        #: What each ctx.cohort() band visited this run, reported on finalize.
        self.cohort_stats: dict[str, Any] = {}
        self._stats = {"produced": 0, "seen": 0}
        self._packages_installed = False

        logger.info(
            "Initialized CUSTOM source with %d cell(s), revision %s",
            len(self._cells),
            self.config.required.notebook.revision,
        )

    # -- recipe helpers ------------------------------------------------------

    def _safe(self, text: Any) -> str:
        """Render ``text`` for errors and logs without secret values."""
        raw = text if isinstance(text, str) else str(text)
        return redact_generic(self._redactor.redact(raw))

    def _plain_recipe(self) -> dict[str, Any]:
        """The recipe as plain JSON for the child process.

        Generated models wrap the free-form maps' values in RootModel, so the
        validated object is not directly serializable as the shape a notebook
        expects. Round-tripping through the model keeps that detail here.
        """
        return json.loads(self.config.model_dump_json(exclude_none=True))

    def _limits(self) -> Any:
        optional = self.config.optional
        return optional.limits if optional and optional.limits else None

    def _max_assets(self) -> int | None:
        limits = self._limits()
        value = getattr(limits, "max_assets", None) if limits else None
        return int(value) if value else None

    # -- child process -------------------------------------------------------

    def _start(self) -> subprocess.Popen[str]:
        """Start the notebook process, or reuse the one already running.

        One process for the whole run, not one per call: a scan asks the
        notebook for content thousands of times, and paying interpreter startup
        each time would dominate everything else. "No persistent kernel" is a
        rule about *authoring*, where the point is that what you see is what
        runs; a scan is a single execution from start to finish.
        """
        if self._process is not None and self._process.poll() is None:
            return self._process

        report = validate_notebook(self._cells)
        if not report.ok:
            raise NotebookContractError(report)

        # Both installs happen in the parent, before the child is spawned: the
        # child runs with a scrubbed environment and no package index
        # credentials, and one install serves every call it will handle.
        #
        # Order matters. Warming a uv group runs `uv sync --frozen`, which
        # prunes anything `uv pip install` put in the venv -- so the groups the
        # notebook's imports need go first, and its own declared packages after.
        warm_declared_groups(self._cells)
        self._install_packages()

        self._assert_folders_exist()
        files_dir = self._materialize_uploaded_files()

        cli_root = Path(__file__).resolve().parents[3]
        process = subprocess.Popen(
            [sys.executable, "-m", "src.sources.custom.runner"],
            cwd=cli_root,
            env=scrubbed_environment(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,  # inherit: notebook logs belong in the runner log
            text=True,
            bufsize=1,
        )

        self._process = process
        self._send(
            {
                "recipe": self._plain_recipe(),
                "cursor": self.sampling_cursor(),
                # A path, not a URL: the child has no way to reach the API and
                # is not meant to have one.
                "filesDir": str(files_dir) if files_dir else None,
                "cohortWeights": self._cohort_weights(),
            }
        )

        frame = self._read_frame(timeout=STARTUP_TIMEOUT_SECONDS)
        if frame.get("type") == "error":
            self._terminate()
            raise CustomSourceError(self._safe(_describe(frame.get("error"))))
        if frame.get("type") != "ready":
            self._terminate()
            raise CustomSourceError(
                self._safe(f"Notebook process sent an unexpected frame: {frame!r}")
            )

        return process

    def _install_packages(self) -> None:
        """Install what the notebook declared, once per source instance."""
        if self._packages_installed:
            return
        self._packages_installed = True

        optional = self.config.optional
        declared = getattr(optional, "packages", None) if optional else None
        if not declared:
            return

        report = install_packages([package.model_dump() for package in declared])
        if report.error:
            raise CustomSourceError(
                self._safe(f"Could not install the notebook's packages: {report.error}")
            )
        if report.skipped_reason:
            logger.warning("%s", report.skipped_reason)

    def _local_folders(self) -> list[Any]:
        optional = self.config.optional
        return list(getattr(optional, "local_folders", None) or []) if optional else []

    def _assert_folders_exist(self) -> None:
        """Fail before the run rather than at the first ``ctx.folder(...)``.

        A folder that was renamed or lives on an unmounted drive is a
        configuration problem, and finding out about it from a traceback inside
        ``extract()`` costs a run to learn.
        """
        for folder in self._local_folders():
            path = Path(str(folder.path))
            if not path.is_dir():
                raise CustomSourceError(
                    f"Local folder {folder.name!r} points at {path}, which is not a directory. "
                    "The folder must be mounted where the scan runs."
                )

    def _materialize_uploaded_files(self) -> Path | None:
        """Download the source's uploaded files so the notebook can open them.

        Downloaded up front rather than on demand because the child process is
        the *responder* on the NDJSON channel: it has no way to ask for bytes
        without a second, reverse-direction protocol, and giving it the API URL
        instead would undo the isolation the child process exists for.
        """
        if not self.source_id:
            return None
        if self._files_dir is not None:
            return self._files_dir

        destination = Path(tempfile.mkdtemp(prefix="classifyre-custom-files-"))
        session = requests.Session()
        try:
            count = download_source_files(session, api_base_url(), self.source_id, destination)
        except Exception as exc:
            # A connector that talks to an API and ignores ctx.files should not
            # fail because the files endpoint was unreachable.
            logger.warning(
                "Could not fetch uploaded files for this source: %s",
                self._safe(exc),
            )
            shutil.rmtree(destination, ignore_errors=True)
            return None
        finally:
            session.close()

        if count:
            logger.info("Made %d uploaded file(s) available to the notebook", count)
        self._files_dir = destination
        return destination

    def _send(self, payload: dict[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None:
            raise CustomSourceError("Notebook process is not running")
        process.stdin.write(json.dumps(payload) + "\n")
        process.stdin.flush()

    def _read_frame(self, timeout: float | None = None) -> dict[str, Any]:
        process = self._process
        if process is None or process.stdout is None:
            raise CustomSourceError("Notebook process is not running")

        if timeout:
            # Wait for output *before* reading: readline() blocks, so a
            # deadline checked only after it returns can never fire while the
            # child is silent — the startup timeout existed but could not
            # trigger, and a hung notebook hung the scan forever.
            self._wait_readable(process.stdout, timeout)
        line = process.stdout.readline()
        if not line:
            code = process.poll()
            raise CustomSourceError(
                f"Notebook process exited (code {code}) before answering. "
                "Check the scan log for the traceback."
            )

        try:
            frame = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CustomSourceError(
                f"Notebook process sent malformed output: {line[:200]!r}"
            ) from exc
        if not isinstance(frame, dict):
            raise CustomSourceError(f"Notebook process sent a non-object frame: {line[:200]!r}")
        return frame

    @staticmethod
    def _wait_readable(stream: Any, timeout: float) -> None:
        """Block until the child wrote something, at most ``timeout`` seconds.

        A stream with no file descriptor (substituted pipes in tests) cannot
        be waited on; then the read stays blocking and the timeout does not
        apply.
        """
        try:
            fileno = stream.fileno()
        except (AttributeError, OSError, ValueError):
            return
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            ready, _, _ = select.select([fileno], [], [], remaining)
            if ready:
                return
            break
        raise CustomSourceError(f"Notebook process did not respond within {timeout}s")

    def _call(self, command: str, **args: Any) -> Any:
        """One request/response round trip."""
        self._start()
        self._send({"command": command, **args})
        frame = self._read_frame()
        while frame.get("type") == "need":
            self._serve_need(frame)
            frame = self._read_frame()
        if frame.get("type") == "error":
            raise CustomSourceError(self._safe(_describe(frame.get("error"))))
        return frame.get("result")

    def _serve_need(self, frame: dict[str, Any]) -> None:
        """Answer a notebook's request for something only this process can do.

        Every request gets a reply, an error included: the notebook is blocked
        reading its stdin until one arrives.
        """
        request_id = frame.get("id")
        try:
            if frame.get("op") != "query_assets":
                raise CustomSourceError(f"Unsupported request {frame.get('op')!r}")
            value = self._relay_asset_query(frame.get("args") or {})
        except Exception as exc:  # reported to the notebook, which raises it
            self._send({"type": "provide", "id": request_id, "error": str(exc)})
            return
        self._send({"type": "provide", "id": request_id, "value": value})

    def _relay_asset_query(self, args: dict[str, Any]) -> Any:
        """``ctx.query_assets()``, performed with this process's credentials.

        The API scopes the read to this run: it must be RUNNING, and the
        namespace comes from the callback URL the job was given.
        """
        if not self.runner_id:
            raise CustomSourceError("ctx.query_assets() needs a scan run")
        response = requests.post(
            f"{api_base_url()}/runners/{self.runner_id}/assets/query",
            json=args,
            headers={**internal_key_headers(), "Connection": "close"},
            timeout=(10, ASSET_QUERY_TIMEOUT_SECONDS),
        )
        if response.status_code >= 400:
            try:
                detail = response.json().get("message")
            except ValueError:
                detail = None
            raise CustomSourceError(
                self._safe(
                    f"ctx.query_assets() was refused ({response.status_code}): "
                    f"{detail or response.text[:500]}"
                )
            )
        return response.json()

    def _terminate(self) -> None:
        process, self._process = self._process, None
        if process is None or process.poll() is not None:
            return
        try:
            if process.stdin:
                process.stdin.close()
            process.terminate()
            process.wait(timeout=ABORT_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            # A loop that never checks ctx.should_abort only stops here.
            process.kill()
            process.wait(timeout=ABORT_GRACE_SECONDS)
        except OSError:
            pass

    # -- BaseSource ----------------------------------------------------------

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            verdict = self._call("test_connection") or {}
            result["status"] = verdict.get("status", "FAILURE")
            result["message"] = verdict.get("message") or "Notebook reported no message."
        except NotebookContractError as exc:
            result["status"] = "FAILURE"
            result["message"] = str(exc)
        except CustomSourceError as exc:
            result["status"] = "FAILURE"
            result["message"] = str(exc)
        finally:
            # A connection test is one shot; nothing should outlive it.
            self._terminate()
        return result

    def discover(self) -> dict[str, Any]:
        try:
            return self._call("discover") or {}
        except (CustomSourceError, NotebookContractError) as exc:
            logger.warning("Notebook discover() failed: %s", self._safe(exc))
            return {}

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        skip, limit, cursor_key, sampling = self._window()
        self._start()
        self._send(
            {
                "command": "extract",
                "skip": skip,
                # The notebook may take this over by reading ctx.offset, in
                # which case the child stops skipping and pages at the source.
                "offset": skip,
                "limit": limit,
                "sampling": sampling,
            }
        )

        batch: list[SingleAssetScanResults] = []
        produced = 0
        while True:
            frame = self._read_frame()
            frame_type = frame.get("type")

            if frame_type == "error":
                raise CustomSourceError(self._safe(_describe(frame.get("error"))))

            if frame_type == "end":
                self._stats = {
                    "produced": int(frame.get("produced") or 0),
                    "seen": int(frame.get("seen") or 0),
                }
                cohort_stats = frame.get("cohortStats")
                self.cohort_stats = cohort_stats if isinstance(cohort_stats, dict) else {}
                self._record_cursor(cursor_key, skip, frame)
                self._warn_if_windowed(cursor_key, skip, limit, produced)
                if frame.get("partialCoverage"):
                    self.declare_partial_coverage(
                        str(frame.get("partialCoverageReason") or "")
                        or "the notebook called ctx.set_partial_coverage()"
                    )
                break

            if frame_type == "need":
                self._serve_need(frame)
                continue

            if frame_type != "item":
                logger.debug("Ignoring unexpected frame from notebook: %s", frame_type)
                continue

            asset = self._to_scan_result(frame.get("data") or {})
            if asset is None:
                continue
            batch.append(asset)
            produced += 1

            if len(batch) >= self.BATCH_SIZE:
                yield batch
                batch = []
            if self._aborted:
                break

        if batch:
            yield batch

        logger.info("Notebook produced %d asset(s)", produced)

    def _warn_if_windowed(
        self, cursor_key: str | None, skip: int, limit: int | None, produced: int
    ) -> None:
        """Say so when AUTOMATIC sampling cut the notebook's stream short.

        The run still completes, and without this nothing on it shows that most
        of the notebook's assets were never scanned: under AUTOMATIC they are not
        retired either, so their findings stay as they were (field report P15).
        """
        if cursor_key is None or not limit or produced < limit:
            return
        message = (
            f"AUTOMATIC sampling ingested a window of {produced} asset(s) from offset {skip}; "
            "the notebook yields more. Assets outside the window were not scanned this run and "
            "keep their previous findings. A notebook that yields its whole universe each run "
            "should use sampling ALL."
        )
        logger.warning(message)

    def _window(self) -> tuple[int, int | None, str | None, str]:
        """How much of the stream this run reads, and how it is sampled.

        A notebook is the source, so it is the only thing that can sample
        efficiently at the origin -- it reads ``ctx.strategy`` and ``ctx.limit``
        and asks its API for the right rows. What is decided here is the
        fallback for a notebook that just yields everything:

        AUTOMATIC pages across runs, remembering where it stopped, so successive
        runs cover new ground rather than re-reading the head.

        RANDOM draws a uniform sample by reservoir, which means draining the
        stream. Taking the first N would not be random -- it would return the
        same head every run, which is the one outcome RANDOM exists to avoid.

        LATEST takes the first N **in the order the notebook yields them**. A
        stream carries no recency of its own, and reordering it would mean
        draining and sorting; so "latest" means "yield newest first", which the
        scaffold says and ``ctx.strategy`` lets a notebook honour.

        ALL reads everything, bounded only by an explicit ``max_assets``.
        """
        strategy = getattr(self.config.sampling, "strategy", SamplingStrategy.ALL)
        max_assets = self._max_assets()
        window = self.sampling_window_size()
        bounded = min(window, max_assets) if max_assets else window

        if strategy == SamplingStrategy.AUTOMATIC:
            key = "assets"
            return self.automatic_offset(key), window, key, "window"

        if strategy == SamplingStrategy.RANDOM:
            return 0, bounded, None, "reservoir"

        if strategy == SamplingStrategy.LATEST:
            return 0, bounded, None, "window"

        return 0, max_assets, None, "window"

    def _record_cursor(self, key: str | None, offset: int, frame: dict[str, Any]) -> None:
        # A cursor the notebook set itself is explicit intent and is honoured
        # under EVERY sampling strategy.
        #
        # This used to sit behind `if key is None: return`, and `key` is only
        # set for AUTOMATIC sampling — so on a source sampling ALL (the default,
        # and what every non-paginating connector uses) `ctx.set_cursor()` was
        # accepted by the SDK, written by the notebook, and then dropped on the
        # floor without a word. Any connector keeping run-to-run state that way
        # silently restarted from nothing on every run: a resumable walk never
        # advanced, and accumulated counts were rebuilt from one run's data and
        # written back smaller.
        notebook_cursor = frame.get("cursor")
        if isinstance(notebook_cursor, dict) and notebook_cursor:
            self.set_next_sampling_cursor(notebook_cursor)
            return
        # The positional fallback stays AUTOMATIC-only: it is derived from this
        # run's offset and page size, which mean nothing under other strategies.
        if key is None:
            return
        # Keep what the notebook stored in earlier runs. A window can stop the
        # notebook before it reaches ctx.set_cursor(); writing only the offset
        # then replaced its whole run-to-run state with {"assets": N} — one such
        # run erased a catalogue's empty/returned history (GENESIS field report
        # P15). The offset is merged in, never substituted.
        self.set_next_sampling_cursor({k: v for k, v in self._sampling_cursor.items() if k != key})
        self.record_automatic_offset(
            key, prev_offset=offset, fetched=int(frame.get("produced") or 0)
        )

    def _handled_offset(self, frame: dict[str, Any]) -> bool:
        return bool(frame.get("offsetHandledByNotebook"))

    def _to_scan_result(self, data: dict[str, Any]) -> SingleAssetScanResults | None:
        asset_id = str(data.get("id") or "").strip()
        if not asset_id:
            logger.warning("Skipping notebook asset with no id")
            return None

        asset_hash = self.generate_hash_id(asset_id)
        name = str(data.get("name") or asset_id)
        external_url = self.ensure_location(
            str(data.get("url") or ""),
            fallback=f"custom://{self.source_id or 'local'}/{asset_id}",
        )

        kind = str(data.get("kind") or FALLBACK_KIND).strip().lower()
        if kind not in KNOWN_KINDS:
            logger.warning(
                "Asset %s uses unknown kind %r; recording it as %r. Valid kinds: %s",
                asset_id,
                kind,
                FALLBACK_KIND,
                ", ".join(sorted(KNOWN_KINDS)),
            )
            kind = FALLBACK_KIND

        metadata = data.get("metadata")
        metadata = dict(metadata) if isinstance(metadata, dict) else {}
        metadata.setdefault("external_id", asset_id)

        # Asset content is deliberately NOT redacted. Redaction protects the
        # observability channels -- logs, stderr, cell output -- where a secret
        # would appear because of how we run the notebook. Content is data the
        # connector chose to emit for scanning; blanking it would corrupt the
        # scan, and a notebook that writes its own token into every record is
        # exactly the finding the secrets detector should raise.
        raw_bytes = _decode_bytes(data.get("content_b64"))
        content = str(data.get("content") or "")
        mime_type = str(data.get("mime_type") or "") or None
        # Absent means extract: a notebook written before the flag existed, or
        # an older runtime, must behave exactly as it always has.
        extract = data.get("extract") is not False

        if raw_bytes is not None:
            # A notebook that fetched a file should get what every other file
            # source gets: text extraction, normalized file metadata, and the
            # binary/image detectors -- without having to parse anything itself.
            #
            # Discovery only works out what the bytes are. Text is extracted in
            # phase 2, from the spilled bytes, by the same fallback every file
            # source uses (`ParsedContentProvider.fetch_text_pages`), which runs
            # it off the event loop and only for assets the scan cache did not
            # skip. This used to run the full parser (docling for a PDF) inline
            # on the discovery loop, stalling every asset behind each document --
            # and its text was never used: it read `parsed.text`, a field
            # `ParsedBytes` does not have, so phase 2 parsed every file again.
            # The MIME type comes from the same resolver the parser called, so
            # the metadata, the asset type and the checksum are unchanged.
            mime_type = _resolve_mime_type(raw_bytes, mime_type, name)
            metadata = {
                **_file_metadata(raw_bytes, mime_type, name),
                **metadata,  # the notebook's own keys win
            }
            if extract:
                self._cache_bytes(asset_hash, raw_bytes, mime_type)

        if extract:
            self._reference_hashes.discard(asset_hash)
        else:
            # Recorded, deliberately not scanned. Stated on the asset rather
            # than implied by missing bytes, which reads as a failed fetch to
            # anything that does not know the convention. Part of the checksum
            # basis through metadata, so switching extraction on or off re-scans.
            content = ""
            metadata["content_reference"] = (
                str(data.get("reference_reason") or "").strip() or DEFAULT_REFERENCE_REASON
            )
            self._reference_hashes.add(asset_hash)

        self._cache_content(asset_hash, content)
        self._id_by_hash[asset_hash] = asset_id
        self._url_by_hash[asset_hash] = external_url

        # Facts the notebook asserted, keyed by Tag detector key. Held here
        # rather than on the result because they are not part of the asset the
        # API stores: the pipeline turns them into findings.
        tags = data.get("tags")
        tags = (
            {str(key): str(value) for key, value in tags.items() if str(key) and str(value)}
            if isinstance(tags, dict)
            else {}
        )
        if tags:
            self._tags_by_hash[asset_hash] = tags
        else:
            self._tags_by_hash.pop(asset_hash, None)

        # Severities a Tag(value, severity=) asked for. Kept only for keys that
        # actually carry a value, so a severity can never resurrect a dropped tag.
        raw_severities = data.get("tag_severities")
        severities = (
            {
                str(key): str(value).upper()
                for key, value in raw_severities.items()
                if str(key) in tags and str(value)
            }
            if isinstance(raw_severities, dict)
            else {}
        )
        if severities:
            self._tag_severities_by_hash[asset_hash] = severities
        else:
            self._tag_severities_by_hash.pop(asset_hash, None)

        # The notebook links assets by *its* ids; the graph needs hashes.
        links = [self.generate_hash_id(str(link)) for link in data.get("links") or []]

        # The checksum decides whether a re-scan sees a changed asset, so it has
        # to cover the whole payload. Truncating the content here would make an
        # edit past the cut-off invisible whenever the length happened to match
        # -- a silently stale asset, which is worse than a slower hash.
        checksum_basis = {
            "id": asset_id,
            "name": name,
            "url": external_url,
            # Which cohort band chose the asset says nothing about the asset:
            # stamping it must never make an unchanged asset read as changed.
            "metadata": {key: value for key, value in metadata.items() if key != "_cohort"},
            "content_length": len(content),
            "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
            # Tags belong in the checksum: they are the only part of a tagged
            # asset that can change while its content does not, and leaving them
            # out would let the scan cache skip the asset and never surface the
            # new tag.
            "tags": dict(sorted(tags.items())),
        }

        # A tag whose severity moved from MEDIUM to HIGH while its value stayed
        # the same is a changed finding, so the checksum has to see it. Added
        # only when present, so an asset with no per-tag severity keeps the
        # exact basis it had before this key existed and the corpus is not
        # re-checksummed for a feature it does not use.
        if severities:
            checksum_basis["tag_severities"] = dict(sorted(severities.items()))

        # For a fetched file the text hashed above is what the parser
        # *extracted*, so two different documents that extract to the same text
        # would collide -- not good enough for metadata-mode cache
        # verification. The bytes are already in hand, so hash them too.
        #
        # Added to the dict rather than declared inside it, so an asset that
        # carries no bytes keeps the exact checksum basis it had before this
        # key existed. Changing the basis re-checksums the whole corpus once
        # (every asset reads as 'updated' and every cache entry misses), and
        # there is no reason to pay that for the text-only assets -- which here
        # are the companies and the people, i.e. almost all of them.
        if raw_bytes is not None:
            checksum_basis["content_bytes_sha256"] = hashlib.sha256(raw_bytes).hexdigest()

        # Normalized here rather than trusted as typed: a notebook can write
        # any string, and a URN spelled differently from the one the owning
        # connector writes never stitches — which looks like nothing happening.
        urn = normalize_urn_or_none(data.get("urn"))

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(checksum_basis),
            name=name,
            external_url=external_url,
            links=links,
            urn=urn,
            asset_type=_content_type(data.get("content_type"), mime_type),
            source_id=self.source_id,
            created_at=_timestamp(data.get("created_at")),
            updated_at=_timestamp(data.get("updated_at")),
            runner_id=self.runner_id,
            **self.metadata_fields(kind, metadata),
        )

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id(self.source_type, asset_id)

    # -- content -------------------------------------------------------------

    def _cache_content(self, asset_hash: str, content: str) -> None:
        """Spill each asset's text to disk between discovery and detection.

        Phase 1 discovers assets and phase 2 scans them, so the content has to
        survive in between. Holding a run's worth of text in memory is how a
        large source turns into an OOM, and asking the notebook to produce one
        asset again by id would mean replaying `extract()` per asset.
        """
        if not content:
            return
        if self._content_dir is None:
            self._content_dir = Path(tempfile.mkdtemp(prefix="classifyre-custom-"))
        try:
            self._content_path(asset_hash).write_text(content, encoding="utf-8")
        except OSError as exc:
            logger.warning("Could not cache content for %s: %s", asset_hash, exc)

    def _content_path(self, asset_hash: str) -> Path:
        assert self._content_dir is not None
        return self._content_dir / f"{asset_hash}.txt"

    def _cached_content(self, asset_hash: str) -> str | None:
        if not self._content_dir:
            return None
        try:
            return self._content_path(asset_hash).read_text(encoding="utf-8")
        except OSError:
            return None

    def _cache_bytes(self, asset_hash: str, raw: bytes, mime_type: str | None) -> None:
        if self._content_dir is None:
            self._content_dir = Path(tempfile.mkdtemp(prefix="classifyre-custom-"))
        try:
            (self._content_dir / f"{asset_hash}.bin").write_bytes(raw)
        except OSError as exc:
            logger.warning("Could not cache bytes for %s: %s", asset_hash, exc)
            return
        self._mime_by_hash[asset_hash] = mime_type or "application/octet-stream"

    def _cohort_weights(self) -> dict[str, Any] | None:
        """The band split the platform measured for this run's cohorts, if any.

        The API writes it into the recipe (`optional.cohort_weights.effective`)
        when it starts the run; the environment variable is for runs started
        some other way.
        """
        settings = (
            getattr(self.config.optional, "cohort_weights", None) if self.config.optional else None
        )
        effective = getattr(settings, "effective", None) if settings is not None else None
        if effective:
            return {name: bands.model_dump(exclude_none=True) for name, bands in effective.items()}
        return _cohort_weights_from_env()

    def declares_relationships(self) -> bool:
        """Whether the notebook defines ``relationships()`` at all.

        Lets the runner tell "this connector has no lineage to declare" from
        "this connector tried to declare lineage and produced none", which are
        the same empty list and very different facts.
        """
        return self._notebook_defines("relationships")

    async def collect_relationships(self) -> list[Any]:
        """Typed relationships the notebook declared.

        A notebook names assets by *its own* ids, because those are the ids it
        yielded and the only ones it knows. Turning them into hashes is this
        adapter's job — the same translation ``Asset.links`` already gets — so an
        author never has to learn that hashes exist.

        A ``Ref.urn(...)`` endpoint is passed through untouched: it names an
        object in another system on purpose, and hashing it would destroy the
        one thing that can ever resolve it.
        """
        if not self._notebook_defines("relationships"):
            return []
        # Deliberately NOT caught here. Swallowing it made a notebook whose
        # relationships() raised — `Ref.id()` instead of `Ref.asset()` was the
        # real case — produce 920 assets, zero edges, and a COMPLETED run whose
        # only trace of the failure was a warning in a Kubernetes job log. The
        # caller (`main._emit_relationships`) keeps the run alive; what it no
        # longer does is keep the run *quiet*.
        payloads = self._call("relationships") or []

        edges: list[Any] = []
        for payload in payloads:
            if not isinstance(payload, dict):
                continue
            try:
                edge = edge_from_payload(payload)
            except Exception as exc:
                logger.warning("Ignoring malformed relationship from notebook: %s", exc)
                continue
            edges.append(
                replace(
                    edge,
                    frm=self._resolve_ref(edge.frm),
                    to=self._resolve_ref(edge.to),
                    via=None if edge.via is None else self._resolve_ref(edge.via),
                ).to_ingest()
            )
        return edges

    def _resolve_ref(self, ref: Ref) -> Ref:
        """Notebook id -> asset hash. URNs and findings pass through."""
        if ref.kind != "asset":
            return ref
        return Ref("asset", self.generate_hash_id(ref.value))

    def _notebook_defines(self, function: str) -> bool:
        """Whether the notebook implements an optional contract function.

        Checked before calling so an ordinary notebook — one that never declares
        relationships — costs nothing rather than a subprocess round trip that
        returns an empty list.
        """
        if self._defined_functions is None:
            try:
                self._defined_functions = frozenset(
                    validate_notebook(self._cells).defined_functions
                )
            except Exception:
                # A notebook that will not parse has already failed louder elsewhere.
                self._defined_functions = frozenset()
        return function in self._defined_functions

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        """Raw bytes for the binary and image detectors.

        Only present when the notebook set ``Asset.content_bytes``; a text-only
        connector returns None here exactly as the base class does.
        """
        if not self._content_dir:
            return None
        try:
            raw = (self._content_dir / f"{asset_id}.bin").read_bytes()
        except OSError:
            return None
        return raw, self._mime_by_hash.get(asset_id, "application/octet-stream")

    def asset_tags(self, asset_hash: str) -> Mapping[str, str]:
        """Tag-detector keys and values asserted about this asset.

        Merges the connector notebook's tags with the augmentation notebook's:
        a CUSTOM source can use both, and either alone must keep working.
        """
        merged = dict(super().asset_tags(asset_hash))
        merged.update(self._tags_by_hash.get(asset_hash, {}))
        return merged

    def asset_tag_severities(self, asset_hash: str) -> Mapping[str, str]:
        """Severities the notebook asked for, for the keys that named one.

        Not merged with the augmentation notebook's tags: only the connector
        notebook can write a Tag(...) today, and inventing a severity for an
        augmentation tag would be a guess.
        """
        return dict(self._tag_severities_by_hash.get(asset_hash, {}))

    def asserts_complete_tags(self, asset_hash: str) -> bool:
        # The notebook yields each asset with its full tag set, every run: a key
        # it stopped writing is a fact it withdrew (GENESIS field report P4).
        return asset_hash in self._id_by_hash

    def extracts_content(self, asset_hash: str) -> bool:
        return asset_hash not in self._reference_hashes

    def evict_asset_cache(self, asset_hash: str) -> None:
        self._reference_hashes.discard(asset_hash)
        if not self._content_dir:
            return
        for suffix in (".txt", ".bin"):
            try:
                (self._content_dir / f"{asset_hash}{suffix}").unlink()
            except OSError:
                pass
        self._mime_by_hash.pop(asset_hash, None)

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        cached = self._cached_content(asset_id)
        if cached is not None:
            return cached, cached

        # Nothing cached: the notebook may still be able to produce it on
        # demand, which is what fetch_content() is for -- when it defines one,
        # and for an asset it yielded. The pipeline asks by URL first and by
        # hash second, and a file asset has no cached text until phase 2 parses
        # its bytes, so without these checks every file cost two subprocess
        # round trips and two warnings, each ending in "not defined".
        if asset_id not in self._id_by_hash or not self._notebook_defines("fetch_content"):
            return None
        try:
            result = self._call("fetch_content", assetId=self._id_by_hash.get(asset_id, asset_id))
        except (CustomSourceError, NotebookContractError) as exc:
            logger.warning("Notebook fetch_content(%s) failed: %s", asset_id, self._safe(exc))
            return None
        if not isinstance(result, dict):
            return None
        return str(result.get("raw", "")), str(result.get("text", ""))

    def resolve_link_for_detection(self, link: str) -> str | None:
        url = self._url_by_hash.get(link)
        if url:
            return super().resolve_link_for_detection(url)
        try:
            return super().resolve_link_for_detection(unhash_id(link).split("_#_", 1)[-1])
        except Exception:
            return super().resolve_link_for_detection(link)

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        path = self._url_by_hash.get(asset.hash) or asset.external_url
        if finding.location is None:
            finding.location = Location()
        finding.location.path = path

    # -- lifecycle -----------------------------------------------------------

    def get_stats(self) -> dict[str, Any]:
        return dict(self._stats)

    def abort(self) -> None:
        logger.info("Aborting CUSTOM source")
        super().abort()
        self._terminate()

    def cleanup(self) -> None:
        self._terminate()
        for attribute in ("_content_dir", "_files_dir"):
            directory = getattr(self, attribute)
            if directory:
                shutil.rmtree(directory, ignore_errors=True)
                setattr(self, attribute, None)


def _cohort_weights_from_env() -> dict[str, Any] | None:
    """Band weights the API measured for this source's cohorts, if it sent any.

    Base64 JSON, so the value survives the job environment verbatim. A value
    that does not decode is ignored: the notebook's declared bands still work.
    """
    raw = os.environ.get("CLASSIFYRE_COHORT_WEIGHTS", "").strip()
    if not raw:
        return None
    try:
        decoded = json.loads(base64.b64decode(raw))
    except (ValueError, binascii.Error) as exc:
        logger.warning("Ignoring unreadable CLASSIFYRE_COHORT_WEIGHTS: %s", exc)
        return None
    return decoded if isinstance(decoded, dict) else None


def _describe(error: Any) -> str:
    if not isinstance(error, dict):
        return str(error)
    kind = error.get("type") or "Error"
    message = error.get("message") or ""
    trace = "".join(error.get("traceback") or [])
    return f"{kind}: {message}\n{trace}".strip()


def _decode_bytes(value: Any) -> bytes | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return base64.b64decode(value)
    except (ValueError, binascii.Error) as exc:
        logger.warning("Ignoring malformed asset bytes: %s", exc)
        return None


def _resolve_mime_type(raw: bytes, declared_mime_type: str | None, file_name: str) -> str:
    """What the bytes are: the resolver the full parser starts with, and nothing more."""
    from ...utils.file_parser import resolve_mime_type

    return resolve_mime_type(raw, declared_mime_type=declared_mime_type, file_name=file_name)


def _file_metadata(raw: bytes, mime_type: str | None, file_name: str) -> dict[str, Any]:
    """Normalized file keys, best effort -- never fails an asset."""
    from ...utils.file_metadata import extract_file_metadata

    try:
        extracted = extract_file_metadata(
            raw, mime_type or "application/octet-stream", file_name=file_name
        )
    except Exception as exc:  # extract_file_metadata is best-effort by contract
        logger.debug("File metadata extraction failed for %s: %s", file_name, exc)
        return {}
    return {key: value for key, value in extracted.items() if value is not None}


def _content_type(value: Any, mime_type: str | None = None) -> OutputAssetType:
    """The canonical payload type, which is what routes detectors.

    An explicit content_type from the notebook wins; otherwise a file's MIME
    type decides, so an image reaches the image detectors without the author
    having to know the enum exists.
    """
    if value:
        try:
            return OutputAssetType(str(value).upper())
        except ValueError:
            logger.warning("Unknown content_type %r; treating the asset as TXT", value)
            return OutputAssetType.TXT

    normalized = (mime_type or "").lower()
    if normalized.startswith("image/"):
        return OutputAssetType.IMAGE
    if normalized.startswith("video/"):
        return OutputAssetType.VIDEO
    if normalized.startswith("audio/"):
        return OutputAssetType.AUDIO
    if normalized and not normalized.startswith("text/"):
        return OutputAssetType.BINARY
    return OutputAssetType.TXT


def _timestamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now(UTC)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return datetime.now(UTC)
