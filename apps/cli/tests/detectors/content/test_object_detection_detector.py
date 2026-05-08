"""Unit tests for ObjectDetectionDetector."""

import io

import pytest

from src.detectors.base import BaseDetector
from src.detectors.content import object_detection_detector as module
from src.models.generated_detectors import (
    ObjectDetectionDetectorConfig,
    ObjectDetectionSeverityRule,
    Severity,
)
from src.models.generated_single_asset_scan_results import DetectorType

Image = pytest.importorskip("PIL.Image", reason="Pillow not installed")


def _make_jpeg_bytes(width: int = 8, height: int = 8) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color=(100, 100, 100)).save(buf, format="JPEG")
    return buf.getvalue()


def _stub_detector(
    cfg: ObjectDetectionDetectorConfig | None = None,
    detections: list[dict] | None = None,
) -> module.ObjectDetectionDetector:
    if cfg is None:
        cfg = ObjectDetectionDetectorConfig(model="stub/detector", confidence_threshold=0.5)
    if detections is None:
        detections = [
            {
                "label": "person",
                "score": 0.9,
                "box": {"xmin": 0, "ymin": 0, "xmax": 50, "ymax": 100},
            }
        ]

    detector = module.ObjectDetectionDetector.__new__(module.ObjectDetectionDetector)
    BaseDetector.__init__(detector, cfg)
    detector._cfg = cfg
    detector._model_id = cfg.model
    detector._device = "cpu"
    detector._severity_map = cfg.severity_map

    detector._image_module = Image

    _detections = detections

    class FakePipeline:
        def __call__(self, _image: object) -> list[dict]:
            return _detections

    detector.pipeline = FakePipeline()
    return detector


@pytest.mark.asyncio
async def test_detect_maps_detection_to_finding() -> None:
    detector = _stub_detector()
    findings = await detector.detect(_make_jpeg_bytes(), content_type="image/jpeg")
    assert len(findings) == 1
    f = findings[0]
    assert f.detector_type == DetectorType.OBJECT_DETECTION
    assert f.finding_type == "person"
    assert f.confidence == pytest.approx(0.9)
    assert f.metadata is not None
    assert f.metadata["box"] == {"xmin": 0, "ymin": 0, "xmax": 50, "ymax": 100}


@pytest.mark.asyncio
async def test_detect_filters_by_confidence_threshold() -> None:
    detections = [
        {"label": "car", "score": 0.3, "box": {"xmin": 0, "ymin": 0, "xmax": 10, "ymax": 10}},
        {"label": "cat", "score": 0.8, "box": {"xmin": 0, "ymin": 0, "xmax": 10, "ymax": 10}},
    ]
    cfg = ObjectDetectionDetectorConfig(model="stub/d", confidence_threshold=0.5)
    detector = _stub_detector(cfg=cfg, detections=detections)
    findings = await detector.detect(_make_jpeg_bytes())
    assert len(findings) == 1
    assert findings[0].finding_type == "cat"


@pytest.mark.asyncio
async def test_detect_applies_severity_map() -> None:
    cfg = ObjectDetectionDetectorConfig(
        model="stub/d",
        confidence_threshold=0.0,
        severity_map=[
            ObjectDetectionSeverityRule(pattern="weapon|knife|gun", severity=Severity.critical),
            ObjectDetectionSeverityRule(pattern="person", severity=Severity.high),
        ],
    )
    detections = [
        {"label": "person", "score": 0.9, "box": {"xmin": 0, "ymin": 0, "xmax": 10, "ymax": 10}},
        {"label": "knife", "score": 0.85, "box": {"xmin": 0, "ymin": 0, "xmax": 5, "ymax": 5}},
        {"label": "chair", "score": 0.7, "box": {"xmin": 0, "ymin": 0, "xmax": 20, "ymax": 20}},
    ]
    detector = _stub_detector(cfg=cfg, detections=detections)
    findings = await detector.detect(_make_jpeg_bytes())
    by_label = {f.finding_type: f.severity for f in findings}
    assert by_label["knife"] == Severity.critical
    assert by_label["person"] == Severity.high
    assert by_label["chair"] == Severity.info


@pytest.mark.asyncio
async def test_detect_filters_by_min_box_area() -> None:
    cfg = ObjectDetectionDetectorConfig(model="stub/d", confidence_threshold=0.0, min_box_area=200)
    detections = [
        {
            "label": "small",
            "score": 0.9,
            "box": {"xmin": 0, "ymin": 0, "xmax": 10, "ymax": 10},
        },  # area=100 — filtered
        {
            "label": "large",
            "score": 0.9,
            "box": {"xmin": 0, "ymin": 0, "xmax": 20, "ymax": 20},
        },  # area=400 — kept
    ]
    detector = _stub_detector(cfg=cfg, detections=detections)
    findings = await detector.detect(_make_jpeg_bytes())
    assert len(findings) == 1
    assert findings[0].finding_type == "large"


@pytest.mark.asyncio
async def test_detect_respects_top_k() -> None:
    cfg = ObjectDetectionDetectorConfig(model="stub/d", confidence_threshold=0.0, top_k=2)
    detections = [
        {
            "label": f"obj{i}",
            "score": 0.9 - i * 0.1,
            "box": {"xmin": 0, "ymin": 0, "xmax": 10, "ymax": 10},
        }
        for i in range(5)
    ]
    detector = _stub_detector(cfg=cfg, detections=detections)
    findings = await detector.detect(_make_jpeg_bytes())
    assert len(findings) == 2


@pytest.mark.asyncio
async def test_detect_skips_non_image_content_type() -> None:
    detector = _stub_detector()
    findings = await detector.detect("some text", content_type="text/plain")
    assert findings == []


def test_init_raises_when_model_is_none() -> None:
    from src.detectors.dependencies import MissingDependencyError

    with pytest.raises(MissingDependencyError):
        module.ObjectDetectionDetector(ObjectDetectionDetectorConfig(model=None))
