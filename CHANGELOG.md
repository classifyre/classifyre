# Changelog

All notable user-facing changes to Classifyre are documented here. Entries are
compiled at release time from per-PR fragments in `changelog.d/` (see
`changelog.d/README.md`). Commit messages and PR titles are never used as
release notes.

## [0.7.0] - 2026-10-28

### Fixed

- Column lineage for Postgres views is more complete and no longer wrong in four cases: views over a single table now record the columns they filter, group or sort on; views that rename a column and use it again, or use quoted mixed-case names, now get column detail instead of table-level only; views over two same-named tables in different schemas keep each table's columns apart; and columns fed through a `LATERAL` subquery are traced to the table they come from. Re-scan existing sources to refresh their column lineage.
