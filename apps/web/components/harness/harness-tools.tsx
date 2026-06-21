"use client";

import * as React from "react";
import { api, type HarnessToolDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { cn } from "@workspace/ui/lib/utils";
import { Eye, Loader2, Pencil, Wrench } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

/**
 * The live tool registry — every capability the harness can call (read/mutate +
 * gated domain), grouped by namespace. Newly registered tools (incl. external
 * MCP servers) show up here automatically.
 */
export function HarnessTools() {
  const { t } = useTranslation();
  const [tools, setTools] = React.useState<HarnessToolDto[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    api.autopilot
      .autopilotControllerGetTools()
      .then((res) => setTools(res.tools))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const grouped = React.useMemo(() => {
    const map = new Map<string, HarnessToolDto[]>();
    for (const tool of tools) {
      const prefix = tool.name.split(".")[0] ?? "misc";
      const list = map.get(prefix) ?? [];
      list.push(tool);
      map.set(prefix, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tools]);

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("harness.loading")}
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title={t("harness.tools.none")}
        description={t("harness.tools.desc")}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-[#d97706]" />
        <h3 className="font-serif text-lg font-black uppercase tracking-[0.03em]">
          {t("harness.tools.registry")}
        </h3>
        <Badge variant="outline" className="font-mono text-[10px]">
          {t("harness.tools.toolCount", { count: tools.length })}
        </Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {grouped.map(([prefix, list]) => (
          <div
            key={prefix}
            className="rounded-[4px] border-2 border-border bg-card p-3"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground">
              {prefix}
            </p>
            <ul className="mt-2 space-y-1.5">
              {list.map((tool) => (
                <ToolRow key={tool.name} tool={tool} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolRow({ tool }: { tool: HarnessToolDto }) {
  const { t } = useTranslation();
  const mutate = tool.sideEffect === "mutate";
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "mt-0.5 inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px font-mono text-[9px] uppercase tracking-wide",
          mutate
            ? "border-[#d97706]/50 text-[#d97706]"
            : "border-stone-400/40 text-stone-500",
        )}
      >
        {mutate ? <Pencil className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
        {mutate ? t("harness.tools.mutate") : t("harness.tools.read")}
      </span>
      <div className="min-w-0">
        <p className="font-mono text-xs">{tool.name}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {tool.description}
        </p>
        {tool.domain && (
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground/70">
            {t("harness.tools.domain")}: {tool.domain}
          </span>
        )}
      </div>
    </li>
  );
}
