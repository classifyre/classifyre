# DataHub Ingestion Patterns For Classifyre Source Work

Use this reference when `reference_project/datahub` is available and you need robust source design patterns.

Do git pull first

## Contents

- [1) Where DataHub Defines Sources](#1-where-datahub-defines-sources)
- [2) Deep Dive: Postgres Source](#2-deep-dive-postgres-source)
- [2b) Deep Dive: MySQL Source](#2b-deep-dive-mysql-source)
- [3) Deep Dive: Databricks (Unity Catalog) Source](#3-deep-dive-databricks-unity-catalog-source)
- [4) Additional Source Examples](#4-additional-source-examples)
- [5) Dependency and Plugin Loading Model](#5-dependency-and-plugin-loading-model)
- [6) Output and Test Expectations](#6-output-and-test-expectations)
- [7) Classifyre Integration Blueprint](#7-classifyre-integration-blueprint)
- [8) Repeatable Research Commands](#8-repeatable-research-commands)

## 1) Where DataHub Defines Sources

Core source architecture:



- `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/api/source.py`
- `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/api/decorators.py`
- `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/source_registry.py`
- `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/run/pipeline.py`

Plugin registration and source extras:

- `reference_project/datahub/metadata-ingestion/setup.py`
- Source entry points are declared under group `datahub.ingestion.source.plugins`.

Docs and recipes:

- `reference_project/datahub/metadata-ingestion/docs/sources/**`

## 2) Deep Dive: Postgres Source

Code paths:

- Source class: `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/sql/postgres/source.py`
- Query builder: `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/sql/postgres/query.py`
- Query lineage extractor: `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/sql/postgres/lineage.py`
- Starter recipe: `reference_project/datahub/metadata-ingestion/docs/sources/postgres/postgres_recipe.yml`
- Query lineage prereqs: `reference_project/datahub/metadata-ingestion/docs/sources/postgres/postgres_pre.md`

Config and validation patterns to reuse:

- Auth mode enum with explicit choices (`PASSWORD`, `AWS_IAM`).
- Strong config validation for resource-heavy options:
  - `max_queries_to_extract` bounded.
  - `min_query_calls` bounded.
  - `query_exclude_patterns` count and pattern-length bounded.
- Dependency validation between flags:
  - `include_usage_statistics` requires `include_query_lineage`.
- Runtime prerequisites checked before lineage extraction:
  - PostgreSQL version check.
  - `pg_stat_statements` extension check.
  - permission check (`pg_read_all_stats` or superuser).

Python libs used:

- `psycopg2-binary` (via SQLAlchemy dialect)
- `GeoAlchemy2` (PostGIS reflection side effects)
- `sqlalchemy`
- DataHub SQL parsing stack (`SqlParsingAggregator`, sqlglot integration)

Security/safety patterns:

- SQL injection prevention via:
  - strict identifier sanitization (`_sanitize_identifier`)
  - parameterized SQL (`TextClause` + bind params)
- Fail-loud for explicit feature enablement:
  - if query-lineage init fails and it was explicitly enabled, source raises error.

## 2b) Deep Dive: MySQL Source

Code paths:

- Source class: `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/sql/mysql.py`
- Starter recipe: `reference_project/datahub/metadata-ingestion/docs/sources/mysql/mysql_recipe.yml`
- Prereqs: `reference_project/datahub/metadata-ingestion/docs/sources/mysql/mysql_pre.md`

Config/auth patterns to reuse:

- Two-tier SQL model (`database.table`) with explicit database scoping.
- Auth mode enum with explicit choices (`PASSWORD`, `AWS_IAM`).
- Optional AWS IAM block (`aws_config`) only when auth mode requires it.
- Stored procedure ingestion has dedicated flags + allow/deny pattern (`include_stored_procedures`, `procedure_pattern`).

Python libs used:

- `pymysql`
- `sqlalchemy`
- DataHub SQL connector stack (`TwoTierSQLAlchemySource`)

Operational safeguards:

- RDS IAM auth requires explicit username + port and injects short-lived tokens at connect time.
- Feature flags keep heavier metadata paths optional (profiling/stored procedures).

## 3) Deep Dive: Databricks (Unity Catalog) Source

Code paths:

- Source class: `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/unity/source.py`
- Config: `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/unity/config.py`
- Connection/auth: `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/unity/connection.py`
- Azure auth model: `reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/unity/azure_auth_config.py`
- Recipe: `reference_project/datahub/metadata-ingestion/docs/sources/databricks/unity-catalog_recipe.yml`
- Prereqs: `reference_project/datahub/metadata-ingestion/docs/sources/databricks/unity-catalog_pre.md`

Important naming and alias behavior:

- Platform label is `Databricks`.
- Source registration uses `unity-catalog` with alias `databricks` in `source_registry.py`.

Auth/config patterns to reuse:

- Mutually-exclusive auth methods:
  - PAT token, Azure auth block, or client credentials (OAuth/service principal).
- Validation for URL shape (`http`/`https` scheme required).
- Warehouse-dependent feature gating:
  - tags, hive metastore extraction, system table lineage, and profiling depend on `warehouse_id`.
  - when safe, features auto-disable with warnings instead of hard failure.
- Profile config as discriminated union (`method: ge` vs `method: analyze`).
- Data source mode enums for lineage/usage (`AUTO`, `SYSTEM_TABLES`, `API`) with validation.

Python libs used:

- `databricks-sdk`
- `databricks-sql-connector`
- `pyspark` (profiling and broader Databricks integration)
- `pandas` (connector compatibility constraints)

Operational pattern to copy:

- Explicit `test_connection` support.
- Paging controls exposed (`databricks_api_page_size`) with defaults and validation.
- Stateful ingestion support enabled and integrated in source base class.

## 4) Additional Source Examples

Use these as extra references when Postgres/Databricks are not close enough.

| Source type | Source class | Primary config | Starter recipe | Extras (setup.py) |
| --- | --- | --- | --- | --- |
| `mysql` | `.../source/sql/mysql.py` | `MySQLConfig` in same module path | `docs/sources/mysql/mysql_recipe.yml` | `mysql` plugin deps (`pymysql`, `aws_common`) |
| `snowflake` | `.../source/snowflake/snowflake_v2.py` | `.../source/snowflake/snowflake_config.py` | `docs/sources/snowflake/snowflake_recipe.yml` | `snowflake_common`, `sql_common`, `usage_common`, `sqlglot_lib` |
| `bigquery` | `.../source/bigquery_v2/bigquery.py` | `.../source/bigquery_v2/bigquery_config.py` | `docs/sources/bigquery/bigquery_recipe.yml` | `bigquery` plugin deps in `setup.py` |
| `s3` | `.../source/s3/source.py` | `.../source/s3/config.py` | `docs/sources/s3/s3_recipe.yml` | `s3_base` (+ optional profiling stack) |
| `kafka` | `.../source/kafka/kafka.py` | `KafkaSourceConfig` in same module path | `docs/sources/kafka/kafka_recipe.yml` | `kafka_common`, `kafka_protobuf` |

## 5) Dependency and Plugin Loading Model

DataHub isolates source dependencies per plugin extra:

- Extras declared in `setup.py` under `plugins` dict.
- Source registry uses entry points and lazy class loading:
  - `PluginRegistry.register_lazy(...)`
  - loads the class on first `get(source_type)`.
- If dependency is missing, config error points to exact pip extra:
  - message pattern: `pip install 'acryl-datahub[<source-type>]'`.

Why this matters for Classifyre:

- One heavy source dependency should not break unrelated source runs.
- Source discovery should stay lightweight until source is selected.

## 6) Output and Test Expectations

DataHub source execution model:

- Source returns `MetadataWorkUnit` stream.
- Pipeline applies workunit processors (status, browse paths, validation, etc.).

Observed output (from golden files) includes:

- Containers and hierarchy aspects.
- Datasets with schema, properties, ownership, lineage, browse paths.
- Additional entities depending on source:
  - Postgres: views, stored procedures mapped to data flow/job, query entities.
  - Databricks: sibling links to delta-lake datasets, optional ML model entities.

Key testing pattern:

- Unit tests for config validators and edge behaviors.
- Integration tests with fixed input and golden output JSON comparison.
- Focused tests for failure modes (missing privileges, missing extensions, invalid config).

Useful files:

- Postgres integration:
  - `reference_project/datahub/metadata-ingestion/tests/integration/postgres/test_postgres.py`
  - `reference_project/datahub/metadata-ingestion/tests/integration/postgres/test_postgres_lineage.py`
  - `reference_project/datahub/metadata-ingestion/tests/integration/postgres/postgres_mces_with_db_golden.json`
- Databricks integration:
  - `reference_project/datahub/metadata-ingestion/tests/integration/unity/test_unity_catalog_ingest.py`
  - `reference_project/datahub/metadata-ingestion/tests/integration/unity/unity_catalog_mces_golden.json`

## 7) Classifyre Integration Blueprint

Apply these patterns when building or upgrading an Classifyre source:

1. Model config in schema first, then generate models, then implement source.
2. Keep auth methods explicit and validate mutual exclusivity when applicable.
3. Keep runtime-only controls in CLI env vars unless users must set them per source.
4. Add feature flags for expensive options (lineage, profiling, deep fetch).
5. Add hard validation for unsafe ranges and conflicting flags.
6. Add a clear `test_connection` result contract (`SUCCESS`/`FAILURE`, actionable message).
7. Keep extraction streaming and deterministic in batches.
8. Add source-specific tests:
   - validator/unit tests
   - extractor behavior tests
   - integration test fixture with expected output snapshots when practical
9. Add dependency notes in source docs so install/runtime expectations are explicit.

## 8) Repeatable Research Commands

Run from repo root:

```bash
# list available DataHub sources and aliases
rg -n "datahub.ingestion.source.plugins|register_alias\\(" reference_project/datahub/metadata-ingestion/setup.py reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/source_registry.py

# inspect Postgres source/config/lineage paths
rg -n "class Postgres|include_query_lineage|AWS_IAM|pg_stat_statements" reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/sql/postgres

# inspect Databricks source/config/auth paths
rg -n "class UnityCatalogSourceConfig|warehouse_id|include_tags|include_hive_metastore|client_id|azure_auth" reference_project/datahub/metadata-ingestion/src/datahub/ingestion/source/unity

# inspect source-specific dependency extras
rg -n "\"postgres\"|\"databricks\"|\"unity-catalog\"|\"snowflake\"|\"bigquery\"|\"s3\"|\"kafka\"" reference_project/datahub/metadata-ingestion/setup.py
```
