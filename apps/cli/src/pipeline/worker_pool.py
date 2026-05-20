"""Process-pool based parallel detector execution.

Uses ``concurrent.futures.ProcessPoolExecutor`` to run CPU-bound detectors
(PII, Secrets, YARA, CodeSecurity, Custom) in separate OS processes,
bypassing Python's GIL for true parallel execution.

Each worker process lazily initialises detector instances from serialised
configuration on first use and caches them for subsequent calls.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import multiprocessing
import os
import time
from concurrent.futures import ProcessPoolExecutor
from typing import Any

from ..models.generated_single_asset_scan_results import DetectionResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Per-worker process state (module-level, isolated per OS process)
# ---------------------------------------------------------------------------
_worker_detector_cache: dict[str, Any] = {}
_worker_init_errors: dict[str, str] = {}
_worker_pid: int | None = None


def _detect_in_worker(
    detector_name: str,
    detector_type: str,
    config_json: str,
    content: str | bytes,
    content_type: str,
) -> list[dict[str, Any]]:
    """Run a single detector on *content* inside a worker process.

    This is a module-level function so it can be pickled by
    ``ProcessPoolExecutor``.  Detectors are lazily initialised from
    *config_json* on first use and cached for the lifetime of the process.
    """
    global _worker_pid  # noqa: PLW0603
    pid = os.getpid()
    if _worker_pid != pid:
        _worker_pid = pid
        logging.basicConfig(
            level=logging.INFO,
            format=f"%(levelname)s:%(name)s:[worker-{pid}] %(message)s",
        )

    cache_key = f"{detector_name}:{hashlib.md5(config_json.encode()).hexdigest()}"

    if cache_key in _worker_init_errors:
        raise RuntimeError(
            f"Detector {detector_name} previously failed to initialise: "
            f"{_worker_init_errors[cache_key]}"
        )

    if cache_key not in _worker_detector_cache:
        try:
            from ..detectors import get_detector
            from ..detectors.config import parse_detector_config

            name, typed_config = parse_detector_config(
                detector_type, json.loads(config_json)
            )
            detector = get_detector(name, typed_config)
            _worker_detector_cache[cache_key] = detector
            logging.getLogger(__name__).info(
                "Worker %d initialised detector %s", pid, detector_name
            )
        except Exception as exc:
            _worker_init_errors[cache_key] = str(exc)
            raise RuntimeError(
                f"Failed to initialise detector {detector_name} in worker {pid}: {exc}"
            ) from exc

    detector = _worker_detector_cache[cache_key]

    t0 = time.monotonic()
    if hasattr(detector, "_detect_sync"):
        if detector_name in ("yara",) and isinstance(content, (str, bytes)):
            results = detector._detect_sync(content, content_type)
        elif detector_name == "custom":
            results = detector._detect_sync(content, content_type)
        else:
            text = content if isinstance(content, str) else content.decode("utf-8", errors="replace")
            results = detector._detect_sync(text)
    else:
        results = asyncio.run(detector.detect(content, content_type))

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    logging.getLogger(__name__).debug(
        "Worker %d ran %s: %d findings in %dms",
        pid, detector_name, len(results), elapsed_ms,
    )

    return [
        r.model_dump(mode="json", exclude_none=True) if hasattr(r, "model_dump") else r
        for r in results
    ]


# I/O-bound detectors should stay in the asyncio event loop, not the pool.
_IO_BOUND_DETECTORS = frozenset({"broken_links"})


def is_io_bound_detector(detector_name: str) -> bool:
    return detector_name in _IO_BOUND_DETECTORS


class DetectorWorkerPool:
    """Manages a ``ProcessPoolExecutor`` for parallel detector execution."""

    def __init__(
        self,
        max_workers: int,
        *,
        mp_start_method: str | None = None,
    ) -> None:
        effective_workers = max(1, min(max_workers, 16))
        if mp_start_method is None:
            available = multiprocessing.get_all_start_methods()
            mp_start_method = "forkserver" if "forkserver" in available else "spawn"

        ctx = multiprocessing.get_context(mp_start_method)
        self._pool = ProcessPoolExecutor(
            max_workers=effective_workers,
            mp_context=ctx,
        )
        self._max_workers = effective_workers
        self._mp_start_method = mp_start_method
        self._shutdown = False
        logger.info(
            "Detector pool started: %d workers (method=%s, pid=%d)",
            effective_workers, mp_start_method, os.getpid(),
        )

    @property
    def max_workers(self) -> int:
        return self._max_workers

    async def run_detector(
        self,
        detector_name: str,
        detector_type: str,
        config_json: str,
        content: str | bytes,
        content_type: str,
    ) -> list[DetectionResult]:
        """Submit a single detection task to the process pool."""
        if self._shutdown:
            raise RuntimeError("DetectorWorkerPool is shut down")

        loop = asyncio.get_running_loop()
        raw_results: list[dict[str, Any]] = await loop.run_in_executor(
            self._pool,
            _detect_in_worker,
            detector_name,
            detector_type,
            config_json,
            content,
            content_type,
        )
        return [DetectionResult.model_validate(r) for r in raw_results]

    def shutdown(self, *, wait: bool = True, cancel_futures: bool = False) -> None:
        if self._shutdown:
            return
        self._shutdown = True
        self._pool.shutdown(wait=wait, cancel_futures=cancel_futures)
        logger.info("Detector pool shut down (%d workers)", self._max_workers)

    def __enter__(self) -> DetectorWorkerPool:
        return self

    def __exit__(self, *exc: object) -> None:
        self.shutdown(wait=True)
