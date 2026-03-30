"use client";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
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
  DetectorDocFieldRow,
  DetectorDocModel,
} from "@workspace/schemas/detector-docs";

type DetectorDocViewProps = {
  detector: DetectorDocModel;
};

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function lifecycleBadgeVariant(
  status: string,
): "secondary" | "outline" | "destructive" {
  if (status === "active") return "secondary";
  if (status === "deprecated") return "destructive";
  return "outline";
}

function mergeDescriptionWithEnum(row: DetectorDocFieldRow): string {
  const parts: string[] = [];
  if (row.description) parts.push(row.description);
  if (row.enumValues) parts.push(`Allowed values: ${row.enumValues}`);
  return parts.join(" ");
}

function FieldsTable({
  id,
  title,
  description,
  rows,
}: {
  id: string;
  title: string;
  description: string;
  rows: DetectorDocFieldRow[];
}) {
  return (
    <Card id={id} className="panel-card scroll-mt-24 rounded-[6px]">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No parameters in this section.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[4px] border-2 border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parameter</TableHead>
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

export function DetectorDocView({ detector }: DetectorDocViewProps) {
  const { catalogMeta } = detector;
  const schemaJson = prettyJson(detector.schema);

  return (
    <div className="space-y-6">
      <header id="detector-overview" className="scroll-mt-24 space-y-4">
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
            {detector.label}
          </h1>
          <p className="text-sm text-muted-foreground">
            Schema-driven detector documentation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary" className="border border-border">
            {detector.detectorType}
          </Badge>
          <Badge variant={lifecycleBadgeVariant(catalogMeta.lifecycleStatus)}>
            {catalogMeta.lifecycleStatus}
          </Badge>
          <Badge variant="outline">{catalogMeta.priority}</Badge>
          <Badge variant="outline">{detector.fieldRows.length} params</Badge>
          <Badge variant="outline">{detector.examples.length} examples</Badge>
        </div>
      </header>

      <Card
        id="detector-metadata"
        className="panel-card scroll-mt-24 rounded-[6px]"
      >
        <CardHeader>
          <CardTitle className="text-lg">Detector Metadata</CardTitle>
          <CardDescription>
            Capability catalog entry from <code>all_detectors.json</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                Categories
              </p>
              <div className="flex flex-wrap gap-1">
                {catalogMeta.categories.length > 0 ? (
                  catalogMeta.categories.map((cat) => (
                    <Badge key={cat} variant="outline" className="text-xs">
                      {cat}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                Supported Asset Types
              </p>
              <div className="flex flex-wrap gap-1">
                {catalogMeta.supportedAssetTypes.length > 0 ? (
                  catalogMeta.supportedAssetTypes.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="text-xs font-mono"
                    >
                      {t}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
            {catalogMeta.recommendedModel && (
              <div className="sm:col-span-2">
                <p className="mb-1 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                  Recommended Model
                </p>
                <code className="text-xs text-foreground">
                  {catalogMeta.recommendedModel}
                </code>
              </div>
            )}
            {catalogMeta.notes && (
              <div className="sm:col-span-2">
                <p className="mb-1 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                  Notes
                </p>
                <p className="text-sm text-muted-foreground">
                  {catalogMeta.notes}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="reference" className="space-y-4">
        <TabsList className="h-auto rounded-[4px] border-2 border-border bg-background p-1">
          <TabsTrigger value="reference" className="rounded-[3px]">
            Parameters
          </TabsTrigger>
          <TabsTrigger value="examples" className="rounded-[3px]">
            Examples
          </TabsTrigger>
          <TabsTrigger value="json" className="rounded-[3px]">
            Raw JSON Schema
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="reference"
          id="parameters"
          className="scroll-mt-24 space-y-4"
        >
          <FieldsTable
            id="detector-fields"
            title="Parameters"
            description={`Configuration parameters for the ${detector.label} detector. Shared from \`${detector.configDefinitionName}\`.`}
            rows={detector.fieldRows}
          />
        </TabsContent>

        <TabsContent
          value="examples"
          id="detector-examples"
          className="scroll-mt-24"
        >
          {detector.examples.length === 0 ? (
            <Card className="panel-card rounded-[6px]">
              <CardHeader>
                <CardTitle className="text-lg">No Examples Yet</CardTitle>
                <CardDescription>
                  Add entries to <code>all_detectors_examples.json</code> under
                  the key <code>{detector.detectorType}</code> to populate this
                  section.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card className="panel-card rounded-[6px]">
              <CardHeader>
                <CardTitle className="text-lg">Examples</CardTitle>
                <CardDescription>
                  Reference configs from{" "}
                  <code>all_detectors_examples.json</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {detector.examples.map((example, index) => (
                  <Card
                    key={`${example.name}-${index}`}
                    className="rounded-[6px] border-2 border-border shadow-none"
                  >
                    <CardHeader>
                      <CardTitle className="text-base">
                        {example.name}
                      </CardTitle>
                      <CardDescription>
                        {example.description || "Example configuration."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="mb-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                        Config
                      </p>
                      <pre className="overflow-x-auto rounded-[4px] border-2 border-border bg-card p-3 font-mono text-xs leading-6">
                        {prettyJson(example.config)}
                      </pre>
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
              <CardTitle className="text-lg">
                Raw Detector JSON Schema
              </CardTitle>
              <CardDescription>
                Resolved schema for <code>{detector.configDefinitionName}</code>
                .
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
