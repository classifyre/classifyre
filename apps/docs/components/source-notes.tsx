import Link from "next/link";

import { Badge } from "@workspace/ui/components";

/**
 * Prose that is true of a *family* of sources rather than one of them.
 *
 * Every relational database scans tables the same way; every object store walks
 * objects the same way. Writing that out thirty-eight times guarantees thirty-
 * eight slightly different versions of it, and the one that goes stale is never
 * the one you are reading. These blocks are the shared half; the per-source
 * pages carry only what is genuinely specific to that system.
 */

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-3"
    >
      {children}
    </Link>
  );
}

function Note({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="my-6 space-y-3 rounded-[6px] border-2 border-border bg-muted/20 p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      <div className="space-y-3 text-sm leading-6 text-foreground">{children}</div>
    </div>
  );
}

/**
 * Shared behaviour of every SQL database source (PostgreSQL, MySQL, SQL Server,
 * Oracle, Hive, Snowflake, Databricks).
 */
export function SqlSourceNotes({
  /** Set when the engine's catalog can report what a view reads from. */
  viewLineage = true,
  /** Set when the engine's catalog exposes foreign keys. */
  foreignKeys = true,
}: {
  viewLineage?: boolean;
  foreignKeys?: boolean;
}) {
  return (
    <Note title="Shared behaviour · SQL databases">
      <p>
        One <strong>asset per table or view</strong>, never one per row. The
        asset carries the table&apos;s structure — database, schema, table name,
        object type, its columns and their types, and a row-count estimate — and
        its content is a <strong>sample of real rows</strong>, formatted so a
        detector reads actual values rather than a schema dump.
      </p>
      <p>
        How many rows, and which ones, is entirely up to the{" "}
        <DocLink href="/sources/sampling/">sampling strategy</DocLink>. Large
        tables are paged through by key rather than by <code>OFFSET</code>, so a
        scan that stops halfway can resume from where it left off instead of
        re-reading from the top.
      </p>
      <p>
        <strong>Read-only throughout.</strong> The connector issues catalog
        queries and bounded <code>SELECT</code>s. Nothing is written back, and a
        read-only account is the right account to give it.
      </p>
      {foreignKeys || viewLineage ? (
        <p>
          Relationships come out of the engine&apos;s own catalog:{" "}
          {foreignKeys ? (
            <>
              <strong>foreign keys</strong> are recorded as{" "}
              <Badge variant="outline" className="font-mono text-[10px]">
                REFERENCE
              </Badge>{" "}
              links — useful, but they move no data, so they never become a
              lineage hop
            </>
          ) : null}
          {foreignKeys && viewLineage ? ", and " : null}
          {viewLineage ? (
            <>
              a <strong>view</strong> and the tables it reads from are recorded
              as{" "}
              <Badge variant="outline" className="font-mono text-[10px]">
                FLOW
              </Badge>{" "}
              — real lineage, with column-level detail parsed out of the
              view&apos;s SQL where the SQL makes that possible
            </>
          ) : null}
          . See <DocLink href="/sources/lineage/">Lineage</DocLink>.
        </p>
      ) : null}
    </Note>
  );
}

/** Shared behaviour of the object-store sources and the folder sources. */
export function ObjectStorageNotes({
  /** What the system calls the container being scanned. */
  container = "bucket",
}: {
  container?: string;
}) {
  return (
    <Note title="Shared behaviour · File and object sources">
      <p>
        Every object in the {container} becomes one asset. What it{" "}
        <em>is</em> — a PDF, a spreadsheet, a screenshot, a video — is worked
        out from the bytes themselves, not from the file name, because storage
        systems routinely label everything as generic binary data. The full list
        of readable types is on{" "}
        <DocLink href="/sources/file-formats/">File Formats</DocLink>.
      </p>
      <p>
        Files hidden <em>inside</em> other files are pulled out and scanned in
        their own right: images embedded in a document, and every member of a
        ZIP, TAR, 7z or RAR archive. Images, audio and video need{" "}
        <DocLink href="/sources/content-extraction/">
          OCR and transcription
        </DocLink>{" "}
        switched on before their content can be read.
      </p>
      <p>
        Large objects are streamed rather than loaded whole, so a multi-gigabyte
        file costs disk rather than memory, and only the part a sampling window
        asks for is read.
      </p>
    </Note>
  );
}

/** Shared behaviour of Elasticsearch, OpenSearch and Meilisearch. */
export function SearchIndexNotes({ indexWord = "index" }: { indexWord?: string }) {
  return (
    <Note title="Shared behaviour · Search engines">
      <p>
        One asset per <strong>{indexWord}</strong>, not per document. The
        asset&apos;s content is a sample of the documents in it, serialised so a
        detector sees the field values; the asset&apos;s metadata records the
        document count and the fields the {indexWord} actually contains.
      </p>
      <p>
        Only read APIs are used — cluster info, {indexWord} listing, and search.
        A read-only key or user is enough, and is what we recommend.
      </p>
    </Note>
  );
}

/** Shared behaviour of the Atlassian sources (Confluence, Jira, JSM). */
export function AtlassianNotes({ product }: { product: string }) {
  return (
    <Note title="Shared behaviour · Atlassian Cloud">
      <p>
        Authentication is your Atlassian account email plus an{" "}
        <strong>API token</strong> — the same token type across {product} and
        every other Atlassian product. The account only ever needs read access,
        and it sees exactly what that account would see in the browser: nothing
        is escalated, so restricted spaces and projects stay invisible unless
        the account is entitled to them.
      </p>
      <p>
        <strong>Attachments are scanned, not skipped.</strong> Each attached
        file becomes an asset of its own, linked back to the page or issue it
        came from, and is read with the full{" "}
        <DocLink href="/sources/file-formats/">file-format</DocLink> pipeline —
        which is where the interesting material usually is.
      </p>
    </Note>
  );
}

/** Lakehouse tables found while scanning a bucket or folder. */
export function LakehouseNotes() {
  return (
    <Note title="Shared behaviour · Lakehouse tables">
      <p>
        A Delta Lake, Apache Iceberg, Apache Hudi, Apache Paimon or Lance table
        found under the prefix is read as <strong>one table asset</strong>, not
        as the pile of data files it is made of. Deleted rows stay deleted,
        files from older snapshots are left out, and a renamed column reads as
        one column. No Spark, JVM or catalog service is needed: the table is
        read through its own metadata files with the credentials this source
        already has.
      </p>
      <p>
        Which formats can be read on which storage, and what to use when the
        table lives behind a catalog instead, is on{" "}
        <DocLink href="/sources/lakehouse/">Lakehouse Tables</DocLink>.
      </p>
    </Note>
  );
}

/**
 * The standard closing note for a source that carries files, pointing at the
 * pages that own the detail rather than repeating them per source.
 */
export function FileHandlingNote({ what = "Files from this source" }: { what?: string }) {
  return (
    <p className="leading-7 text-foreground">
      {what} are read with the shared file pipeline: see{" "}
      <DocLink href="/sources/file-formats/">Supported File Formats</DocLink> for
      everything it can open, and{" "}
      <DocLink href="/sources/content-extraction/">OCR &amp; Transcription</DocLink>{" "}
      for reading text out of images, audio and video.
    </p>
  );
}

/**
 * Every source also carries the settings that are the same everywhere. Listing
 * them per source would triple the length of each table for no new information.
 */
export function SharedSettingsNote() {
  return (
    <p className="leading-7 text-muted-foreground">
      Beyond the fields below, every source also has the settings shared by all
      of them: the{" "}
      <DocLink href="/sources/sampling/">sampling strategy</DocLink>, the{" "}
      <DocLink href="/sources/augmentation/">augmentation notebook</DocLink>{" "}
      that enriches assets after extraction, the{" "}
      <DocLink href="/detectors/">detectors</DocLink> to run, the{" "}
      <DocLink href="/sources/testing/">scan schedule</DocLink>, and the compute
      limits for its scan jobs.
    </p>
  );
}

/**
 * Stated on every source page, so the answer to "can this source be read with
 * SQL?" is always in the same place — including when the answer is no.
 *
 * `support` names how the query engine (DuckDB, one short-lived job per query)
 * reaches the source, and mirrors `QUERYABLE_SOURCE_TYPES` in
 * apps/cli/src/query/bindings.py with the detail on /data-query:
 * `"database"` (every scanned table and view, e.g. PostgreSQL and MySQL),
 * `"bucket"` (Delta/Iceberg tables and table-shaped files in the four bucket
 * sources and local folders), `"catalog"` (an attached lakehouse catalog),
 * `"odbc"` (any database behind an ODBC driver), `"databricks"` (Unity Catalog
 * tables, with their extra conditions), or `"none"` (not queryable — the
 * children say why, and what to do instead).
 *
 * "SQL connections" below means the PostgreSQL-protocol access for BI tools
 * and drivers (Power BI, Excel, Tableau, DBeaver, psql, JDBC/ODBC clients): it
 * reads the same tables as SQL, once the table or source is opened on its
 * Governance tab. It is not the ODBC *source*.
 */
export function QueryNote({
  support,
  children,
}: {
  support: "database" | "bucket" | "catalog" | "odbc" | "databricks" | "none";
  children?: React.ReactNode;
}) {
  if (support === "none") {
    return (
      <Note title="Query data & SQL connections">
        <p>
          This source <strong>cannot be queried with SQL yet</strong> — not on
          the <strong>Query data</strong> page, the Data tabs, in exports,
          through AI agents, or over{" "}
          <DocLink href="/sql-connections/">SQL connections</DocLink> (Power
          BI, Excel and the like). Scans still read and classify everything;
          only reading rows back is missing.
        </p>
        {children}
      </Note>
    );
  }
  return (
    <Note title="Query data & SQL connections">
      {support === "database" && <p>Every scanned table and view.</p>}
      {support === "catalog" && (
        <p>Every scanned table, attached exactly as the scan attaches it.</p>
      )}
      {support === "bucket" && (
        <p>
          Delta and Iceberg tables — read as they are now, not as the last
          scan saw them — along with Parquet, CSV, TSV, JSON Lines, JSON, Avro
          and geospatial files (geometry as WKT text). Formats scans read but
          SQL cannot, like Excel workbooks and SQLite files, are listed with
          their reason. See{" "}
          <DocLink href="/data-query/">SQL over your tables</DocLink>.
        </p>
      )}
      {support === "databricks" && (
        <>
          <p>
            Every scanned Unity Catalog table stored as Delta, read through
            Unity Catalog itself: DuckDB asks it for short-lived credentials to
            the table&apos;s files, so no storage keys are involved. Two things
            must be switched on in Databricks, otherwise a query answers that
            Databricks would not hand out storage credentials: an admin turns
            on <strong>External data access</strong> for the metastore, and the
            source&apos;s principal holds the{" "}
            <strong>EXTERNAL USE SCHEMA</strong> privilege on each schema to
            query.
          </p>
          <p>
            Only Delta tables can be read. <strong>Views</strong> are listed but
            cannot be queried, because they have no files of their own; query
            the tables they read instead.
          </p>
        </>
      )}
      {support === "odbc" && (
        <>
          <p>
            Every scanned table and view, read through DuckDB&apos;s{" "}
            <code>odbc_scanner</code> extension with the same connection string,
            user and password the scan uses. The one thing queries need beyond
            the scan is <strong>the driver installed where queries run</strong>:
            the image ships unixODBC and the PostgreSQL driver, anything else
            rides in a custom CLI-jobs image.
          </p>
          <p>
            ODBC is the slowest way in: a query is a plain{" "}
            <code>SELECT * FROM table</code> sent to the database — no filter,
            projection or aggregation is sent along, though a{" "}
            <code>LIMIT</code> ends the read early. Start with one, or land the
            table in a bucket first.
          </p>
        </>
      )}
      <p>
        SQL runs on the <DocLink href="/data-query/">Query data</DocLink> page,
        the Data tabs, in exports and through AI agents — and, once the table
        or source is opened on its Governance tab, over{" "}
        <DocLink href="/sql-connections/">SQL connections</DocLink> (Power BI,
        Excel, Tableau, DBeaver, psql, JDBC/ODBC). Scan first: SQL only knows
        the tables a scan found, and who may query follows roles and grants.
      </p>
      {children}
    </Note>
  );
}

/**
 * Stated on every source page, so the answer to "does this source do lineage?"
 * is always in the same place — including when the answer is no.
 */
export function LineageNote({ children }: { children?: React.ReactNode }) {
  return (
    <Note title="Lineage">
      {children ?? (
        <p>
          This source records <strong>no lineage</strong>. Nothing in the system
          it reads describes data moving from one place to another, so no{" "}
          <Badge variant="outline" className="font-mono text-[10px]">
            FLOW
          </Badge>{" "}
          edges are produced. Related items are still linked — see{" "}
          <DocLink href="/sources/lineage/">Lineage &amp; Relationships</DocLink>{" "}
          for what those links mean and how they differ from lineage.
        </p>
      )}
    </Note>
  );
}
