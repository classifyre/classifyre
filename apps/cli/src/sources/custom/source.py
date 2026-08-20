"""The CUSTOM source: a connector whose implementation is a user's notebook.

The notebook defines four plain functions. Everything a source is otherwise
expected to do -- stable hashes, checksums, link resolution, metadata validation,
sampling windows, content caching -- is done here, so a connector author writes
``yield Asset(...)`` and never sees ``SingleAssetScanResults``.

User code runs in a child process (``runner.py``) with a scrubbed environment.
That process, not an AST check, is what keeps a notebook away from this one's
credentials.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

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
from ...notebook.packages import install as install_packages
from ...utils.hashing import hash_id, unhash_id
from ..base import BaseSource
from .env import scrubbed_environment

logger = logging.getLogger(__name__)

#: Asset kinds declared for CUSTOM in the x-asset-metadata catalog. A notebook
#: that uses anything else is corrected rather than failed: losing a four-hour
#: scan at asset 40,000 over a typo in `kind` is a worse outcome than a warning.
KNOWN_KINDS = frozenset({"record", "document", "page", "file", "table"})
FALLBACK_KIND = "record"

#: How long a terminated child gets to leave its loop before it is killed.
ABORT_GRACE_SECONDS = 5

#: How long to wait for the notebook's definitions to execute.
STARTUP_TIMEOUT_SECONDS = 120


class CustomSourceError(RuntimeError):
    """The notebook could not be loaded or run."""


class CustomSource(BaseSource):
    source_type = "custom"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = CustomInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self._cells = [cell.model_dump(mode="json") for cell in self.config.required.notebook.cells]
        self._process: subprocess.Popen[str] | None = None
        self._content_dir: Path | None = None
        self._id_by_hash: dict[str, str] = {}
        self._url_by_hash: dict[str, str] = {}
        self._mime_by_hash: dict[str, str] = {}
        self._stats = {"produced": 0, "seen": 0}
        self._packages_installed = False

        logger.info(
            "Initialized CUSTOM source with %d cell(s), revision %s",
            len(self._cells),
            self.config.required.notebook.revision,
        )

    # -- recipe helpers ------------------------------------------------------

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

        # Installed in the parent, before the child is spawned: the child runs
        # with a scrubbed environment and no package index credentials, and one
        # install serves every call it will handle.
        self._install_packages()

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
            }
        )

        frame = self._read_frame(timeout=STARTUP_TIMEOUT_SECONDS)
        if frame.get("type") == "error":
            self._terminate()
            raise CustomSourceError(_describe(frame.get("error")))
        if frame.get("type") != "ready":
            self._terminate()
            raise CustomSourceError(f"Notebook process sent an unexpected frame: {frame!r}")

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
            raise CustomSourceError(f"Could not install the notebook's packages: {report.error}")
        if report.skipped_reason:
            logger.warning("%s", report.skipped_reason)

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

        deadline = time.monotonic() + timeout if timeout else None
        line = process.stdout.readline()
        if not line:
            code = process.poll()
            raise CustomSourceError(
                f"Notebook process exited (code {code}) before answering. "
                "Check the scan log for the traceback."
            )
        if deadline and time.monotonic() > deadline:
            raise CustomSourceError(f"Notebook process did not respond within {timeout}s")

        try:
            frame = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CustomSourceError(
                f"Notebook process sent malformed output: {line[:200]!r}"
            ) from exc
        if not isinstance(frame, dict):
            raise CustomSourceError(f"Notebook process sent a non-object frame: {line[:200]!r}")
        return frame

    def _call(self, command: str, **args: Any) -> Any:
        """One request/response round trip."""
        self._start()
        self._send({"command": command, **args})
        frame = self._read_frame()
        if frame.get("type") == "error":
            raise CustomSourceError(_describe(frame.get("error")))
        return frame.get("result")

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
            logger.warning("Notebook discover() failed: %s", exc)
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
                raise CustomSourceError(_describe(frame.get("error")))

            if frame_type == "end":
                self._stats = {
                    "produced": int(frame.get("produced") or 0),
                    "seen": int(frame.get("seen") or 0),
                }
                self._record_cursor(cursor_key, skip, frame)
                break

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
        if key is None:
            return
        # A cursor the notebook set itself wins: it knows its own pagination
        # better than a positional offset does.
        notebook_cursor = frame.get("cursor")
        if isinstance(notebook_cursor, dict) and notebook_cursor:
            self.set_next_sampling_cursor(notebook_cursor)
            return
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

        if raw_bytes is not None:
            # A notebook that fetched a file should get what every other file
            # source gets: text extraction, normalized file metadata, and the
            # binary/image detectors -- without having to parse anything itself.
            parsed = self.parse_asset_bytes(raw_bytes, declared_mime_type=mime_type, file_name=name)
            mime_type = getattr(parsed, "mime_type", None) or mime_type
            if not content:
                content = getattr(parsed, "text", "") or ""
            metadata = {
                **_file_metadata(raw_bytes, mime_type, name),
                **metadata,  # the notebook's own keys win
            }
            self._cache_bytes(asset_hash, raw_bytes, mime_type)

        self._cache_content(asset_hash, content)
        self._id_by_hash[asset_hash] = asset_id
        self._url_by_hash[asset_hash] = external_url

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
            "metadata": metadata,
            "content_length": len(content),
            "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        }

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(checksum_basis),
            name=name,
            external_url=external_url,
            links=links,
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

    def evict_asset_cache(self, asset_hash: str) -> None:
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
        # demand, which is what fetch_content() is for.
        try:
            result = self._call("fetch_content", assetId=self._id_by_hash.get(asset_id, asset_id))
        except (CustomSourceError, NotebookContractError) as exc:
            logger.warning("Notebook fetch_content(%s) failed: %s", asset_id, exc)
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
        if self._content_dir:
            shutil.rmtree(self._content_dir, ignore_errors=True)
            self._content_dir = None


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
