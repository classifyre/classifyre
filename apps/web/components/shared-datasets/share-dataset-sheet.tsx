"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Crown,
  Loader2,
  Share2,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type {
  SharedDatasetAudienceDto,
  TenantGroupDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import { columnAccessFor } from "@/lib/column-access";
import { apiErrorMessage } from "@/lib/data-query";
import {
  describeDataset,
  shareDataset,
  sqlWord,
  updateDataset,
  useSharedDatasetOptions,
  type SharedDatasetDescriptionDto,
  type SharedDatasetDto,
} from "@/lib/shared-datasets";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import { InheritedTag } from "./inherited-tag";

/**
 * Share the SQL page's query as a dataset (docs/prd/DQ-data-query.md §5.12),
 * or save a new version of one. One sheet, three parts read top to bottom:
 * what it is, what it inherits (checked against the owning group as you
 * pick it), and who reads it.
 */
export interface ShareDatasetPreset {
  owningGroupId?: string;
  audienceGroupIds?: string[];
  lockOwner?: boolean;
  name?: string;
  description?: string;
}

export function ShareDatasetSheet({
  open,
  sql,
  dataset,
  preset,
  onClose,
  onShared,
}: {
  open: boolean;
  sql: string;
  /** Set when saving a new version of this dataset. */
  dataset?: SharedDatasetDto | null;
  /** Prefills when publishing from a data request (PRD DR §4.5). */
  preset?: ShareDatasetPreset;
  onClose: () => void;
  onShared: (dataset: SharedDatasetDto) => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const options = useSharedDatasetOptions();
  const [name, setName] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [groupId, setGroupId] = React.useState("");
  const [audience, setAudience] = React.useState<string[]>([]);
  const [roleKey, setRoleKey] = React.useState("data-reader");
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);
  const [check, setCheck] = React.useState<SharedDatasetDescriptionDto | null>(
    null,
  );
  const [checking, setChecking] = React.useState(false);
  const [checkError, setCheckError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(dataset?.name ?? (preset?.name ? sqlWord(preset.name, "") : ""));
    setDomain(dataset?.domain ?? "");
    setDescription(dataset?.description ?? preset?.description ?? "");
    setGroupId(dataset?.owningGroup.id ?? preset?.owningGroupId ?? "");
    setAudience(preset?.audienceGroupIds ?? []);
    setCheck(null);
    setCheckError(null);
    api.access
      .workspaceAccessControllerGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [open, dataset, preset]);

  // The first group of yours is the natural owner, and its name a domain.
  React.useEffect(() => {
    if (!open || dataset) return;
    if (groupId) {
      const chosen =
        options.data?.groups.find((g) => g.id === groupId) ??
        groups.find((g) => g.id === groupId);
      if (chosen) {
        setDomain(
          (current) =>
            current || sqlWord(chosen.name.split("/").pop() ?? "", "data"),
        );
      }
      return;
    }
    const first = options.data?.groups[0];
    if (first) {
      setGroupId(first.id);
      setDomain(
        (current) =>
          current || sqlWord(first.name.split("/").pop() ?? "", "data"),
      );
    }
  }, [open, dataset, groupId, options.data, groups]);

  // Checked again whenever the SQL or the owning group changes.
  React.useEffect(() => {
    if (!open || !sql.trim()) return;
    let cancelled = false;
    setChecking(true);
    setCheckError(null);
    const timer = setTimeout(() => {
      describeDataset(sql, groupId || undefined)
        .then((result) => {
          if (!cancelled) setCheck(result);
        })
        .catch(async (caught) => {
          if (!cancelled) {
            setCheck(null);
            setCheckError(await apiErrorMessage(caught));
          }
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, sql, groupId]);

  const sqlName = `shared.${sqlWord(domain || "data", "data")}.${sqlWord(name || "dataset")}`;
  const ready =
    Boolean(name.trim() && domain.trim() && groupId) &&
    Boolean(check?.canShare) &&
    !checking;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const saved = dataset
        ? await updateDataset(dataset.assetId, {
            sql,
            description,
            owningGroupId: groupId,
          })
        : await shareDataset({
            name,
            domain,
            description: description || undefined,
            sql,
            owningGroupId: groupId,
            audience: audience.map((id) => ({
              groupId: id,
              roleKey: roleKey as SharedDatasetAudienceDto["roleKey"],
            })),
          });
      toast.success(
        dataset
          ? t("sharedDatasets.share.savedVersion", { version: saved.version })
          : t("sharedDatasets.share.shared", { name: saved.sqlName }),
      );
      onShared(saved);
    } catch (caught) {
      toast.error(await apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const myGroups = React.useMemo(() => {
    const base = options.data?.groups ?? [];
    if (
      preset?.owningGroupId &&
      !base.some((g) => g.id === preset.owningGroupId)
    ) {
      const found = groups.find((g) => g.id === preset.owningGroupId);
      return [
        {
          id: preset.owningGroupId,
          name: found?.path || found?.name || preset.owningGroupId,
        },
        ...base,
      ];
    }
    return base;
  }, [options.data?.groups, preset?.owningGroupId, groups]);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
        data-testid="share-dataset-sheet"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            {dataset
              ? t("sharedDatasets.share.editTitle", { name: dataset.sqlName })
              : t("sharedDatasets.share.title")}
          </SheetTitle>
          <SheetDescription>{t("sharedDatasets.share.lead")}</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4">
          {/* 1. What it is */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">
              {t("sharedDatasets.share.whatTitle")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ds-domain">
                  {t("sharedDatasets.share.domain")}
                </Label>
                <Input
                  id="ds-domain"
                  value={domain}
                  disabled={Boolean(dataset)}
                  onChange={(e) => setDomain(e.target.value)}
                  list="ds-domains"
                  placeholder="sales"
                  data-testid="share-domain"
                />
                <datalist id="ds-domains">
                  {(options.data?.domains ?? []).map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ds-name">
                  {t("sharedDatasets.share.name")}
                </Label>
                <Input
                  id="ds-name"
                  value={name}
                  disabled={Boolean(dataset)}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="orders_by_region"
                  data-testid="share-name"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("sharedDatasets.share.sqlNameHint")}{" "}
              <code className="rounded bg-muted px-1 font-mono">{sqlName}</code>
            </p>
            <div className="space-y-1">
              <Label htmlFor="ds-description">
                {t("sharedDatasets.share.description")}
              </Label>
              <Textarea
                id="ds-description"
                value={description}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("sharedDatasets.share.descriptionHint")}
              />
            </div>
          </section>

          {/* 2. Who owns it, and what it inherits */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">
              {t("sharedDatasets.share.ownTitle")}
            </h3>
            <div className="space-y-1">
              <Label>{t("sharedDatasets.share.owningGroup")}</Label>
              <Select
                value={groupId}
                onValueChange={setGroupId}
                disabled={Boolean(preset?.lockOwner)}
              >
                <SelectTrigger data-testid="share-owning-group">
                  <SelectValue
                    placeholder={t("sharedDatasets.share.pickGroup")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {myGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("sharedDatasets.share.owningGroupHint")}
              </p>
            </div>

            {checking && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("sharedDatasets.share.checking")}
              </p>
            )}
            {checkError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                {checkError}
              </p>
            )}
            {check && (
              <>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("sharedDatasets.share.inputs", {
                      count: check.inputs.length,
                    })}
                  </p>
                  <ul className="divide-y rounded-md border text-sm">
                    {check.inputs.map((input) => (
                      <li
                        key={input.assetId}
                        className="flex flex-wrap items-center gap-2 px-3 py-2"
                        data-testid="share-input"
                      >
                        <Link
                          href={nsPath(`/assets/${input.assetId}`)}
                          className="font-mono text-xs hover:underline"
                        >
                          {input.sqlName}
                        </Link>
                        {input.youGovern && (
                          <Badge
                            variant="outline"
                            className="gap-1 font-normal"
                          >
                            <Crown className="h-3 w-3" />
                            {t("sharedDatasets.share.youGovern")}
                          </Badge>
                        )}
                        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                          {input.answeredBy.length
                            ? t("sharedDatasets.share.told", {
                                list: input.answeredBy
                                  .map((a) => a.name)
                                  .join(", "),
                              })
                            : t("sharedDatasets.share.ungoverned")}
                          {input.groupCanQuery === true && (
                            <span className="flex items-center gap-0.5 text-accent-ink">
                              <Check className="h-3.5 w-3.5" />
                              {t("sharedDatasets.share.groupReads")}
                            </span>
                          )}
                          {input.groupCanQuery === false && (
                            <span className="flex items-center gap-0.5 text-destructive">
                              <X className="h-3.5 w-3.5" />
                              {t("sharedDatasets.share.groupCannot")}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("sharedDatasets.share.columns")}
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-left text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">
                            {t("sharedDatasets.columns.name")}
                          </th>
                          <th className="px-3 py-1.5 font-medium">
                            {t("sharedDatasets.columns.inherits")}
                          </th>
                          <th className="px-3 py-1.5 font-medium">
                            {t("sharedDatasets.columns.readers")}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {check.columns.map((column) => {
                          const access = columnAccessFor({
                            access: null,
                            maskKind: null,
                            classification: column.floor ?? null,
                          });
                          return (
                            <tr key={column.name} data-testid="share-column">
                              <td className="px-3 py-1.5">
                                <span className="font-mono">{column.name}</span>{" "}
                                <span className="text-muted-foreground">
                                  {column.type}
                                </span>
                              </td>
                              <td className="px-3 py-1.5">
                                {column.floor ? (
                                  <InheritedTag
                                    floor={column.floor}
                                    from={column.from}
                                    traced={column.traced}
                                  />
                                ) : (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5">
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
                  </div>
                  {check.untraced.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {t("sharedDatasets.share.untraced", {
                        list: check.untraced.join(", "),
                      })}
                    </p>
                  )}
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t("sharedDatasets.share.floorRule")}
                  </p>
                </div>

                {check.problems.length > 0 && (
                  <ul
                    className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs"
                    data-testid="share-problems"
                  >
                    {check.problems.map((problem) => (
                      <li key={problem} className="flex items-start gap-1.5">
                        <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                        {problem}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {/* 3. Who reads it */}
          {!dataset && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">
                {t("sharedDatasets.share.audienceTitle")}
              </h3>
              <MultiSelect values={audience} onValuesChange={setAudience}>
                <MultiSelectTrigger
                  className="w-full"
                  data-testid="share-audience"
                >
                  <MultiSelectValue
                    placeholder={t("sharedDatasets.share.audiencePlaceholder")}
                  />
                </MultiSelectTrigger>
                <MultiSelectContent
                  search={{
                    placeholder: t("sharedDatasets.share.audienceSearch"),
                    emptyMessage: t("sharedDatasets.share.audienceEmpty"),
                  }}
                >
                  {groups.map((group) => (
                    <MultiSelectItem
                      key={group.id}
                      value={group.id}
                      badgeLabel={group.path || group.name}
                      keywords={[group.name, group.path]}
                    >
                      {group.path || group.name}
                    </MultiSelectItem>
                  ))}
                </MultiSelectContent>
              </MultiSelect>
              <Select value={roleKey} onValueChange={setRoleKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="data-reader">
                    {t("accessRequests.roles.data-reader")}
                  </SelectItem>
                  <SelectItem value="data-reader-unmasked">
                    {t("accessRequests.roles.data-reader-unmasked")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("sharedDatasets.share.audienceHint")}
              </p>
            </section>
          )}
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!ready || busy}
            data-testid="share-submit"
          >
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {dataset
              ? t("sharedDatasets.share.saveVersion", {
                  version: dataset.version + 1,
                })
              : t("sharedDatasets.share.submit")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
