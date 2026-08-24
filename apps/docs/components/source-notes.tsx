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
 * Oracle, SQLite, Hive, Snowflake, Databricks).
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

/** Shared behaviour of Delta Lake and Iceberg. */
export function LakehouseNotes({ format }: { format: string }) {
  return (
    <Note title="Shared behaviour · Lakehouse tables">
      <p>
        No Spark, no JVM, and no catalog service is required. {format} table
        metadata is read directly out of the table&apos;s own files in object
        storage, and rows are sampled from the underlying Parquet — so the only
        thing you have to provide is object-storage access to the warehouse
        path.
      </p>
      <p>
        Connection details are the same shape as the{" "}
        <DocLink href="/sources/s3-compatible-storage/">
          S3-Compatible Storage
        </DocLink>{" "}
        source, which means AWS S3, MinIO, Cloudflare R2 and the rest all work
        the same way.
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
      <DocLink href="/detectors/">detectors</DocLink> to run, the{" "}
      <DocLink href="/sources/testing/">scan schedule</DocLink>, and the compute
      limits for its scan jobs.
    </p>
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
