# CLI Application

Python CLI for source extraction, detector execution, and batched output delivery.

## Setup

```bash
cd /unstructured/apps/cli
uv sync
# Optional if you want an activated shell instead of `uv run ...`:
source .venv/bin/activate
```

Optional detector groups:

```bash
uv sync --group detectors
# or specific groups: --group secrets --group pii --group threat ...
```

### System dependency: LibreOffice

Legacy Office formats (`.doc`, `.xls`, `.ppt`) have no usable pure-Python parser,
so `src/utils/legacy_office.py` shells out to `soffice --headless --convert-to
docx|xlsx|pptx` and feeds the result through the normal OOXML extractors. Without
it those files scan as *"no content available"* — a silent coverage gap, not an
error.

- **Kubernetes**: already installed in the CLI image (`libreoffice-*-nogui`).
- **Desktop / local dev**: install it yourself — `brew install --cask libreoffice`
  (macOS), `apt install libreoffice-writer libreoffice-calc libreoffice-impress`
  (Debian/Ubuntu). The CLI checks `PATH` first, then the standard macOS, Windows,
  and Linux-tarball install locations.
- **Non-standard install**: point at the binary with `CLASSIFYRE_SOFFICE_PATH`.

`tests/utils/test_legacy_office.py` skips its round-trip tests when no LibreOffice
is found, so a green local run does not prove this path works.

## Command Syntax

Use the thin wrapper:

```bash
uv run main.py <command> <recipe.json> [options]
```

Or direct module entrypoint:

```bash
uv run python -m src.main <command> <recipe.json> [options]
```

Commands:

- `test` - test source connection.
- `discover` - discover source resources.
- `extract` - run extraction and emit batched output.
- `evaluate-file` - internally evaluate detectors against one local file.

## Extract Output Model

Extraction always emits in batches.
Recipes do not contain `output` configuration; output is controlled by CLI flags and environment variables.

Output types:

- `console` - emits NDJSON envelopes to stdout.
- `file` - appends NDJSON envelopes to a file.
- `rest` - pushes batches to API endpoints and finalizes run.

Default behavior:

- If `source_id` is present (`--source-id` or `SOURCE_ID` env), default output is `rest`.
- Otherwise default output is `console`.
- Default batch size is `20`.

## CLI Options

Global/common:

- `--debug` - enable debug logging.
- `--detectors-file <path>` - file evaluation only.

Extract output options:

- `--output-type rest|file|console`
- `--output-batch-size <int>`
- `--output-rest-url <url>` (complete API base, including the namespace path)
- `--output-file-path <path>`
- `--source-id <uuid>`
- `--runner-id <uuid>`
- `--managed-runner` (REST only; runner lifecycle managed by API orchestrator)

Environment fallbacks:

- `SOURCE_ID`, `RUNNER_ID`
- `CLASSIFYRE_OUTPUT_TYPE`, `CLASSIFYRE_OUTPUT_BATCH_SIZE`
- `CLASSIFYRE_OUTPUT_REST_URL`, `CLASSIFYRE_OUTPUT_REST_TIMEOUT_SEC`
- `CLASSIFYRE_OUTPUT_FILE_PATH`
- `API_URL` (fallback base URL for REST output)

## Practical Examples

### 1) Console output (quick local test)

```bash
uv run main.py extract ./wordpress-recipe.json --output-type console --output-batch-size 1
```

You will see NDJSON lines like:

- `{"event":"batch", ...}`
- `{"event":"finish", ...}`

### 2) File output

```bash
uv run main.py extract ./wordpress-recipe.json \
  --output-type file \
  --output-file-path /tmp/classifyre-assets.ndjson \
  --output-batch-size 20
```

### 3) REST output (manual CLI to backend)

```bash
uv run main.py extract ./wordpress-recipe.json \
  --output-type rest \
  --source-id <source_uuid>
```

Notes:

- `--runner-id` optional for manual runs. If omitted, CLI creates external runner automatically.
- `--output-rest-url` is optional. If omitted, CLI uses `CLASSIFYRE_OUTPUT_REST_URL`, then `API_URL`, then `http://localhost:8000`. In a namespaced deployment, pass the complete base (for example `https://api.example/ns-id`); the CLI appends all asset, finding, runner, and source endpoints beneath it.
- `--managed-runner` should be used only for API-orchestrated runs where runner already exists.

### 4) REST output with explicit runner (managed/orchestrated style)

```bash
uv run main.py extract ./wordpress-recipe.json \
  --output-type rest \
  --source-id <source_uuid> \
  --runner-id <runner_uuid> \
  --managed-runner
```

### 5) Full extract command with all output flags

```bash
uv run main.py extract ./wordpress-recipe.json \
  --output-type rest \
  --output-batch-size 20 \
  --output-rest-url http://localhost:8000 \
  --output-file-path /tmp/classifyre-assets.ndjson \
  --source-id <source_uuid> \
  --runner-id <runner_uuid> \
  --managed-runner
```

Use `--output-file-path` only when `--output-type file`.

## Dev Scripts

- `bun run dev` - run CLI quickly.
- `bun run lint` - ruff format/check.
- `bun run check-types` - mypy.
- `bun run test` - pytest suite.
