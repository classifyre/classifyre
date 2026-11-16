"use client";

import * as React from "react";
import Link from "next/link";
import {
  Ban,
  ChevronDown,
  ChevronRight,
  Crown,
  GitBranch,
  History,
  Loader2,
  Megaphone,
  PencilLine,
  Share2,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ToneBadge,
} from "@workspace/ui/components";
import { Textarea } from "@workspace/ui/components/textarea";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { useNsPath } from "@/lib/ns-path";
import { columnAccessFor } from "@/lib/column-access";
import { apiErrorMessage } from "@/lib/data-query";
import {
  blockDataset,
  promoteDataset,
  unblockDataset,
  useSharedDatasetUses,
  useSharedDatasetVersions,
  type SharedDatasetDto,
  type SharedDatasetSummaryDto,
} from "@/lib/shared-datasets";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import { InheritedTag } from "./inherited-tag";

const STATE_TONE = {
  live: "active",
  blocked: "error",
  unavailable: "error",
  retired: "archived",
} as const;

/** The badges a shared dataset carries in headers and lists (§5.12). */
export function DatasetBadges({
  dataset,
}: {
  dataset: Pick<SharedDatasetSummaryDto, "promoted" | "state" | "stateReason">;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ToneBadge tone="fresh" data-testid="dataset-badge">
        <Share2 className="h-3 w-3" aria-hidden />
        {t("sharedDatasets.badge")}
      </ToneBadge>
      {dataset.promoted && (
        <ToneBadge tone="done" data-testid="dataset-promoted">
          <Megaphone className="h-3 w-3" aria-hidden />
          {t("sharedDatasets.promoted")}
        </ToneBadge>
      )}
      {dataset.state !== "live" && (
        <span title={dataset.stateReason ?? undefined}>
          <ToneBadge
            tone={STATE_TONE[dataset.state]}
            data-testid="dataset-state"
          >
            {t(`sharedDatasets.state.${dataset.state}` as TranslationKey)}
          </ToneBadge>
        </span>
      )}
    </>
  );
}

/** Overview: what it is, who answers for it, what it reads. */
export function DatasetOverviewCard({
  dataset,
  onChange,
}: {
  dataset: SharedDatasetDto;
  onChange: (next: SharedDatasetDto) => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const [busy, setBusy] = React.useState(false);
  const togglePromoted = async () => {
    setBusy(true);
    try {
      onChange(await promoteDataset(dataset.assetId, !dataset.promoted));
    } catch (caught) {
      toast.error(await apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="dataset-overview">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-base">{dataset.sqlName}</code>
          <DatasetBadges dataset={dataset} />
        </CardTitle>
        <CardDescription>
          {dataset.description || t("sharedDatasets.overview.noDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {dataset.state !== "live" && dataset.stateReason && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            {dataset.stateReason}
          </p>
        )}
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("sharedDatasets.overview.owner")}
            </dt>
            <dd className="flex items-center gap-1 font-medium">
              <Crown className="h-3.5 w-3.5 text-muted-foreground" />
              {dataset.owner?.name ?? t("sharedDatasets.overview.noOwner")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("sharedDatasets.overview.owningGroup")}
            </dt>
            <dd className="font-medium">{dataset.owningGroup.name}</dd>
            <dd className="text-xs text-muted-foreground">
              {t("sharedDatasets.overview.owningGroupHint")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("sharedDatasets.overview.version")}
            </dt>
            <dd className="font-medium">
              {t("sharedDatasets.overview.versionValue", {
                version: dataset.version,
                date: new Date(dataset.updatedAt).toLocaleDateString(),
              })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("sharedDatasets.overview.promoted")}
            </dt>
            <dd className="flex items-center gap-2">
              {dataset.promoted
                ? t("sharedDatasets.overview.promotedBy", {
                    name: dataset.promotedBy?.name ?? "—",
                  })
                : t("sharedDatasets.overview.notPromoted")}
              {dataset.canPromote && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void togglePromoted()}
                  data-testid="dataset-promote"
                >
                  {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {dataset.promoted
                    ? t("sharedDatasets.overview.unpromote")
                    : t("sharedDatasets.overview.promote")}
                </Button>
              )}
            </dd>
          </div>
        </dl>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {t("sharedDatasets.overview.reads", {
              count: dataset.inputs.length,
            })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {dataset.inputs.map((input) => (
              <Link
                key={input.assetId}
                href={nsPath(`/assets/${input.assetId}`)}
                className="inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs hover:bg-muted"
              >
                <GitBranch className="h-3 w-3 text-muted-foreground" />
                {input.sqlName}
              </Link>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Definition: the SQL as shared, its versions, and where to change it. */
export function DatasetDefinitionCard({
  dataset,
}: {
  dataset: SharedDatasetDto;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const versions = useSharedDatasetVersions(dataset.assetId);
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <div className="space-y-4">
      <Card data-testid="dataset-definition">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
          <div className="space-y-1">
            <CardTitle>{t("sharedDatasets.definition.title")}</CardTitle>
            <CardDescription>
              {t("sharedDatasets.definition.lead")}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link
                href={nsPath(
                  `/query?sql=${encodeURIComponent(`SELECT * FROM ${dataset.sqlName} LIMIT 100`)}`,
                )}
              >
                {t("sharedDatasets.definition.query")}
              </Link>
            </Button>
            {dataset.canEdit && (
              <Button size="sm" asChild data-testid="dataset-edit">
                <Link href={nsPath(`/query?dataset=${dataset.assetId}`)}>
                  <PencilLine className="mr-1.5 h-3.5 w-3.5" />
                  {t("sharedDatasets.definition.edit")}
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {dataset.sql}
          </pre>
        </CardContent>
      </Card>

      <DatasetColumnsCard dataset={dataset} />

      <Card data-testid="dataset-versions">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t("sharedDatasets.definition.versions")}
          </CardTitle>
          <CardDescription>
            {t("sharedDatasets.definition.versionsLead")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {versions.loading && (
            <p className="text-xs text-muted-foreground">
              {t("common.loading")}
            </p>
          )}
          <ul className="divide-y rounded-md border text-sm">
            {(versions.data ?? []).map((version) => (
              <li key={version.version}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() =>
                    setOpen((current) =>
                      current === version.version ? null : version.version,
                    )
                  }
                >
                  {open === version.version ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <span className="font-medium">
                    {t("sharedDatasets.definition.version", {
                      version: version.version,
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(version.createdAt).toLocaleString()} ·{" "}
                    {version.changedBy?.name ?? "—"} ·{" "}
                    {version.owningGroup.name}
                  </span>
                </button>
                {open === version.version && (
                  <pre className="mx-3 mb-3 max-h-64 overflow-auto rounded border bg-muted/40 p-2 font-mono text-xs">
                    {version.sql}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/** Output columns: what each inherits, and what readers get. */
export function DatasetColumnsCard({ dataset }: { dataset: SharedDatasetDto }) {
  const { t } = useTranslation();
  return (
    <Card data-testid="dataset-columns">
      <CardHeader className="pb-3">
        <CardTitle>{t("sharedDatasets.columns.title")}</CardTitle>
        <CardDescription>{t("sharedDatasets.columns.lead")}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">
                {t("sharedDatasets.columns.name")}
              </th>
              <th className="py-1.5 pr-3 font-medium">
                {t("sharedDatasets.columns.comesFrom")}
              </th>
              <th className="py-1.5 pr-3 font-medium">
                {t("sharedDatasets.columns.inherits")}
              </th>
              <th className="py-1.5 font-medium">
                {t("sharedDatasets.columns.atLeast")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {dataset.columns.map((column) => {
              const access = columnAccessFor({
                access: null,
                maskKind: null,
                classification: column.floor ?? null,
              });
              return (
                <tr key={column.name}>
                  <td className="py-1.5 pr-3">
                    <span className="font-mono">{column.name}</span>{" "}
                    <span className="text-muted-foreground">{column.type}</span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-muted-foreground">
                    {column.traced
                      ? column.upstreams
                          .map((u) => `${u.table}.${u.column}`)
                          .join(", ")
                      : t("sharedDatasets.columns.untraced")}
                    {column.transform && column.transform !== "IDENTITY" && (
                      <Badge variant="outline" className="ml-1 font-normal">
                        {column.transform.toLowerCase()}
                      </Badge>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {column.floor ? (
                      <InheritedTag
                        floor={column.floor}
                        from={column.from}
                        traced={column.traced}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-1.5">
                    <ColumnAccessChip
                      action={access.action}
                      mask={access.mask}
                      fromClassification
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("sharedDatasets.share.floorRule")}
        </p>
      </CardContent>
    </Card>
  );
}

/** Governance's *Inputs* step: every table it reads, who answers, whether it blocks. */
export function DatasetInputsCard({ dataset }: { dataset: SharedDatasetDto }) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  return (
    <Card data-testid="dataset-inputs">
      <CardHeader className="pb-3">
        <CardTitle>{t("sharedDatasets.inputs.title")}</CardTitle>
        <CardDescription>{t("sharedDatasets.inputs.lead")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border text-sm">
          {dataset.inputs.map((input) => (
            <li
              key={input.assetId}
              className="flex flex-wrap items-center gap-2 px-3 py-2"
            >
              <Link
                href={nsPath(`/assets/${input.assetId}?tab=governance`)}
                className="font-mono text-xs hover:underline"
              >
                {input.sqlName}
              </Link>
              <span className="text-xs text-muted-foreground">
                {input.sourceName}
              </span>
              {input.blocked && (
                <ToneBadge tone="error">
                  <Ban className="h-3 w-3" aria-hidden />
                  {t("sharedDatasets.inputs.blocks")}
                </ToneBadge>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {input.answeredBy.length
                  ? t("sharedDatasets.inputs.answeredBy", {
                      list: input.answeredBy.map((a) => a.name).join(", "),
                    })
                  : t("sharedDatasets.share.ungoverned")}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * On an input table (or source): the shared datasets that read it, and for
 * its owners and stewards *Block* / *Lift* — the twin of closing a table to
 * one SQL connection (§5.7).
 */
export function DatasetUsesCard({
  scopeType,
  scopeId,
}: {
  scopeType: "asset" | "source";
  scopeId: string;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const uses = useSharedDatasetUses(scopeType, scopeId);
  const [reasonFor, setReasonFor] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!uses.loading && !uses.data?.length) return null;

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setBusy(id);
    try {
      uses.setData((await fn()) as typeof uses.data);
      setReasonFor(null);
      setReason("");
    } catch (caught) {
      toast.error(await apiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card data-testid="dataset-uses">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Share2 className="h-4 w-4" />
          {t("sharedDatasets.uses.title")}
        </CardTitle>
        <CardDescription>
          {t(
            scopeType === "asset"
              ? "sharedDatasets.uses.leadTable"
              : "sharedDatasets.uses.leadSource",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border text-sm">
          {(uses.data ?? []).map((use) => (
            <li
              key={use.datasetId}
              className="space-y-2 px-3 py-2"
              data-testid="dataset-use"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={nsPath(`/assets/${use.datasetId}`)}
                  className="font-mono text-xs hover:underline"
                >
                  {use.sqlName}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {t("sharedDatasets.uses.by", {
                    owner: use.owner?.name ?? "—",
                    group: use.owningGroup.name,
                  })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("sharedDatasets.uses.reads", { count: use.reads30d })}
                </span>
                {use.block && (
                  <ToneBadge tone="error">
                    <Ban className="h-3 w-3" aria-hidden />
                    {t("sharedDatasets.uses.blocked", {
                      name: use.block.blockedBy?.name ?? "—",
                    })}
                  </ToneBadge>
                )}
                {use.canBlock && (
                  <span className="ml-auto">
                    {use.block ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === use.datasetId}
                        onClick={() =>
                          void act(
                            () => unblockDataset(use.datasetId, use.block!.id),
                            use.datasetId,
                          )
                        }
                        data-testid="dataset-unblock"
                      >
                        <Unlock className="mr-1 h-3.5 w-3.5" />
                        {t("sharedDatasets.uses.lift")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setReasonFor((current) =>
                            current === use.datasetId ? null : use.datasetId,
                          )
                        }
                        data-testid="dataset-block"
                      >
                        <Ban className="mr-1 h-3.5 w-3.5" />
                        {t("sharedDatasets.uses.block")}
                      </Button>
                    )}
                  </span>
                )}
              </div>
              {use.block?.reason && (
                <p className="text-xs text-muted-foreground">
                  {use.block.reason}
                </p>
              )}
              {reasonFor === use.datasetId && (
                <div className="space-y-2">
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("sharedDatasets.uses.reasonHint")}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setReasonFor(null)}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy === use.datasetId}
                      onClick={() =>
                        void act(
                          () =>
                            blockDataset(
                              use.datasetId,
                              scopeType,
                              scopeId,
                              reason,
                            ),
                          use.datasetId,
                        )
                      }
                      data-testid="dataset-block-confirm"
                    >
                      {t("sharedDatasets.uses.blockConfirm")}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
