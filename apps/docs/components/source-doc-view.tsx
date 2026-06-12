"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import type {
  SourceAssetMetadata,
  SourceDocFieldRow,
  SourceDocModel,
} from "@workspace/schemas/source-docs";

type SourceDocViewProps = {
  source: SourceDocModel;
};

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function mergeDescriptionWithEnum(row: SourceDocFieldRow): string {
  const parts: string[] = [];
  if (row.description) {
    parts.push(row.description);
  }
  if (row.enumValues) {
    parts.push(`Allowed values: ${row.enumValues}`);
  }
  return parts.join(" ");
}

function rowsForSection(
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

function SectionTable({
  id,
  title,
  description,
  rows,
}: {
  id: string;
  title: string;
  description: string;
  rows: SourceDocFieldRow[];
}) {
  return (
    <Card id={id} className="p-0 border-none shadow-none bg-background">
      <CardHeader className="p-0">
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No fields in this section.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[4px] border-2 border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Path</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Constraints</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${title}-${row.path}-${row.type}`}>
                    <TableCell className="max-w-[16rem] whitespace-normal break-all font-mono text-xs">
                      {row.path}
                    </TableCell>
                    <TableCell className="max-w-[10rem] whitespace-normal break-words font-mono text-xs">
                      {row.type}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.required ? "secondary" : "outline"}>
                        {row.required ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[28rem] whitespace-normal break-words text-xs text-muted-foreground">
                      {mergeDescriptionWithEnum(row) || "—"}
                    </TableCell>
                    <TableCell className="max-w-[14rem] whitespace-normal break-words font-mono text-xs">
                      {row.defaultValue ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[16rem] whitespace-normal break-words text-xs">
                      {row.constraints ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssetsMetadataSection({ assets }: { assets: SourceAssetMetadata[] }) {
  if (assets.length === 0) {
    return null;
  }

  return (
    <Card
      id="extracted-metadata"
      className="p-0 border-none shadow-none bg-background"
    >
      <CardHeader className="p-0">
        <CardTitle className="text-lg">Extracted Metadata</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 p-0">
        {assets.map((asset) => (
          <div key={asset.assetKind} className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{asset.label}</h3>
            </div>
            <div className="overflow-x-auto rounded-[4px] border-2 border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Required</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {asset.fields.map((field) => (
                    <TableRow key={`${asset.assetKind}-${field.name}`}>
                      <TableCell className="font-mono text-xs">
                        {field.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {field.type}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={field.required ? "secondary" : "outline"}
                        >
                          {field.required ? "Yes" : "No"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[28rem] whitespace-normal break-words text-xs text-muted-foreground">
                        {field.description || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function SourceDocView({ source }: SourceDocViewProps) {
  const schemaJson = prettyJson(source.schema);
  const requiredRows = rowsForSection(source.fieldRows, "required");
  const maskedRows = rowsForSection(source.fieldRows, "masked");
  const optionalRows = rowsForSection(source.fieldRows, "optional");

  return (
    <div className="space-y-6">
      <header id="source-overview" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-[6px] border-2 border-border bg-card">
            <SourceIcon source={source.sourceType} size="lg" />
          </div>
          <div>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              {source.label}
            </h1>
          </div>
        </div>
      </header>

      <Tabs defaultValue="reference" className="space-y-4">
        <TabsList className="h-auto rounded-[4px] border-2 border-border bg-background p-1">
          <TabsTrigger value="reference" className="rounded-[3px]">
            Schema Reference
          </TabsTrigger>
          <TabsTrigger value="json" className="rounded-[3px]">
            JSON Schema
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="reference"
          id="schema-reference"
          className="scroll-mt-24 space-y-4"
        >
          <SectionTable
            id="required-fields"
            title="Required"
            description="Fields required for a valid configuration."
            rows={requiredRows}
          />
          <SectionTable
            id="masked-fields"
            title="Masked"
            description="Sensitive fields under(secrets/credentials)."
            rows={maskedRows}
          />
          <SectionTable
            id="optional-fields"
            title="Optional"
            description="Optional configuration fields."
            rows={optionalRows}
          />

          <AssetsMetadataSection assets={source.assetsMetadata} />

          {source.examples.length === 0 ? (
            <Card
              id="source-examples"
              className="panel-card scroll-mt-24 rounded-[6px]"
            >
              <CardHeader>
                <CardTitle className="text-lg">No Examples Yet</CardTitle>
                <CardDescription>
                  Add entries to <code>all_input_examples.json</code> for this
                  source type to populate this section.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card
              id="source-examples"
              className="p-0 border-none shadow-none bg-background"
            >
              <CardHeader className="p-0">
                <CardTitle className="text-lg">Examples</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-0">
                {source.examples.map((example, index) => (
                  <Card
                    key={`${example.name}-${index}`}
                    className="p-0 border-none shadow-none bg-background"
                  >
                    <CardHeader className="p-0">
                      <CardTitle className="text-base">
                        {example.name}
                      </CardTitle>
                      <CardDescription className="p-0">
                        {example.description || "Example configuration."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 p-0">
                      <div>
                        <p className="mb-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                          Config Payload
                        </p>
                        <pre className="overflow-x-auto rounded-[4px] border-2 border-border bg-card p-3 font-mono text-xs leading-6">
                          {prettyJson(example.config)}
                        </pre>
                      </div>
                      {example.schedule ? (
                        <div>
                          <p className="mb-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                            Schedule
                          </p>
                          <pre className="overflow-x-auto rounded-[4px] border-2 border-border bg-card p-3 font-mono text-xs leading-6">
                            {prettyJson(example.schedule)}
                          </pre>
                        </div>
                      ) : null}

                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="json">
          <Card className="panel-card rounded-[6px]">
            <CardHeader>
              <CardTitle className="text-lg">Raw Source JSON Schema</CardTitle>
              <CardDescription>
                Resolved schema definition for this source type.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto rounded-[4px] border-2 border-border bg-card p-4">
                <pre className="min-w-max font-mono text-xs leading-6">
                  {schemaJson}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
