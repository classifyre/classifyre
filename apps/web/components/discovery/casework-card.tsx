"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { nsPath } from "@/lib/ns-path";
import { CasesTable } from "@/components/cases-table";
import { PanelCard, panelHeadingClass } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";

/**
 * What is being investigated right now.
 *
 * This is deliberately not its own list. It used to be one — status tiles, a
 * hand-rolled row for each recent case, an inquiries/leads strip — and it drifted
 * from the investigations page it links to: a different badge, a different
 * severity treatment, a different idea of what a case row looks like. The card
 * is now a header over the real `CasesTable`, so the dashboard and the page it
 * sends you to can no longer disagree about how a case is drawn.
 */
export function CaseworkCard() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <PanelCard className="flex min-h-[320px] flex-col overflow-hidden sm:col-span-2 xl:col-span-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className={panelHeadingClass}>{t("casework.title")}</h3>
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            {t("casework.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push(nsPath("/investigations"))}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-[4px] border-2 border-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
        >
          {t("casework.viewAll")} <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <CasesTable variant="compact" limit={6} />
    </PanelCard>
  );
}
