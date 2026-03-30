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
    <Card id={id} className="panel-card scroll-mt-24 rounded-[6px]">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No fields in this section.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[4px] border-2 border-border">
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
            <p className="text-sm text-muted-foreground">
              Schema-driven source documentation.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary" className="border border-border">
            {source.sourceType}
          </Badge>
          <Badge variant="outline">{source.fieldRows.length} fields</Badge>
          <Badge variant="outline">{source.examples.length} examples</Badge>
        </div>
      </header>

      {source.knowledgeSections.length > 0 ? (
        <Card
          id="common-questions"
          className="panel-card scroll-mt-24 rounded-[6px]"
        >
          <CardHeader>
            <CardTitle className="text-lg">Commonly Asked Questions</CardTitle>
            <CardDescription>
              Assistant knowledge mapped to this source type from{" "}
              <code>assistant_knowledge.json</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              {source.knowledgeSections.map((section) => (
                <AccordionItem key={section.key} value={section.key}>
                  <AccordionTrigger className="font-semibold">
                    {section.title}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    {section.summary ? (
                      <p className="text-sm text-muted-foreground">
                        {section.summary}
                      </p>
                    ) : null}
                    {section.suggestions.length > 0 ? (
                      <div>
                        <p className="mb-1 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                          Suggestions
                        </p>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {section.suggestions.map((suggestion, index) => (
                            <li key={`${section.key}-suggestion-${index}`}>
                              {suggestion}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {section.questions.length > 0 ? (
                      <div>
                        <p className="mb-1 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                          Typical Questions
                        </p>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {section.questions.map((question, index) => (
                            <li key={`${section.key}-question-${index}`}>
                              {question}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="reference" className="space-y-4">
        <TabsList className="h-auto rounded-[4px] border-2 border-border bg-background p-1">
          <TabsTrigger value="reference" className="rounded-[3px]">
            Schema Reference
          </TabsTrigger>
          <TabsTrigger value="json" className="rounded-[3px]">
            Raw JSON Schema
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
            description="Fields required for a valid configuration payload under `config.required`."
            rows={requiredRows}
          />
          <SectionTable
            id="masked-fields"
            title="Masked"
            description="Sensitive fields under `config.masked` (secrets/credentials)."
            rows={maskedRows}
          />
          <SectionTable
            id="optional-fields"
            title="Optional"
            description="Optional configuration fields under `config.optional`."
            rows={optionalRows}
          />

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
              className="panel-card scroll-mt-24 rounded-[6px]"
            >
              <CardHeader>
                <CardTitle className="text-lg">Examples</CardTitle>
                <CardDescription>
                  Reference payloads generated from shared source examples JSON.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {source.examples.map((example, index) => (
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
                    <CardContent className="space-y-3">
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
                      <div>
                        <p className="mb-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                          Config Payload
                        </p>
                        <pre className="overflow-x-auto rounded-[4px] border-2 border-border bg-card p-3 font-mono text-xs leading-6">
                          {prettyJson(example.config)}
                        </pre>
                      </div>
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
