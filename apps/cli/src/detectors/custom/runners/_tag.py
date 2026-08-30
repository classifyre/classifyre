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

    def tag_finding(self, value: str) -> DetectionResult:
        """One finding for one value the notebook asserted under this key."""
        text = str(value).strip()
        return self._make_result(
            finding_type=f"tag:{self.label}",
            category="CLASSIFICATION",
            severity=self.severity,
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
            },
        )


def _coerce_severity(value: object) -> Severity:
    if isinstance(value, Severity):
        return value
    if isinstance(value, str) and value in Severity.__members__:
        return Severity(value)
    return _DEFAULT_SEVERITY
