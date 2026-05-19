import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any, cast

from .outputs import create_output_sink
from .sources import get_source, list_available_sources
from .utils.validation import validate_input, validate_test_connection

logger = logging.getLogger(__name__)
_SURROGATE_RE = re.compile(r"[\ud800-\udfff]")


_TIMEOUT_PHRASES = ("timed out", "timeout", "connection reset", "errno 110", "connection refused")
_TIMEOUT_MYSQL_CODES = {2003, 2006, 2013}


def _is_timeout_error(exc: BaseException) -> bool:
    """Return True when exc represents a connection/read timeout or unreachable host."""
    exc_str = str(exc).lower()
    if any(phrase in exc_str for phrase in _TIMEOUT_PHRASES):
        return True
    if "timeout" in type(exc).__name__.lower():
        return True
    args = getattr(exc, "args", ())
    if args and isinstance(args[0], int) and args[0] in _TIMEOUT_MYSQL_CODES:
        return True
    return False


def _sanitize_for_json(value: Any) -> Any:
    """Recursively replace isolated surrogate code points before JSON encoding."""
    if isinstance(value, str):
        return _SURROGATE_RE.sub("\ufffd", value)
    if isinstance(value, list):
        return [_sanitize_for_json(item) for item in value]
    if isinstance(value, dict):
        return {key: _sanitize_for_json(item) for key, item in value.items()}
    return value


def setup_logging() -> None:
    """Configure the logging facility."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s:%(name)s: %(message)s",
        stream=sys.stderr,
    )


def load_local_env() -> None:
    """
    Load KEY=VALUE pairs from .env in the current working directory.
    Existing process environment values take precedence.
    """
    env_path = Path(".env")
    if not env_path.exists():
        return

    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue
            cleaned = value.strip().strip('"').strip("'")
            os.environ[key] = cleaned
    except Exception as exc:
        logger.warning("Failed to load .env file: %s", exc)


def load_recipe(recipe_path: str) -> dict[str, Any]:
    path = Path(recipe_path)
    if not path.exists():
        logger.error("Recipe file not found at %s", recipe_path)
        sys.exit(1)

    with path.open("r", encoding="utf-8") as f:
        try:
            data = json.load(f)
            if not isinstance(data, dict):
                logger.error("Recipe JSON must be an object at top level")
                sys.exit(1)
            return cast(dict[str, Any], data)
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON in recipe file: %s", e)
            sys.exit(1)


def _compute_findings_counts(
    findings: list[Any],
) -> tuple[int, dict[str, int], dict[str, dict[str, int]]]:
    """Return (total, by_severity, by_detector) counts from a findings list."""
    by_severity: dict[str, int] = {}
    by_detector: dict[str, dict[str, int]] = {}

    for f in findings:
        severity = str(getattr(f, "severity", None) or "UNKNOWN")
        detector = str(getattr(f, "detector_type", None) or "UNKNOWN")

        by_severity[severity] = by_severity.get(severity, 0) + 1

        entry = by_detector.setdefault(detector, {"total": 0})
        entry["total"] += 1
        entry[severity] = entry.get(severity, 0) + 1

    return len(findings), by_severity, by_detector


def _asset_to_payload(asset: Any) -> dict[str, Any]:
    if hasattr(asset, "model_dump"):
        payload = asset.model_dump(mode="json", exclude_none=True)
        if isinstance(payload, dict):
            return cast(dict[str, Any], payload)
        raise TypeError(f"model_dump() must return dict, got {type(payload)}")
    if isinstance(asset, dict):
        return cast(dict[str, Any], asset)
    raise TypeError(f"Unsupported asset payload type: {type(asset)}")


async def run_command_async(args: argparse.Namespace, recipe: dict[str, Any]) -> None:
    """Initialize the source and execute the specified command."""
    runner_id = args.runner_id or os.environ.get("RUNNER_ID") or "local-run"
    source_id = args.source_id or os.environ.get("SOURCE_ID")
    if source_id:
        os.environ["SOURCE_ID"] = source_id

    try:
        try:
            source = get_source(recipe, source_id=source_id, runner_id=runner_id)
        except ValueError as e:
            logger.error("Failed to initialize source: %s", e)
            sys.exit(1)

        try:
            if args.command == "test":
                result = source.test_connection()
                logger.info("Validating test connection output...")
                try:
                    validate_test_connection(result)
                    logger.info("Test connection output is valid")
                except Exception as validation_error:
                    logger.warning("Test connection output validation failed: %s", validation_error)

                print(json.dumps(result, indent=2))
                if result.get("status") == "FAILURE":
                    sys.exit(1)

            elif args.command == "discover":
                result = source.test_connection()
                if result.get("status") == "FAILURE":
                    logger.error("Aborting: Connection test failed: %s", result.get("message"))
                    sys.exit(1)

                logger.info("Discovering resources...")
                data = source.discover()
                print(json.dumps(data, indent=2))

            elif args.command == "extract":
                result = source.test_connection()
                if result.get("status") == "FAILURE":
                    msg = result.get("message", "")
                    logger.error("Aborting: Connection test failed: %s", msg)
                    sys.exit(1)

                logger.info("Starting extraction...")
                sink = create_output_sink(args)
                sink_started = False

                try:
                    await sink.start()
                    sink_started = True

                    from .pipeline.detector_pipeline import DetectorPipeline

                    pipeline = DetectorPipeline.from_recipe(
                        recipe,
                        source,
                        runner_id,
                        max_concurrent_assets=args.detector_max_concurrent,
                    )
                    has_detectors = bool(pipeline.detectors)

                    # --- Phase 1: Discovery ---
                    source.set_discovery_only(True)
                    all_stubs: list[Any] = []
                    total_assets = 0
                    output_batch_count = 0

                    async for raw_batch in source.extract_raw():
                        if not raw_batch:
                            continue

                        batch_size = len(raw_batch)
                        total_assets += batch_size

                        stub_batch = [_asset_to_payload(asset) for asset in raw_batch]
                        for stub in stub_batch:
                            stub["findings"] = []
                        await sink.emit_batch(stub_batch, skip_findings=True)
                        output_batch_count += 1

                        hashes = [s["hash"] for s in stub_batch if s.get("hash")]
                        if hasattr(sink, "register_discovered_assets") and hashes:
                            await sink.register_discovered_assets(hashes)

                        all_stubs.extend(raw_batch)
                        logger.info(
                            "Discovered %s assets (total: %s)",
                            batch_size,
                            total_assets,
                        )

                    source.set_discovery_only(False)
                    logger.info("Phase 1 complete: %d assets discovered", total_assets)

                    # --- Phase 2: Processing ---
                    if has_detectors and all_stubs:
                        import asyncio as _asyncio

                        workers = args.processing_workers
                        semaphore = _asyncio.Semaphore(workers)
                        processed_count = 0
                        error_count = 0

                        async def _process_one(asset: Any) -> None:
                            nonlocal processed_count, error_count
                            async with semaphore:
                                asset_hash = getattr(asset, "hash", None) or ""
                                try:
                                    if hasattr(sink, "update_asset_status"):
                                        await sink.update_asset_status(asset_hash, "PROCESSING")

                                    async def _on_findings_flushed(partial: list[Any]) -> None:
                                        # partial is the full accumulated findings list from the pipeline
                                        stub_payload = _asset_to_payload(asset)
                                        stub_payload["findings"] = [
                                            f.model_dump(mode="json", exclude_none=True)
                                            if hasattr(f, "model_dump")
                                            else f
                                            for f in partial
                                        ]
                                        await sink.emit_batch([stub_payload], skip_findings=False)
                                        if hasattr(sink, "update_asset_status"):
                                            f_total, f_by_sev, f_by_det = _compute_findings_counts(
                                                partial
                                            )
                                            await sink.update_asset_status(
                                                asset_hash,
                                                "PROCESSING",
                                                findings_total=f_total,
                                                findings_by_severity=f_by_sev,
                                                findings_by_detector=f_by_det,
                                            )

                                    result = await pipeline.process_single_asset(
                                        asset,
                                        on_findings_flushed=_on_findings_flushed,
                                        findings_flush_size=args.detector_flush_batch_size,
                                    )
                                    payload = _asset_to_payload(result)
                                    await sink.emit_batch([payload], skip_findings=False)

                                    if hasattr(sink, "update_asset_status"):
                                        f_total, f_by_sev, f_by_det = _compute_findings_counts(
                                            result.findings or []
                                        )
                                        await sink.update_asset_status(
                                            asset_hash,
                                            "PROCESSED",
                                            findings_total=f_total,
                                            findings_by_severity=f_by_sev,
                                            findings_by_detector=f_by_det,
                                        )

                                    source.evict_asset_cache(asset_hash)
                                    processed_count += 1
                                except Exception as exc:
                                    error_count += 1
                                    logger.error("Asset %s failed: %s", asset_hash, exc)
                                    if hasattr(sink, "update_asset_status"):
                                        try:
                                            error_msg = str(exc) or type(exc).__name__
                                            await sink.update_asset_status(
                                                asset_hash, "ERROR", error_msg
                                            )
                                        except Exception:
                                            pass

                        tasks = [_asyncio.create_task(_process_one(a)) for a in all_stubs]
                        await _asyncio.gather(*tasks, return_exceptions=True)
                        logger.info(
                            "Phase 2 complete: %d processed, %d errors",
                            processed_count,
                            error_count,
                        )
                    elif all_stubs and hasattr(sink, "update_asset_status"):
                        # No detectors configured: mark discovered assets as PROCESSED
                        import asyncio as _asyncio

                        async def _mark_processed(asset: Any) -> None:
                            asset_hash = getattr(asset, "hash", None) or ""
                            await sink.update_asset_status(
                                asset_hash, "PROCESSED", findings_total=0
                            )

                        tasks = [_asyncio.create_task(_mark_processed(a)) for a in all_stubs]
                        await _asyncio.gather(*tasks, return_exceptions=True)
                        logger.info(
                            "Phase 2 skipped (no detectors): %d assets marked processed",
                            len(all_stubs),
                        )

                    await sink.finish()
                    logger.info(
                        "Extraction completed: %s assets in %s batches",
                        total_assets,
                        output_batch_count,
                    )
                except Exception as extraction_error:
                    if _is_timeout_error(extraction_error):
                        logger.warning(
                            "Source timed out during extraction, partial results flushed: %s",
                            extraction_error,
                        )
                        await sink.finish()
                        return
                    if sink_started:
                        try:
                            await sink.fail(extraction_error)
                        except Exception as sink_error:
                            logger.error(
                                "Failed to mark sink failure: %s", sink_error, exc_info=True
                            )
                    raise

        except Exception as e:
            logger.debug("Traceback for %s failure:", args.command, exc_info=True)
            if _is_timeout_error(e):
                logger.warning("SCAN TIMED OUT (source unreachable): %s", e)
                return
            logger.error("SCAN FAILED: %s", e)
            sys.exit(1)
        finally:
            source.cleanup()
    except Exception as e:
        logger.debug("Traceback for fatal error:", exc_info=True)
        logger.error("FATAL: %s", e)
        sys.exit(1)


def run_command(args: argparse.Namespace, recipe: dict[str, Any]) -> None:
    """Wrapper to run async command."""
    import asyncio

    asyncio.run(run_command_async(args, recipe))


def run_train_command(args: argparse.Namespace) -> None:
    """Fine-tune detector models on labeled training examples.

    Reads pipeline_schema and examples from JSON files, runs GLiNER2 NER
    fine-tuning and/or SetFit classification training, saves artifacts to
    output_dir, and prints a JSON result to stdout for the API to consume.
    """
    import json
    from pathlib import Path

    from .detectors.custom.trainer import GLiNER2Trainer

    schema_path = Path(args.pipeline_schema)
    examples_path = Path(args.examples)
    output_dir = Path(args.output_dir)

    if not schema_path.exists():
        logger.error("Pipeline schema file not found: %s", schema_path)
        sys.exit(1)
    if not examples_path.exists():
        logger.error("Examples file not found: %s", examples_path)
        sys.exit(1)

    try:
        pipeline_schema: dict[str, Any] = json.loads(schema_path.read_text())
        examples_raw: list[dict[str, Any]] = json.loads(examples_path.read_text())
    except json.JSONDecodeError as e:
        logger.error("Invalid JSON in input files: %s", e)
        sys.exit(1)

    trainer = GLiNER2Trainer(pipeline_schema, examples_raw, output_dir)
    result = trainer.train()
    print(json.dumps(result.to_dict()))


def run_sandbox_command(args: argparse.Namespace) -> None:
    """Execute the sandbox command: parse file + run detectors."""
    from .sandbox import SandboxRunner

    file_path_str: str | None = args.recipe
    if not file_path_str:
        logger.error("sandbox command requires a file path as the first argument")
        sys.exit(1)

    file_path = Path(file_path_str)
    if not file_path.exists():
        logger.error("File not found: %s", file_path)
        sys.exit(1)

    detectors: list[dict[str, Any]] = []
    if args.detectors_file:
        detectors_path = Path(args.detectors_file)
        if not detectors_path.exists():
            logger.error("Detectors file not found: %s", detectors_path)
            sys.exit(1)
        try:
            with detectors_path.open("r", encoding="utf-8") as f:
                detectors = json.load(f)
            if not isinstance(detectors, list):
                logger.error("Detectors file must contain a JSON array")
                sys.exit(1)
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON in detectors file: %s", e)
            sys.exit(1)

    try:
        runner = SandboxRunner(detectors)
        parsed, findings = runner.run(file_path)
        if parsed.parse_error:
            logger.warning("File parse warning: %s", parsed.parse_error)
        output: dict[str, Any] = {
            "mime_type": parsed.mime_type,
            "findings": [f.model_dump(mode="json") for f in findings],
        }
        if parsed.parse_error:
            output["parse_error"] = parsed.parse_error
        print(json.dumps(_sanitize_for_json(output), ensure_ascii=False))
    except Exception as e:
        logger.error("Sandbox run failed: %s", e, exc_info=True)
        sys.exit(1)


def main() -> None:
    setup_logging()
    load_local_env()
    from .telemetry import init_telemetry

    init_telemetry()

    available_sources = list_available_sources()

    parser = argparse.ArgumentParser(description="Classifyre Metadata Extraction CLI")
    parser.add_argument(
        "command",
        choices=["test", "extract", "discover", "sandbox", "train"],
        help="Command to run",
    )
    parser.add_argument(
        "recipe",
        nargs="?",
        default=None,
        help="Path to recipe JSON (or file path for sandbox command)",
    )
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument(
        "--output-type",
        choices=["rest", "file", "console"],
        default=None,
        help="Output destination type for extract",
    )
    parser.add_argument(
        "--output-batch-size",
        type=int,
        default=None,
        help="Output batch size override (default: 20)",
    )
    parser.add_argument(
        "--output-rest-url",
        default=None,
        help=(
            "REST output base URL (defaults to CLASSIFYRE_OUTPUT_REST_URL, API_URL, "
            "or http://localhost:8000)"
        ),
    )
    parser.add_argument(
        "--output-file-path",
        default=None,
        help="File output path for NDJSON envelopes",
    )
    parser.add_argument("--source-id", default=None, help="Source UUID for REST output")
    parser.add_argument("--runner-id", default=None, help="Runner UUID for REST output")
    parser.add_argument(
        "--managed-runner",
        action="store_true",
        help="Managed mode for API-orchestrated REST runs",
    )
    parser.add_argument(
        "--detectors-file",
        default=None,
        help="Path to JSON file with detector configs (sandbox command only)",
    )
    # train-command arguments
    parser.add_argument(
        "--pipeline-schema",
        default=None,
        help="Path to pipeline schema JSON file (train command only)",
    )
    parser.add_argument(
        "--examples",
        default=None,
        help="Path to training examples JSON file (train command only)",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Directory to write trained model artifacts (train command only)",
    )
    parser.add_argument(
        "--detector-flush-batch-size",
        type=int,
        default=None,
        help="How many detector-processed assets to accumulate before pushing findings to the API (default: 5, env: CLASSIFYRE_DETECTOR_FLUSH_BATCH_SIZE)",
    )
    parser.add_argument(
        "--detector-max-concurrent",
        type=int,
        default=None,
        help="Max assets processed in parallel by the detector pipeline (default: 10, env: CLASSIFYRE_DETECTOR_MAX_CONCURRENT)",
    )
    parser.add_argument(
        "--processing-workers",
        type=int,
        default=None,
        help="Number of parallel asset-processing workers in Phase 2 (default: 2, env: CLASSIFYRE_PROCESSING_WORKERS)",
    )

    args = parser.parse_args()

    if args.detector_flush_batch_size is None:
        env_val = os.environ.get("CLASSIFYRE_DETECTOR_FLUSH_BATCH_SIZE")
        try:
            args.detector_flush_batch_size = int(env_val) if env_val else 5
        except ValueError:
            args.detector_flush_batch_size = 5
    args.detector_flush_batch_size = max(args.detector_flush_batch_size, 1)

    if args.detector_max_concurrent is None:
        env_val = os.environ.get("CLASSIFYRE_DETECTOR_MAX_CONCURRENT")
        try:
            args.detector_max_concurrent = int(env_val) if env_val else 10
        except ValueError:
            args.detector_max_concurrent = 10
    args.detector_max_concurrent = max(args.detector_max_concurrent, 1)

    if args.processing_workers is None:
        env_val = os.environ.get("CLASSIFYRE_PROCESSING_WORKERS")
        try:
            args.processing_workers = int(env_val) if env_val else 2
        except ValueError:
            args.processing_workers = 2
    args.processing_workers = max(args.processing_workers, 1)

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    if args.command == "sandbox":
        run_sandbox_command(args)
        return

    if args.command == "train":
        if not args.pipeline_schema or not args.examples or not args.output_dir:
            logger.error("train requires --pipeline-schema, --examples, and --output-dir")
            sys.exit(1)
        run_train_command(args)
        return

    if not args.recipe:
        logger.error("recipe argument is required for this command")
        sys.exit(1)

    recipe = load_recipe(args.recipe)

    source_type = recipe.get("type", "").lower()
    if not source_type:
        logger.error(
            "Recipe must have a 'type' field (e.g., 'WORDPRESS', 'SLACK', 'S3_COMPATIBLE_STORAGE')"
        )
        logger.info("Available source types: %s", ", ".join(available_sources))
        sys.exit(1)

    logger.info("Validating recipe for %s...", source_type)
    try:
        validate_input(recipe, source_type)
        logger.info("Recipe is valid")
    except Exception as e:
        logger.error("Recipe validation failed: %s", e)
        sys.exit(1)

    run_command(args, recipe)


if __name__ == "__main__":
    main()
