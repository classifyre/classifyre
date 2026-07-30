"use client";

import { Fingerprint, KeyRound } from "lucide-react";

import { useTranslation } from "@/hooks/use-translation";

/**
 * The credential guarantee, stated in the interface rather than buried in docs.
 *
 * Not a dismissable toast and not a tooltip: it is the single most consequential
 * fact about an archive — that it is safe to hand to someone else, and that the
 * receiving instance will need its secrets re-entered — and it has to be visible
 * at the moment the operator decides to export, not after.
 */
export function SecretsNotice({ variant = "export" }: { variant?: "export" | "import" }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-start gap-2.5 rounded-[4px] border border-amber-500/35 bg-amber-500/[0.06] px-3 py-2.5">
      <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-700 dark:text-amber-500">
          {t("dataTransfer.secretsHeading")}
        </p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t(
            variant === "export"
              ? "dataTransfer.secretsExportBody"
              : "dataTransfer.secretsImportBody",
          )}
        </p>
        {variant === "export" ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("dataTransfer.noScheduleNote")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * States the one thing about an import that surprises people: nothing is
 * replaced. Records arrive under new identities and sit alongside what is
 * already there, which also means importing the same archive twice gives you
 * two copies. Better said plainly, before the operator commits, than discovered
 * afterwards.
 */
export function NewIdentitiesNotice() {
  const { t } = useTranslation();

  return (
    <div className="flex items-start gap-2.5 rounded-[4px] border border-border bg-muted/30 px-3 py-2.5">
      <Fingerprint className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em]">
          {t("dataTransfer.newIdsHeading")}
        </p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("dataTransfer.newIdsBody")}
        </p>
      </div>
    </div>
  );
}
