import { Badge } from "@workspace/ui/components";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import catalog from "@/src/_generated/mcp-catalog.json";

/**
 * The MCP tool catalog as the server registers it. The JSON is written by the
 * API's `bun run codegen` (scripts/generate-openapi-spec.ts), which reads the
 * tools back from the live MCP server — the same source the Settings page
 * uses — so these tables cannot drift from what clients actually see.
 */

type Parameter = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  format?: string;
  enumValues?: string[];
};

type Tool = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  parameters: Parameter[];
};

type Group = {
  id: string;
  title: string;
  description: string;
  operations: string[];
  tools: Tool[];
};

const groups = (catalog as { groups: Group[] }).groups;

function pick(ids?: string[]): Group[] {
  if (!ids) return groups;
  return ids
    .map((id) => groups.find((group) => group.id === id))
    .filter((group): group is Group => group !== undefined);
}

/** Every token scope: its id (for `toolGroupIds`), what it enables, how many tools. */
export function McpScopeTable() {
  return (
    <div className="overflow-x-auto rounded-[4px] border-2 border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Scope</TableHead>
            <TableHead>
              <code>toolGroupIds</code> id
            </TableHead>
            <TableHead>What it enables</TableHead>
            <TableHead>Tools</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <TableRow key={group.id}>
              <TableCell className="whitespace-nowrap text-sm font-medium">
                <a href={`#scope-${group.id}`}>{group.title}</a>
              </TableCell>
              <TableCell className="font-mono text-xs">{group.id}</TableCell>
              <TableCell className="max-w-[32rem] whitespace-normal text-xs text-muted-foreground">
                {group.description}
              </TableCell>
              <TableCell className="text-xs">{group.tools.length}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Hints({ tool }: { tool: Tool }) {
  return (
    <span className="flex flex-wrap gap-1">
      {tool.readOnly ? <Badge variant="secondary">read-only</Badge> : null}
      {tool.destructive ? (
        <Badge variant="outline" className="border-destructive/50 text-destructive">
          destructive
        </Badge>
      ) : null}
      {!tool.readOnly && !tool.destructive ? <Badge variant="outline">writes</Badge> : null}
      {tool.idempotent && !tool.readOnly ? <Badge variant="outline">idempotent</Badge> : null}
    </span>
  );
}

function Parameters({ parameters }: { parameters: Parameter[] }) {
  if (parameters.length === 0) {
    return <p className="text-xs text-muted-foreground">No parameters.</p>;
  }
  return (
    <table className="mt-2 w-full text-xs">
      <tbody>
        {parameters.map((p) => (
          <tr key={p.name} className="border-t border-border align-top">
            <td className="py-1 pr-3 font-mono whitespace-nowrap">
              {p.name}
              {p.required ? <span className="text-destructive">*</span> : null}
            </td>
            <td className="py-1 pr-3 font-mono whitespace-nowrap text-muted-foreground">
              {p.format ? `${p.type} (${p.format})` : p.type}
            </td>
            <td className="py-1 text-muted-foreground">
              {[p.description, p.enumValues?.length ? `One of: ${p.enumValues.join(", ")}` : null]
                .filter(Boolean)
                .join(" ") || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The tools of some scopes (all by default): what each does, whether it
 * writes, and its parameters (* = required).
 */
export function McpToolCatalog({ scopes }: { scopes?: string[] }) {
  return (
    <div className="space-y-8">
      {pick(scopes).map((group) => (
        <section key={group.id} className="space-y-3">
          <h3 id={`scope-${group.id}`} className="scroll-mt-24 text-lg font-semibold">
            {group.title} <span className="font-mono text-sm font-normal text-muted-foreground">{group.id}</span>
          </h3>
          <p className="text-sm text-muted-foreground">{group.description}</p>
          <div className="space-y-2">
            {group.tools.map((tool) => (
              <details key={tool.name} className="rounded-[4px] border-2 border-border px-3 py-2">
                <summary className="cursor-pointer list-none">
                  <span className="flex flex-wrap items-center gap-2">
                    <code className="text-sm font-semibold">{tool.name}</code>
                    <Hints tool={tool} />
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {tool.description}
                  </span>
                </summary>
                <Parameters parameters={tool.parameters} />
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
