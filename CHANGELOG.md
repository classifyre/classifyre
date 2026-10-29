# Changelog

All notable user-facing changes to Classifyre are documented here. Entries are
compiled at release time from per-PR fragments in `changelog.d/` (see
`changelog.d/README.md`). Commit messages and PR titles are never used as
release notes.

## [0.7.1] - 2026-10-29

### Fixed

- The Connections tab of a source with ten assets or fewer now shows the links between them. Before, it said "Nothing links these yet" and drew none, because every asset counted as a starting point and none as a neighbour.
- Databricks tables and views now show their column types (for example `decimal(21,2)`); before, every column came back with an empty type. When Unity Catalog saw a notebook produce a table, the lineage edge now names that notebook, so you can see which notebook wrote it. Turn on notebooks in the source's extraction options and re-scan to get both.
- MySQL and Hive views now connect to the tables and views they read from. Before, every view edge pointed at a name no scanned asset had, so the connection showed as an unresolved node and the real table or view never got its downstream. Views that read across databases and views built on other views are covered. Re-scan MySQL and Hive sources to repair existing edges.
- Tables, node labels and other catalog objects that disappear from a source are now marked as deleted, and their open findings are resolved, whichever sampling strategy the source uses. Before, only a source set to read everything ever retired anything, so dropped tables, a changed database and renamed labels stayed listed as "unchanged" forever. This applies to the SQL sources, Databricks and Neo4j; a scan that could not list part of the source retires nothing, and after you change a source's scope the old assets are retired by the second scan. Their findings from sampled rows are left as they were.

## [0.7.0] - 2026-10-28

### Fixed

- Column lineage for Postgres views is more complete and no longer wrong in four cases: views over a single table now record the columns they filter, group or sort on; views that rename a column and use it again, or use quoted mixed-case names, now get column detail instead of table-level only; views over two same-named tables in different schemas keep each table's columns apart; and columns fed through a `LATERAL` subquery are traced to the table they come from. Re-scan existing sources to refresh their column lineage.
