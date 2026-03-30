"""Tests for NSFW image detector."""

import pytest

from src.detectors.content.nsfw_detector import NSFWDetector
from src.detectors.dependencies import MissingDependencyError, ensure_torch, require_module
from src.models.generated_detectors import DetectorConfig, Severity

try:
    ensure_torch("nsfw", ["content", "detectors"])
    require_module("transformers", "nsfw", ["content", "detectors"])
    require_module("PIL.Image", "nsfw", ["content", "detectors"])
except MissingDependencyError as exc:
    pytest.skip(str(exc), allow_module_level=True)


@pytest.mark.asyncio
async def test_nsfw_detector_initialization():
    """Test that NSFW detector can be initialized."""
    detector = NSFWDetector()
    assert detector.detector_type == "nsfw"
    assert detector.detector_name == "nsfw"
    assert detector.config is not None


@pytest.mark.asyncio
async def test_nsfw_detector_initialization_with_config():
    """Test NSFW detector with custom config."""
    config = DetectorConfig(confidence_threshold=0.9)
    detector = NSFWDetector(config)
    assert detector.config.confidence_threshold == 0.9


@pytest.mark.asyncio
async def test_detect_safe_image_bytes(sample_safe_image):
    """Test detection on safe image (bytes)."""
    detector = NSFWDetector()
    results = await detector.detect(sample_safe_image, content_type="image/png")

    # Safe images should have no high-confidence NSFW detections
    # (may detect "normal" class with high confidence)
    nsfw_findings = [r for r in results if r.severity in [Severity.critical, Severity.high]]
    assert len(nsfw_findings) == 0, (
        f"Safe image should not be flagged as NSFW, got: {[r.finding_type for r in results]}"
    )


@pytest.mark.asyncio
async def test_detect_safe_image_file(sample_safe_image_path):
    """Test detection on safe image file path."""
    detector = NSFWDetector()

    # Read image file
    with open(sample_safe_image_path, "rb") as f:
        image_bytes = f.read()

    results = await detector.detect(image_bytes, content_type="image/jpeg")

    # Safe images should not be flagged
    nsfw_findings = [r for r in results if r.severity in [Severity.critical, Severity.high]]
    assert len(nsfw_findings) == 0


@pytest.mark.asyncio
async def test_supported_content_types():
    """Test that detector reports supported image types."""
    detector = NSFWDetector()
    content_types = detector.get_supported_content_types()

    # Should support common image formats
    assert "image/jpeg" in content_types
    assert "image/png" in content_types
    assert isinstance(content_types, list)


@pytest.mark.asyncio
async def test_detector_metadata():
    """Test detector metadata."""
    detector = NSFWDetector()
    metadata = detector.get_metadata()

    assert metadata["detector_type"] == "nsfw"
    assert metadata["detector_name"] == "nsfw"
    assert "content_types" in metadata
    # Image models can run on CPU but benefit from GPU
    assert isinstance(metadata["requires_gpu"], bool)


@pytest.mark.asyncio
async def test_confidence_threshold_filtering(sample_safe_image):
    """Test that confidence threshold filters results."""
    # High threshold should filter out low-confidence results
    config = DetectorConfig(confidence_threshold=0.95)
    detector = NSFWDetector(config)

    results = await detector.detect(sample_safe_image, content_type="image/png")

    # All results should meet threshold
    for result in results:
        assert result.confidence >= 0.95


@pytest.mark.asyncio
async def test_max_findings_limit(sample_safe_image):
    """Test that max_findings config is respected."""
    config = DetectorConfig(max_findings=1)
    detector = NSFWDetector(config)

    results = await detector.detect(sample_safe_image, content_type="image/png")

    # Should limit to max_findings
    assert len(results) <= 1


@pytest.mark.asyncio
async def test_category_is_content(sample_safe_image):
    """Test that all results have category 'content'."""
    detector = NSFWDetector()
    results = await detector.detect(sample_safe_image, content_type="image/png")

    for result in results:
        assert result.category == "CONTENT"


@pytest.mark.asyncio
async def test_invalid_image_content():
    """Test handling of invalid image content."""
    detector = NSFWDetector()

    # Invalid image data
    invalid_data = b"This is not an image"

    results = await detector.detect(invalid_data, content_type="image/jpeg")

    # Should handle gracefully and return empty or error
    # (implementation may vary - should not crash)
    assert isinstance(results, list)


@pytest.mark.asyncio
async def test_text_content_rejected():
    """Test that text content is rejected for image detector."""
    detector = NSFWDetector()

    text_content = "This is text, not an image"

    # Should handle gracefully
    results = await detector.detect(text_content, content_type="text/plain")

    # Should return empty list or handle error gracefully
    assert isinstance(results, list)


@pytest.mark.asyncio
async def test_results_have_proper_structure(sample_safe_image):
    """Test that results have proper structure."""
    detector = NSFWDetector()
    results = await detector.detect(sample_safe_image, content_type="image/png")

    for result in results:
        # Should have all required fields
        assert hasattr(result, "finding_type")
        assert hasattr(result, "category")
        assert hasattr(result, "severity")
        assert hasattr(result, "confidence")
        assert hasattr(result, "matched_content")

        # Confidence should be valid
        assert 0 <= result.confidence <= 1

        # Category should be content
        assert result.category == "CONTENT"


@pytest.mark.asyncio
async def test_multiple_image_formats(sample_safe_image_path):
    """Test detection works with different image formats."""
    import io

    from PIL import Image

    detector = NSFWDetector()

    # Read original image
    img = Image.open(sample_safe_image_path)

    # Test PNG
    png_bytes = io.BytesIO()
    img.save(png_bytes, format="PNG")
    png_results = await detector.detect(png_bytes.getvalue(), content_type="image/png")
    assert isinstance(png_results, list)

    # Test JPEG
    jpeg_bytes = io.BytesIO()
    img.save(jpeg_bytes, format="JPEG")
    jpeg_results = await detector.detect(jpeg_bytes.getvalue(), content_type="image/jpeg")
    assert isinstance(jpeg_results, list)
