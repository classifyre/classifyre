# Classifyre New Source Onboarding

Use this checklist when adding a source type to avoid missing cross-package updates.

For implementation hardening patterns from DataHub connectors (config validators, plugin dependency isolation, output/test expectations), also read:

- `references/datahub-ingestion-patterns.md`

## Contents

- [1) Schema Layer](#1-schema-layer)
- [2) CLI Layer](#2-cli-layer)
- [3) API + DB Layer](#3-api--db-layer)
- [4) Web + UI Layer](#4-web--ui-layer)
- [5) Final Verification](#5-final-verification)
- [WordPress Reference Set](#wordpress-reference-set)

## 1) Schema Layer

Update `packages/schemas/src/schemas/all_input_sources.json`.

Required changes:
- Add the source literal to `definitions.AssetType.enum` (uppercase).
- Add source-specific config definitions for `*Required`, `*Masked`, and `*Optional`.
  - `*Required`: only mandatory ingestion fields.
  - `*Masked`: credentials/secrets (username/password/token/etc.).
  - `*Optional`: non-mandatory controls grouped by nested sections.
- Add `*Input` definition using `allOf` with `CoreInput` and top-level `required`, `masked`, `optional` keys.
- Add new `*Input` to top-level `oneOf`.

Update `packages/schemas/src/schemas/all_input_examples.json`.

Required changes:
- Add at least 2 examples for the new source.
- Include realistic minimal/full config variants in the canonical shape:
  - `type`
  - `required`
  - `masked`
  - `optional`
  - optional `detectors`

Update `packages/schemas/scripts/validate_examples.py`.

Required changes:
- Add `TYPE_TO_DEFINITION` mapping for the new type.

Validate:

```bash
cd packages/schemas
uv run python scripts/validate_examples.py
```

## 2) CLI Layer

Regenerate models after schema edits:

```bash
cd apps/cli
uv run python scripts/generate_models.py
```

Confirm new model exists in:
- `apps/cli/src/models/generated_input.py`

Implement source package:
- Add `apps/cli/src/sources/<source_name>/source.py`
- Add `apps/cli/src/sources/<source_name>/__init__.py`

Follow `BaseSource` contract from `apps/cli/src/sources/base.py`:
- `test_connection`
- `extract` (async generator of batches)
- `generate_hash_id`
- `abort`
- Optional `fetch_content`

Relationship mapping rule:
- Emit relationships as typed edges (`flow` / `references` / `contains` / `same_as` from `apps/cli/src/graph/edges.py`) through `self.add_edge(...)`. Only `flow` is lineage.
- Keep `SingleAssetScanResults.links` for plain references; do not repeat lineage upstreams there.
- Name anything another connector could point at with a URN (`_urn_authority()` on tabular sources), and register a new platform in both `apps/cli/src/utils/urn.py` and `apps/api/src/graph/urn.ts`.

Asset metadata rule:
- Emit every asset with `**self.metadata_fields("<asset_kind>", {...normalized metadata...})` (from `base.py`). This sets both `asset_kind` (display type) and the `metadata` JSONB dict, and validates against the `x-asset-metadata` catalog in `packages/schemas/src/schemas/all_input_sources.json` — strict (raises) under pytest, warns at runtime.
- Declare a `sources.<SOURCE_TYPE>.<asset_kind>` catalog entry for each kind before implementing, reusing shared `contentTypes` via `use`. For file/object bytes call `extract_file_metadata(...)` from `apps/cli/src/utils/file_metadata.py`; tabular sources inherit metadata from `BaseTabularSource._table_to_asset`.
- Keep `tests/test_assets_metadata_catalog.py` green and assert your source's emitted keys conform. See the "Asset metadata contract rule" in `SKILL.md` for the full contract.

Use existing implementations as patterns:
- `apps/cli/src/sources/wordpress/source.py`
- `apps/cli/src/sources/slack/source.py`

Discovery note:
- `apps/cli/src/sources/__init__.py` auto-discovers subclasses, so keep module importable and `source_type` set.

Add tests:
- Unit: `apps/cli/tests/test_<source_name>_source.py`
- Integration: `apps/cli/tests/integration/test_<source_name>_*.py` (if creds/test env exists)
- For relationship-capable sources, include assertions that linked assets appear in `links`.

Suggested runs:

```bash
cd apps/cli
uv run pytest tests/test_<source_name>_source.py
```

Runtime config rule:
- Keep operational execution controls (runtime mode, remote endpoint, infrastructure toggles) in CLI env vars when they are not user-managed source settings.
- Only expose runtime controls in schema when they must be configured per source by end users.

## 3) API + DB Layer

Add the source type to the Prisma enum:
- `apps/api/prisma/schema.prisma` (`enum AssetType`)

Hand-write the migration, as every earlier source did (no database needed):

```sql
-- apps/api/prisma/migrations/<timestamp>_add_<source_name>_asset_type/migration.sql
ALTER TYPE "AssetType" ADD VALUE '<SOURCE_TYPE>';
```

Regenerate the Prisma client:

```bash
cd apps/api
bun run prisma:generate
```

Before running API e2e on shared/deployed databases, apply migrations:

```bash
cd apps/api
bun run prisma:deploy
```

Update the source list in the API description strings:
- `apps/api/src/main.ts`
- `apps/api/scripts/generate-openapi-spec.ts`
- `apps/api/src/controllers/sources.controller.ts`

Add the type to the schema-examples list in `apps/api/test/source.e2e-spec.ts`.

If the source introduces a URN platform, mirror it in `apps/api/src/graph/urn.ts`.

Regenerate OpenAPI:

```bash
cd apps/api
bun run openapi:generate
```

Regenerate API client:

```bash
cd packages/api-client
bun run generate
```

## 4) Web + UI Layer

Source labels come from the schema (`label` on the `*Input` definition), so the
lists to update are the typed maps:
- `packages/ui/src/lib/source-catalog.ts` (description, category, keywords)
- `packages/ui/src/components/source-icon.tsx` (both the simple-icon map and the component map)
- `apps/web/components/json-schema-form.tsx` (`TABULAR_SOURCE_TYPE_MAP`)
- `apps/web/i18n/en.json` and `apps/web/i18n/de.json` (`sourceTypes`)

For new metadata keys: `apps/web/components/asset-metadata-card.tsx` plus the
`assets.detail.assetMetadata.keys` block in both i18n files.

Use business-facing descriptions in UI (avoid implementation-detail wording).

Update examples and assistant guidance:
- `packages/schemas/src/schemas/all_input_examples.json`
- `packages/schemas/src/schemas/assistant_knowledge.json`

Docs:
- `apps/docs/app/sources/<slug>/page.mdx`
- `apps/docs/app/sources/_meta.js`
- `apps/docs/app/sources/lineage/page.mdx` (table of lineage-producing sources)

Use discovery script to find additional touchpoints:

```bash
python .claude/skills/add-new-source/scripts/find_source_touchpoints.py <workspace-root>
```

## 5) Final Verification

Run minimum checks:

```bash
cd packages/schemas && uv run python scripts/validate_examples.py
cd apps/cli && uv run pytest tests/test_<source_name>_source.py
cd apps/api && bun run openapi:generate
cd packages/api-client && bun run generate
```

If web source selectors/maps changed, run:

```bash
cd apps/web
bun run typecheck
```

## WordPress Reference Set

Use this set when you need a complete working example:
- `packages/schemas/src/schemas/all_input_sources.json`
- `packages/schemas/src/schemas/all_input_examples.json`
- `apps/cli/src/sources/wordpress/source.py`
- `apps/cli/tests/test_wordpress_source.py`
- `apps/cli/tests/integration/test_wordpress_real.py`
- `apps/api/test/helpers/wordpress-test-helper.ts`
- `apps/api/test/wordpress-runner.e2e-spec.ts`
