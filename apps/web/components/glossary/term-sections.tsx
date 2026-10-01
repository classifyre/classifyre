"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, Power, Trash2, Check } from "lucide-react";
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
  SeverityBadge,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import { FileSearch, Link2 } from "lucide-react";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  approveBinding,
  createRelation,
  deleteBinding,
  disableBinding,
  enableBinding,
  findInTextCreate,
  findInTextPreview,
  getTermEvidence,
  getTermSummary,
  listBindings,
  removeRelation,
  semanticErrorMessage,
  type Binding,
  type FindInTextPreview,
  type LookupHit,
  type RelationType,
  type TermDetail,
  type TermEvidencePage,
  type TermSummaryStats,
} from "@/lib/semantic-api";
import { BindDialog } from "./bind-dialog";
import {
  MICRO_LABEL,
  MethodBadge,
  TermLink,
  TermPicker,
  TermStatusBadge,
} from "./glossary-ui";

const RELATION_TYPES: RelationType[] = [
  "BROADER",
  "RELATED",
  "PART_OF",
  "INSTANCE_OF",
  "CUSTOM",
];

// ── Evidence (SL3 R7.3) ──────────────────────────────────────────────────────

export function TermEvidence({ term }: { term: TermDetail }) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const [includeNarrower, setIncludeNarrower] = React.useState(
    term.narrower.length > 0,
  );
  const [page, setPage] = React.useState(0);
  const [summary, setSummary] = React.useState<TermSummaryStats | null>(null);
  const [evidence, setEvidence] = React.useState<TermEvidencePage | null>(null);

  React.useEffect(() => {
    let active = true;
    setEvidence(null);
    Promise.all([
      getTermSummary(term.id, includeNarrower),
      getTermEvidence(term.id, { includeNarrower, page }),
    ])
      .then(([stats, rows]) => {
        if (!active) return;
        setSummary(stats);
        setEvidence(rows);
      })
      .catch(() => {
        if (!active) return;
        setSummary(null);
        setEvidence({
          termId: term.id,
          includeNarrower,
          total: 0,
          page,
          pageSize: 50,
          assets: [],
        });
      });
    return () => {
      active = false;
    };
  }, [term.id, includeNarrower, page]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {summary && (
          <div className="flex flex-wrap gap-6">
            {(
              [
                ["assets", summary.counts.assets],
                ["findings", summary.counts.findings],
                ["sources", summary.counts.sources],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <div className={MICRO_LABEL}>
                  {t(`glossary.evidence.${label}` as TranslationKey)}
                </div>
                <div className="font-mono text-2xl font-bold">
                  {value.toLocaleString()}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-1.5">
              {summary.byMethod.map((row) => (
                <span key={row.method} className="flex items-center gap-1">
                  <MethodBadge method={row.method} />
                  <span className="font-mono text-xs">{row.assets}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {term.narrower.length > 0 && (
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={includeNarrower}
              onCheckedChange={(value) => {
                setIncludeNarrower(value);
                setPage(0);
              }}
            />
            {t("glossary.evidence.includeNarrower")}
          </label>
        )}
      </div>

      {evidence === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : evidence.assets.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title={t("glossary.evidence.none")}
          description={
            term.status === "APPROVED"
              ? t("glossary.evidence.noneHint")
              : t("glossary.evidence.notApproved")
          }
        />
      ) : (
        <div className="overflow-auto rounded-[4px] bg-white dark:bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.evidence.asset")}</span>
                </TableHead>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.evidence.source")}</span>
                </TableHead>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.evidence.method")}</span>
                </TableHead>
                {includeNarrower && (
                  <TableHead>
                    <span className={MICRO_LABEL}>{t("glossary.evidence.via")}</span>
                  </TableHead>
                )}
                <TableHead className="text-right">
                  <span className={MICRO_LABEL}>{t("glossary.evidence.support")}</span>
                </TableHead>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.evidence.severity")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidence.assets.map((row) => (
                <TableRow key={row.assetId} className={row.goneAt ? "opacity-60" : undefined}>
                  <TableCell className="max-w-[320px]">
                    <Link
                      href={nsPath(`/assets/${row.assetId}`)}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {row.assetName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{row.source.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.methods.map((method) => (
                        <MethodBadge key={method} method={method} />
                      ))}
                    </div>
                  </TableCell>
                  {includeNarrower && (
                    <TableCell className="text-xs">
                      {row.terms
                        .filter((entry) => entry.id !== term.id)
                        .map((entry) => entry.name)
                        .join(", ")}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono text-sm">
                    {row.support.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {row.maxSeverity ? (
                      <SeverityBadge
                        severity={
                          row.maxSeverity.toLowerCase() as
                            | "critical"
                            | "high"
                            | "medium"
                            | "low"
                            | "info"
                        }
                      >
                        {row.maxSeverity}
                      </SeverityBadge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {evidence.total > evidence.pageSize && (
            <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
              <span>
                {t("glossary.evidence.page", {
                  from: String(page * evidence.pageSize + 1),
                  to: String(Math.min((page + 1) * evidence.pageSize, evidence.total)),
                  total: evidence.total.toLocaleString(),
                })}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  {t("common.pagination.previous")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(page + 1) * evidence.pageSize >= evidence.total}
                  onClick={() => setPage(page + 1)}
                >
                  {t("common.pagination.next")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bindings (SL2) ───────────────────────────────────────────────────────────

export function TermBindings({ term }: { term: TermDetail }) {
  const { t } = useTranslation();
  const [bindings, setBindings] = React.useState<Binding[] | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    listBindings({ termId: term.id, take: 200 })
      .then((result) => {
        if (active) setBindings(result.bindings);
      })
      .catch(() => {
        if (active) setBindings([]);
      });
    return () => {
      active = false;
    };
  }, [term.id, refresh]);

  async function act(id: string, action: () => Promise<unknown>) {
    setBusy(id);
    try {
      await action();
      setRefresh((value) => value + 1);
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setBusy(null);
    }
  }

  const asHit: LookupHit = term;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("glossary.bindings.hint")}</p>
        <Button
          size="sm"
          onClick={() => setAdding(true)}
          disabled={term.kind !== "CONCEPT"}
          className="rounded-[4px]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("glossary.bindings.add")}
        </Button>
      </div>
      {bindings === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : bindings.length === 0 ? (
        <EmptyState
          icon={Link2}
          title={t("glossary.bindings.none")}
          description={
            term.kind === "CONCEPT"
              ? t("glossary.bindings.noneHint")
              : t("glossary.bindings.entitiesHint")
          }
        />
      ) : (
        <div className="overflow-auto rounded-[4px] bg-white dark:bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.bindings.vocabulary")}</span>
                </TableHead>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.bindings.mode")}</span>
                </TableHead>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.columns.status")}</span>
                </TableHead>
                <TableHead>
                  <span className={MICRO_LABEL}>{t("glossary.bindings.by")}</span>
                </TableHead>
                <TableHead className="text-right">
                  <span className={MICRO_LABEL}>{t("glossary.columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((binding) => (
                <TableRow key={binding.id}>
                  <TableCell className="max-w-[300px]">
                    <div className="truncate text-sm font-medium">{binding.label.label}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {binding.label.detail}
                      {binding.values.length > 0 && ` · ${binding.values.join(", ")}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {t(`glossary.bindings.modes.${binding.mode}` as TranslationKey)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="rounded-[4px] font-mono text-[10px]">
                      {binding.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {binding.approvedBy ?? binding.createdBy ?? binding.origin.toLowerCase()}
                    {binding.packKey && ` · ${binding.packKey}`}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {binding.status === "DRAFT" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          aria-label={t("glossary.approve")}
                          onClick={() => act(binding.id, () => approveBinding(binding.id))}
                          className="h-8 rounded-[4px] border-2 border-border"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {binding.status === "APPROVED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => act(binding.id, () => disableBinding(binding.id))}
                          className="h-8 rounded-[4px] border-2 border-border text-xs"
                        >
                          <Power className="h-3.5 w-3.5" />
                          {t("glossary.bindings.disable")}
                        </Button>
                      )}
                      {binding.status === "DISABLED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => act(binding.id, () => enableBinding(binding.id))}
                          className="h-8 rounded-[4px] border-2 border-border text-xs"
                        >
                          <Power className="h-3.5 w-3.5" />
                          {t("glossary.bindings.enable")}
                        </Button>
                      )}
                      {binding.status !== "APPROVED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          aria-label={t("glossary.delete")}
                          onClick={() => act(binding.id, () => deleteBinding(binding.id))}
                          className="h-8 rounded-[4px] border-2 border-destructive text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <BindDialog
        open={adding}
        onOpenChange={setAdding}
        row={null}
        initialTerm={asHit}
        onSaved={() => setRefresh((value) => value + 1)}
      />
    </div>
  );
}

// ── Relations (SL1 R5) ───────────────────────────────────────────────────────

export function TermRelations({
  term,
  onChanged,
}: {
  term: TermDetail;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [type, setType] = React.useState<RelationType>(
    term.kind === "ENTITY" ? "INSTANCE_OF" : "BROADER",
  );
  const [other, setOther] = React.useState<LookupHit | null>(null);
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!other) return;
    setBusy(true);
    try {
      await createRelation({
        fromTermId: term.id,
        toTermId: other.id,
        type,
        label: type === "CUSTOM" ? label.trim() : undefined,
      });
      setOther(null);
      setLabel("");
      onChanged();
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.relations.failed")));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await removeRelation(id);
      onChanged();
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    }
  }

  return (
    <div className="space-y-3">
      {term.relations.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("glossary.relations.none")}</p>
      ) : (
        <ul className="space-y-1">
          {term.relations.map((relation) => (
            <li key={relation.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {t(
                    `glossary.relations.${relation.direction === "out" ? "out" : "in"}.${relation.type}` as TranslationKey,
                  )}
                  {relation.type === "CUSTOM" && relation.label ? ` "${relation.label}"` : ""}
                </span>
                <TermLink termKey={relation.term.key}>{relation.term.term}</TermLink>
                {relation.status !== "APPROVED" && <TermStatusBadge status={relation.status} />}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("glossary.relations.remove")}
                onClick={() => remove(relation.id)}
                className="h-7"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2 rounded-[4px] border-2 border-dashed border-border p-3">
        <div className={MICRO_LABEL}>{t("glossary.relations.add")}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={type} onValueChange={(value) => setType(value as RelationType)}>
            <SelectTrigger className="h-9 w-[200px] rounded-[4px] border-2 border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RELATION_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`glossary.relations.out.${value}` as TranslationKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {type === "CUSTOM" && (
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("glossary.relations.labelPlaceholder")}
              className="h-9 w-[180px] rounded-[4px] border-2 border-border"
            />
          )}
        </div>
        <TermPicker
          value={other}
          onChange={setOther}
          kind={type === "BROADER" || type === "INSTANCE_OF" ? "CONCEPT" : undefined}
        />
        <Button size="sm" disabled={!other || busy} onClick={add} className="rounded-[4px]">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("glossary.relations.addButton")}
        </Button>
      </div>
    </div>
  );
}

// ── Find in text (SL2 §7) ────────────────────────────────────────────────────

export function FindInTextDialog({
  term,
  open,
  onOpenChange,
}: {
  term: TermDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const [preview, setPreview] = React.useState<FindInTextPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [severity, setSeverity] = React.useState("info");
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError(null);
    setCreated(null);
    findInTextPreview(term.key)
      .then(setPreview)
      .catch((loadError) =>
        setError(semanticErrorMessage(loadError, t("glossary.findInText.failed"))),
      );
  }, [open, term.key, t]);

  async function create() {
    setBusy(true);
    try {
      const result = await findInTextCreate(term.key, { severity });
      setCreated(result.customDetectorId);
      toast.success(t("glossary.findInText.created"));
    } catch (createError) {
      toast.error(semanticErrorMessage(createError, t("glossary.findInText.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("glossary.findInText.title")}</DialogTitle>
          <DialogDescription>{t("glossary.findInText.description")}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : !preview ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <div className={MICRO_LABEL}>{t("glossary.findInText.labels")}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {preview.labels.map((label) => (
                  <Badge
                    key={label.value}
                    variant="outline"
                    className={
                      label.checked
                        ? "rounded-[4px] text-[11px]"
                        : "rounded-[4px] text-[11px] line-through opacity-60"
                    }
                    title={label.reason}
                  >
                    {label.value}
                  </Badge>
                ))}
              </div>
            </div>
            {preview.pattern && (
              <div>
                <div className={MICRO_LABEL}>{t("glossary.findInText.pattern")}</div>
                <code className="mt-1 block break-all rounded-[4px] bg-muted px-2 py-1 font-mono text-[11px]">
                  {preview.pattern}
                </code>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t("glossary.findInText.tests", { count: String(preview.scenarios.length) })}
            </p>
            {preview.warnings.map((warning) => (
              <p key={warning.code} className="text-xs text-amber-700 dark:text-amber-400">
                {warning.message}
              </p>
            ))}
            {preview.detectors.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("glossary.findInText.existing", {
                  names: preview.detectors.map((detector) => detector.name).join(", "),
                })}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Label>{t("glossary.findInText.severity")}</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="h-8 w-[140px] rounded-[4px] border-2 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["info", "low", "medium", "high", "critical"].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {created && (
              <Link
                href={nsPath(`/detectors/${created}`)}
                className="text-xs underline"
              >
                {t("glossary.findInText.openDetector")}
              </Link>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button disabled={busy || !preview?.pattern || created !== null} onClick={create}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("glossary.findInText.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
