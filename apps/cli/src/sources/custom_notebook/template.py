"""The notebook file: its starter template, its required frame, and validation.

A custom source notebook is a plain marimo file. What makes it usable as a
connector is that ``check``/``discover``/``fetch`` are *top-level* definitions:
marimo serializes a cell that contains only a function definition (and refers
only to symbols from the ``with app.setup:`` block) as a real module-level
``def`` decorated with ``@app.function``. Those are importable with a plain
``from notebook import discover`` and, crucially, importing the module does not
execute the notebook's other cells - so a production scan never runs the
author's scratch work.

Two consequences shape this module:

* The setup block and the PEP 723 header are load-bearing, not decoration. The
  header is what lets uv build the notebook's sandbox venv, and its
  ``[tool.uv.sources]`` entry is the only reason ``import classifyre`` resolves
  inside that venv. Both are rewritten on every materialization, because the
  SDK path differs between a Kubernetes image and a packaged desktop app, and a
  notebook saved in one must still run in the other.
* Validation is a pure AST parse. Deciding whether a notebook is well-formed
  must never execute it.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass

#: Functions a notebook must define at the top level to be a usable connector.
REQUIRED_FUNCTIONS = ("discover", "fetch")
#: Defined by the template and called by "Test connection", but a notebook that
#: drops it simply has no connection test rather than being invalid.
OPTIONAL_FUNCTIONS = ("check",)

NOTEBOOK_FILENAME = "notebook.py"

_HEADER_RE = re.compile(r"^# /// script\n(?:#.*\n)*?# ///\n", re.MULTILINE)


class NotebookValidationError(ValueError):
    """Raised when a notebook cannot serve as a connector."""


@dataclass(frozen=True)
class NotebookInfo:
    """What a static read of the notebook could determine."""

    functions: frozenset[str]
    dependencies: tuple[str, ...]

    @property
    def is_usable(self) -> bool:
        return all(name in self.functions for name in REQUIRED_FUNCTIONS)


def render_header(sdk_path: str, dependencies: tuple[str, ...] = ()) -> str:
    """Render the PEP 723 block that defines the notebook's sandbox venv.

    Two entries are always present and are not the author's to remove.
    ``marimo`` because the notebook's first statement is ``import marimo``, and
    ``classifyre-sdk`` because the setup cell imports it - and the SDK is staged
    inside the CLI image and the desktop bundle rather than published to an
    index, so it is resolved by path rather than by version.
    """
    pinned = {"classifyre-sdk", "marimo"}
    extra = [dep for dep in dependencies if _dependency_name(dep) not in pinned]
    lines = [
        "# /// script",
        '# requires-python = ">=3.12"',
        "# dependencies = [",
        '#     "classifyre-sdk",',
        '#     "marimo>=0.24.0",',
    ]
    lines += [f'#     "{dep}",' for dep in extra]
    lines += [
        "# ]",
        "#",
        "# [tool.uv.sources]",
        f'# classifyre-sdk = {{ path = "{sdk_path}" }}',
        "# ///",
    ]
    return "\n".join(lines) + "\n"


def _dependency_name(spec: str) -> str:
    return re.split(r"[<>=!~\[ ]", spec.strip(), maxsplit=1)[0].strip().lower()


def parse_dependencies(source: str) -> tuple[str, ...]:
    """Read the dependency list out of an existing PEP 723 header.

    Best-effort and deliberately forgiving: marimo's package installer rewrites
    this block, and a header we cannot parse should cost the author their extra
    packages on the next materialization, not fail their scan.
    """
    match = _HEADER_RE.search(source)
    if not match:
        return ()
    # Drop the `# /// script` / `# ///` fence lines; only what sits between them
    # is TOML.
    lines = match.group(0).splitlines()[1:-1]
    body = "\n".join(line.lstrip("#").strip() for line in lines)
    try:
        import tomllib

        parsed = tomllib.loads(body)
    except Exception:
        return ()
    deps = parsed.get("dependencies")
    if not isinstance(deps, list):
        return ()
    return tuple(str(dep) for dep in deps if isinstance(dep, str))


def apply_header(source: str, sdk_path: str) -> str:
    """Replace (or insert) the PEP 723 header, preserving declared dependencies."""
    header = render_header(sdk_path, parse_dependencies(source))
    if _HEADER_RE.search(source):
        return _HEADER_RE.sub(header, source, count=1)
    return header + source


def inspect(source: str) -> NotebookInfo:
    """Statically determine which interface functions a notebook defines.

    Counts both a bare ``def`` and a decorated one, since marimo only adds
    ``@app.function`` once the cell qualifies as a top-level definition, and a
    notebook can be written by hand before it has ever been opened in marimo.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise NotebookValidationError(
            f"Notebook is not valid Python (line {exc.lineno}): {exc.msg}"
        ) from exc

    found = {
        node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    return NotebookInfo(functions=frozenset(found), dependencies=parse_dependencies(source))


def validate(source: str) -> NotebookInfo:
    """Raise unless the notebook defines the required top-level functions."""
    info = inspect(source)
    missing = [name for name in REQUIRED_FUNCTIONS if name not in info.functions]
    if missing:
        raise NotebookValidationError(
            f"Notebook must define {' and '.join(missing)} at the top level. "
            "In marimo, put each one alone in its own cell and import everything "
            "it needs from the setup cell - that is what makes marimo save it as "
            "a top-level function rather than a cell body."
        )
    return info


STARTER_NOTEBOOK = '''import marimo

app = marimo.App(width="medium")

with app.setup:
    # Imports for the connector functions below. marimo guarantees this block
    # runs before anything else, and only symbols defined here (or other
    # top-level definitions) may be used by @app.function cells.
    from classifyre import AssetContent, AssetRef, context

    ctx = context()


@app.function
def check(ctx) -> None:
    """Verify the source is reachable. Raise to fail "Test connection"."""
    if not ctx.variables:
        raise RuntimeError("Add at least one variable to this source first.")


@app.function
def discover(ctx) -> list[AssetRef]:
    """List what exists, without downloading it.

    Runs once at the start of a scan, over the whole corpus, so keep it to
    listing calls. `id` must stay stable for the same underlying object across
    runs - it is what ties an asset to its history.
    """
    return [
        AssetRef(
            id="example-1",
            name="Example record",
            url="https://example.internal/records/1",
            kind="record",
        )
    ]


@app.function
def fetch(ctx, ref: AssetRef) -> AssetContent:
    """Return the content for one ref. Called once per asset, in parallel."""
    return AssetContent(text=f"Content for {ref.id}")


@app.cell
def _():
    # Scratch cells like this one are for developing against the real source.
    # They run while you are editing and are ignored during a scan.
    refs = discover(ctx)
    refs
    return


if __name__ == "__main__":
    app.run()
'''
