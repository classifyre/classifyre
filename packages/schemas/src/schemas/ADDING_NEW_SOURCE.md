# Adding a New Source

This guide lives under `packages/schemas` because every new source starts with schema design, but it covers the end-to-end checklist across CLI, API, DB, and Web. Use WordPress as a working example for patterns and structure.

Reference files for WordPress:
`packages/schemas/src/schemas/all_input_sources.json`
`packages/schemas/src/schemas/all_input_examples.json`
`apps/cli/src/sources/wordpress/source.py`
`apps/cli/tests/integration/test_wordpress_real.py`

**Step 1: Research and Design**

1. Confirm the source is read-only for ingestion and discovery.
2. Identify the auth modes the source supports and prefer existing libraries (for example `requests`, database drivers, or official SDKs) over custom HTTP clients.
3. Decide which config fields are truly needed, and how to represent them with `required`, `masked`, and `optional` sections.

**Step 2: Add the Input Schema**

1. Update `packages/schemas/src/schemas/all_input_sources.json`.
2. Add new `*Required`, `*Masked`, and `*Optional` definitions for the source.
3. Add a new `*Input` definition using `allOf` with `CoreInput`.
4. Add the new input to the top-level `oneOf`.
5. Add the new source to `definitions.AssetType` (uppercase enum string).

**Step 3: Add Examples**

1. Update `packages/schemas/src/schemas/all_input_examples.json`.
2. Provide multiple examples covering auth variations and common use cases.
3. If the root `all_input_examples.json` is still used by your flow, keep it in sync with the schemas copy.

**Step 4: Validate Examples**

1. Update the mapping in `packages/schemas/scripts/validate_examples.py` (`TYPE_TO_DEFINITION`) for the new source.
2. Run the validator script when you add or change examples.

**Step 5: Regenerate Pydantic Models (CLI)**

1. Run `uv run python scripts/generate_models.py` from `apps/cli`.
2. Confirm `apps/cli/src/models/generated_input.py` includes the new input model.

**Step 6: Implement the CLI Source**

1. Add a new package under `apps/cli/src/sources/<source_name>/`.
2. Implement `BaseSource` methods: `test_connection`, `extract`, `generate_hash_id`, `abort`, and optionally `fetch_content`.
3. Use streaming batches in `extract` and follow existing patterns for detectors and hashing.
4. Ensure the module is importable so the auto-discovery in `src/sources/__init__.py` can register it.
5. Prefer existing libraries already used in the repo over custom clients.

**Step 7: Tests**

1. Ask the requester whether a test system or credentials are available.
2. Add unit tests for config parsing, paging, and error handling.
3. If real credentials or a test instance are available, add an integration test in `apps/cli/tests/integration`.
4. Use `test_wordpress_real.py` as a model for structure and expectations.

**Step 8: API Updates**

1. Search for `AssetType` and source lists to ensure the new type is recognized in API logic.
2. If DTOs or validations change, update `apps/api` and regenerate OpenAPI as needed.

**Step 9: Prisma Schema and Migrations**

1. Update `enum AssetType` in `apps/api/prisma/schema.prisma`.
2. Run Prisma migration and client generation if the enum changes.

**Step 10: OpenAPI and API Client**

1. Regenerate `apps/api/openapi.json` when API DTOs or enums change.
2. Regenerate the API client in `packages/api-client` if the OpenAPI spec changes.

**Step 11: Web and UI**

1. Update source lists, icons, and labels in the web and UI packages.
2. Common places to check:
   `apps/web/components/source-type-selector.tsx`
   `apps/web/app/(dashboard)/discovery/page.tsx`
   `packages/ui/src/components/source-icon.tsx`
   `packages/ui/src/mocks/types.ts`
   `packages/ui/src/mocks/sources.ts`

**Quality Bar**

1. Keep configuration minimal, documented, and consistent with other sources.
2. Keep code clean, testable, and reusable with clear separation between IO, parsing, and transformation.
3. Prefer stable, well-maintained dependencies and avoid custom protocol implementations.
