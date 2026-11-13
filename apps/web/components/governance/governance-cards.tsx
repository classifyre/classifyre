"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { toast } from "sonner";
import {
  Archive,
  BadgeCheck,
  BookCheck,
  BookOpen,
  CheckCircle2,
  Circle,
  Crown,
  FileText,
  Gauge,
  Pencil,
  PencilLine,
  Tags,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { api } from "@workspace/api-client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { ActorChip } from "@/components/actor-chip";
import type { AssetGovernanceDto, GovernanceStatus } from "@/lib/governance";

const LEGAL_BASES = [
  "CONSENT",
  "CONTRACT",
  "LEGAL_OBLIGATION",
  "VITAL_INTERESTS",
  "PUBLIC_TASK",
  "LEGITIMATE_INTERESTS",
] as const;
const NO_LEGAL_BASIS = "__none__";

export type GovernancePatch = {
  description?: string | null;
  usage?: string | null;
  limitations?: string | null;
  legalBasis?: (typeof LEGAL_BASES)[number] | null;
  retention?: string | null;
  status?: GovernanceStatus;
};

export function DescriptionCard({
  governance,
  onSave,
}: {
  governance: AssetGovernanceDto;
  onSave: (patch: GovernancePatch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    description: governance.description ?? "",
    usage: governance.usage ?? "",
    limitations: governance.limitations ?? "",
    legalBasis: (governance.legalBasis as string | null) ?? NO_LEGAL_BASIS,
    retention: governance.retention ?? "",
  });
  useEffect(() => {
    if (editing) return;
    setForm({
      description: governance.description ?? "",
      usage: governance.usage ?? "",
      limitations: governance.limitations ?? "",
      legalBasis: (governance.legalBasis as string | null) ?? NO_LEGAL_BASIS,
      retention: governance.retention ?? "",
    });
  }, [governance, editing]);

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        description: form.description.trim() || null,
        usage: form.usage.trim() || null,
        limitations: form.limitations.trim() || null,
        legalBasis:
          form.legalBasis === NO_LEGAL_BASIS
            ? null
            : (form.legalBasis as (typeof LEGAL_BASES)[number]),
        retention: form.retention.trim() || null,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, string | null | undefined][] = [
    [t("governance.fields.usage"), governance.usage],
    [t("governance.fields.limitations"), governance.limitations],
    [
      t("governance.fields.legalBasis"),
      governance.legalBasis
        ? t(`governance.legalBasis.${governance.legalBasis}` as TranslationKey)
        : null,
    ],
    [t("governance.fields.retention"), governance.retention],
  ];

  return (
    <Card data-testid="asset-description-card">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>{t("governance.fields.description")}</CardTitle>
          <CardDescription>{t("governance.descriptionHint")}</CardDescription>
        </div>
        {governance.canGovern && !editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
            data-testid="edit-description"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t("common.edit")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="gov-description">
                {t("governance.fields.description")}
              </Label>
              <Textarea
                id="gov-description"
                rows={6}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder={t("governance.placeholders.description")}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="gov-usage">
                  {t("governance.fields.usage")}
                </Label>
                <Textarea
                  id="gov-usage"
                  rows={3}
                  value={form.usage}
                  onChange={(event) =>
                    setForm({ ...form, usage: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gov-limitations">
                  {t("governance.fields.limitations")}
                </Label>
                <Textarea
                  id="gov-limitations"
                  rows={3}
                  value={form.limitations}
                  onChange={(event) =>
                    setForm({ ...form, limitations: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gov-legal">
                  {t("governance.fields.legalBasis")}
                </Label>
                <Select
                  value={form.legalBasis}
                  onValueChange={(value) =>
                    setForm({ ...form, legalBasis: value })
                  }
                >
                  <SelectTrigger id="gov-legal">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LEGAL_BASIS}>
                      {t("governance.legalBasis.none")}
                    </SelectItem>
                    {LEGAL_BASES.map((basis) => (
                      <SelectItem key={basis} value={basis}>
                        {t(`governance.legalBasis.${basis}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gov-retention">
                  {t("governance.fields.retention")}
                </Label>
                <Input
                  id="gov-retention"
                  value={form.retention}
                  onChange={(event) =>
                    setForm({ ...form, retention: event.target.value })
                  }
                  placeholder={t("governance.placeholders.retention")}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => void save()}
                disabled={busy}
                data-testid="save-description"
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {governance.description ? (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <Markdown>{governance.description}</Markdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("governance.noDescription")}
              </p>
            )}
            {facts.some(([, value]) => value) && (
              <dl className="grid gap-3 sm:grid-cols-2">
                {facts
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="whitespace-pre-wrap text-sm">{value}</dd>
                    </div>
                  ))}
              </dl>
            )}
            {governance.updatedBy && (
              <p className="text-xs text-muted-foreground">
                {t("governance.lastChanged")}{" "}
                <ActorChip actorRef={governance.updatedBy} />
                {governance.updatedAt &&
                  ` · ${new Date(governance.updatedAt).toLocaleString()}`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const NEXT_STATUSES: Record<GovernanceStatus, GovernanceStatus[]> = {
  DRAFT: ["ACTIVE"],
  ACTIVE: ["DEPRECATED", "DRAFT"],
  DEPRECATED: ["ACTIVE", "RETIRED"],
  RETIRED: ["DRAFT"],
};

const LIFECYCLE: GovernanceStatus[] = ["DRAFT", "ACTIVE", "DEPRECATED", "RETIRED"];

const STATUS_ICON: Record<GovernanceStatus, LucideIcon> = {
  DRAFT: PencilLine,
  ACTIVE: BadgeCheck,
  DEPRECATED: TriangleAlert,
  RETIRED: Archive,
};

/** What each checklist item looks like; unknown keys get a plain circle. */
const CHECK_ICON: Record<string, LucideIcon> = {
  owner: Crown,
  steward: BookCheck,
  description: FileText,
  meaning: BookOpen,
  classification: Tags,
  quality: Gauge,
  certified: BadgeCheck,
};

/**
 * Certification (GOV §4): what is in place, as tiles that jump to the step
 * that fixes them, and where the asset is in its lifecycle, with the moves
 * the owner or a steward may make from there.
 */
export function CertificationCard({
  governance,
  onStatus,
  onJump,
}: {
  governance: AssetGovernanceDto;
  onStatus: (status: GovernanceStatus) => Promise<void>;
  onJump?: (key: string) => void;
}) {
  const { t } = useTranslation();
  const items = governance.checklist as { key: string; done: boolean }[];
  const done = items.filter((item) => item.done).length;
  const status = governance.status as GovernanceStatus | null;
  const percent = items.length ? Math.round((done / items.length) * 100) : 0;
  return (
    <Card data-testid="governance-checklist">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>{t("governance.steps.certification")}</CardTitle>
            <CardDescription>{t("governance.certify.lead")}</CardDescription>
          </div>
          <div className="min-w-[160px] space-y-1 text-right">
            <div className="font-mono text-xs uppercase tracking-wider">
              {t("governance.checklist.progress", {
                done,
                total: items.length,
              })}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-accent-ink"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {items.map((item) => {
            const Icon = CHECK_ICON[item.key] ?? Circle;
            const jumpable = Boolean(onJump) && item.key !== "certified";
            return (
              <li key={item.key} data-done={item.done}>
                <button
                  type="button"
                  disabled={!jumpable}
                  onClick={() => onJump?.(item.key)}
                  className={`relative flex h-full w-full flex-col items-start gap-2 rounded-[4px] border p-3 text-left transition-colors enabled:hover:border-border ${
                    item.done
                      ? "border-accent-ink/40 bg-accent/15"
                      : "border-dashed border-border/60 bg-background"
                  }`}
                >
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-[4px] border ${
                      item.done
                        ? "border-border bg-accent text-accent-foreground"
                        : "border-border/40 bg-muted text-muted-foreground"
                    }`}
                    aria-hidden
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span
                    className={`text-xs font-medium leading-snug ${item.done ? "" : "text-muted-foreground"}`}
                  >
                    {t(`governance.checklist.${item.key}` as TranslationKey)}
                  </span>
                  <span className="absolute right-2 top-2" aria-hidden>
                    {item.done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-accent-ink" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("governance.certify.lifecycle")}
          </div>
          <ol className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="lifecycle-track">
            {LIFECYCLE.map((step, index) => {
              const Icon = STATUS_ICON[step];
              const current = status === step;
              return (
                <li
                  key={step}
                  data-current={current}
                  className={`relative flex items-start gap-2 rounded-[4px] border p-3 ${
                    current
                      ? "border-border bg-accent/20 shadow-[3px_3px_0_0_var(--border)]"
                      : "border-border/40 bg-muted/30 text-muted-foreground"
                  }`}
                >
                  <span
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border ${
                      current
                        ? "border-border bg-accent text-accent-foreground"
                        : "border-border/40 bg-background"
                    }`}
                    aria-hidden
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {index + 1}. {t(`governance.status.${step}`)}
                    </span>
                    <span className="block text-[11px] leading-snug">
                      {t(`governance.statusHint.${step}`)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          {!status && (
            <p className="text-sm text-muted-foreground">
              {t("governance.certify.needsOwner")}
            </p>
          )}
          {governance.canGovern && status && (
            <div className="flex flex-wrap items-center gap-2">
              {NEXT_STATUSES[status].map((next) => {
                const Icon = STATUS_ICON[next];
                return (
                  <Button
                    key={next}
                    size="sm"
                    variant={next === "ACTIVE" ? "default" : "outline"}
                    onClick={() => void onStatus(next)}
                    data-testid={`status-${next}`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {t(`governance.statusAction.${next}`)}
                  </Button>
                );
              })}
            </div>
          )}
          {governance.certifiedAt && status === "ACTIVE" && (
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <BadgeCheck className="h-3.5 w-3.5 text-accent-ink" aria-hidden />
              {t("governance.certifiedBy")}{" "}
              <ActorChip actorRef={governance.certifiedBy} /> ·{" "}
              {new Date(governance.certifiedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Save description, legal basis or lifecycle, with the toasts every caller wants. */
export async function saveGovernance(
  assetId: string,
  patch: GovernancePatch,
  t: (key: TranslationKey) => string,
): Promise<AssetGovernanceDto> {
  try {
    const next = await api.governance.governanceControllerUpdateAssetGovernance(
      {
        id: assetId,
        updateAssetGovernanceDto: patch,
      },
    );
    toast.success(t("governance.saved"));
    return next;
  } catch (error) {
    toast.error(
      await extractApiErrorMessage(error, t("governance.saveFailed")),
    );
    throw error;
  }
}
