"""Secrets must never reach logs, error messages, or stored run errors.

A recipe validation failure used to dump the whole recipe (including the
``masked`` credential bag) into the log, and scan errors interpolated driver
exceptions verbatim. These tests pin the safe behavior.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import Any

import pytest

from src.main import _safe_error_copy, _safe_text
from src.notebook import redact as notebook_redact
from src.pipeline.detector_pipeline import DetectorPipeline
from src.sources.custom.source import CustomSource
from src.utils.redaction import (
    PLACEHOLDER,
    Redactor,
    redact_generic,
    redact_with_recipe,
    sanitize_for_logging,
    short_id_for_log,
)
from src.utils.validation import RecipeValidationError, validate_input

SECRET = "SUPER-SECRET-API-KEY-12345"
DB_PASSWORD = "db-pw-9x8z-secret"


def _custom_recipe(**overrides: Any) -> dict[str, Any]:
    recipe: dict[str, Any] = {
        "type": "CUSTOM",
        "required": {
            "notebook": {
                "revision": 1,
                "cells": [{"id": "nb", "type": "code", "source": "x"}],
            }
        },
        "masked": {"secrets": {"api_token": SECRET}},
        "optional": {"variables": {"api_base": "https://api.example.com"}},
        "sampling": {"strategy": "ALL", "rows_per_page": 100},
    }
    recipe.update(overrides)
    return recipe


def test_recipe_validation_failure_hides_masked_secrets() -> None:
    recipe = _custom_recipe(sampling={"strategy": "NOPE", "rows_per_page": 100})
    with pytest.raises(RecipeValidationError) as exc_info:
        validate_input(recipe, "custom")
    message = str(exc_info.value)
    assert SECRET not in message
    assert "masked" not in message or "hidden" in message


def test_recipe_validation_failure_hides_short_secrets() -> None:
    # A two-character secret is below the value redactor's minimum length,
    # so only structural hiding (never rendering the masked bag) protects it.
    recipe = _custom_recipe()
    recipe["masked"] = {"secrets": {"pin": "12"}}
    recipe["sampling"] = {"strategy": "NOPE", "rows_per_page": 100}
    with pytest.raises(RecipeValidationError) as exc_info:
        validate_input(recipe, "custom")
    message = str(exc_info.value)
    assert '"pin"' not in message
    assert "secrets': {'pin'" not in message


def test_sanitize_for_logging_hides_masked_structurally() -> None:
    recipe = _custom_recipe()
    recipe["masked"] = {"secrets": {"pin": "12"}}
    cleaned = sanitize_for_logging(recipe, Redactor.from_recipe(recipe))
    assert cleaned["masked"] == {"secrets": {"pin": PLACEHOLDER}}
    # Non-secret config stays readable for debugging.
    assert cleaned["sampling"] == {"strategy": "ALL", "rows_per_page": 100}


def test_redact_generic_hides_url_passwords_and_assignments() -> None:
    assert (
        redact_generic(f"postgres://analyst:{DB_PASSWORD}@db:5432/app")
        == f"postgres://analyst:{PLACEHOLDER}@db:5432/app"
    )
    assert redact_generic(f"password={DB_PASSWORD}") == f"password={PLACEHOLDER}"
    assert redact_generic(f"Bearer {SECRET}") == f"Bearer {PLACEHOLDER}"


def test_safe_text_hides_known_recipe_secrets() -> None:
    recipe = _custom_recipe()
    redactor = Redactor.from_recipe(recipe)
    assert _safe_text(f"connection failed with {SECRET}", redactor) != (
        f"connection failed with {SECRET}"
    )
    assert SECRET not in _safe_text(f"connection failed with {SECRET}", redactor)


def test_safe_error_copy_preserves_type_and_hides_secrets() -> None:
    recipe = _custom_recipe()
    redactor = Redactor.from_recipe(recipe)
    original = ConnectionError(f"could not connect with password {SECRET}")
    clone = _safe_error_copy(original, redactor)
    assert type(clone).__name__ == "ConnectionError"
    assert SECRET not in str(clone)


def test_custom_source_parent_errors_hide_secrets() -> None:
    recipe = _custom_recipe()
    source = CustomSource(dict(recipe))
    try:
        assert SECRET not in source._safe(f"notebook said {SECRET}")
        assert source._safe(f"notebook said {SECRET}").endswith(PLACEHOLDER)
    finally:
        source.cleanup()


def test_redact_with_recipe_covers_values_and_patterns() -> None:
    recipe = _custom_recipe()
    assert SECRET not in redact_with_recipe(f"key {SECRET} here", recipe)
    assert DB_PASSWORD not in redact_with_recipe(f"postgres://u:{DB_PASSWORD}@h/db", recipe)


def test_notebook_redact_reexports_the_canonical_helpers() -> None:
    # The child runtime keeps importing from notebook.redact; both paths
    # must stay the same objects.
    assert notebook_redact.Redactor is Redactor
    assert notebook_redact.redact_generic is redact_generic
    assert notebook_redact.sanitize_for_logging is sanitize_for_logging
    assert notebook_redact.PLACEHOLDER == PLACEHOLDER


def _reversible_blob(raw_id: str) -> str:
    # Same envelope as utils.hashing.hash_id: reversible base64 over the id.
    return base64.urlsafe_b64encode(f"custom_#_{raw_id}".encode()).decode().rstrip("=")


def test_encoded_secret_in_reversible_hash_is_hidden() -> None:
    # A notebook that builds asset ids from secrets leaks the secret
    # *encoded* in the hash: plain substring matching never sees it.
    secret = "7190272603554-MM-live-credential-99"
    blob = _reversible_blob(f"doc-9_{secret}")
    assert secret not in blob
    line = f"trying candidates ['https://api.example.com/ws', '{blob}']"
    cleaned = Redactor([secret]).redact(line)
    assert blob not in cleaned
    assert secret not in cleaned
    assert "https://api.example.com/ws" in cleaned


def test_benign_reversible_hash_survives_redaction() -> None:
    blob = _reversible_blob("rec-1")
    line = f"fetch_text_pages({blob}): fetch_content_bytes returned None"
    assert Redactor(["unrelated-secret-value"]).redact(line) == line


def test_short_id_for_log_truncates_opaque_blobs() -> None:
    redactor = Redactor([])
    short_url = "https://api.example.com/records/9"
    assert short_id_for_log(short_url, redactor) == short_url
    long_blob = _reversible_blob("x" * 200)
    assert len(long_blob) > 120
    shortened = short_id_for_log(long_blob, redactor)
    assert long_blob not in shortened
    assert "omitted" in shortened
    # The head still identifies the document.
    assert shortened.startswith(long_blob[:120])


def test_short_id_for_log_redacts_known_values_first() -> None:
    secret = "SUPER-SECRET-API-KEY-12345"
    redactor = Redactor([secret])
    assert short_id_for_log(f"user:{secret}@host", redactor) != (f"user:{secret}@host")
    assert secret not in short_id_for_log(f"user:{secret}@host", redactor)


class _StubContentSource:
    """Minimal source shape for driving content iteration in tests."""

    def __init__(self, recipe: dict[str, Any]) -> None:
        self.recipe = recipe

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        _ = asset_id
        return
        yield ("", "")

    async def fetch_content_bytes(self, asset_id: str) -> tuple[str, str] | None:
        _ = asset_id
        return None


async def _drain(gen: AsyncGenerator[str, None]) -> None:
    async for _ in gen:
        pass


def test_pipeline_candidate_log_hides_secret_bearing_ids(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Production shape: the notebook built the asset id from a secret, the
    # reversible hash carries it encoded, and the pipeline logged both
    # candidates verbatim at INFO.
    secret = "7190272603554-MM-live-credential-99"
    blob = _reversible_blob(f"doc-9_{secret}")
    recipe = {"type": "CUSTOM", "masked": {"secrets": {"api_token": secret}}}
    pipeline = DetectorPipeline(
        detectors=[],
        source=_StubContentSource(recipe),
        runner_id="run-1",  # type: ignore[arg-type]
    )
    asset = SimpleNamespace(external_url="https://api.example.com/ws", hash=blob, name="Doc 9")
    with caplog.at_level(logging.INFO, logger="src.pipeline.detector_pipeline"):
        asyncio.run(_drain(pipeline._iter_text_content_pages(asset)))  # type: ignore[arg-type]
    assert secret not in caplog.text
    assert blob not in caplog.text
    # Still actionable: which document and how many candidates.
    assert "Doc 9" in caplog.text
    assert "candidate" in caplog.text
