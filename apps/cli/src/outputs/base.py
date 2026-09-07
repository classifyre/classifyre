from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import BaseModel

OutputType = Literal["rest", "file", "console"]

# How long to wait for the API to answer a write-back. Generous enough that a
# bulk ingest of a large batch finishes well inside it — the old 30 s cut those
# off mid-flight and made urllib3 re-upload the same body — but finite, so a
# wedged API fails the run instead of hanging it forever.
DEFAULT_REST_TIMEOUT_SEC = 300


@dataclass(frozen=True)
class OutputRuntimeContext:
    source_id: str | None
    runner_id: str | None
    managed_runner: bool
    batch_size: int


@dataclass
class RelationshipReport:
    """What happened to this run's lineage, so a scan cannot lie about it.

    Lineage is the product's differentiator and it used to be able to vanish
    entirely from a run that reported ``COMPLETED``: a connector's
    ``relationships()`` raised, the runner logged a warning marked *non-fatal*,
    and nothing in the runner summary, the source status or the UI ever said
    that an entire relationship pass had been discarded. The only trace was a
    line in a Kubernetes job log.

    Three distinct outcomes, deliberately not collapsed into one number:

    - ``failed`` — a relationship pass raised. The edge count it would have
      produced is unknowable, so this counts passes, not edges.
    - ``lost`` — edges were assembled and then could not be sent. This is a
      real edge count.
    - ``dropped`` — the API accepted the request but could not resolve an
      endpoint. Expected in small numbers (the other half may arrive later);
      reported so a systematic URN mistake is visible rather than inferred.
    """

    emitted: int = 0
    failed: int = 0
    lost: int = 0
    dropped: int = 0
    errors: list[str] = field(default_factory=list)

    #: Cap on retained error strings — the run record has to stay bounded even
    #: when every pass of a long scan fails the same way.
    MAX_ERRORS = 5

    def record_failure(self, error: str) -> None:
        self.failed += 1
        self._add_error(error)

    def record_lost(self, count: int, error: str) -> None:
        self.lost += count
        self._add_error(error)

    def record_emitted(self, *, emitted: int, dropped: int) -> None:
        self.emitted += max(0, emitted)
        self.dropped += max(0, dropped)

    def record_empty(self) -> None:
        """A connector that declares relationships produced none.

        Not an error on its own — a cohort really can have nothing to relate —
        but recorded so "no lineage" is a stated outcome rather than an absence
        of evidence.
        """
        self._add_error("relationships() produced no edges")

    def _add_error(self, error: str) -> None:
        if len(self.errors) < self.MAX_ERRORS and error not in self.errors:
            self.errors.append(error)

    @property
    def degraded(self) -> bool:
        """Whether this run's lineage is incomplete for a reason worth raising."""
        return self.failed > 0 or self.lost > 0

    def summary(self) -> str | None:
        """One operator-facing sentence, or None when nothing went wrong."""
        parts: list[str] = []
        if self.failed:
            parts.append(f"{self.failed} relationship pass(es) failed")
        if self.lost:
            parts.append(f"{self.lost} edge(s) could not be sent")
        if not parts:
            return None
        detail = f" ({'; '.join(self.errors)})" if self.errors else ""
        return "lineage incomplete: " + ", ".join(parts) + detail


@dataclass(frozen=True)
class OutputSettings:
    output_type: OutputType
    batch_size: int
    source_id: str | None
    runner_id: str | None
    managed_runner: bool
    rest_url: str | None = None
    # Read timeout in seconds; None disables it. See resolve_output_settings.
    rest_timeout_sec: int | None = DEFAULT_REST_TIMEOUT_SEC
    file_path: str | None = None


class BatchEnvelope(BaseModel):
    event: Literal["batch"] = "batch"
    output_type: OutputType
    source_id: str | None = None
    runner_id: str | None = None
    batch_index: int
    asset_count: int
    assets: list[dict[str, Any]]


class FinishEnvelope(BaseModel):
    event: Literal["finish"] = "finish"
    output_type: OutputType
    source_id: str | None = None
    runner_id: str | None = None
    batch_count: int
    total_assets: int


class ErrorEnvelope(BaseModel):
    event: Literal["error"] = "error"
    output_type: OutputType
    source_id: str | None = None
    runner_id: str | None = None
    error: str


class OutputSink(Protocol):
    batch_size: int

    async def start(self) -> None: ...

    async def emit_batch(
        self, assets: list[dict[str, Any]], *, skip_findings: bool = False
    ) -> None: ...

    async def finish(self) -> None: ...

    async def fail(self, error: Exception) -> None: ...
