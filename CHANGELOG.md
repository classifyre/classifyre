# Changelog

All notable user-facing changes to Classifyre are documented here. Entries are
compiled at release time from per-PR fragments in `changelog.d/` (see
`changelog.d/README.md`). Commit messages and PR titles are never used as
release notes.

## [0.9.8] - 2026-11-28

### Fixed

- Upgrading the all-in-one Docker image no longer leaves it stuck on the setup screen: the default first sign-in is `classifyre` / `classifyre` (a temporary password) again. Volumes first created with 0.9.6 need `-e CLASSIFYRE_ADMIN_USER=admin -e CLASSIFYRE_ADMIN_PASSWORD=admin`.

## [0.9.7] - 2026-11-28

### Added

- You can now explore database tables and foreign-key relationships interactively on the Visual Schema canvas in Data Query, source data tabs, and Data Requests, with live SQL generation, auto-layout, and PNG, SVG, JSON, and DBML export. All column masking, hidden or restricted column policies, row-level filters, and access grants are enforced across the visual catalog, link discovery, and exports.

## [0.9.5] - 2026-11-27

### Changed

- TLS and certificate usage on the SQL gateway is now optional (`sqlGateway.tls.enabled` in Helm, `SQL_GATEWAY_TLS_ENABLED` in the environment). It stays enabled by default in Helm and general deployments, while the all-in-one Docker image now disables SQL gateway TLS by default so BI tools and ODBC clients can connect without downloading a certificate.

## [0.9.4] - 2026-11-26

### Added

- You can now request a governed shared dataset from a data team under Cases using a visual join canvas. Place catalog tables, draw column-to-column joins, choose columns and filters while SQL generates live, and route the request to a data-team group for review and delivery as a versioned shared dataset — with change requests, self-serve publishing when you already hold publish rights, governance notifications, and MCP tools for AI assistants.

### Changed

- Investigations now live under Cases alongside Data Requests, with a unified picker when starting new work. Existing bookmarks and notification links under /investigations/ redirect automatically to /cases/.

## [0.9.3] - 2026-11-24

### Added

- A new Data consumer role lets you give someone outside the team (an agency, an auditor, a partner department) exactly the tables or shared datasets you grant them, without showing them findings, assets, sources or activity; the app opens on the SQL page for them and only offers what they can use.
- When row filtering is on, a table's Rows step now lists the groups that may query it but would see no rows (admins included), and readers without a rule are told to ask the table's owner or a steward.
- Columns can now be restricted: hidden even from people allowed to read the table unmasked, so only the table's owners and stewards see a national ID or passport number in a table a team otherwise reads in clear.
- A new mask, "identifiers removed", keeps free-text columns such as ticket bodies and notes readable while replacing e-mail addresses, IBANs, card and phone numbers, ID numbers, passwords and access keys in every row, instead of hiding the whole column.

### Changed

- Hashed columns now ignore upper and lower case and surrounding spaces, so the same e-mail address spelt differently in two systems gets the same hash and joins; hash values shown before this release change once.

### Fixed

- BI dashboards that load several charts at once (Metabase, for example) no longer fail with "the SQL gateway is busy" while their sessions are starting.
- Columns named in camelCase, as in Salesforce and HubSpot exports (FirstName, MobilePhone), now get the same detection as their snake_case equivalents, so names are found in them and phone numbers are no longer classified as card or national ID numbers.
- Sharing a dataset now stops with a clear message when its owning group would read no rows of one of its tables because of a row filter, instead of sharing a dataset that silently leaves that table's rows out.
- Columns holding European national ID numbers (Austrian social insurance, German tax ID, PESEL and others) are now classified as sensitive, like US social security numbers, instead of as ordinary personal data.
- Tables of ODBC sources can be queried with SQL again, from the SQL page, exports and SQL connections; every such query had failed since the query engine was hardened.
- Personal data found in database and lakehouse tables is now tied to its column on tables of any size, so those columns are classified and masked by default; before, tables with more than a couple of columns were often left unmasked, and phone numbers and national IDs in small tables went undetected. Re-scan a source to classify the tables it already has.

### Security

- What a finding matched (the e-mail address, IBAN, card number or key itself, and the text around it) is now shown only to people who may read it: investigators, curators, source managers and admins, and anyone who reads that table in clear. Viewers see a finding's type, place and priority with the value hidden, on every page, in exports and to AI agents, and searching findings by their value needs the same right.

## [0.9.2] - 2026-11-23

### Changed

- Every all-in-one Docker command now also publishes the SQL connections port, `-p 5433:5433` (not 5432, which the container's own PostgreSQL holds), and the app shows that port to Power BI, Excel and `psql`. If you already published it as `-p 5432:5433`, add `-e SQL_GATEWAY_PUBLIC_PORT=5432` so the app keeps showing 5432. Turn SQL connections off with `-e SQL_GATEWAY_ENABLED=false`.
- SQL connections are now switched on by default in the Helm chart and stay on in the all-in-one Docker image. On Kubernetes the gateway runs as soon as you install, but tools cannot reach it until you set `sqlGateway.publicHost` and expose its port; set `sqlGateway.enabled: false` to run without it. The gateway pod asks for 250m CPU and 1 GiB by default, so lower `sqlGateway.resources.requests` on a small node.

### Fixed

- The "Connect a tool" button no longer flashes on and disappears on the SQL page and the Data tabs. Where SQL connections are on but have no public address yet, it stays, and the dialog, Settings → SQL connections and a table's Governance tab now say what is missing and link the setup guide for every kind of ingress.

## [0.9.1] - 2026-11-22

### Added

- Custom sources can now be queried with SQL: a notebook that defines `tables()` and `scan(table, request)` gets its tables in the SQL catalog, read live from its API on each query, with row filters and audit applied as for every other table. Columns the notebook declares as personal or secret (`Table(classify=...)`) are masked or hidden by default, `ScanRefusedError` tells people which condition a table needs, and such queries always run as a Job of their own, never in the shared query worker.
- Meilisearch indexes and Neo4j node labels and relationship types can now be queried with SQL and joined with any other table: they are read live through the source's own API, filters are sent to the source where it can apply them, and the SQL page shows how many requests and rows each live table took.

### Changed

- Scan Meilisearch and Neo4j sources again after upgrading: scans now record an index's or label's columns, and list each Neo4j relationship type as an asset of its own, which SQL needs before it can read them.
- SQL connections now refuse writes and definitions (INSERT, UPDATE, DELETE, MERGE, CREATE, COPY, DO blocks and the like) with a read-only error before they run: a SQL connection only reads, and such statements could only ever answer with empty results there.
- SQL queries (the SQL page, exports, MCP and SQL connections from BI tools) answer in about a second instead of five to ten: a warm query worker runs each query in its own process instead of starting a Kubernetes Job for it, and a query it has no room for still runs as a Job. The Helm chart deploys it by default (`queryWorker`), sizes its slots from the pod's memory and scales it on CPU. Queries of different workspaces share it safely: each query sees only its own sources' credentials and files, the worker runs on a read-only file system behind its own network policy, one query that runs out of memory fails alone, and each workspace has its own share (`queryWorker.maxActivePerWorkspace`, `queryWorker.maxOverflowJobsPerWorkspace`). One person may now run up to 100 queries at once instead of 3 (`queryWorker.maxActivePerPerson`); without the worker the limit is 20. Queries over ODBC sources still run as Jobs.

### Fixed

- A link to a tab that appears only once your permissions have loaded, such as Settings → Access, now opens that tab instead of sometimes falling back to the first one.
- Date and timestamp conditions sent to a live source now show on the SQL page as SQL writes them (`day >= DATE '2026-11-20'`), not as a bare date.
- SQL connections refuse cursor statements over your tables that they cannot serve (scrollable cursors, reading backward, cursors sent as prepared statements) with a clear error, instead of answering them with no rows; cursors now end with their transaction as in PostgreSQL, and one connection can hold at most eight open at once.
- When the SQL gateway is short of memory it now refuses new connections as busy, so tools retry, instead of being restarted and dropping every open connection.
- Metabase's query builder (table previews, filters, groupings and joins) now works over SQL connections; before, it failed with "Referenced table not found".
- Metabase and other BI tools that open several connections at once can now connect through SQL connections; before, every connection after the first was refused with "Another sign-in from here is under way".
- Excel, Power BI and other tools using the PostgreSQL ODBC driver with "Use Declare/Fetch" turned on now get the rows of their queries; before, they received empty results.
- Results read page by page over SQL connections, such as Metabase downloads and DBeaver or Tableau with a fetch size, now arrive in full; before, they could silently stop after the first page.
- SQL connections refuse statements over your tables they cannot answer, such as PREPARE/EXECUTE, CREATE TABLE … AS, COPY … TO and DO blocks, instead of answering them with no rows; behind a load balancer, the limit on connections signing in now applies to each client rather than to everyone behind the same proxy.

## [0.9.0] - 2026-11-19

### Added

- Activity now shows what a governance change changed, from the old value to the new one: who was named owner or steward and who held the role before, the status before and after certification, edited descriptions, columns, glossary terms and quality checks. Governance changes have readable names in the list. The ownership card no longer keeps its own history; Activity holds it.
- Assets and sources can have an owner, stewards and a custodian, picked from your organization's people and groups. An asset with an owner is governed. Its new Overview tab shows its owners, description, legal basis, glossary terms and a checklist of what is still missing, and its owner or steward can certify it. Owners and stewards can edit their own assets without a workspace role. The asset list can be filtered by governance status, by "Owned by me" and by "Stewarded by me".
- Columns that hold personal data are now masked for people who may query a table but should not see the real values. By default a column follows its classification on the Governance tab — personal and sensitive data masked, secrets hidden — and the table's owner or a steward can set any column to clear, masked (redacted, last four shown, hashed so it still joins, or empty) or hidden. Masks apply everywhere the table is read: the SQL page, Data tabs, exports and SQL connections, filters and joins included. A new role, Data reader, unmasked, given like Data reader on a table, a source or the workspace, reads them in clear, as do the table's owner and stewards.
- People who cannot query a table or source can now ask for it from its Data tab: they pick a group of theirs, how long they need it and say why. The table's owner (or, with no owner, its stewards; with neither, the workspace's admins) is notified and approves or declines on the Governance tab; approval gives that group an expiring Data reader grant on exactly that table or source. Someone who reads a table masked can ask to read it in clear the same way. Admins see every waiting request in Settings → Access.
- A table's Overview now lists its columns. For each one, a steward can add a business name, a description, a glossary term and a critical-data-element flag. Each column also gets a classification (personal, sensitive, secret and so on), worked out from the findings in that column; a steward confirms it or sets their own. The Overview also shows who read or exported the table in the last 30 days. Two new MCP tools read an asset's governance and set its owner.
- People now hear about the data they answer for. Someone named owner, steward or custodian of an asset or source gets a notification, as does a group named as steward or custodian. An asset's owner and stewards are notified when one of its quality rules starts failing, and when someone else certifies, deprecates or retires it. Only people with the asset-governance permission (admins and curators) can name or remove owners, stewards and custodians; owners and stewards keep everything else on their assets.
- AI agents connected over MCP can now read tables for you: the new Data tool group lists the tables you may query and runs a SELECT (`query_data`), through your own access, masked columns, row filters and limits, with every table read recorded in Activity as yours.
- A new **ODBC** source scans any database that has an ODBC driver (SQL Server, Oracle, DB2, Teradata, a data source on a mainframe): tables, views, columns, keys and a sample of real rows. You pick the driver, host, port and database (or a DSN, or a full connection string), and SQL can query those tables too, through DuckDB's ODBC extension. The Classifyre image ships the unixODBC driver manager and the PostgreSQL driver; other drivers are added to the image the scans run in.
- Assets can have data quality rules, in a new Quality step of the Governance tab. A rule counts open findings ("no personal data in the notes column") or checks what the scan recorded (the table is not empty, it was scanned in the last 24 hours). Rules are checked after every scan and on request, and every result is kept. While a rule fails, it keeps a Quality finding open with its severity; the finding resolves by itself once the rule passes again. Each asset gets a quality score weighted by severity.
- Quality rules can now check a whole table: empty, missing, invalid or duplicate values in a column (as a number of rows or a percentage), the row count, or any SQL query that returns one number. These rules run after each scan or on an hourly, daily or weekly schedule, through the same SQL engine as the SQL page. An asset's description, team, columns and quality rules can be downloaded as an Open Data Contract Standard (ODCS) contract in YAML or JSON, and a contract can be applied to fill them in, with a report of anything that was skipped.
- A table's owner or steward can now show each reader only some of its rows: on the Governance tab, step Rows, turn filtering on and give groups (or everyone) rules such as "region is one of Tirol, Salzburg". Readers without a rule see no rows; the owner and stewards see them all. Filters apply wherever the table is read — the SQL page, Data tabs, exports, SQL connections and AI agents — and only the owner or a steward can make them show more.
- Settings → General now has Scan limits for each workspace: scans running at once, automatic scans at once, and runs kept per source. Values saved there replace the Helm chart and all-in-one image settings for that workspace, apart from the installation-wide ceiling on scans running at once; leaving a field empty follows the chart or image again.
- Queries can now be shared as **shared datasets**: on the SQL page, *Share as dataset* turns a query over one or more tables into a governed dataset (`shared.<domain>.<name>`) that other groups read — on the SQL page, Data tabs, exports, SQL connections and AI agents — without any access to the tables behind it. The tables are read with the access of the dataset's owning group, checked on every read; their masks, row filters and column classification carry into the dataset and can be made stricter, never looser. Owners of those tables are told when their table is shared and can block a dataset. Each dataset has its own owner, Promoted and Certified badges, versions, column lineage, quality checks, access requests and activity, and all of them are listed under *Assets → Shared assets*. Sharing needs the new *Dataset publisher* role, or owning or stewarding every table a dataset reads. Over SQL connections a dataset reads only tables that are themselves open to SQL connections, and such a table cannot be closed while a draft or active dataset open to connections reads it: deprecate or retire the dataset first.
- BI tools and drivers can now read your tables directly: Power BI, Excel, Tableau, DBeaver, psql and any JDBC or ODBC client connect over the PostgreSQL protocol with a SQL connection made in Settings. Each connection belongs to one person and reads only what that person may query; every table read is recorded with the connection and shows in the table's Activity and Usage. A table's owner can give someone a connection for it, see which connections read it, and close it to one connection without affecting the rest; admins can revoke any connection. Connections are always encrypted, expire, and keep no password, only a verifier.
- SQL can now query Databricks (Unity Catalog Delta tables, with the source's own credentials), and JSON and geospatial files (GeoJSON, FlatGeobuf, shapefile tables) in buckets and folders. The SQL docs now list every queryable source and file format, and why the others are not.

### Changed

- The Assets page has tabs over the same asset list, each showing the columns and filters that matter there: Raw assets, Governed assets (with how often they are read and which are read most) and Shared assets (with their usage and status, each dataset labelled in the list, and filters for whether a dataset can be read now and whether it is promoted).
- Data contracts now carry each column's access: an exported contract says whether a column is shown, masked (and how) or hidden, and applying one sets it, except where it would show more than you may read yourself. Struct and list columns keep their shape when masked, with every field and element masked on its own, so a hashed field still joins. SQL queries start about a second sooner.
- Explore moved into the Assets page as its Explore tab. The map starts from the workspace's most connected assets, and the asset list under it can start from the assets with the most lineage, the most critical findings, duplicates, or links people drew. Press the compass on a row to draw it on the map, or tick several to explore them together or add them beside what the map already shows. Saved views open from the map's top bar, and old Explore links open the new tab.
- The findings and asset lists export from the same Export button as query results; they export as CSV.
- Summary cards that act as filters or tabs look the same on every page: the chosen one turns dark, with its icon in the accent colour.
- In the sidebar, Findings moved under Casework, between Investigations and Duplicate review.
- A glossary term's steward is now a person or group from your organization rather than free text. On upgrade, a steward name that matches exactly one person who has signed in is linked to that person. Any other steward text is moved into the term's notes.
- Overview is now the Dashboard, the page you land on in a workspace. It is about the data you answer for rather than findings and scans: how many assets are governed, by lifecycle, how their quality holds, who asks for access and reads them, and what waits on you. It shows your own assets or all of them, over 7, 30 or 90 days, for one source or all, and each count of assets opens exactly those assets. Findings and scans keep their summaries on their own pages, and old Overview links open the Dashboard.
- Governance now has its own tab on asset and source pages: one step at a time (ownership, description, meaning, columns, certification), with a stepper that ticks off each step as it is done. The Overview tab keeps only a short summary of owners and status. Adding glossary terms to an asset is simpler: suggested terms are added with one click, picking a search result adds it at once, and a missing term can be created on the spot. Each role now says what it allows. An asset's owner can query the tables they own without a separate grant (but not export them).
- Governed assets are no longer deleted for good. Purging a source's assets keeps the ones that have an owner, or whose source has one, and says how many it kept; deleting a source is refused while it or any of its assets has an owner. Remove the owner on the Governance tab first to delete such an asset after all.
- Adding a quality check now works like adding a source: choose what to check (column values, a SQL query, findings, or what the last scan recorded), start from a template, then fill one form that picks columns from the table and shows today's counts. A test run measures the check on the data as it is now before you save it, and shows the value, whether it passes and the query that ran. A short guide explains when checks run and what happens when one fails. Quality now shows on the assets list (with a filter for failing checks), in the asset header and on the source's Governance tab, which no longer uses steps. The Governance tab uses the full page width, with an icon for each role and a clearer certification view.
- The SQL page is now called Query data, in the sidebar and as the page's title, with what it does under the title. Connect a tool sits at the top right of the page.
- The search box of the findings and asset lists picks how it matches, semantic or exact, inside the box.
- Sandbox and Mounted Folder now sit under Other in the source catalog instead of Warehouse & Lakehouse.
- The SQL over tables limits moved from the Export & Import tab to Settings → General.

### Removed

- The live feeds for Excel Power Query, Google Sheets and BI tools are gone; findings, assets and scan assets can still be downloaded as CSV with the Download CSV button.
- The Telegram and Slack chat bots are gone, along with Settings → Chat Bots: bots stop answering, and their saved tokens, conversation history and the usage recorded for chat replies are deleted when you upgrade. The in-app Assistant and the MCP server are not affected; to reach Classifyre from your own tools, use the MCP server.
- SQLite is no longer a source of its own, and existing SQLite sources are removed along with their assets and findings. SQLite files in a bucket, a mounted folder or an upload are still read, table by table.
- Exporting and importing workspaces is gone: the Export & Import tab in Settings, creating a workspace from an archive, and the transfer endpoints and settings behind them no longer exist.

### Fixed

- A first start on an empty database no longer leaves the worker stuck: when the API and the worker both created the database at the same moment, the one that lost the race failed and never became ready.
- Live updates such as scan progress, notifications and the case board now connect through the web app's own address, so they keep working when the app is opened from another device or hostname.
- SQL queries now work on MySQL sources set to verify the server's certificate (Verify CA, Verify identity): the query checks it against the source's CA like a scan does. MySQL passwords with spaces, quotes or backslashes also connect correctly.

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
