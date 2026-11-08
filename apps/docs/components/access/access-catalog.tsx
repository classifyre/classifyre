import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import catalog from "@/src/_generated/access-catalog.json";

/**
 * Every role and capability as the API enforces them. The JSON is written by
 * the API's `bun run codegen` (scripts/generate-openapi-spec.ts) from
 * `apps/api/src/identity/roles.ts` and `capabilities.ts`, so these tables
 * cannot drift from what Classifyre allows.
 */

type Capability = { id: string; scope: string; description: string };
type Role = {
  key: string;
  title: string;
  scope: string;
  capabilities: string[];
};

const { capabilities, roles } = catalog as {
  capabilities: Capability[];
  roles: Role[];
};

/** Roles that can be granted, in the order the API lists them. */
const GRANTABLE = roles.filter(
  (role) => role.scope === "workspace" || role.scope === "tenant",
);

const AREAS: { title: string; prefixes: string[] }[] = [
  { title: "Workspace", prefixes: ["workspace.", "access."] },
  { title: "Sources and scans", prefixes: ["source."] },
  { title: "Findings and assets", prefixes: ["finding.", "asset."] },
  { title: "Detectors and code", prefixes: ["detector.", "code."] },
  { title: "Investigations", prefixes: ["case.", "inquiry.", "lead."] },
  {
    title: "Glossary and entities",
    prefixes: ["glossary.", "entity.", "correlation."],
  },
  { title: "Assistant, export and MCP", prefixes: ["agent.", "data.", "mcp."] },
  { title: "Tenant", prefixes: ["tenant."] },
];

const WHERE: Record<string, string> = {
  workspace:
    "On one workspace, every workspace a group owns, or the whole tenant",
  tenant: "On the whole tenant, or every workspace a group owns",
  platform:
    "Not granted in Classifyre: the identity server's realm role `classifyre-operator`",
  public: "Never granted: people who have not signed in, on the public tenant",
};

function short(title: string): string {
  return title
    .replace("Workspace ", "WS ")
    .replace("Source manager", "Source mgr");
}

/** One row per role: where it can be given and how many capabilities it holds. */
export function RoleTable() {
  return (
    <div className="overflow-x-auto rounded-[4px] border-2 border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Given</TableHead>
            <TableHead className="text-right">Capabilities</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => (
            <TableRow key={role.key}>
              <TableCell className="font-medium">{role.title}</TableCell>
              <TableCell>
                <code>{role.key}</code>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {WHERE[role.scope]}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {role.capabilities.length}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Every capability, grouped by area, with a mark under each grantable role that holds it. */
export function CapabilityMatrix() {
  return (
    <div className="overflow-x-auto rounded-[4px] border-2 border-border">
      <Table className="text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-64">Capability</TableHead>
            {GRANTABLE.map((role) => (
              <TableHead
                key={role.key}
                className="whitespace-nowrap text-center text-xs"
                title={role.title}
              >
                {short(role.title)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {AREAS.map((area) => {
            const rows = capabilities.filter((capability) =>
              area.prefixes.some((prefix) => capability.id.startsWith(prefix)),
            );
            if (rows.length === 0) return null;
            return [
              <TableRow
                key={area.title}
                className="bg-muted/40 hover:bg-muted/40"
              >
                <TableCell
                  colSpan={GRANTABLE.length + 1}
                  className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em]"
                >
                  {area.title}
                </TableCell>
              </TableRow>,
              ...rows.map((capability) => (
                <TableRow key={capability.id}>
                  <TableCell>
                    <code>{capability.id}</code>
                    <div className="text-xs text-muted-foreground">
                      {capability.description}
                    </div>
                  </TableCell>
                  {GRANTABLE.map((role) => {
                    const has = role.capabilities.includes(capability.id);
                    return (
                      <TableCell
                        key={role.key}
                        className="text-center"
                        aria-label={`${role.title}: ${has ? "yes" : "no"}`}
                      >
                        {has ? (
                          "●"
                        ) : (
                          <span className="text-muted-foreground/40">·</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              )),
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}
