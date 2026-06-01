"""SandboxRunner: run detectors on a local file."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..models.generated_single_asset_scan_results import DetectionResult, Location
from ..utils.embedded_images import has_embedded_images, iter_embedded_images
from ..utils.file_parser import ParsedFile, parse_file

logger = logging.getLogger(__name__)


class SandboxRunner:
    """Run a set of detectors against a single local file."""

    def __init__(self, detectors_config: list[dict[str, Any]]) -> None:
        self._config = detectors_config

    def _build_detectors(self) -> list[Any]:
        from ..detectors import get_detector
        from ..detectors.config import parse_detector_config

        detectors = []
        for item in self._config:
            if not item.get("enabled", True):
                continue

            detector_type = item.get("type", "").upper()
            raw_config = item.get("config", {})

            try:
                detector_name, typed_config = parse_detector_config(
                    detector_type=detector_type,
                    raw_config=raw_config,
                )

                detector = get_detector(detector_name, typed_config)
                detectors.append(detector)
                logger.info(f"Initialized sandbox detector: {detector_name}")
            except Exception as e:
                logger.error(f"Failed to initialize detector {detector_type}: {e}")

        return detectors

    @staticmethod
    def _is_binary_detector(detector: Any) -> bool:
        for ct in detector.get_supported_content_types():
            if ct.startswith(("image/", "audio/", "video/")) or ct == "application/octet-stream":
                return True
        return False

    @staticmethod
    def _is_file_mime(mime_type: str) -> bool:
        """MIME types that should be delivered to a detector as raw bytes.

        Includes images/audio/video, generic binary, and PDFs. PDFs are *not*
        ``is_binary`` (they have a text layer) but a file-capable detector — e.g.
        a vision LLM detector — needs the original bytes to render page images,
        so route them through the byte path too.
        """
        return mime_type.startswith(("image/", "audio/", "video/")) or mime_type in (
            "application/pdf",
            "application/octet-stream",
        )

    @staticmethod
    def _supports_mime(supported: list[str], mime_type: str) -> bool:
        if mime_type in supported:
            return True
        for s in supported:
            if s.endswith("/*") and mime_type.startswith(s[:-1]):
                return True
        return False

    async def run_async(self, file_path: Path) -> tuple[ParsedFile, list[DetectionResult]]:
        """Parse the file and run all enabled detectors."""
        parsed = parse_file(file_path)

        detectors = self._build_detectors()
        if not detectors:
            return parsed, []

        tasks = []
        active_detectors = []

        mime_type = parsed.mime_type
        file_mime = self._is_file_mime(mime_type)

        # Content is delivered whole — never truncated. Truncation corrupts
        # binary files (images/PDFs) and drops potentially-important text, and
        # capacity is an instance concern: if a file is too large the worker is
        # OOM-killed and the failure is surfaced to the user, rather than silently
        # scanning partial content.
        raw_bytes: bytes | None = None

        def _get_raw_bytes() -> bytes:
            nonlocal raw_bytes
            if raw_bytes is None:
                raw_bytes = file_path.read_bytes()
            return raw_bytes

        if parsed.parse_error:
            logger.warning("Text extraction failed (%s): %s", mime_type, parsed.parse_error)

        text = parsed.text_content

        for detector in detectors:
            label = self._detector_label(detector)
            supported = detector.get_supported_content_types()
            # File/binary delivery: a file-capable detector (e.g. vision LLM,
            # image classifier) that supports this file's MIME gets raw bytes —
            # even for PDFs, which are not ``is_binary`` but still need the
            # original file to render page images.
            if (
                file_mime
                and self._is_binary_detector(detector)
                and self._supports_mime(supported, mime_type)
            ):
                logger.info("Sandbox: dispatching '%s' on file bytes (%s)", label, mime_type)
                tasks.append(detector.detect(_get_raw_bytes(), mime_type))
                active_detectors.append(detector)
            # Text delivery: text detectors get the extracted text layer.
            elif "text/plain" in supported and text.strip():
                logger.info("Sandbox: dispatching '%s' on extracted text (%d chars)", label, len(text))
                tasks.append(detector.detect(text, "text/plain"))
                active_detectors.append(detector)
            else:
                logger.info(
                    "Sandbox: '%s' not dispatched on whole file (supports=%s, file_mime=%s)",
                    label,
                    supported,
                    file_mime,
                )

        # Files that embed images (parquet image datasets, office docs) get each
        # embedded image run through the image/binary detectors directly, with
        # findings tagged by the embedded-image location so the UI can group them.
        embedded_images = has_embedded_images(mime_type)
        if not tasks and not embedded_images:
            if not text.strip() and not file_mime:
                logger.warning(
                    "No text content extracted from %s file; skipping text detectors.",
                    mime_type,
                )
            return parsed, []

        detected_at = datetime.now(UTC)
        all_findings: list[DetectionResult] = []

        results = await asyncio.gather(*tasks, return_exceptions=True) if tasks else []
        for detector, result in zip(active_detectors, results, strict=False):
            label = self._detector_label(detector)
            if isinstance(result, Exception):
                logger.error("Sandbox: '%s' failed on whole file: %s", label, result)
                continue
            if isinstance(result, list):
                detector_findings = [f for f in result if isinstance(f, DetectionResult)]
                logger.info(
                    "Sandbox: '%s' on whole file → %d finding(s)", label, len(detector_findings)
                )
                for finding in detector_findings:
                    all_findings.append(
                        finding.model_copy(
                            update={
                                "runner_id": "sandbox",
                                "detected_at": detected_at,
                            }
                        )
                    )

        if embedded_images:
            all_findings.extend(
                await self._run_embedded_image_detectors(
                    detectors=detectors,
                    file_bytes=_get_raw_bytes(),
                    mime_type=mime_type,
                    detected_at=detected_at,
                )
            )

        return parsed, all_findings

    async def _run_embedded_image_detectors(
        self,
        *,
        detectors: list[Any],
        file_bytes: bytes,
        mime_type: str,
        detected_at: datetime,
    ) -> list[DetectionResult]:
        """Run image/binary detectors over each image embedded in a container file.

        Sequential by design (one image, one detector at a time) so the job/scan
        logs read in order and each detector's outcome is attributable.
        """
        binary_detectors = [d for d in detectors if self._is_binary_detector(d)]
        if not binary_detectors:
            logger.info(
                "Sandbox: %s embeds images but no image-capable detectors are configured; "
                "skipping embedded-image scan",
                mime_type,
            )
            return []

        logger.info(
            "Sandbox: scanning images embedded in %s with image detectors: [%s]",
            mime_type,
            ", ".join(self._detector_label(d) for d in binary_detectors),
        )

        findings: list[DetectionResult] = []
        image_count = 0
        for image in iter_embedded_images(file_bytes, mime_type):
            image_count += 1
            size_kb = len(image.image_bytes) / 1024
            compatible = [
                d
                for d in binary_detectors
                if self._supports_mime(d.get_supported_content_types(), image.mime_type)
            ]
            if not compatible:
                logger.info(
                    "Sandbox: embedded image %s (%s, %.0f KB) — no compatible detector",
                    image.location,
                    image.mime_type,
                    size_kb,
                )
                continue
            logger.info(
                "Sandbox: embedded image %s (%s, %.0f KB) → dispatching [%s]",
                image.location,
                image.mime_type,
                size_kb,
                ", ".join(self._detector_label(d) for d in compatible),
            )
            for detector in compatible:
                label = self._detector_label(detector)
                try:
                    result = await detector.detect(image.image_bytes, image.mime_type)
                except Exception as exc:
                    logger.error(
                        "Sandbox: '%s' failed on embedded image %s: %s",
                        label,
                        image.location,
                        exc,
                    )
                    continue
                detector_findings = (
                    [f for f in result if isinstance(f, DetectionResult)]
                    if isinstance(result, list)
                    else []
                )
                logger.info(
                    "Sandbox: '%s' on embedded image %s → %d finding(s)",
                    label,
                    image.location,
                    len(detector_findings),
                )
                for finding in detector_findings:
                    findings.append(self._tag_embedded(finding, image.location, detected_at))

        logger.info(
            "Sandbox: embedded-image scan complete — %d image(s) scanned, %d finding(s)",
            image_count,
            len(findings),
        )
        return findings

    @staticmethod
    def _detector_label(detector: Any) -> str:
        """Human-readable detector name for logs (e.g. 'OCR_invoice'), not the class."""
        config_name = getattr(getattr(detector, "config", None), "name", None)
        if isinstance(config_name, str) and config_name.strip():
            return config_name.strip()
        key = getattr(getattr(detector, "config", None), "custom_detector_key", None)
        if isinstance(key, str) and key.strip():
            return key.strip()
        return str(detector.__class__.__name__)

    @staticmethod
    def _tag_embedded(
        finding: DetectionResult, location_label: str, detected_at: datetime
    ) -> DetectionResult:
        """Attach the embedded-image location to a finding for parent-file grouping."""
        metadata = dict(finding.metadata or {})
        metadata["embedded_location"] = location_label
        location = finding.location or Location()
        if not location.path:
            location = location.model_copy(update={"path": location_label})
        return finding.model_copy(
            update={
                "runner_id": "sandbox",
                "detected_at": detected_at,
                "metadata": metadata,
                "location": location,
            }
        )

    def run(self, file_path: Path) -> tuple[ParsedFile, list[DetectionResult]]:
        """Synchronous wrapper around run_async."""
        return asyncio.run(self.run_async(file_path))
