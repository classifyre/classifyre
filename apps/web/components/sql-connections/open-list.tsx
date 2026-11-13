"use client";

import Link from "next/link";
import { Database, Table2 } from "lucide-react";
import { Spinner } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useNamespace } from "@/components/namespace-provider";
import { ActorChip } from "@/components/actor-chip";
import { formatDate } from "@/lib/date";
import { useExposures } from "@/lib/sql-connections";

/**
 * What BI tools may reach at all (opt-in, DQ §5.7): every source and table
 * opened to SQL connections, by whom and when. Each opens its Governance
 * tab, where it is closed again.
 */
export function OpenToConnectionsList() {
  const { t } = useTranslation();
  const { nsHref } = useNamespace();
  const { items } = useExposures();
  return (
    <section className="space-y-2" data-testid="sql-open-list">
      <div>
        <h3 className="text-sm font-semibold">{t("sqlConnections.openListTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("sqlConnections.openListLead")}</p>
      </div>
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="rounded-[4px] border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          {t("sqlConnections.openListNone")}
        </p>
      ) : (
        <ul className="divide-y rounded-[4px] border">
          {items.map((item) => (
            <li
              key={`${item.type}:${item.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              {item.type === "source" ? (
                <Database className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Table2 className="h-4 w-4 text-muted-foreground" />
              )}
              <Link
                href={nsHref(
                  `/${item.type === "source" ? "sources" : "assets"}/${item.id}?tab=governance`,
                )}
                className="font-medium underline-offset-4 hover:underline"
              >
                {item.sqlName ?? item.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {item.type === "source"
                  ? t("sqlConnections.wholeSourceShort")
                  : t("sqlConnections.oneTable")}
              </span>
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                {t("sqlConnections.openedAt", { when: formatDate(item.openedAt) })}
                {item.openedBy && <ActorChip actorRef={item.openedBy} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
