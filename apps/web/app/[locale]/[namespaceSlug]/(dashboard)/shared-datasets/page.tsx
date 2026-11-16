"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, Plus, Share2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import {
  useSharedDatasetOptions,
  useSharedDatasets,
} from "@/lib/shared-datasets";
import { DatasetBadges } from "@/components/shared-datasets/dataset-cards";
import { GovernanceBadge } from "@/components/governance/governance-badge";

/**
 * Shared datasets (docs/prd/DQ-data-query.md §5.12): every saved query shared
 * here, findable by everyone who sees assets; locked ones say so and lead to
 * *Request access* on their page.
 */
export default function SharedDatasetsPage() {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const datasets = useSharedDatasets();
  const options = useSharedDatasetOptions();
  const [search, setSearch] = React.useState("");
  const needle = search.trim().toLowerCase();
  const rows = (datasets.data ?? []).filter(
    (row) =>
      !needle ||
      row.sqlName.includes(needle) ||
      (row.description ?? "").toLowerCase().includes(needle) ||
      row.owningGroup.name.toLowerCase().includes(needle),
  );

  return (
    <div className="space-y-6" data-testid="shared-datasets-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Share2 className="h-7 w-7" aria-hidden />
          <div>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              {t("sharedDatasets.page.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("sharedDatasets.page.lead")}
            </p>
          </div>
        </div>
        {options.data?.canShare && (
          <Button asChild data-testid="new-shared-dataset">
            <Link href={nsPath("/query")}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t("sharedDatasets.page.new")}
            </Link>
          </Button>
        )}
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("sharedDatasets.page.search")}
        className="max-w-sm"
      />

      {datasets.loading && !datasets.data ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Share2}
          title={t("sharedDatasets.page.emptyTitle")}
          description={t("sharedDatasets.page.emptyLead")}
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sharedDatasets.page.dataset")}</TableHead>
                  <TableHead>{t("sharedDatasets.overview.owner")}</TableHead>
                  <TableHead>
                    {t("sharedDatasets.overview.owningGroup")}
                  </TableHead>
                  <TableHead>{t("sharedDatasets.page.trust")}</TableHead>
                  <TableHead className="text-right">
                    {t("sharedDatasets.page.inputs")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.assetId} data-testid="shared-dataset-row">
                    <TableCell className="max-w-md">
                      <Link
                        href={nsPath(`/assets/${row.assetId}`)}
                        className="flex items-center gap-1.5 font-mono text-sm hover:underline"
                      >
                        {!row.canQuery && (
                          <Lock
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-label={t("sharedDatasets.page.locked")}
                          />
                        )}
                        {row.sqlName}
                      </Link>
                      {row.description && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {row.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.owner?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.owningGroup.name}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <GovernanceBadge status={row.lifecycle} />
                        <DatasetBadges dataset={row} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.inputCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
