"""Unit tests for FeatureExtractionDetector."""

import pytest

from src.detectors.base import BaseDetector
from src.detectors.content import feature_extraction_detector as module
from src.models.generated_detectors import FeatureExtractionDetectorConfig
from src.models.generated_single_asset_scan_results import DetectorType


def _stub_detector(
    pooling: str = "mean",
    normalize: bool = True,
) -> module.FeatureExtractionDetector:
    detector = module.FeatureExtractionDetector.__new__(module.FeatureExtractionDetector)
    cfg = FeatureExtractionDetectorConfig(
        model="stub/embedder",
        pooling_strategy=pooling,
        normalize_embeddings=normalize,
    )
    BaseDetector.__init__(detector, cfg)
    detector._cfg = cfg
    detector._model_id = "stub/embedder"
    detector._pooling = pooling
    detector._normalize = normalize
    detector._truncation = True
    detector._max_length = None
    # Fake pipeline — returns [batch=1, tokens=3, hidden=4]
    # Accept **kwargs to handle truncation and other parameters
    detector.pipeline = lambda _text, **kwargs: [[[0.1, 0.2, 0.3, 0.4]] * 3]
    return detector


@pytest.mark.asyncio
async def test_detect_returns_embedding_finding() -> None:
    detector = _stub_detector()
    findings = await detector.detect("hello world")
    assert len(findings) == 1
    f = findings[0]
    assert f.detector_type == DetectorType.FEATURE_EXTRACTION
    assert f.finding_type == "embedding"
    assert f.confidence == 1.0
    assert "embedding" in (f.metadata or {})


@pytest.mark.asyncio
async def test_detect_mean_pooling_produces_vector() -> None:
    detector = _stub_detector(pooling="mean")
    findings = await detector.detect("test")
    embedding = findings[0].metadata["embedding"]  # type: ignore[index]
    assert isinstance(embedding, list)
    assert len(embedding) == 4  # hidden_dim


@pytest.mark.asyncio
async def test_detect_cls_pooling_uses_first_token() -> None:
    detector = module.FeatureExtractionDetector.__new__(module.FeatureExtractionDetector)
    cfg = FeatureExtractionDetectorConfig(
        model="stub/e", pooling_strategy="cls", normalize_embeddings=False
    )
    BaseDetector.__init__(detector, cfg)
    detector._cfg = cfg
    detector._model_id = "stub/e"
    detector._pooling = "cls"
    detector._normalize = False
    detector._truncation = True
    detector._max_length = None
    # tokens have distinct values so we can distinguish cls from mean
    detector.pipeline = lambda _text, **kwargs: [[[1.0, 0.0], [0.0, 1.0], [0.5, 0.5]]]
    findings = await detector.detect("test")
    embedding = findings[0].metadata["embedding"]  # type: ignore[index]
    assert embedding == pytest.approx([1.0, 0.0])


@pytest.mark.asyncio
async def test_detect_normalisation_produces_unit_vector() -> None:
    import math

    detector = _stub_detector(pooling="mean", normalize=True)
    findings = await detector.detect("test")
    embedding = findings[0].metadata["embedding"]  # type: ignore[index]
    norm = math.sqrt(sum(x**2 for x in embedding))
    assert abs(norm - 1.0) < 1e-5


@pytest.mark.asyncio
async def test_detect_skips_non_text_content_type() -> None:
    detector = _stub_detector()
    findings = await detector.detect(b"data", content_type="image/jpeg")  # type: ignore[arg-type]
    assert findings == []


@pytest.mark.asyncio
async def test_detect_skips_empty_content() -> None:
    detector = _stub_detector()
    findings = await detector.detect("   ")
    assert findings == []


def test_init_raises_when_model_is_none() -> None:
    from src.detectors.dependencies import MissingDependencyError

    with pytest.raises(MissingDependencyError):
        module.FeatureExtractionDetector(FeatureExtractionDetectorConfig(model=None))
