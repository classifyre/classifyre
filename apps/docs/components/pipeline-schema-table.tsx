import { Badge } from "@workspace/ui/components";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { getPipelineSchemaFieldRows } from "@workspace/schemas/pipeline-schema-utils";

type PipelineSchemaTableProps = {
  definition: string;
};

export function PipelineSchemaTable({ definition }: PipelineSchemaTableProps) {
  const rows = getPipelineSchemaFieldRows(definition);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No parameters found for <code>{definition}</code>.
      </p>
    );
  }

  return (
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
            <TableRow key={row.path}>
              <TableCell className="max-w-[14rem] whitespace-normal break-all font-mono text-xs">
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
                {[row.description, row.enumValues ? `Allowed: ${row.enumValues}` : undefined]
                  .filter(Boolean)
                  .join(" ") || "—"}
              </TableCell>
              <TableCell className="max-w-[12rem] whitespace-normal break-words font-mono text-xs">
                {row.defaultValue ?? "—"}
              </TableCell>
              <TableCell className="max-w-[14rem] whitespace-normal break-words text-xs">
                {row.constraints ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
