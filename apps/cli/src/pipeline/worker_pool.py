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
from ..utils.resources import get_effective_cpu_count, get_effective_memory_mb

__all__ = ["get_effective_cpu_count", "get_effective_memory_mb"]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Per-worker process state (module-level, isolated per OS process)
# ---------------------------------------------------------------------------
_worker_detector_cache: dict[str, Any] = {}
_worker_init_errors: dict[str, str] = {}
_worker_pid: int | None = None


def _init_worker_threads(threads_per_worker: int) -> None:
    """Cap BLAS/torch intra-op threads so N workers don't each grab every core.

    Runs as the ProcessPoolExecutor initializer in each worker process. The env
    vars must be set before numpy/torch import; torch.set_num_threads covers the
    case where torch is already imported via the forkserver preload.
    """
    threads = max(1, threads_per_worker)
    for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ.setdefault(var, str(threads))
    # Detector work is background work: on a shared host (desktop) the pool
    # must yield to the UI, so deprioritize workers where the OS allows it.
    if hasattr(os, "nice"):
        try:
            os.nice(5)
        except OSError:
            pass
    try:
        import torch

        torch.set_num_threads(threads)
    except Exception:
        pass


class _WorkerResult:
    """Container for results + metadata from a worker process."""

    __slots__ = ("elapsed_ms", "findings", "worker_pid")

    def __init__(self, findings: list[dict[str, Any]], worker_pid: int, elapsed_ms: int) -> None:
        self.findings = findings
        self.worker_pid = worker_pid
        self.elapsed_ms = elapsed_ms


def _detect_in_worker(
    detector_name: str,
    detector_type: str,
    config_json: str,
    content: str | bytes,
    content_type: str,
) -> _WorkerResult:
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

            name, typed_config = parse_detector_config(detector_type, json.loads(config_json))
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
            text = (
                content if isinstance(content, str) else content.decode("utf-8", errors="replace")
            )
            results = detector._detect_sync(text)
    else:
        results = asyncio.run(detector.detect(content, content_type))

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    logging.getLogger(__name__).info(
        "Worker %d ran %s: %d findings in %dms",
        pid,
        detector_name,
        len(results),
        elapsed_ms,
    )

    findings = [
        r.model_dump(mode="json", exclude_none=True) if hasattr(r, "model_dump") else r
        for r in results
    ]
    return _WorkerResult(findings=findings, worker_pid=pid, elapsed_ms=elapsed_ms)


# I/O-bound detectors should stay in the asyncio event loop, not the pool.
_IO_BOUND_DETECTORS = frozenset({"broken_links"})


def is_io_bound_detector(detector_name: str) -> bool:
    return detector_name in _IO_BOUND_DETECTORS


# Pipeline schema types whose runners load a torch model into every worker
# process that executes them.
_ML_PIPELINE_TYPES = frozenset(
    {
        "GLINER2",
        "TEXT_CLASSIFICATION",
        "IMAGE_CLASSIFICATION",
        "OBJECT_DETECTION",
    }
)


def recipe_has_ml_custom_detectors(recipe: dict[str, Any]) -> bool:
    """True when the recipe configures a custom detector backed by a local ML model."""
    for item in recipe.get("detectors", []):
        if not isinstance(item, dict) or not item.get("enabled", True):
            continue
        if str(item.get("type", "")).upper() != "CUSTOM":
            continue
        config = item.get("config") or {}
        schema = config.get("pipeline_schema") or {}
        schema_type = str(schema.get("type", "GLINER2")).upper()
        if schema_type in _ML_PIPELINE_TYPES:
            return True
    return False


def compute_pool_workers(override: int | None = None, *, per_worker_mb: int = 1024) -> int:
    """Compute optimal pool size from actual resource limits.

    Auto-sizes from cgroup CPU/memory so the pool fits within:
    - CPU cores (cgroup-aware) minus 1 for the main process
    - Memory / *per_worker_mb* per worker (each worker loads its own copy of any
      configured ML models, so callers pass a larger budget when the recipe has
      ML-backed custom detectors)
    - Hard cap of 16

    When *override* is set, it is used directly (clamped to [1, 16]).
    """
    if override is not None:
        return max(1, min(override, 16))

    cpus = get_effective_cpu_count()
    mem_mb = get_effective_memory_mb()

    cpu_budget = max(1, cpus - 1)
    mem_budget = max(1, (mem_mb - 512) // max(1, per_worker_mb))

    effective = max(1, min(cpu_budget, mem_budget, 16))

    logger.info(
        "Pool sizing: cpu_budget=%d (cpus=%d), mem_budget=%d (%dMB), effective=%d",
        cpu_budget,
        cpus,
        mem_budget,
        mem_mb,
        effective,
    )
    return effective


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
        # CLASSIFYRE_WORKER_THREADS caps BLAS/torch threads per worker; the
        # desktop app sets it so workers*threads stays below the core count
        # instead of saturating the machine. Unset (K8s/dev) keeps the
        # divide-the-cores behavior.
        threads_env = os.environ.get("CLASSIFYRE_WORKER_THREADS", "")
        if threads_env.isdigit() and int(threads_env) > 0:
            threads_per_worker = min(int(threads_env), 16)
        else:
            threads_per_worker = max(1, get_effective_cpu_count() // effective_workers)
        self._pool = ProcessPoolExecutor(
            max_workers=effective_workers,
            mp_context=ctx,
            initializer=_init_worker_threads,
            initargs=(threads_per_worker,),
        )
        self._max_workers = effective_workers
        self._mp_start_method = mp_start_method
        self._shutdown = False
        logger.info(
            "Detector pool started: %d workers (method=%s, pid=%d)",
            effective_workers,
            mp_start_method,
            os.getpid(),
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
    ) -> tuple[list[DetectionResult], int, int]:
        """Submit a single detection task to the process pool.

        Returns (findings, worker_pid, elapsed_ms).
        """
        if self._shutdown:
            raise RuntimeError("DetectorWorkerPool is shut down")

        loop = asyncio.get_running_loop()
        result: _WorkerResult = await loop.run_in_executor(
            self._pool,
            _detect_in_worker,
            detector_name,
            detector_type,
            config_json,
            content,
            content_type,
        )
        findings = [DetectionResult.model_validate(r) for r in result.findings]
        return findings, result.worker_pid, result.elapsed_ms

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
