"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Search, TableProperties } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { cn } from "@workspace/ui/lib/utils";
import { useCan, useMe } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";

export default function NewCasePickerPage() {
  return (
    <React.Suspense>
      <NewCasePickerInner />
    </React.Suspense>
  );
}

function NewCasePickerInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nsPath = useNsPath();
  const { t } = useTranslation();
  const me = useMe();
  const canEditCase = useCan("case.edit");
  const kind = searchParams.get("kind");

  // Forward any extra query params (e.g. inquiryId) when jumping directly.
  const extraParams = React.useMemo(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("kind");
    const str = next.toString();
    return str ? `?${str}` : "";
  }, [searchParams]);

  React.useEffect(() => {
    if (kind === "investigation") {
      router.replace(nsPath(`/cases/new/investigation${extraParams}`));
    } else if (kind === "data-request") {
      router.replace(nsPath(`/cases/new/data-request${extraParams}`));
    }
  }, [kind, router, nsPath, extraParams]);

  if (kind === "investigation" || kind === "data-request") {
    return null;
  }

  const investigationDisabled = me !== null && !canEditCase;

  return (
    <div className="container max-w-4xl space-y-6 py-8" data-testid="new-case-picker">
      <div>
        <Button
          variant="outline"
          asChild
          className="mb-4 rounded-[4px] border-2 border-border"
        >
          <Link href={nsPath("/cases")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("cases.newPicker.back")}
          </Link>
        </Button>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("cases.newPicker.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          {t("cases.newPicker.description")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {investigationDisabled ? (
          <Card
            className="h-full border-2 border-border/50 opacity-60 shadow-none"
            data-testid="new-case-kind-investigation"
            aria-disabled="true"
          >
            <CardContent className="flex h-full flex-col gap-4 p-6">
              <div className="flex size-12 items-center justify-center rounded-[4px] border-2 border-border/50 bg-muted/50 text-muted-foreground">
                <Search className="size-6" aria-hidden />
              </div>
              <div className="space-y-2">
                <h2 className="font-serif text-xl font-bold uppercase tracking-[0.04em]">
                  {t("cases.newPicker.investigationTitle")}
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("cases.newPicker.investigationDescription")}
                </p>
              </div>
              <p className="mt-auto font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                {t("cases.newPicker.investigationNoPermission")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Link
            href={nsPath(`/cases/new/investigation${extraParams}`)}
            className="group block h-full rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            data-testid="new-case-kind-investigation"
          >
            <Card className="h-full border-2 border-border shadow-none transition-colors group-hover:border-foreground group-hover:bg-muted/30">
              <CardContent className="flex h-full flex-col gap-4 p-6">
                <div className="flex size-12 items-center justify-center rounded-[4px] border-2 border-border bg-background text-foreground">
                  <Search className="size-6" aria-hidden />
                </div>
                <div className="space-y-2">
                  <h2 className="font-serif text-xl font-bold uppercase tracking-[0.04em] decoration-2 underline-offset-4 group-hover:underline">
                    {t("cases.newPicker.investigationTitle")}
                  </h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t("cases.newPicker.investigationDescription")}
                  </p>
                </div>
                <span className="mt-auto inline-flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-foreground/80 group-hover:text-foreground">
                  {t("cases.newPicker.investigationAction")}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </CardContent>
            </Card>
          </Link>
        )}

        <Link
          href={nsPath(`/cases/new/data-request${extraParams}`)}
          className="group block h-full rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          data-testid="new-case-kind-data-request"
        >
          <Card
            className={cn(
              "h-full border-2 border-border border-l-4 border-l-sky-500 shadow-none transition-colors",
              "group-hover:border-sky-500 group-hover:bg-sky-50/40 dark:group-hover:bg-sky-950/20",
            )}
          >
            <CardContent className="flex h-full flex-col gap-4 p-6">
              <div className="flex size-12 items-center justify-center rounded-[4px] border-2 border-sky-500/40 bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400">
                <TableProperties className="size-6" aria-hidden />
              </div>
              <div className="space-y-2">
                <h2 className="font-serif text-xl font-bold uppercase tracking-[0.04em] decoration-2 underline-offset-4 group-hover:underline">
                  {t("cases.newPicker.dataRequestTitle")}
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("cases.newPicker.dataRequestDescription")}
                </p>
              </div>
              <span className="mt-auto inline-flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-sky-700 dark:text-sky-400">
                {t("cases.newPicker.dataRequestAction")}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
