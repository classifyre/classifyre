# Changelog

All notable user-facing changes to Classifyre are documented here. Entries are
compiled at release time from per-PR fragments in `changelog.d/` (see
`changelog.d/README.md`). Commit messages and PR titles are never used as
release notes.

## [0.8.0] - 2026-11-11

### Added

- Activity now names what changed (the source, table or group at the time of the change), can be searched, sorted and paged, and reading table rows with SQL is recorded per table. Access given on a single table or source is now listed under that table's or source's name instead of "One table" or "One source".
- A table's Data tab, a source's Data tab and the SQL page now show Access and Activity for exactly that scope: who can query it, and which reads, exports and access changes touched it. Give access on a table's tab always opens just that table, and on the SQL page the whole workspace.
- You can export the whole result of a SQL query as an Excel, CSV or Parquet file, up to a million rows by default, if you may export data from the workspace.
- You can now query the rows of database, lakehouse and bucket tables with standard SQL, from a table's new Data tab or the new SQL page, and join tables across sources. Workspace admins can query straight away, and the new Data reader role gives a group access to a whole workspace, one source or a single table.
- You can now make a workspace public, read-only for everyone in its tenant and for signed-out visitors of the first tenant, with the new workspace.publish capability. This replaces the public tenant and demo mode, which are gone.
- Sources with tables now have a Data tab: query the source's tables with its table list beside the editor, give a group the Data reader role on the whole source in one step, and see who read its tables and who was given access in its Activity.

### Changed

- Chat bots now only read: a chat message has no signed-in person behind it, so the bot setting that allowed changes is gone.
- The all-in-one Docker image now asks you to sign in: open it and sign in as `classifyre` with the password `classifyre`, then change the password under Your account. Set `CLASSIFYRE_URL` when you open it at another address or port than `http://localhost:3000`.
- Giving access now uses one dialog everywhere — Settings → Access and the Data tabs of sources and tables — with the same fields: group, role, what it applies to and an optional end date. From Settings, the Data reader role (which opens SQL) can now be given on one source or one table, and access given on a Data tab can end on a date.
- Notifications now go to groups: by default to the group that owns the workspace, or to the groups chosen for each kind under Settings → Access → Who gets notifications. Marking a notification read, important or dismissed now applies to you only, and visitors of a public workspace see none.
- Visitors of a public workspace now see the SQL page with an example query and a Sign in button, so they know what signing in opens; nothing can be run, saved or exported without signing in. A source's page no longer shows who changed it last in its header.
- Sign-in is now always on: every installation runs the identity server, and every change is recorded under the name of the person who signed in. Workspaces of an installation that ran without sign-in are copied into a tenant once with `node dist/src/admin.js workspaces copy --to-tenant default --all`; MCP tokens made without sign-in no longer exist, so create new ones after signing in.
- The SQL page now works like a small IDE: Run, Format and Save sit in one toolbar above the editor, and your tables, recent queries and saved queries are in tabs beside it. Names complete as you type with access marks, a table or column from the list lands where the cursor stands, reopening a past query brings back just its SQL, and results can be searched, sorted and paged.
- A workspace's name, address, description, categories, links and picture are now edited under Settings → General inside the workspace; the gear on a workspace card opens it there.

### Removed

- The Helm value `iam.enabled` is gone, and a release that still sets it fails with a message: remove it from your values and make sure `ingress.host` or `iam.appUrl` is set. The Platform page no longer imports workspaces made without sign-in; operators use the `workspaces copy --to-tenant` command instead.

### Fixed

- Tables you cannot query now say why, whether the table cannot be read or you need the Data reader role, and each finished query records exactly the tables it read.

### Security

- A custom detector's patterns, prompts and code, and the list of AI providers, are now shown only to people who can change detectors or see the settings; visitors of a public workspace no longer see them, and a public workspace no longer sends visitors to the sign-in page on its own.
- Visitors of a public workspace, and members reading one without a role in it, no longer see its activity, its settings or how its sources are configured, and cannot use SQL; the API refuses them these too. People without the right to change sources now see a source's name, type and scans but not its configuration or notebook code.

## [0.7.4] - 2026-11-09

### Added

- With sign-in on, workspace admins manage who has access under **Settings → Access**, tenant admins manage access across the tenant on the **Tenant access** page, and new workspaces are created for an owning group you belong to. **Why can I…?** shows which grant gives you a permission, and MCP tokens show whose access they carry.
- The Helm chart now installs an identity server for sign-in (`iam`, on by default), with its own database, a first tenant and a first admin. It is reached through the web app at `/iam`, so there is no separate address to configure. Installs without `ingress.host` must set `iam.appUrl`, or turn sign-in off with `iam.enabled: false`; a sitemap is only allowed with sign-in off.
- Sign-in now looks like Classifyre: the sign-in page sits on the same animated board of evidence pins as our landing page, and the identity console and everyone's account page carry the Classifyre logo, type and colours. Operators open the identity console straight from Classifyre (**Identity console** in the account menu, and on the Platform and Tenant access pages) to add people, groups and tenants, without a port-forward; the identity server's own master realm stays closed. The workspace list now only offers the actions each person may take, the account menu shows your name everywhere, and the Access & Sign-in docs walk through the first sign-in, organizing a company with groups, and every role and right, with screenshots.
- Operators now see every tenant on a new **Platform** page: its admins, workspaces, database and any problem. They suspend and resume tenants, copy in workspaces made without sign-in, and remove the data of a tenant whose organization was deleted. Tenants, their people and groups are created in the identity server, which Classifyre only reads. Operators hold the `classifyre-operator` role, which the Helm chart gives its first admin (`iam.bootstrap.admin.operator`); they see tenants, not what is inside them. People of a suspended tenant see a page saying so.
- An installation with sign-in can now make one tenant public (`iam.public.enabled`, `iam.public.tenant` in the Helm chart). People who have not signed in browse its workspaces read-only, with **Sign in** at the top; once signed in, everyone sees only their own tenant, never the public one mixed in. Visitors cannot change anything, see who has access, or create MCP tokens, and the sitemap, now allowed with a public tenant, lists only it. It is off by default; the all-in-one Docker image still has no sign-in at all.
- The sign-in page now speaks English and German, like Classifyre: it opens in the language you were using, or your browser's, and has a language switch. Your choice there is kept on your account for the sign-in pages and emails such as a password reset.
- With sign-in on, every tenant now has a PostgreSQL database of its own, with its own login, next to a control database that holds the tenants, their access and the list of their workspaces. A tenant can be backed up, restored and deleted on its own, and a tenant whose upgrade fails is unavailable on its own while the others keep working; the Platform page shows each tenant's database and any upgrade error. The chart's database user needs `CREATEDB` and `CREATEROLE` (`iam.controlDatabase` names the control database). Installs that turned sign-in on before this move their tenants once with `node dist/src/admin.js tenants split`.
- With sign-in on (Helm `iam.enabled`), people sign in to the web app, see only the workspaces their groups give them, and find their name, tenant and **Sign out** in the account menu. People and groups are managed in the identity server, or a company directory connected to it; Classifyre only reads them and decides what they may do. Sessions renew themselves; tokens stay in server-only cookies. A signed-in instance is never offered to search engines.
- Every change in a workspace is now recorded with who made it: sources, inquiries, detectors, findings, glossary terms and cases show who created them and who changed them last, **History** lists every change to an item, and **Settings → Activity** shows the whole workspace. Changes made by agents through MCP are attributed to the token they used, and only the names of changed fields are kept, never their values.
- **Your account** in the account menu opens your own account page, in Classifyre's look: change your name, email, password and two-factor sign-in, see where you are signed in, and pick the language of the sign-in pages.

### Changed

- Items created by the autopilot are now attributed to `agent:autopilot` instead of `ai-autopilot`; existing items are converted when you upgrade. Scripts that filter on the old value need updating.
- With sign-in on, the identity server is reached through the web app at `/iam`, like every other external path; there is no separate ingress, port, or public URL for it anymore. The old `iam.publicUrl` value is gone — the address is always `<iam.appUrl>/iam`, so existing installs only need it removed from their values if they set it.
- Turning sign-in off no longer opens every tenant's workspaces to anyone: without sign-in Classifyre uses only the database of workspaces made without it, and tenants' workspaces are in their own databases, out of its reach. Turning sign-in on no longer moves existing workspaces into the first tenant either; an operator copies them in with `node dist/src/admin.js workspaces copy` in an API pod or **Bring in workspaces** on the Platform page, and can copy a workspace out of a tenant the same way. Each copy is in the tenant's activity.

### Removed

- Access is now always given to groups: the API no longer accepts a grant to one person, and grants made to one person before are removed on upgrade. Put the person in a group in the identity server and give that group access instead.

### Security

- Sign-in is harder to misuse: the identity server's own master realm can no longer be reached through crafted addresses, operators' rights in the identity console are limited to people, organizations and directories, signing out can no longer be triggered from another website, and people of a deleted tenant, or of one whose organization was replaced, now see a page that says so.

## [0.7.3] - 2026-11-03

### Added

- A custom source's notebook can now read the whole workspace — sources, assets with their metadata and findings, findings by detector, and detectors — and tag, link and give glossary meaning to assets of other sources from a new `augment_sources()` step. Every read is paged by cursor, every write records which source made it, and a later complete run retires what that source stopped asserting. The same is available to agents through new MCP tools, with two starter templates and a new guide.
- You can now scan lakehouse tables through an Iceberg REST catalog (Polaris, Snowflake Open Catalog, Unity Catalog, Nessie, Gravitino, Lakekeeper, AWS Glue, Amazon S3 Tables and BigLake metastore), a DuckLake, Trino or Starburst, Amazon Athena, Google BigQuery and Amazon Redshift.
- Scans now read Avro, ORC, Vortex and JSON Lines files row by row, open SQLite, DuckDB and GeoPackage files and scan every table inside them, and read GeoJSON and FlatGeobuf features with their coordinates as text, as well as Shapefile attribute tables.
- Table assets from Snowflake, Databricks, Hive, Dremio and the new lakehouse sources now show the table's storage format, such as Iceberg, Delta or native.

### Changed

- S3-compatible, Azure Blob Storage, Google Cloud Storage and local-folder scans now read the Delta Lake, Apache Iceberg, Apache Hudi, Apache Paimon and Lance tables they find as single table assets, with deleted rows left out, renamed columns read as one column, and each table read at its current version.
- `ctx.query_assets()` in a custom source no longer stops after 100 queries per run, can read every source when none is named, and returns each asset's id, URN and source. Every read still pages by cursor.

### Removed

- The Delta Lake and Apache Iceberg source types are gone, because bucket scans and the new Iceberg REST Catalog source read those tables; upgrading deletes any existing sources of these two types along with their assets and findings, so recreate them as a bucket or Iceberg REST Catalog source.

### Fixed

- With Automatic sampling, cloud-storage and folder scans now keep coming back to a table file larger than one slice until all of its rows are read; before, only the first slice of each file was ever scanned.
- Azure Blob Storage scans list a container's blobs reliably again with current versions of the Azure SDK.
- TSV files, `;`-separated CSV exports and CSVs with a title line above the header are now split into their real columns instead of being read as a single column, and spreadsheets with a title row above the header keep every column.
- Cross-system lineage now survives a connection change. Moving a source to another host or port left its existing assets under the old name, so lineage from another source never reached them; the next scan now renames them, and waiting arrows bind.
- E-mail addresses in a table column named "contact" are now found; the column was treated as holding only people's names.

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
