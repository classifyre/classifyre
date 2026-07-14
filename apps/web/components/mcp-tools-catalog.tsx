"use client";

import * as React from "react";
import { api, type McpToolSummaryDto } from "@workspace/api-client";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
} from "@workspace/ui/components";
import {
  ChevronRight,
  Loader2,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

type ToolGroup = {
  id: string;
  title: string;
  tools: McpToolSummaryDto[];
};

/** Group id → editorial order; unknown groups fall to the end alphabetically. */
const GROUP_ORDER = [
  "sources",
  "custom_detectors",
  "runs",
  "findings",
  "assets",
  "inquiries",
  "cases",
  "correlation",
];

function groupTools(tools: McpToolSummaryDto[]): ToolGroup[] {
  const byGroup = new Map<string, ToolGroup>();

  for (const tool of tools) {
    const id = tool.groupId ?? "other";
    const title = tool.groupTitle ?? "Other";
    const existing = byGroup.get(id);
    if (existing) {
      existing.tools.push(tool);
    } else {
      byGroup.set(id, { id, title, tools: [tool] });
    }
  }

  return [...byGroup.values()].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a.id);
    const bi = GROUP_ORDER.indexOf(b.id);
    if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function AnnotationPill({
  tone,
  children,
}: {
  tone: "read" | "warn" | "idem";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "warn"
      ? "border-destructive/40 text-destructive"
      : tone === "read"
        ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
        : "border-border text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center rounded-[3px] border bg-transparent px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${toneClass}`}
    >
      {children}
    </span>
  );
}

function ToolRow({ tool }: { tool: McpToolSummaryDto }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-[6px] border border-border bg-background transition-colors hover:border-foreground/20 data-[state=open]:border-foreground/25">
        <CollapsibleTrigger className="group flex w-full items-start gap-3 px-3 py-3 text-left">
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <code className="font-mono text-[13px] font-medium text-foreground">
                {tool.name}
              </code>
              {tool.readOnly ? (
                <AnnotationPill tone="read">
                  {t("mcp.catalog.readOnly")}
                </AnnotationPill>
              ) : null}
              {tool.destructive ? (
                <AnnotationPill tone="warn">
                  {t("mcp.catalog.destructive")}
                </AnnotationPill>
              ) : null}
              {tool.idempotent && !tool.readOnly ? (
                <AnnotationPill tone="idem">
                  {t("mcp.catalog.idempotent")}
                </AnnotationPill>
              ) : null}
            </div>
            {tool.description ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {tool.description}
              </p>
            ) : null}
          </div>
          <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {tool.parameters.length > 0
              ? `${tool.parameters.length} ${tool.parameters.length === 1 ? "arg" : "args"}`
              : "0 args"}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-4 border-t border-dashed border-border px-3 py-3 pl-[30px]">
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("mcp.catalog.input")}
              </p>
              {tool.parameters.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("mcp.catalog.noInput")}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-[4px] border border-border">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        <th className="px-3 py-2 font-medium">
                          {t("mcp.catalog.paramName")}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t("mcp.catalog.paramType")}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t("mcp.catalog.paramRequired")}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t("mcp.catalog.paramDescription")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tool.parameters.map((param) => (
                        <tr
                          key={param.name}
                          className="border-b border-border last:border-b-0 align-top"
                        >
                          <td className="px-3 py-2">
                            <code className="font-mono text-[12px] text-foreground">
                              {param.name}
                            </code>
                          </td>
                          <td className="px-3 py-2">
                            <code className="font-mono text-[11px] text-muted-foreground">
                              {param.type}
                              {param.format ? `:${param.format}` : ""}
                            </code>
                            {param.enumValues && param.enumValues.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {param.enumValues.map((value) => (
                                  <code
                                    key={value}
                                    className="rounded-[3px] border border-border bg-muted/40 px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
                                  >
                                    {value}
                                  </code>
                                ))}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            {param.required ? (
                              <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-500">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                                {t("mcp.catalog.required")}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {t("mcp.catalog.optional")}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {param.description ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("mcp.catalog.output")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("mcp.catalog.outputJson")}
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function McpToolsCatalog({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const [tools, setTools] = React.useState<McpToolSummaryDto[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.instanceSettings
      .mcpSettingsControllerGetTools()
      .then((next) => {
        if (!cancelled) {
          setTools(next);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("mcp.catalog.loadError"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, t]);

  const filtered = React.useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return tools;
    }
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(trimmed) ||
        tool.title?.toLowerCase().includes(trimmed) ||
        tool.description?.toLowerCase().includes(trimmed),
    );
  }, [query, tools]);

  const groups = React.useMemo(() => groupTools(filtered), [filtered]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t("mcp.catalog.title")}
            </p>
            {tools.length > 0 ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {t("mcp.catalog.toolCount", { count: tools.length })}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {t("mcp.catalog.description")}
          </p>
        </div>

        {enabled && tools.length > 0 ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("mcp.catalog.search")}
              className="h-8 w-56 pl-8 text-xs"
            />
          </div>
        ) : null}
      </div>

      {!enabled ? (
        <div className="rounded-[6px] border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          {t("mcp.catalog.enableToView")}
        </div>
      ) : loading ? (
        <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("mcp.loading")}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-[6px] border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" />
          {error}
        </div>
      ) : tools.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          {t("mcp.catalog.empty")}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          {t("mcp.catalog.noMatches", { query: query.trim() })}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground">
                  {group.title}
                </p>
                <span className="h-px flex-1 bg-border" />
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  {group.tools.length}
                </span>
              </div>
              <div className="grid gap-2">
                {group.tools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
