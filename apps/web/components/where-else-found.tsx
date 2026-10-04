"use client";

import { useNsPath } from "@/lib/ns-path";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Radar, UserPlus } from "lucide-react";
import { api, type ValueOccurrencesResponseDto } from "@workspace/api-client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  SourceIcon,
  Spinner,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { FeatureOffNotice } from "@/components/feature-off-notice";
import { assetCandidate, useAddToCase } from "@/components/case-target/case-target";
import { AddToCaseButton } from "@/components/case-target/case-target-menu";
import { MakeEntityDialog } from "@/components/glossary/entity-sections";
import { useWorkspaceFeatures } from "@/hooks/use-workspace-features";

/**
 * "Where else found" — lists every other asset that carries the same normalized
 * finding value, via the correlation reverse index. The most investigator-
 * valuable view: it reveals relationships without any embeddings.
 */
export function WhereElseFound({
  label,
  value,
  currentAssetId,
  findingId,
  embedded = false,
}: {
  label: string;
  value: string;
  currentAssetId?: string;
  /** The finding this value came from, so "Make entity" records where. */
  findingId?: string;
  /** Inside another panel (the case board's details): no card around it. */
  embedded?: boolean;
}) {
  const nsPath = useNsPath();
  const { t } = useTranslation();
  // Each asset the value turns up in can join a case from here.
  const { target: caseTarget, dialog: caseDialog } = useAddToCase();
  const [data, setData] = useState<ValueOccurrencesResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The value occurs in several places: it may be a thing worth naming (G5 R16).
  const [makingEntity, setMakingEntity] = useState(false);
  const { isOff } = useWorkspaceFeatures();
  const makeEntity =
    label && value && !isOff("entities") ? (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setMakingEntity(true)}
        className="h-7 shrink-0 rounded-[4px] border-2 border-border text-xs"
        data-testid="make-entity"
      >
        <UserPlus className="h-3.5 w-3.5" />
        {t("entities.make.open")}
      </Button>
    ) : null;

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    if (!label || !value) {
      setData({ label, value, valueHash: "", assets: [] });
      return;
    }
    api.correlation
      .correlationControllerOccurrences({ label, value })
      .then((res) => {
        if (active) setData(res);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : t("correlation.occurrences.loadFailed"),
          );
      });
    return () => {
      active = false;
    };
  }, [label, value, t]);

  const others =
    data?.assets.filter((a) => a.assetId !== currentAssetId) ?? [];

  const content = (
    <>
      {/* The reverse index is duplicate detection's output: while it is off
          it stops growing (and is empty once its data was deleted). */}
      <FeatureOffNotice
        feature="duplicates"
        context="occurrences"
        variant="inline"
      />
      {error ? (
        <EmptyState
          icon={Radar}
          title={t("correlation.occurrences.loadFailed")}
          description={error}
        />
      ) : data === null ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner label={t("correlation.occurrences.title")} />
        </div>
      ) : others.length === 0 ? (
        <EmptyState
          icon={Radar}
          title={t("correlation.occurrences.none")}
          description={t("correlation.occurrences.noneDesc")}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("correlation.occurrences.foundIn", {
              count: String(others.length),
            })}
          </p>
          {others.map((a) => (
            <div
              key={a.assetId}
              className="flex items-center justify-between gap-3 rounded-[4px] border border-border/60 bg-muted/30 p-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SourceIcon source={a.sourceType} size="sm" />
                <Link
                  href={nsPath(`/assets/${a.assetId}`)}
                  className="truncate text-sm font-semibold underline-offset-4 hover:underline"
                  title={a.name || a.externalUrl}
                >
                  {a.name || a.externalUrl || a.assetId}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {a.sourceName}
                </span>
              </div>
              <AddToCaseButton
                target={caseTarget}
                candidate={assetCandidate({
                  id: a.assetId,
                  name: a.name || a.externalUrl || a.assetId,
                  sourceType: a.sourceType,
                })}
              />
            </div>
          ))}
        </div>
      )}
      {caseDialog}
      <MakeEntityDialog
        open={makingEntity}
        onOpenChange={setMakingEntity}
        findingId={findingId}
        label={label}
        value={value}
      />
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-3" data-testid="where-else-found">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("correlation.occurrences.desc")}</p>
          {makeEntity}
        </div>
        {content}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Radar className="h-4 w-4" />
            {t("correlation.occurrences.title")}
          </span>
          {makeEntity}
        </CardTitle>
        <CardDescription>{t("correlation.occurrences.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{content}</CardContent>
    </Card>
  );
}
