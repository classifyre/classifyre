# Changelog

All notable user-facing changes to Classifyre are documented here. Entries are
compiled at release time from per-PR fragments in `changelog.d/` (see
`changelog.d/README.md`). Commit messages and PR titles are never used as
release notes.

## [0.7.2] - 2026-10-30

### Added

- Lineage now crosses from Databricks into the database behind a foreign catalog. A table built through Lakehouse Federation is traced to the real PostgreSQL, MySQL, SQL Server, Oracle or Snowflake table, column detail included, and the path carries on through that database's own views once its source is scanned. The scanning identity needs `BROWSE` on the foreign catalog and `USE CONNECTION` on the connection. Re-scan the Databricks source to pick this up.

### Fixed

- Sources on automatic sampling and automatic scheduling no longer re-scan every few minutes after they have read everything. Databases without a usable key, Neo4j labels, MongoDB and search-engine indexes are read page by page and start over at the end, and that restart was mistaken for new ground, so a finished source stayed at the one-minute catch-up pace for good. Once every table, label or index has been read once, the source now moves to the steady schedule (15 minutes, doubling while nothing new appears). If its content still differs on every scan, for example a table with a "loaded at" column, it backs off to at most every 6 hours instead of looping.
- The column lineage panel now shows functions in the order the value passes through them. `SUM(CASE …)` used to read `amount → SUM → CASE → income`; it now reads `amount → CASE → SUM → income`. The panel also follows a column up to five steps back instead of three, so a trace that crosses into another system reaches that system's own views. Column lineage from Databricks no longer says a column was copied as-is just because the names match: Unity Catalog does not report what happened in between, so those rows now read **Mapped**.
- A scan that retires a lot at once now finishes. When a source's scope changed, resolving the findings of its old assets one by one outlasted the time limit on finishing the run, so the run rolled back and retried forever. They are now resolved in batches.
- Lineage arrows now stand alone. Each one used to have a dotted "references" line drawn backwards over it, and foreign keys were doubled the same way. Arrows on the Connections tab and in Explore also read in plain words (*derived*, *view of*) instead of the internal name. Existing links clear up on the source's next scan. A link a person drew now says **Manual** under how it was known; it used to read as if a platform's catalog had reported it.

## [0.7.1] - 2026-10-29

### Fixed

- The Connections tab of a source with ten assets or fewer now shows the links between them. Before, it said "Nothing links these yet" and drew none, because every asset counted as a starting point and none as a neighbour.
- Databricks tables and views now show their column types (for example `decimal(21,2)`); before, every column came back with an empty type. When Unity Catalog saw a notebook produce a table, the lineage edge now names that notebook, so you can see which notebook wrote it. Turn on notebooks in the source's extraction options and re-scan to get both.
- MySQL and Hive views now connect to the tables and views they read from. Before, every view edge pointed at a name no scanned asset had, so the connection showed as an unresolved node and the real table or view never got its downstream. Views that read across databases and views built on other views are covered. Re-scan MySQL and Hive sources to repair existing edges.
- Tables, node labels and other catalog objects that disappear from a source are now marked as deleted, and their open findings are resolved, whichever sampling strategy the source uses. Before, only a source set to read everything ever retired anything, so dropped tables, a changed database and renamed labels stayed listed as "unchanged" forever. This applies to the SQL sources, Databricks and Neo4j; a scan that could not list part of the source retires nothing, and after you change a source's scope the old assets are retired by the second scan. Their findings from sampled rows are left as they were.

## [0.7.0] - 2026-10-28

### Fixed

- Column lineage for Postgres views is more complete and no longer wrong in four cases: views over a single table now record the columns they filter, group or sort on; views that rename a column and use it again, or use quoted mixed-case names, now get column detail instead of table-level only; views over two same-named tables in different schemas keep each table's columns apart; and columns fed through a `LATERAL` subquery are traced to the table they come from. Re-scan existing sources to refresh their column lineage.
