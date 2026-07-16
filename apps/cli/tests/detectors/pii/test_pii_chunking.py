"""Regression tests for PII chunking config unwrapping (G-011).

chunk_size / chunk_overlap / max_length are generated as RootModel[int]
wrappers. The detector used to treat them as plain ints, which meant a config
with valid chunking values raised
``unsupported operand type(s) for -: 'ChunkSize' and 'ChunkOverlap'`` on every
page. The run still reported COMPLETED with zero errors, so PII silently
produced nothing for the whole corpus.

These tests need no Presidio: they exercise the config plumbing directly.
"""

from src.detectors.pii.detector import PIIDetector, _unwrap_int
from src.models.generated_detectors import ChunkOverlap, ChunkSize, MaxLength


def _detector_with(cfg) -> PIIDetector:
    """A PIIDetector bound to a config without booting the Presidio analyzer."""
    detector = PIIDetector.__new__(PIIDetector)
    detector._cfg = cfg
    return detector


class _Cfg:
    """Stands in for PIIDetectorConfig with exactly the fields under test."""

    def __init__(self, chunk_size=None, chunk_overlap=None, max_length=None):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.max_length = max_length


class TestUnwrapInt:
    def test_unwraps_root_model(self):
        assert _unwrap_int(ChunkSize(root=500)) == 500

    def test_passes_through_plain_int(self):
        assert _unwrap_int(500) == 500

    def test_none_stays_none(self):
        assert _unwrap_int(None) is None

    def test_wrapper_with_unset_root_is_none(self):
        # root is declared `int = Field(None)`, so an unset root is None and
        # must not be mistaken for a usable value.
        assert _unwrap_int(ChunkSize.model_construct(root=None)) is None


class TestChunkText:
    def test_root_model_config_does_not_raise(self):
        # The exact shape that failed on every page of the corpus run.
        detector = _detector_with(
            _Cfg(chunk_size=ChunkSize(root=10), chunk_overlap=ChunkOverlap(root=2))
        )

        chunks = detector._chunk_text("abcdefghijklmnopqrstuvwxyz")

        assert chunks, "chunking must produce output, not fail silently"
        assert all(isinstance(text, str) for text, _ in chunks)
        assert all(isinstance(offset, int) for _, offset in chunks)

    def test_offsets_and_overlap_are_correct(self):
        detector = _detector_with(
            _Cfg(chunk_size=ChunkSize(root=10), chunk_overlap=ChunkOverlap(root=2))
        )

        chunks = detector._chunk_text("abcdefghijklmnopqrstuvwxyz")

        # step = 10 - 2 = 8, so offsets advance by 8 and consecutive chunks
        # share 2 characters.
        assert [offset for _, offset in chunks] == [0, 8, 16, 24]
        assert chunks[0][0] == "abcdefghij"
        assert chunks[1][0] == "ijklmnopqr"

    def test_plain_ints_still_work(self):
        detector = _detector_with(_Cfg(chunk_size=10, chunk_overlap=2))

        chunks = detector._chunk_text("abcdefghijklmnopqrstuvwxyz")

        assert [offset for _, offset in chunks] == [0, 8, 16, 24]

    def test_null_chunk_size_returns_whole_text(self):
        detector = _detector_with(_Cfg(chunk_size=None))

        assert detector._chunk_text("some text") == [("some text", 0)]

    def test_wrapper_with_unset_root_returns_whole_text(self):
        # A truthy wrapper around an unset root must not be read as "chunk at 0".
        detector = _detector_with(_Cfg(chunk_size=ChunkSize.model_construct(root=None)))

        assert detector._chunk_text("some text") == [("some text", 0)]

    def test_missing_overlap_defaults_to_zero(self):
        detector = _detector_with(_Cfg(chunk_size=ChunkSize(root=5), chunk_overlap=None))

        chunks = detector._chunk_text("abcdefghij")

        assert [offset for _, offset in chunks] == [0, 5]

    def test_overlap_at_or_above_chunk_size_still_advances(self):
        # step must stay >= 1 or the comprehension would never terminate.
        detector = _detector_with(
            _Cfg(chunk_size=ChunkSize(root=5), chunk_overlap=ChunkOverlap(root=9))
        )

        chunks = detector._chunk_text("abcdefgh")

        assert len(chunks) == len("abcdefgh")
        assert [offset for _, offset in chunks] == list(range(8))


class TestMaxLength:
    """max_length is the same wrapper bug, unreported only because the corpus
    run never set it: spaCy would receive a RootModel and fail comparing it
    against len(text)."""

    def test_max_length_unwraps_to_int(self):
        assert _unwrap_int(MaxLength(root=2_000_000)) == 2_000_000

    def test_unset_max_length_is_none(self):
        assert _unwrap_int(None) is None
