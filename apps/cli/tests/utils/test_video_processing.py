"""Unit tests for sparse video frame processing."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from src.utils import video_processing


class _ArrayCv2:
    COLOR_BGR2GRAY = 1

    @staticmethod
    def resize(frame: Any, size: tuple[int, int]) -> Any:
        assert (frame.shape[1], frame.shape[0]) == size
        return frame

    @staticmethod
    def cvtColor(frame: Any, _conversion: int) -> Any:  # noqa: N802
        return frame[:, :, 0]

    @staticmethod
    def absdiff(left: Any, right: Any) -> Any:
        import numpy as np

        return np.abs(left.astype(np.int16) - right.astype(np.int16))


def _array_cv2() -> _ArrayCv2:
    return _ArrayCv2()


def test_changed_frame_ocr_is_timestamped_and_deduplicated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    np = pytest.importorskip("numpy")
    first = np.tile(np.arange(9, dtype=np.uint8), (8, 1))
    second = np.fliplr(first).copy()
    first_bgr = np.repeat(first[:, :, None], 3, axis=2)
    second_bgr = np.repeat(second[:, :, None], 3, axis=2)

    monkeypatch.setattr(video_processing, "_get_cv2", _array_cv2)
    monkeypatch.setattr(
        video_processing,
        "_iter_sampled_frames",
        lambda _path: iter(
            [
                (0.0, first_bgr),
                (1.0, first_bgr.copy()),
                (2.0, second_bgr),
                (32.0, second_bgr.copy()),
            ]
        ),
    )
    # Even an exact coarse-hash collision must not suppress a changed slide.
    hashes = iter([0, 0, 0])
    monkeypatch.setattr(video_processing, "_difference_hash", lambda *_args: next(hashes))
    ocr_results = iter(["Opening slide", "Architecture slide"])
    monkeypatch.setattr(video_processing, "_ocr_text", lambda _frame: next(ocr_results))

    segments = list(
        video_processing.iter_video_ocr_segments(b"video", file_name="lecture.mp4")
    )

    assert segments == [
        "[On-screen text 00:00:00]\nOpening slide",
        "[On-screen text 00:00:02]\nArchitecture slide",
    ]


def test_sparse_sampler_seeks_by_timestamp(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    positions: list[float] = []

    class FakeCapture:
        def isOpened(self) -> bool:  # noqa: N802
            return True

        def release(self) -> None:
            return None

        def get(self, prop: int) -> float:
            return 30.0 if prop == 1 else 90.0

        def set(self, prop: int, value: float) -> bool:
            if prop == 3:
                positions.append(value)
            return True

        def read(self) -> tuple[bool, object]:
            return True, object()

    fake_cv2 = SimpleNamespace(
        CAP_PROP_FPS=1,
        CAP_PROP_FRAME_COUNT=2,
        CAP_PROP_POS_MSEC=3,
        VideoCapture=lambda _path: FakeCapture(),
    )
    monkeypatch.setattr(video_processing, "_get_cv2", lambda: fake_cv2)

    samples = list(video_processing._iter_sampled_frames(tmp_path / "sample.mp4"))

    assert [timestamp for timestamp, _frame in samples] == [0.0, 1.0, 2.0]
    assert positions == [0.0, 1000.0, 2000.0]


def test_rapidocr_filters_low_confidence_lines(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = lambda _frame: (  # noqa: E731
        [
            [None, "clear text", 0.91],
            [None, "noise", 0.2],
            {"text": "another line", "score": 0.8},
        ],
        0.01,
    )
    monkeypatch.setattr(video_processing, "_get_rapidocr_engine", lambda: (engine, None))

    assert video_processing._ocr_text(object()) == "clear text\nanother line"


def test_path_ocr_reuses_existing_video(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"video")
    seen: list[Path] = []

    def segments(path: Path) -> Any:
        seen.append(path)
        yield "[On-screen text 00:00:01]\nSlide"

    monkeypatch.setattr(video_processing, "iter_video_ocr_path", segments)

    text, error = video_processing.extract_video_ocr_path(video_path)

    assert error is None
    assert text.endswith("Slide")
    assert seen == [video_path]
