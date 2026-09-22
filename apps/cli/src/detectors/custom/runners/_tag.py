"""Tag pipeline runner — the one runner that never looks at content.

A tag is an assertion, not a detection. The source system already knows that a
table holds cardholder data or that a folder is under legal hold; running a
classifier over the content to re-derive that fact can only lose information.
So a TAG detector runs nothing. It exists to give the assertion a stable
identity — a key, a label, a severity — and a CUSTOM connector notebook applies
it by that key::

    Asset(id="accounts", tags={"cardholder_data": "primary-account-numbers"})

``detect()`` therefore returns nothing for any content it is handed. The finding
is built by ``tag_finding()``, called from the detector pipeline once per tag the
notebook attached to the asset.
"""

from __future__ import annotations

from ....models.generated_detectors import (
    PipelineResult,
    Severity,
    TagPipelineSchema,
)
from ....models.generated_single_asset_scan_results import DetectionResult
from ._base import BaseRunner

#: Matches the schema default. A tag has no confidence to derive a severity
#: from, so an unreadable one falls back here rather than being guessed at.
_DEFAULT_SEVERITY = Severity.medium

#: Most severe first, so a lower index is a higher severity.
_SEVERITY_ORDER: tuple[Severity, ...] = (
    Severity.critical,
    Severity.high,
    Severity.medium,
    Severity.low,
    Severity.info,
)


class TagRunner(BaseRunner):
    """Placeholder pipeline: produces findings only from notebook-supplied tags."""

    def __init__(
        self, schema: TagPipelineSchema, detector_key: str = "", detector_name: str = ""
    ) -> None:
        self.schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name
        # The label is what every finding is called. Falling back to the
        # detector name keeps a detector created without one readable rather
        # than producing findings typed "tag:".
        self.label = (schema.label or "").strip() or detector_name or detector_key or "tag"
        self.severity = _coerce_severity(schema.severity)

    def run(self, text: str) -> PipelineResult:
        """No pipeline to run. Present only to satisfy the runner interface."""
        return PipelineResult(metadata={"runner": "TAG"})

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        """Never fires on content. A tag comes from the connector, not the text."""
        return []

    def get_supported_content_types(self) -> list[str]:
        """No content type is supported, so the pipeline never schedules this."""
        return []

    def bound_severity(self, requested: str | Severity | None) -> tuple[Severity, bool]:
        """The severity to use for one tag, and whether it had to be lowered.

        The detector's own severity is a ceiling, not a default. A connector
        that knows this instance is milder than usual may say so; one that
        wants its findings to outrank what the operator configured may not,
        because the detector is where that decision belongs. An unreadable or
        over-severe request lands on the ceiling and the caller reports it,
        rather than being applied or dropped in silence.
        """
        if requested is None:
            return self.severity, False
        asked = _parse_severity(requested)
        if asked is None:
            return self.severity, True
        if _SEVERITY_ORDER.index(asked) < _SEVERITY_ORDER.index(self.severity):
            return self.severity, True
        return asked, False

    def tag_finding(self, value: str, severity: str | Severity | None = None) -> DetectionResult:
        """One finding for one value the notebook asserted under this key.

        ``severity`` is what the connector *asked for*, not an already-bounded
        value: the finding records both what was applied and what was refused,
        so a capped tag can be explained from the finding itself rather than
        from a log line nobody kept.
        """
        text = str(value).strip()
        applied, lowered = self.bound_severity(severity)
        return self._make_result(
            finding_type=f"tag:{self.label}",
            category="CLASSIFICATION",
            severity=applied,
            # Asserted by the connector, not inferred from content: there is
            # nothing here for a confidence score to express.
            confidence=1.0,
            matched_content=text,
            location=None,
            metadata={
                "runner": "TAG",
                "label": self.label,
                "tag_key": self._detector_key,
                "tag_value": text,
                # Recorded so a finding whose severity differs from its
                # detector's can be explained without re-reading the notebook.
                **({"tag_severity": str(applied)} if applied != self.severity else {}),
                # And when the connector asked for more than the detector
                # allows, what it asked for. Without this the most interesting
                # case -- a refused promotion -- left no trace on the finding
                # at all, only a warning in a log.
                **(
                    {"tag_severity_requested": str(severity).strip().upper()}
                    if lowered and severity is not None
                    else {}
                ),
            },
        )


def _parse_severity(value: object) -> Severity | None:
    """The severity this value names, or None when it names none."""
    if isinstance(value, Severity):
        return value
    if isinstance(value, str):
        # The schema spells them lowercase; a notebook writes "HIGH".
        name = value.strip().lower()
        if name in Severity.__members__:
            return Severity(name)
    return None


def _coerce_severity(value: object) -> Severity:
    return _parse_severity(value) or _DEFAULT_SEVERITY
