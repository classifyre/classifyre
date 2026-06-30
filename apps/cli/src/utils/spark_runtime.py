"""Operational runtime configuration for Spark-backed sources.

These are infrastructure controls (cluster master, JAR coordinates, memory),
deliberately driven by environment variables rather than per-source recipe fields
so users configure connection/scope while operators control execution.

Environment variables:
    SPARK_MASTER          Spark master URL (default ``local[*]``); ignored when a
                          source uses a Spark Connect / remote endpoint.
    SPARK_DRIVER_MEMORY   e.g. ``2g``
    SPARK_EXECUTOR_MEMORY e.g. ``4g``
    SPARK_JARS_PACKAGES   Override Maven coordinates for format runtime JARs
                          (Delta/Hudi); falls back to each source's default.
    SPARK_MAVEN_REPO      Additional Maven repository for JAR resolution.
"""

from __future__ import annotations

import os
from typing import Any


def apply_runtime_config(
    builder: Any,
    *,
    master: str | None = None,
    jars_packages: str | None = None,
    extra_conf: dict[str, str] | None = None,
) -> Any:
    """Apply env-driven runtime config + source-specific conf to a SparkSession builder.

    ``master`` overrides the cluster master (e.g. a source-supplied ``spark://``
    URL); otherwise ``SPARK_MASTER`` is used (default ``local[*]``).
    ``jars_packages`` is the source's default Maven coordinates; ``SPARK_JARS_PACKAGES``
    overrides it when set. Returns the (mutated) builder for chaining.
    """
    builder = builder.master(master or os.environ.get("SPARK_MASTER", "local[*]"))

    driver_memory = os.environ.get("SPARK_DRIVER_MEMORY")
    if driver_memory:
        builder = builder.config("spark.driver.memory", driver_memory)
    executor_memory = os.environ.get("SPARK_EXECUTOR_MEMORY")
    if executor_memory:
        builder = builder.config("spark.executor.memory", executor_memory)

    packages = os.environ.get("SPARK_JARS_PACKAGES") or jars_packages
    if packages:
        builder = builder.config("spark.jars.packages", packages)
    repo = os.environ.get("SPARK_MAVEN_REPO")
    if repo:
        builder = builder.config("spark.jars.repositories", repo)

    for key, value in (extra_conf or {}).items():
        if value is not None:
            builder = builder.config(key, value)
    return builder
