"""AI/LLM pipeline runner — prompt-driven classification and field extraction."""

from __future__ import annotations

import base64
import json
import logging
import os
from datetime import UTC, datetime
from typing import Any

# Quiet litellm's import-time provider preload warnings (bedrock/sagemaker need
# botocore, which we don't install) before the library is ever imported.
os.environ.setdefault("LITELLM_LOG", "ERROR")

from ....models.generated_detectors import LLMPipelineSchema, Severity
from ....models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
)
from ....utils.file_to_images import render_to_images, supported_mime_type
from ...dependencies import require_module
from ._base import _IMAGE_CONTENT_TYPES, _TEXT_CONTENT_TYPES, BaseRunner, _resolve_pipeline_severity

logger = logging.getLogger(__name__)

# Map the stored AI provider type onto the litellm model-string convention.
_PROVIDER_PREFIX: dict[str, str] = {
    "CLAUDE": "anthropic",
    "GEMINI": "gemini",
    "OPENAI_COMPATIBLE": "openai",
}

# Content types a vision-capable LLM detector renders to images and sends to the
# model directly. PDFs are rasterised page-by-page; images pass through.
_VISION_CONTENT_TYPES = [*_IMAGE_CONTENT_TYPES, "application/pdf"]

# Cap the number of rendered page images sent in a single completion to bound
# token cost and request size for multi-page PDFs.
_MAX_VISION_IMAGES = 20


class LLMRunner(BaseRunner):
    """AI detector — sends content to a configured LLM provider for classification + extraction."""

    def __init__(
        self, schema: LLMPipelineSchema, detector_key: str = "", detector_name: str = ""
    ) -> None:
        self._schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name

        runtime = schema.provider_runtime
        if runtime is None:
            raise ValueError(
                f"AI detector '{detector_key}' is missing provider_runtime — the API must "
                "inject resolved provider credentials before dispatch."
            )
        self._runtime = runtime
        self._litellm = require_module("litellm", "llm", ["llm"])
        # Let litellm silently drop params an endpoint doesn't support (e.g.
        # response_format / temperature on some OpenAI-compatible gateways)
        # instead of raising. Keep its own logging quiet.
        self._litellm.drop_params = True
        self._litellm.suppress_debug_info = True
        logging.getLogger("LiteLLM").setLevel(logging.ERROR)

    def run(self, text: str) -> None:  # type: ignore[override]  # pragma: no cover
        raise NotImplementedError("LLMRunner uses detect() directly")

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        if isinstance(content, bytes):
            return self._detect_vision(content, content_type)
        if content_type not in _TEXT_CONTENT_TYPES:
            return []
        text = content.strip()
        if not text:
            return []

        schema = self._schema
        content_limit = schema.content_limit or 8000
        snippet = text[:content_limit]

        messages = [
            {"role": "system", "content": self._build_system_prompt()},
            {"role": "user", "content": snippet},
        ]
        return self._complete_and_parse(messages, snippet)

    def _detect_vision(self, content: bytes, content_type: str) -> list[DetectionResult]:
        """Render a binary file (image/PDF) to images and classify via the model."""
        if not self._vision_enabled():
            return []
        if not supported_mime_type(content_type):
            return []

        images = render_to_images(
            content,
            content_type,
            max_pages=_MAX_VISION_IMAGES,
        )
        if not images:
            return []

        image_blocks = [
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}"
                },
            }
            for png in images[:_MAX_VISION_IMAGES]
        ]
        messages = [
            {"role": "system", "content": self._build_system_prompt()},
            {"role": "user", "content": image_blocks},
        ]
        # matched_content fallback descriptor — there is no text snippet for files.
        descriptor = f"[{content_type}, {len(image_blocks)} page image(s)]"
        return self._complete_and_parse(messages, descriptor, vision_pages=len(image_blocks))

    def _complete_and_parse(
        self,
        messages: list[dict[str, Any]],
        snippet: str,
        *,
        vision_pages: int | None = None,
    ) -> list[DetectionResult]:
        schema = self._schema
        try:
            response = self._litellm.completion(
                model=self._model_string(),
                api_key=self._runtime.api_key,
                api_base=self._runtime.base_url or None,
                temperature=schema.temperature if schema.temperature is not None else 0.0,
                max_tokens=self._max_tokens(),
                messages=messages,
                response_format={"type": "json_object"},
            )
            raw = response.choices[0].message.content or "{}"
            parsed = self._parse_json(raw)
        except Exception as exc:
            logger.error(
                "llm detector error (detector=%s, model=%s): %s",
                self._detector_key,
                self._runtime.model,
                exc,
                exc_info=True,
            )
            return []

        return self._results_from_payload(snippet, parsed, vision_pages=vision_pages)

    def _vision_enabled(self) -> bool:
        return bool(getattr(self._runtime, "supports_vision", False))

    def get_supported_content_types(self) -> list[str]:
        types = list(_TEXT_CONTENT_TYPES)
        if self._vision_enabled():
            types.extend(_VISION_CONTENT_TYPES)
        return types

    # ── Internals ────────────────────────────────────────────────────────────

    def _max_tokens(self) -> int | None:
        # `max_tokens` is generated as a RootModel[int] wrapper, so unwrap `.root`
        # before handing it to litellm — passing the model object serialises to an
        # invalid request body and fails the whole completion.
        raw = self._schema.max_tokens
        if raw is None:
            return None
        return getattr(raw, "root", raw)

    def _model_string(self) -> str:
        prefix = _PROVIDER_PREFIX.get(self._runtime.provider.value, "openai")
        return f"{prefix}/{self._runtime.model}"

    def _build_system_prompt(self) -> str:
        schema = self._schema
        parts: list[str] = [schema.system_prompt.strip()]

        labels = schema.labels or []
        if labels:
            label_lines = "\n".join(
                f"- {lbl.name}: {lbl.description}" if lbl.description else f"- {lbl.name}"
                for lbl in labels
            )
            parts.append(
                "Classify the content using these labels:\n"
                + label_lines
                + (
                    "\nMultiple labels may apply."
                    if schema.multi_label
                    else "\nChoose the single best label."
                )
            )

        fields = schema.output_fields or []
        if fields:
            field_lines = "\n".join(
                f"- {f.name} ({f.type.value if f.type else 'string'}): {f.description}"
                if f.description
                else f"- {f.name} ({f.type.value if f.type else 'string'})"
                for f in fields
            )
            parts.append("Also extract these fields:\n" + field_lines)

        parts.append(
            "Respond with a JSON object of the form: "
            '{"labels": [{"name": "<label>", "confidence": <0-1>, '
            '"matched_content": "<relevant snippet>"}], "fields": {<field name>: <value>}}. '
            "Use only the labels listed above. Return an empty labels array when none apply."
        )

        if schema.response_example:
            parts.append("Example response:\n" + schema.response_example.strip())

        return "\n\n".join(parts)

    @staticmethod
    def _parse_json(raw: str) -> dict[str, Any]:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            start = raw.find("{")
            end = raw.rfind("}")
            if start == -1 or end == -1 or end <= start:
                return {}
            try:
                parsed = json.loads(raw[start : end + 1])
            except json.JSONDecodeError:
                return {}
        return parsed if isinstance(parsed, dict) else {}

    def _results_from_payload(
        self,
        snippet: str,
        payload: dict[str, Any],
        *,
        vision_pages: int | None = None,
    ) -> list[DetectionResult]:
        schema = self._schema
        threshold = schema.confidence_threshold if schema.confidence_threshold is not None else 0.5
        default_severity = schema.severity or Severity.info
        extracted = self._coerce_fields(payload.get("fields"))

        raw_labels = payload.get("labels")
        label_entries: list[dict[str, Any]] = (
            [lbl for lbl in raw_labels if isinstance(lbl, dict)]
            if isinstance(raw_labels, list)
            else []
        )

        results: list[DetectionResult] = []
        for entry in label_entries:
            label = str(entry.get("name", "")).strip()
            if not label:
                continue
            confidence = float(entry.get("confidence", 1.0) or 0.0)
            if confidence < threshold:
                continue
            severity = _resolve_pipeline_severity(label, schema.severity_map, default_severity)
            matched = str(entry.get("matched_content") or "").strip() or snippet[:320]
            results.append(
                DetectionResult(
                    detector_type=DetectorType.CUSTOM,
                    finding_type=label,
                    category="CLASSIFICATION",
                    severity=severity,
                    confidence=min(0.99, confidence),
                    matched_content=matched,
                    location=None,
                    custom_detector_key=self._detector_key,
                    custom_detector_name=self._detector_name,
                    detected_at=datetime.now(UTC),
                    metadata={
                        "runner": "LLM",
                        "provider": self._runtime.provider.value,
                        "model": self._runtime.model,
                        "label": label,
                        "fields": extracted,
                        "input": "vision" if vision_pages is not None else "text",
                        **({"vision_pages": vision_pages} if vision_pages is not None else {}),
                    },
                    extracted_data=extracted or None,
                    extraction_method="LLM",
                )
            )

        results.sort(key=lambda r: r.confidence, reverse=True)
        return results

    @staticmethod
    def _coerce_fields(raw: Any) -> dict[str, Any]:
        return {str(k): v for k, v in raw.items()} if isinstance(raw, dict) else {}
