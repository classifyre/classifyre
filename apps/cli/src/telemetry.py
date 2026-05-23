"""
OpenTelemetry initialisation for ephemeral Kubernetes CLI jobs.

Key design points:
- BatchSpanProcessor with 2 s delay so spans export before the job finishes.
- Explicit force_flush() + SIGTERM handler — Python's default SIGTERM kills
  the process before atexit hooks run, which would silently drop spans.
- Graceful no-op when OTel packages are not installed or telemetry is disabled.

Opt-out: set TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1 in the environment.
Install: uv sync --group otel
"""

from __future__ import annotations

import atexit
import os
import signal
import sys
from functools import partial
from typing import Any


def is_telemetry_enabled() -> bool:
    if os.getenv("TELEMETRY_DISABLED") == "1":
        return False
    if os.getenv("DO_NOT_TRACK") == "1":
        return False
    if os.getenv("CLASSIFYRE_TELEMETRY", "true").lower() == "false":
        return False
    return True


def init_telemetry() -> Any:
    """
    Initialise the OTel SDK and return the TracerProvider.

    Returns a no-op provider when telemetry is disabled or the OTel SDK is
    not installed (the ``otel`` optional dependency group was not installed).
    """
    if not is_telemetry_enabled():
        return None

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        # OTel optional group not installed — run without telemetry.
        return None

    resource = Resource.create(
        {
            "service.name": os.getenv("OTEL_SERVICE_NAME", "classifyre-cli"),
            "service.version": os.getenv("SERVICE_VERSION", "0.0.0"),
            "deployment.environment.name": os.getenv(
                "DEPLOY_ENV", os.getenv("NODE_ENV", "production")
            ),
            "service.namespace": "classifyre",
            "service.instance.id": os.getenv("CLASSIFYRE_INSTANCE_ID", ""),
        }
    )

    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(),
            # Reduced delay so spans export before a short-lived job exits.
            schedule_delay_millis=2_000,
            max_queue_size=512,
            max_export_batch_size=256,
        )
    )
    trace.set_tracer_provider(provider)

    _shutdown_state: dict[str, bool] = {"called": False}

    def _shutdown(timeout_ms: int = 10_000) -> None:
        if _shutdown_state["called"]:
            return
        _shutdown_state["called"] = True
        provider.force_flush(timeout_millis=timeout_ms)
        provider.shutdown()

    def _handle_sigterm(signum: int, frame: Any) -> None:  # noqa: ARG001
        _shutdown(timeout_ms=8_000)
        sys.exit(143)

    atexit.register(_shutdown)
    signal.signal(signal.SIGTERM, partial(_handle_sigterm))

    return provider
