"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Anchor,
  Check,
  Download,
  GitMerge,
  Loader2,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import { FeatureOffNotice } from "@/components/feature-off-notice";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  addEntityValue,
  createEntity,
  downloadEntityMentions,
  getEntity,
  getEntityConfig,
  getEntityMentions,
  getEntityOverview,
  mergeEntity,
  removeEntityValue,
  reviewEntityCandidates,
  type EntityConfig,
  type EntityDetail,
  type EntityMention,
  type EntityOverview,
  type EntityValue,
} from "@/lib/entities-api";
import {
  semanticErrorMessage,
  type EntityType,
  type LookupHit,
  type TermDetail,
} from "@/lib/semantic-api";
import { MICRO_LABEL, TermLink, TermPicker, useTermHref } from "./glossary-ui";

const ENTITY_TYPES: EntityType[] = [
  "PERSON",
  "ORGANIZATION",
  "LOCATION",
  "REFERENCE",
  "OTHER",
];

function formatDay(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "–";
}

/** The matched value inside its context, as the findings list shows it. */
export function Snippet({
  snippet,
}: {
  snippet: { before: string; matched: string; after: string } | null;
}) {
  if (!snippet) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {snippet.before}
      <mark className="rounded-[2px] bg-accent/20 px-0.5 font-medium text-foreground">
        {snippet.matched}
      </mark>
      {snippet.after}
    </span>
  );
}

// ── Values: names and identifiers ────────────────────────────────────────────

function ValueRows({
  values,
  onRemove,
  busy,
}: {
  values: EntityValue[];
  onRemove: (value: EntityValue) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y rounded-[4px] border-2 border-border">
      {values.map((value) => (
        <li key={value.id} className="flex items-center gap-3 px-3 py-2">
          <span className="w-36 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
            {value.label}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-sm">{value.value}</span>
            {value.sharedWith.length > 0 && (
              <span className="flex flex-wrap items-center gap-1 text-[11px] text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {t("entities.values.sharedWith")}
                {value.sharedWith.map((other) => (
                  <TermLink key={other.id} termKey={other.key} className="font-normal">
                    {other.term}
                  </TermLink>
                ))}
              </span>
            )}
          </span>
          <Badge variant="outline" className="shrink-0 rounded-[4px] text-[10px]">
            {t(`entities.methods.${value.method}` as TranslationKey)}
          </Badge>
          <span
            className="w-16 shrink-0 text-right font-mono text-xs"
            title={t("entities.values.occurrencesHint")}
          >
            {value.occurrences.toLocaleString()}
          </span>
          {value.method === "EXACT_ALIAS" ? (
            <span className="w-7 shrink-0" />
          ) : (
            <Button
              size="icon"
              variant="ghost"
              disabled={busy}
              aria-label={t("entities.values.remove", { value: value.value })}
              onClick={() => onRemove(value)}
              className="h-7 w-7 shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddIdentifier({
  entityId,
  config,
  onAdded,
}: {
  entityId: string;
  config: EntityConfig | null;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = React.useState("");
  const [value, setValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  // Labels a detector really produces come first: an identifier under a label
  // nothing detects links nothing.
  const options = React.useMemo(() => {
    if (!config) return [];
    const names = new Set(config.activeNameLabels);
    const known = new Set([
      ...config.shippedIdentifierLabels,
      ...config.identifierLabels,
    ]);
    const observed = config.observedLabels.filter(
      (entry) => !names.has(entry) && !entry.startsWith("tag_") && entry !== "date_time",
    );
    return [
      ...observed.filter((entry) => known.has(entry)),
      ...observed.filter((entry) => !known.has(entry)),
    ];
  }, [config]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim() || !value.trim()) return;
    setSaving(true);
    try {
      const result = await addEntityValue(entityId, {
        label: label.trim(),
        value: value.trim(),
      });
      if (result.conflict) {
        toast.warning(
          t("entities.values.conflict", { entity: result.conflict.term }),
        );
      } else {
        toast.success(t("entities.values.added"));
      }
      setValue("");
      onAdded();
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="w-48 space-y-1">
        <Label htmlFor="entity-value-label" className="text-[11px]">
          {t("entities.values.label")}
        </Label>
        <Input
          id="entity-value-label"
          list="entity-value-labels"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="iban_code"
          className="h-8 rounded-[4px] border-2 border-border font-mono text-xs"
        />
        <datalist id="entity-value-labels">
          {options.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>
      </div>
      <div className="min-w-48 flex-1 space-y-1">
        <Label htmlFor="entity-value-value" className="text-[11px]">
          {t("entities.values.value")}
        </Label>
        <Input
          id="entity-value-value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="AT61 1904 3002 3457 3201"
          className="h-8 rounded-[4px] border-2 border-border font-mono text-xs"
        />
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={saving || !label.trim() || !value.trim()}
        className="h-8 rounded-[4px] text-xs"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        {t("entities.values.add")}
      </Button>
    </form>
  );
}

// ── Mentions ─────────────────────────────────────────────────────────────────

function Timeline({ weeks }: { weeks: EntityOverview["timeline"] }) {
  const { t } = useTranslation();
  if (weeks.length === 0) return null;
  const max = Math.max(...weeks.map((week) => week.mentions), 1);
  const shown = weeks.slice(-52);
  return (
    <div>
      <div
        className="flex h-20 items-end gap-px"
        role="img"
        aria-label={t("entities.mentions.overTime")}
      >
        {shown.map((week) => (
          <div
            key={week.week}
            title={`${new Date(week.week).toLocaleDateString()} · ${week.mentions.toLocaleString()}`}
            className="min-w-[3px] max-w-6 flex-1 rounded-t-[2px] bg-accent"
            style={{ height: `${Math.max((week.mentions / max) * 100, 4)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{new Date(shown[0]!.week).toLocaleDateString()}</span>
        <span>{new Date(shown[shown.length - 1]!.week).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function MentionList({ entity, refreshKey }: { entity: EntityDetail; refreshKey: number }) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const [rows, setRows] = React.useState<EntityMention[] | null>(null);
  const [next, setNext] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [exporting, setExporting] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setRows(null);
    getEntityMentions(entity.id, { limit: 25 })
      .then((page) => {
        if (!active) return;
        setRows(page.mentions);
        setNext(page.next);
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [entity.id, refreshKey]);

  async function more() {
    if (!next) return;
    setLoading(true);
    try {
      const page = await getEntityMentions(entity.id, { after: next, limit: 50 });
      setRows((previous) => [...(previous ?? []), ...page.mentions]);
      setNext(page.next);
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setLoading(false);
    }
  }

  async function exportAs(format: "csv" | "json") {
    setExporting(format);
    try {
      await downloadEntityMentions(entity.key, format);
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setExporting(null);
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={MICRO_LABEL}>{t("entities.mentions.title")}</div>
        {rows && rows.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {t("entities.mentions.export")}
            </span>
            {(["csv", "json"] as const).map((format) => (
              <Button
                key={format}
                size="sm"
                variant="outline"
                disabled={exporting !== null}
                onClick={() => exportAs(format)}
                className="h-7 rounded-[4px] border-2 border-border font-mono text-[11px] uppercase"
              >
                {exporting === format ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                {format}
              </Button>
            ))}
          </div>
        )}
      </div>
      {rows === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("entities.mentions.none")}
          description={
            entity.status === "APPROVED"
              ? t("entities.mentions.noneHint")
              : t("entities.mentions.notApproved")
          }
        />
      ) : (
        <div className="overflow-auto rounded-[4px] bg-white dark:bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {(["asset", "source", "value", "context", "seen"] as const).map((column) => (
                  <TableHead key={column}>
                    <span className={MICRO_LABEL}>
                      {t(`entities.mentions.columns.${column}` as TranslationKey)}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.assetId}:${row.label}:${row.value}`}>
                  <TableCell className="max-w-[240px]">
                    <Link
                      href={nsPath(`/assets/${row.assetId}`)}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {row.assetName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{row.sourceName}</TableCell>
                  <TableCell>
                    <span className="block font-mono text-xs">{row.value}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{row.label}</span>
                  </TableCell>
                  <TableCell className="max-w-[420px]">
                    {row.findingId ? (
                      <Link
                        href={nsPath(`/findings/${row.findingId}`)}
                        className="line-clamp-2 hover:underline"
                      >
                        <Snippet snippet={row.snippet} />
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    {formatDay(row.seenAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {next && (
            <div className="border-t p-3 text-center">
              <Button size="sm" variant="outline" disabled={loading} onClick={more}>
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("entities.mentions.more")}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── The entity tab of a term page (G5 R14) ───────────────────────────────────

/**
 * What makes an ENTITY-kind term a *thing*: its confirmed values, where they
 * occur across every source, when, and with whom — plus the candidates
 * waiting for a decision. Mentions are a join, never stored rows, so a value
 * added here lists documents scanned long before.
 */
export function EntityPanel({
  term,
  refreshKey,
  onChanged,
}: {
  term: TermDetail;
  refreshKey: number;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const [entity, setEntity] = React.useState<EntityDetail | null>(null);
  const [overview, setOverview] = React.useState<EntityOverview | null>(null);
  const [config, setConfig] = React.useState<EntityConfig | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [local, setLocal] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    Promise.all([getEntity(term.id), getEntityOverview(term.id)])
      .then(([detail, summary]) => {
        if (!active) return;
        setEntity(detail);
        setOverview(summary);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [term.id, refreshKey, local]);

  React.useEffect(() => {
    getEntityConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const reload = () => {
    setLocal((value) => value + 1);
    onChanged();
  };

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      reload();
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setBusy(false);
    }
  }

  if (failed) {
    return <p className="text-sm text-muted-foreground">{t("entities.loadFailed")}</p>;
  }
  if (!entity || !overview) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  const identifiers = entity.values.filter((value) => value.family === "identifier");
  const names = entity.values.filter((value) => value.family === "name");
  const tiles: Array<[string, string]> = [
    ["mentions", entity.mentionCount.toLocaleString()],
    ["assets", entity.assetCount.toLocaleString()],
    ["sources", entity.sourceCount.toLocaleString()],
    ["firstSeen", formatDay(entity.firstSeenAt)],
    ["lastSeen", formatDay(entity.lastSeenAt)],
  ];

  return (
    <div className="space-y-6">
      <FeatureOffNotice feature="entities" context="entity" />

      {entity.mergedInto && (
        <p className="flex items-center gap-2 rounded-[4px] border-2 border-border bg-muted/40 px-3 py-2 text-sm">
          <GitMerge className="h-4 w-4 shrink-0" aria-hidden />
          {t("entities.mergedInto")}{" "}
          <TermLink termKey={entity.mergedInto.key}>{entity.mergedInto.term}</TermLink>
        </p>
      )}
      {!entity.mergedInto && entity.featureEnabled && entity.status !== "APPROVED" && (
        <p className="rounded-[4px] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("entities.notLinking")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([key, value]) => (
          <div key={key} className="rounded-[4px] border-2 border-border px-3 py-2">
            <div className={MICRO_LABEL}>{t(`entities.tiles.${key}` as TranslationKey)}</div>
            <div className="font-mono text-xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      {entity.candidates.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className={MICRO_LABEL}>
              {t("entities.candidates.title", { count: String(entity.candidates.length) })}
            </div>
            <Link
              href={nsPath("/glossary?tab=proposals")}
              className="text-xs underline underline-offset-2 hover:no-underline"
            >
              {t("entities.candidates.openQueue")}
            </Link>
          </div>
          <ul className="divide-y rounded-[4px] border-2 border-border">
            {entity.candidates.map((candidate) => (
              <li key={candidate.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-36 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                  {candidate.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{candidate.value}</span>
                {candidate.conflictTermId ? (
                  <Badge variant="outline" className="rounded-[4px] text-[10px]">
                    {t("entities.candidates.conflict")}
                  </Badge>
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {t(`entities.methods.${candidate.method}` as TranslationKey)}
                    {candidate.score !== null && ` · ${Math.round(candidate.score * 100)}%`}
                  </span>
                )}
                <span className="font-mono text-xs" title={t("entities.values.occurrencesHint")}>
                  {candidate.occurrences.toLocaleString()}
                </span>
                {candidate.conflictTermId ? (
                  <Link
                    href={nsPath("/glossary?tab=proposals")}
                    className="text-xs underline underline-offset-2"
                  >
                    {t("entities.candidates.review")}
                  </Link>
                ) : (
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () => reviewEntityCandidates([{ id: candidate.id, decision: "accept" }]),
                          t("entities.candidates.accepted"),
                        )
                      }
                      className="h-7 rounded-[4px] text-xs"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t("glossary.proposals.accept")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () => reviewEntityCandidates([{ id: candidate.id, decision: "reject" }]),
                          t("entities.candidates.rejected"),
                        )
                      }
                      className="h-7 rounded-[4px] border-2 border-border text-xs"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t("entities.candidates.reject")}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <section className="space-y-2">
            <div className={MICRO_LABEL}>{t("entities.values.identifiers")}</div>
            {identifiers.length > 0 ? (
              <ValueRows
                values={identifiers}
                busy={busy}
                onRemove={(value) =>
                  act(() => removeEntityValue(value.id), t("entities.values.removed"))
                }
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t("entities.values.noIdentifiers")}</p>
            )}
            {entity.status !== "DEPRECATED" && (
              <AddIdentifier entityId={entity.id} config={config} onAdded={reload} />
            )}
            <p className="text-[11px] text-muted-foreground">{t("entities.values.labelHint")}</p>
          </section>
          <section className="space-y-2">
            <div className={MICRO_LABEL}>{t("entities.values.names")}</div>
            {names.length > 0 ? (
              <ValueRows
                values={names}
                busy={busy}
                onRemove={(value) =>
                  act(() => removeEntityValue(value.id), t("entities.values.removed"))
                }
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t("entities.values.noNames")}</p>
            )}
          </section>
          {entity.anchor && (
            <section className="space-y-1">
              <div className={MICRO_LABEL}>{t("entities.anchor")}</div>
              <p className="flex items-center gap-2 text-sm">
                <Anchor className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {entity.anchor.asset ? (
                  <Link
                    href={nsPath(`/assets/${entity.anchor.asset.id}`)}
                    className="truncate font-medium hover:underline"
                  >
                    {entity.anchor.asset.name}
                  </Link>
                ) : null}
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {entity.anchor.urn}
                </span>
              </p>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <section className="space-y-2">
            <div className={MICRO_LABEL}>{t("entities.mentions.overTime")}</div>
            {overview.timeline.length > 0 ? (
              <Timeline weeks={overview.timeline} />
            ) : (
              <p className="text-xs text-muted-foreground">{t("entities.mentions.none")}</p>
            )}
          </section>
          {overview.sources.length > 0 && (
            <section className="space-y-2">
              <div className={MICRO_LABEL}>{t("entities.sources")}</div>
              <ul className="divide-y rounded-[4px] border-2 border-border">
                {overview.sources.map((source) => (
                  <li key={source.sourceId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <Link
                      href={nsPath(`/sources/${source.sourceId}`)}
                      className="min-w-0 truncate text-sm font-medium hover:underline"
                    >
                      {source.name}
                    </Link>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {t("entities.sourceCounts", {
                        mentions: source.mentions.toLocaleString(),
                        assets: source.assets.toLocaleString(),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="space-y-2">
            <div className={MICRO_LABEL}>{t("entities.coMentions.title")}</div>
            {overview.coMentions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {overview.coMentions.map((other) => (
                  <TermLink
                    key={other.id}
                    termKey={other.key}
                    className="rounded-[4px] border border-border px-2 py-0.5 text-xs font-normal"
                  >
                    {other.term}
                    <span className="ml-1.5 font-mono text-muted-foreground">
                      {other.sharedAssets.toLocaleString()}
                    </span>
                  </TermLink>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("entities.coMentions.none")}</p>
            )}
          </section>
        </div>
      </div>

      <MentionList entity={entity} refreshKey={local + refreshKey} />
    </div>
  );
}

// ── Merge (G5 R7) ────────────────────────────────────────────────────────────

export function MergeEntityDialog({
  term,
  open,
  onOpenChange,
  onMerged,
}: {
  term: TermDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: (intoKey: string) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = React.useState<LookupHit | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) setTarget(null);
  }, [open]);

  async function merge() {
    if (!target) return;
    setSaving(true);
    try {
      const result = await mergeEntity(term.id, target.id);
      toast.success(t("entities.merge.done", { from: term.term, into: result.into.term }));
      onOpenChange(false);
      onMerged(result.into.key);
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setSaving(false);
    }
  }

  const invalid =
    target !== null && (target.id === term.id || target.kind !== "ENTITY" || target.status !== "APPROVED");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[6px]">
        <DialogHeader>
          <DialogTitle>{t("entities.merge.title", { name: term.term })}</DialogTitle>
          <DialogDescription>{t("entities.merge.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{t("entities.merge.into")}</Label>
          <TermPicker value={target} onChange={setTarget} kind="ENTITY" autoFocus />
          {invalid && (
            <p className="text-xs text-amber-800 dark:text-amber-300">
              {target?.id === term.id
                ? t("entities.merge.same")
                : t("entities.merge.needsApproved")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!target || invalid || saving} onClick={merge}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
            {t("entities.merge.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Make entity (G5 R16) ─────────────────────────────────────────────────────

/**
 * Promote a finding's value (or a value from "where else found") to an
 * entity: a name becomes the entity's name, anything else its first
 * identifier. The entity then lists every other place the value occurs.
 */
export function MakeEntityDialog({
  open,
  onOpenChange,
  findingId,
  label,
  value,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Promote this finding; or pass `label` and `value` alone. */
  findingId?: string;
  label: string;
  value: string;
}) {
  const { t } = useTranslation();
  const termHref = useTermHref();
  const [config, setConfig] = React.useState<EntityConfig | null>(null);
  const [name, setName] = React.useState("");
  const [entityType, setEntityType] = React.useState<EntityType>("OTHER");
  const [saving, setSaving] = React.useState(false);
  const [created, setCreated] = React.useState<{
    key: string;
    term: string;
    assets: number;
    merged: boolean;
    conflict: string | null;
  } | null>(null);

  const normalizedLabel = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const isName = config ? config.activeNameLabels.includes(normalizedLabel) : false;

  React.useEffect(() => {
    if (!open) return;
    setCreated(null);
    getEntityConfig()
      .then((result) => {
        setConfig(result);
        const named = result.activeNameLabels.includes(normalizedLabel);
        setName(named ? value : "");
        setEntityType(
          /person|people|full_name/.test(normalizedLabel)
            ? "PERSON"
            : /org|company/.test(normalizedLabel)
              ? "ORGANIZATION"
              : /location|gpe|place/.test(normalizedLabel)
                ? "LOCATION"
                : "OTHER",
        );
      })
      .catch(() => setConfig(null));
  }, [open, normalizedLabel, value]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const result = await createEntity({
        name: name.trim(),
        entityType,
        ...(findingId ? { findingId } : { value: { label, value } }),
      });
      setCreated({
        key: result.key,
        term: result.term,
        assets: result.assetCount,
        merged: result.merged,
        conflict: result.conflicts[0]?.heldBy.term ?? null,
      });
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[6px]">
        <DialogHeader>
          <DialogTitle>{t("entities.make.title")}</DialogTitle>
          <DialogDescription>
            {isName ? t("entities.make.descName") : t("entities.make.descIdentifier")}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-3">
            <p className="text-sm">
              {created.merged
                ? t("entities.make.existing", { name: created.term })
                : t("entities.make.created", { name: created.term })}{" "}
              {t("entities.make.found", { count: created.assets.toLocaleString() })}
            </p>
            {created.conflict && (
              <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("entities.values.conflict", { entity: created.conflict })}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
              <Button asChild>
                <Link href={`${termHref(created.key)}?tab=entity`}>{t("entities.make.openEntity")}</Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-[4px] border-2 border-border px-3 py-2">
              <div className="font-mono text-[11px] text-muted-foreground">{label}</div>
              <div className="break-all font-mono text-sm">{value}</div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="make-entity-name">{t("entities.make.name")}</Label>
              <Input
                id="make-entity-name"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                placeholder={t("entities.make.namePlaceholder")}
                className="rounded-[4px] border-2 border-border"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("entities.make.type")}</Label>
              <Select value={entityType} onValueChange={(next) => setEntityType(next as EntityType)}>
                <SelectTrigger className="rounded-[4px] border-2 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`glossary.entityTypes.${type}` as TranslationKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("entities.make.confirm")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
