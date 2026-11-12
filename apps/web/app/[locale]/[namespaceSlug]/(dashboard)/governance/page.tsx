"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useCan } from "@/hooks/use-me";
import { useNsPath } from "@/lib/ns-path";
import { useGovernanceSummary } from "@/lib/governance";
import { AuditEventList } from "@/components/audit-history";

function Share({ part, whole }: { part: number; whole: number }) {
  const pct = whole ? Math.round((part / whole) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-accent-ink" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {part}/{whole}
      </span>
    </div>
  );
}

/**
 * How far this workspace is governed (docs/prd/GOV-governed-data-assets.md
 * §5.7): coverage per source, the ungoverned tables people read most, what
 * is yours, and the latest governance changes.
 */
export default function GovernancePage() {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const canSeeActivity = useCan("activity.view");
  const { data, loading } = useGovernanceSummary();

  return (
    <div className="space-y-6" data-testid="governance-page">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7" aria-hidden />
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
            {t("governance.page.title")}
          </h1>
          <p className="text-muted-foreground">{t("governance.page.lead")}</p>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["assets", data.totals.assets],
                ["owned", data.totals.owned],
                ["active", data.totals.active],
                ["ungoverned", data.totals.assets - data.totals.owned],
              ] as const
            ).map(([key, value]) => (
              <Card key={key}>
                <CardContent className="p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    {t(`governance.page.totals.${key}`)}
                  </p>
                  <p className="mt-1 text-3xl font-black">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2">
              <CardHeader>
                <CardTitle>{t("governance.page.first.title")}</CardTitle>
                <CardDescription>
                  {t("governance.page.first.description", { days: data.days })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.governFirst.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("governance.page.first.none")}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t("governance.page.first.asset")}
                        </TableHead>
                        <TableHead>{t("common.source")}</TableHead>
                        <TableHead className="text-right">
                          {t("governance.usage.reads")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("governance.usage.readers")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.governFirst.map((row) => (
                        <TableRow
                          key={row.assetId}
                          data-testid="govern-first-row"
                        >
                          <TableCell>
                            <Link
                              href={nsPath(`/assets/${row.assetId}`)}
                              className="font-medium hover:underline"
                            >
                              {row.name}
                            </Link>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.sourceName}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.reads}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.readers}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("governance.page.mine.title")}</CardTitle>
                <CardDescription>
                  {t("governance.page.mine.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Link
                  className="block hover:underline"
                  href={nsPath("/assets?governance=mine")}
                >
                  {t("governance.page.mine.owned", { count: data.mine.owned })}
                </Link>
                <Link
                  className="block hover:underline"
                  href={nsPath("/assets?governance=stewarding")}
                >
                  {t("governance.page.mine.stewarded", {
                    count: data.mine.stewarded,
                  })}
                </Link>
                <Link
                  className="block hover:underline"
                  href={nsPath("/assets?governance=ungoverned")}
                >
                  {t("governance.page.mine.ungoverned")}
                </Link>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("governance.page.sources.title")}</CardTitle>
              <CardDescription>
                {t("governance.page.sources.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.source")}</TableHead>
                    <TableHead>{t("governance.page.totals.owned")}</TableHead>
                    <TableHead>{t("governance.page.totals.active")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sources.map((source) => (
                    <TableRow key={source.sourceId}>
                      <TableCell>
                        <Link
                          href={nsPath(`/sources/${source.sourceId}`)}
                          className="font-medium hover:underline"
                        >
                          {source.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Share part={source.owned} whole={source.assets} />
                      </TableCell>
                      <TableCell>
                        <Share part={source.active} whole={source.assets} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {canSeeActivity && (
            <Card>
              <CardHeader>
                <CardTitle>{t("governance.page.activity")}</CardTitle>
              </CardHeader>
              <CardContent>
                <AuditEventList
                  filter={{ resource: "governance" }}
                  showEntity
                />
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
