"""The editor's SDK completions must match the SDK.

A completion list that has drifted is worse than none: it offers an argument
that no longer exists and hides one that does. The file is generated, and this
fails the moment the checked-in copy stops matching what the generator would
produce now -- so adding a `ctx` method is a one-command change, not a
remembered chore.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

CLI_ROOT = Path(__file__).resolve().parents[1]
GENERATOR = CLI_ROOT / "scripts" / "generate_sdk_completions.py"


def _generator():
    spec = importlib.util.spec_from_file_location("generate_sdk_completions", GENERATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_checked_in_completions_match_the_sdk() -> None:
    module = _generator()
    on_disk = json.loads(module.OUTPUT_PATH.read_text(encoding="utf-8"))
    assert on_disk == module.build(), (
        "notebook_completions.json is stale. Regenerate it with:\n"
        "  cd apps/cli && uv run python scripts/generate_sdk_completions.py"
    )


def test_completions_cover_the_context_surface() -> None:
    from src.notebook.sdk import Context

    module = _generator()
    offered = {member["label"] for member in module.build()["objects"]["ctx"]["members"]}
    public = {name for name in vars(Context) if not name.startswith("_")}
    # Runtime-only members are excluded on purpose; everything else an author
    # can reach must be offered.
    expected = public - module.RUNTIME_ONLY_MEMBERS
    assert expected <= offered, f"not offered in the editor: {sorted(expected - offered)}"


def test_runtime_only_members_are_not_offered_to_authors() -> None:
    module = _generator()
    offered = {member["label"] for member in module.build()["objects"]["ctx"]["members"]}
    assert not (offered & module.RUNTIME_ONLY_MEMBERS)


def test_the_offset_hand_off_is_discoverable() -> None:
    # Reading ctx.offset changes who applies the window, so the editor has to
    # surface it -- an author will not guess it exists.
    module = _generator()
    members = {m["label"]: m for m in module.build()["objects"]["ctx"]["members"]}
    assert "offset" in members
    assert "responsibility" in members["offset"]["documentation"].lower()


def test_completions_cover_every_asset_field() -> None:
    from src.notebook.sdk import Asset

    module = _generator()
    offered = {field["label"] for field in module.build()["classes"]["Asset"]["fields"]}
    assert offered == set(Asset.__annotations__)


def test_required_fields_are_marked_as_such() -> None:
    module = _generator()
    fields = {f["label"]: f for f in module.build()["classes"]["Asset"]["fields"]}
    # `id` is the one field an author must supply; everything else has a default.
    assert fields["id"]["required"] is True
    assert fields["name"]["required"] is False


def test_method_snippets_place_the_cursor_in_the_first_argument() -> None:
    module = _generator()
    members = {m["label"]: m for m in module.build()["objects"]["ctx"]["members"]}
    assert members["secret"]["insertText"] == "secret(${1:name})"
    # A no-argument property is inserted plainly, with no call parentheses.
    assert members["strategy"]["insertText"] == "strategy"
