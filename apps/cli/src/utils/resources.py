"""Cgroup-aware CPU and memory introspection.

Shared by the detector worker pool (to size the process pool) and the
transcription pipeline (to select the right Whisper model at runtime).
"""

from __future__ import annotations

import os


def get_effective_cpu_count() -> int:
    """Return usable CPUs, respecting cgroup limits (K8s / Docker).

    ``os.cpu_count()`` returns the *host* count, which is usually much larger
    than the container's CPU quota.  This reads cgroup v2 / v1 to get the
    actual allocation.
    """
    try:
        data = open("/sys/fs/cgroup/cpu.max").read().strip()
        quota_str, period_str = data.split()
        if quota_str != "max":
            cpus = int(quota_str) / int(period_str)
            if cpus >= 0.5:
                return max(1, int(cpus))
    except (FileNotFoundError, OSError, ValueError):
        pass

    try:
        quota = int(open("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read().strip())
        period = int(open("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read().strip())
        if quota > 0 and period > 0:
            cpus = quota / period
            if cpus >= 0.5:
                return max(1, int(cpus))
    except (FileNotFoundError, OSError, ValueError):
        pass

    return os.cpu_count() or 4


def get_effective_memory_mb() -> int:
    """Return usable memory in MB, respecting cgroup limits (K8s / Docker)."""
    try:
        mem_bytes = int(open("/sys/fs/cgroup/memory.max").read().strip())
        if mem_bytes < 2**50:
            return max(256, mem_bytes // (1024 * 1024))
    except (FileNotFoundError, OSError, ValueError):
        pass

    try:
        mem_bytes = int(open("/sys/fs/cgroup/memory/memory.limit_in_bytes").read().strip())
        if mem_bytes < 2**50:
            return max(256, mem_bytes // (1024 * 1024))
    except (FileNotFoundError, OSError, ValueError):
        pass

    try:
        for line in open("/proc/meminfo"):
            if line.startswith("MemTotal:"):
                return max(256, int(line.split()[1]) // 1024)
    except (FileNotFoundError, OSError, ValueError):
        pass

    return 4096
