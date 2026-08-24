import Link from "next/link";

import { Badge } from "@workspace/ui/components";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import {
  SOURCE_CATEGORY_META,
  resolveSourceCatalogMeta,
} from "@workspace/ui/lib/source-catalog";
import {
  getSourceDoc,
  type SourceDocFieldRow,
  type SourceDocModel,
} from "@workspace/schemas/source-docs";

/**
 * Building blocks for the hand-written per-source pages.
 *
 * The prose on those pages is written by a human; the *facts* are not. Anything
 * that has a single source of truth elsewhere — the configuration fields, the
 * metadata each asset kind carries, the catalog category — is read from the
 * shared schema here, so a schema change shows up on the page instead of
 * silently making the page wrong.
 */

type SourceProps = {
  /** The `SOURCE_TYPE` constant, e.g. `POSTGRESQL`. */
  type: string;
};

function source(sourceType: string): SourceDocModel {
  const doc = getSourceDoc(sourceType);
  if (!doc) {
    throw new Error(
      `No source schema found for "${sourceType}". Check the constant against all_input_sources.json.`,
    );
  }
  return doc;
}

function sectionRows(
  rows: SourceDocFieldRow[],
  section: "required" | "masked" | "optional",
): SourceDocFieldRow[] {
  return rows.filter(
    (row) =>
      row.path === section ||
      row.path.startsWith(`${section}.`) ||
      row.path.startsWith(`${section}[]`),
  );
}

/** Strips the section prefix — the table already says which section it is. */
function displayPath(path: string): string {
  return path.replace(/^(required|masked|optional)\.?/, "") || path;
}

function describe(row: SourceDocFieldRow): string {
  return (
    [row.description, row.enumValues ? `Allowed: ${row.enumValues}` : undefined]
      .filter(Boolean)
      .join(" ") || "—"
  );
}

function FieldTable({
  caption,
  rows,
}: {
  caption: string;
  rows: SourceDocFieldRow[];
}) {
  if (rows.length === 0) {
    return (
      <p className="my-4 text-sm text-muted-foreground">
        {caption}: none for this source.
      </p>
    );
  }

  return (
    <div className="my-6 overflow-x-auto rounded-[6px] border-2 border-border">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            <TableHead className="px-3 py-2 font-mono text-xs uppercase tracking-[0.08em]">
              Field
            </TableHead>
            <TableHead className="px-3 py-2 font-mono text-xs uppercase tracking-[0.08em]">
              Type
            </TableHead>
            <TableHead className="px-3 py-2 font-mono text-xs uppercase tracking-[0.08em]">
              Required
            </TableHead>
            <TableHead className="px-3 py-2 font-mono text-xs uppercase tracking-[0.08em]">
              What it does
            </TableHead>
            <TableHead className="px-3 py-2 font-mono text-xs uppercase tracking-[0.08em]">
              Default
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${caption}-${row.path}-${row.type}`}>
              <TableCell className="max-w-[16rem] whitespace-normal break-all px-3 py-2 align-top font-mono text-xs">
                {displayPath(row.path)}
              </TableCell>
              <TableCell className="max-w-[10rem] whitespace-normal break-words px-3 py-2 align-top font-mono text-xs">
                {row.type}
              </TableCell>
              <TableCell className="px-3 py-2 align-top">
                <Badge variant={row.required ? "secondary" : "outline"}>
                  {row.required ? "Yes" : "No"}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[30rem] whitespace-normal break-words px-3 py-2 align-top text-xs text-muted-foreground">
                {describe(row)}
                {row.constraints ? (
                  <span className="block pt-1 font-mono text-[11px] text-foreground/70">
                    {row.constraints}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="max-w-[12rem] whitespace-normal break-words px-3 py-2 align-top font-mono text-xs">
                {row.defaultValue ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type SchemaNode = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(node: SchemaNode): string {
  if (typeof node.const === "string") return `"${node.const}"`;
  if (Array.isArray(node.enum)) return "enum";
  if (typeof node.type === "string") return node.type;
  if (Array.isArray(node.type)) return node.type.join(" | ");
  return "object";
}

/**
 * Flatten one schema object into table rows.
 *
 * Used for the sections the app models as a choice between shapes (an auth
 * mode, most often). Those carry no rows in the pre-flattened field list —
 * a `oneOf` has no single set of properties — and were previously invisible on
 * the generated pages, which is exactly the half of the form a reader most
 * needs before they can connect anything.
 */
function rowsFromSchema(node: SchemaNode, prefix = ""): SourceDocFieldRow[] {
  const properties = isRecord(node.properties) ? node.properties : {};
  const requiredNames = new Set(
    Array.isArray(node.required)
      ? node.required.filter((name): name is string => typeof name === "string")
      : [],
  );

  return Object.entries(properties).flatMap(([name, rawChild]) => {
    if (!isRecord(rawChild)) return [];
    const path = prefix ? `${prefix}.${name}` : name;
    const nested = isRecord(rawChild.properties)
      ? rowsFromSchema(rawChild, path)
      : [];

    const row: SourceDocFieldRow = {
      path,
      section: prefix || name,
      required: requiredNames.has(name),
      type: typeName(rawChild),
      description:
        typeof rawChild.description === "string" ? rawChild.description : undefined,
      defaultValue:
        rawChild.default === undefined ? undefined : JSON.stringify(rawChild.default),
      enumValues: Array.isArray(rawChild.enum)
        ? rawChild.enum.map((value) => String(value)).join(", ")
        : undefined,
    };

    return [row, ...nested];
  });
}

/** The `oneOf` branches of a section, if it is modelled as a choice of shapes. */
function variantsOf(
  doc: SourceDocModel,
  section: "required" | "masked" | "optional",
): Array<{ label: string; rows: SourceDocFieldRow[] }> {
  const properties = isRecord(doc.schema.properties) ? doc.schema.properties : {};
  const node = properties[section];
  if (!isRecord(node) || !Array.isArray(node.oneOf)) return [];

  return node.oneOf.filter(isRecord).map((variant, index) => ({
    label:
      (typeof variant.label === "string" && variant.label) ||
      (typeof variant.title === "string" && variant.title) ||
      `Option ${index + 1}`,
    rows: rowsFromSchema(variant),
  }));
}

function SectionFields({
  doc,
  section,
  caption,
}: {
  doc: SourceDocModel;
  section: "required" | "masked" | "optional";
  caption: string;
}) {
  const variants = variantsOf(doc, section);

  if (variants.length > 0) {
    return (
      <>
        <p className="leading-7 text-muted-foreground">
          This section depends on which authentication method you pick — one of
          the following applies.
        </p>
        {variants.map((variant) => (
          <div key={variant.label}>
            <p className="pt-2 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {variant.label}
            </p>
            <FieldTable caption={`${caption} · ${variant.label}`} rows={variant.rows} />
          </div>
        ))}
      </>
    );
  }

  return <FieldTable caption={caption} rows={sectionRows(doc.fieldRows, section)} />;
}

/**
 * Every configuration field for one source, split the way the form splits them.
 *
 * Read straight from `all_input_sources.json`, which is the same schema the
 * app renders its form from — so this cannot drift from what you actually see
 * when you add the source.
 */
export function SourceParameters({ type }: SourceProps) {
  const doc = source(type);

  return (
    <>
      <h3 className="scroll-mt-28 font-serif text-xl font-black uppercase tracking-[0.05em] text-foreground sm:text-2xl">
        Required
      </h3>
      <p className="leading-7 text-foreground">
        Without these, the source will not save.
      </p>
      <SectionFields doc={doc} section="required" caption="Required fields" />

      <h3 className="scroll-mt-28 font-serif text-xl font-black uppercase tracking-[0.05em] text-foreground sm:text-2xl">
        Secrets
      </h3>
      <p className="leading-7 text-foreground">
        Stored encrypted and never shown again after you save them. See{" "}
        <Link
          href="/sources/configuration/"
          className="font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-3"
        >
          Configuration &amp; Fields
        </Link>
        .
      </p>
      <SectionFields doc={doc} section="masked" caption="Secret fields" />

      <h3 className="scroll-mt-28 font-serif text-xl font-black uppercase tracking-[0.05em] text-foreground sm:text-2xl">
        Optional
      </h3>
      <p className="leading-7 text-foreground">
        Everything you can tune. Sensible defaults apply when you leave them
        alone.
      </p>
      <SectionFields doc={doc} section="optional" caption="Optional fields" />
    </>
  );
}

/**
 * The metadata each asset kind from this source carries.
 *
 * Generated from the `x-asset-metadata` catalog, which the connectors are
 * tested against — so what is listed here is what actually lands on the asset.
 */
export function SourceMetadata({ type }: SourceProps) {
  const doc = source(type);

  if (doc.assetsMetadata.length === 0) {
    return (
      <p className="leading-7 text-muted-foreground">
        This source does not declare a fixed metadata shape — what each asset
        carries is decided by the connector.
      </p>
    );
  }

  return (
    <>
      {doc.assetsMetadata.map((asset) => (
        <div key={asset.assetKind} className="my-6 space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Asset kind · {asset.assetKind}
          </p>
          <div className="overflow-x-auto rounded-[6px] border-2 border-border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="px-3 py-2 font-mono text-xs uppercase tracking-[0.08em]">
                    Field
                  </TableHead>
                  <TableHead className="px-3 py-2 font-mono text-xs uppercase tracking-[0.08em]">
                    Type
                  </TableHead>
                  <TableHead className="px-3 py-2 font-mono text-xs uppercase tracking-[0.08em]">
                    Always present
                  </TableHead>
                  <TableHead className="px-3 py-2 font-mono text-xs uppercase tracking-[0.08em]">
                    What it is
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {asset.fields.map((field) => (
                  <TableRow key={`${asset.assetKind}-${field.name}`}>
                    <TableCell className="px-3 py-2 align-top font-mono text-xs">
                      {field.name}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top font-mono text-xs">
                      {field.type}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top">
                      <Badge variant={field.required ? "secondary" : "outline"}>
                        {field.required ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[30rem] whitespace-normal break-words px-3 py-2 align-top text-xs text-muted-foreground">
                      {field.description || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </>
  );
}

type SourceFactsProps = SourceProps & {
  /** The vendor's own site or product page. */
  vendor?: { label: string; href: string };
  /** Where the reader gets the credential this source needs. */
  auth?: { label: string; href: string };
  /** Anything else worth a click — API docs, admin console, driver notes. */
  links?: Array<{ label: string; href: string }>;
};

/**
 * The header block every source page opens with: icon, category, asset kinds,
 * and the handful of outbound links a reader needs before they can configure
 * anything.
 */
export function SourceFacts({ type, vendor, auth, links = [] }: SourceFactsProps) {
  const doc = source(type);
  const catalog = resolveSourceCatalogMeta(type, { label: doc.label });
  const category = SOURCE_CATEGORY_META[catalog.category];
  const kinds = doc.assetsMetadata.map((asset) => asset.assetKind);
  const outbound = [
    vendor ? { ...vendor, role: "Product" } : null,
    auth ? { ...auth, role: "Credentials" } : null,
    ...links.map((link) => ({ ...link, role: "Reference" })),
  ].filter((entry): entry is { label: string; href: string; role: string } =>
    Boolean(entry),
  );

  return (
    <div className="my-6 space-y-4 rounded-[6px] border-2 border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-[6px] border-2 border-border bg-background">
          <SourceIcon source={type} size="lg" />
        </span>
        <div className="space-y-1">
          <p className="font-serif text-lg font-black uppercase tracking-[0.05em] text-foreground">
            {doc.label}
          </p>
          <p className="text-sm text-muted-foreground">{catalog.description}</p>
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Category
          </dt>
          <dd className="text-foreground">{category.label}</dd>
        </div>
        <div>
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Source type
          </dt>
          <dd className="font-mono text-xs text-foreground">{type}</dd>
        </div>
        {kinds.length > 0 ? (
          <div className="sm:col-span-2">
            <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Produces
            </dt>
            <dd className="flex flex-wrap gap-1.5 pt-1">
              {kinds.map((kind) => (
                <Badge key={kind} variant="outline" className="font-mono text-[11px]">
                  {kind}
                </Badge>
              ))}
            </dd>
          </div>
        ) : null}
        {outbound.length > 0 ? (
          <div className="sm:col-span-2">
            <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Links
            </dt>
            <dd className="flex flex-col gap-1 pt-1">
              {outbound.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-3"
                >
                  {link.label}
                  <span className="pl-2 font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                    {link.role}
                  </span>
                </a>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
