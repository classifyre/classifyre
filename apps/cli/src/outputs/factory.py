from __future__ import annotations

import argparse
import os
from typing import Any, cast

from .base import OutputRuntimeContext, OutputSettings, OutputSink, OutputType
from .console import ConsoleOutputSink
from .file import FileOutputSink
from .rest import RestOutputSink


def _normalize_output_type(value: str) -> OutputType:
    normalized = value.strip().lower()
    if normalized not in {"rest", "file", "console"}:
        raise ValueError("output type must be one of: rest, file, console")
    return cast(OutputType, normalized)


def _parse_int(value: Any, fallback: int) -> int:
    if value is None:
        return fallback

    if isinstance(value, bool):
        return fallback

    if isinstance(value, int):
        return value

    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return fallback


def _coalesce(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def resolve_output_settings(
    args: argparse.Namespace,
) -> OutputSettings:
    env_type = os.environ.get("CLASSIFYRE_OUTPUT_TYPE")
    env_batch_size = os.environ.get("CLASSIFYRE_OUTPUT_BATCH_SIZE")
    env_rest_url = os.environ.get("CLASSIFYRE_OUTPUT_REST_URL")
    env_rest_timeout = os.environ.get("CLASSIFYRE_OUTPUT_REST_TIMEOUT_SEC")
    env_file_path = os.environ.get("CLASSIFYRE_OUTPUT_FILE_PATH")
    env_api_url = os.environ.get("API_URL")

    source_id_value = _coalesce(
        getattr(args, "source_id", None),
        os.environ.get("SOURCE_ID"),
    )
    runner_id_value = _coalesce(
        getattr(args, "runner_id", None),
        os.environ.get("RUNNER_ID"),
    )
    source_id = str(source_id_value) if source_id_value is not None else None
    runner_id = str(runner_id_value) if runner_id_value is not None else None
    default_output_type: OutputType = "rest" if source_id else "console"

    output_type = _normalize_output_type(
        str(
            _coalesce(
                getattr(args, "output_type", None),
                env_type,
                default_output_type,
            )
        )
    )
    batch_size = _parse_int(
        _coalesce(
            getattr(args, "output_batch_size", None),
            env_batch_size,
            20,
        ),
        fallback=20,
    )
    if batch_size < 1:
        raise ValueError("output_batch_size must be >= 1")

    managed_runner = bool(getattr(args, "managed_runner", False))
    if managed_runner and output_type != "rest":
        raise ValueError("--managed-runner can only be used with output type 'rest'")

    rest_url_value = _coalesce(
        getattr(args, "output_rest_url", None),
        env_rest_url,
        env_api_url,
    )
    rest_url = str(rest_url_value) if rest_url_value is not None else None

    rest_timeout_sec = _parse_int(_coalesce(env_rest_timeout, 30), 30)
    if rest_timeout_sec < 1:
        rest_timeout_sec = 30

    file_path_value = _coalesce(
        getattr(args, "output_file_path", None),
        env_file_path,
    )
    file_path = str(file_path_value) if file_path_value is not None else None

    if output_type == "rest":
        if not source_id:
            raise ValueError("REST output requires source_id (--source-id or SOURCE_ID)")
        if not rest_url:
            rest_url = "http://localhost:8000"
        if managed_runner and not runner_id:
            raise ValueError("managed REST output requires runner_id")
    elif output_type == "file" and not file_path:
        raise ValueError(
            "file output requires output_file_path (--output-file-path or CLASSIFYRE_OUTPUT_FILE_PATH)"
        )

    return OutputSettings(
        output_type=output_type,
        batch_size=batch_size,
        source_id=source_id,
        runner_id=runner_id,
        managed_runner=managed_runner,
        rest_url=rest_url,
        rest_timeout_sec=rest_timeout_sec,
        file_path=file_path,
    )


def create_output_sink(args: argparse.Namespace) -> OutputSink:
    settings = resolve_output_settings(args)
    context = OutputRuntimeContext(
        source_id=settings.source_id,
        runner_id=settings.runner_id,
        managed_runner=settings.managed_runner,
        batch_size=settings.batch_size,
    )

    if settings.output_type == "rest":
        if not settings.rest_url:
            raise ValueError("rest_url must be provided for REST output")
        return RestOutputSink(
            context,
            base_url=settings.rest_url,
            timeout_sec=settings.rest_timeout_sec,
        )

    if settings.output_type == "file":
        if not settings.file_path:
            raise ValueError("file_path must be provided for file output")
        return FileOutputSink(context, file_path=settings.file_path)

    return ConsoleOutputSink(context)
