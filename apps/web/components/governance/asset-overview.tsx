"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { toast } from "sonner";
import { CheckCircle2, Circle, Pencil, UserPlus } from "lucide-react";
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
  Spinner,
  Textarea,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { ActorChip } from "@/components/actor-chip";
import { AssetMeaningPanel } from "@/components/glossary/meaning-card";
import type {
  AssetGovernanceDto,
  GovernancePrincipalDto,
  GovernanceRoleKind,
  GovernanceStatus,
} from "@/lib/governance";
import { OwnershipCard } from "./ownership-card";
import { PrincipalPicker } from "./principal-picker";

const LEGAL_BASES = [
  "CONSENT",
  "CONTRACT",
  "LEGAL_OBLIGATION",
  "VITAL_INTERESTS",
  "PUBLIC_TASK",
  "LEGITIMATE_INTERESTS",
] as const;
const NO_LEGAL_BASIS = "__none__";

type Patch = {
  description?: string | null;
  usage?: string | null;
  limitations?: string | null;
  legalBasis?: (typeof LEGAL_BASES)[number] | null;
  retention?: string | null;
  status?: GovernanceStatus;
};

/** Nobody owns the asset: one way forward (GOV §5.7). */
function UngovernedCard({
  canGovern,
  onAssign,
}: {
  canGovern: boolean;
  onAssign: (principalRef: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [owner, setOwner] = useState<GovernancePrincipalDto | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="border-dashed" data-testid="ungoverned-card">
      <CardHeader>
        <CardTitle>{t("governance.ungoverned.title")}</CardTitle>
        <CardDescription>{t("governance.ungoverned.body")}</CardDescription>
      </CardHeader>
      {canGovern && (
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="sm:w-80">
            <PrincipalPicker
              kinds={["user"]}
              value={owner}
              onChange={setOwner}
              placeholder={t("governance.ungoverned.pick")}
            />
          </div>
          <Button
            disabled={!owner || busy}
            data-testid="ungoverned-assign-owner"
            onClick={async () => {
              if (!owner) return;
              setBusy(true);
              try {
                await onAssign(owner.ref);
              } finally {
                setBusy(false);
              }
            }}
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            {t("governance.ungoverned.assign")}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

function DescriptionCard({
  governance,
  onSave,
}: {
  governance: AssetGovernanceDto;
  onSave: (patch: Patch) => Promise<void>;
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

function ChecklistCard({
  governance,
  onStatus,
}: {
  governance: AssetGovernanceDto;
  onStatus: (status: GovernanceStatus) => Promise<void>;
}) {
  const { t } = useTranslation();
  const done = governance.checklist.filter(
    (item: { done: boolean }) => item.done,
  ).length;
  const status = governance.status as GovernanceStatus | null;
  return (
    <Card data-testid="governance-checklist">
      <CardHeader>
        <CardTitle>{t("governance.checklist.title")}</CardTitle>
        <CardDescription>
          {t("governance.checklist.progress", {
            done,
            total: governance.checklist.length,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1.5">
          {governance.checklist.map((item: { key: string; done: boolean }) => (
            <li
              key={item.key}
              className="flex items-center gap-2 text-sm"
              data-done={item.done}
            >
              {item.done ? (
                <CheckCircle2 className="h-4 w-4 text-accent-ink" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />
              )}
              <span className={item.done ? "" : "text-muted-foreground"}>
                {t(`governance.checklist.${item.key}` as TranslationKey)}
              </span>
            </li>
          ))}
        </ul>
        {governance.canGovern && status && (
          <div className="flex flex-wrap gap-2">
            {NEXT_STATUSES[status].map((next) => (
              <Button
                key={next}
                size="sm"
                variant={next === "ACTIVE" ? "default" : "outline"}
                onClick={() => void onStatus(next)}
                data-testid={`status-${next}`}
              >
                {t(`governance.statusAction.${next}`)}
              </Button>
            ))}
          </div>
        )}
        {governance.certifiedAt && status === "ACTIVE" && (
          <p className="text-xs text-muted-foreground">
            {t("governance.certifiedBy")}{" "}
            <ActorChip actorRef={governance.certifiedBy} /> ·{" "}
            {new Date(governance.certifiedAt).toLocaleDateString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The asset's Overview (GOV §5.7): who answers for it, what it is for, what
 * it means, and what is still missing to be fully governed; the technical
 * details follow (`children`).
 */
export function AssetOverview({
  governance,
  loading,
  onChange,
  sourceHref,
  children,
}: {
  governance: AssetGovernanceDto | null;
  loading: boolean;
  onChange: (next: AssetGovernanceDto) => void;
  sourceHref?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();

  if (loading && !governance) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const assetId = governance?.assetId;
  const assign = async (role: GovernanceRoleKind, principalRef: string) => {
    if (!assetId) return;
    onChange(
      await api.governance.governanceControllerAssignAssetRole({
        id: assetId,
        assignGovernanceRoleDto: { role, principalRef },
      }),
    );
  };
  const remove = async (roleId: string) => {
    if (!assetId) return;
    onChange(
      await api.governance.governanceControllerRemoveAssetRole({
        id: assetId,
        roleId,
      }),
    );
  };
  const save = async (patch: Patch) => {
    if (!assetId) return;
    try {
      onChange(
        await api.governance.governanceControllerUpdateAssetGovernance({
          id: assetId,
          updateAssetGovernanceDto: patch,
        }),
      );
      toast.success(t("governance.saved"));
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.saveFailed")),
      );
      throw error;
    }
  };

  return (
    <div className="space-y-4" data-testid="asset-overview">
      {governance && !governance.governed && (
        <UngovernedCard
          canGovern={governance.canGovern}
          onAssign={async (ref) => {
            try {
              await assign("OWNER", ref);
              toast.success(t("governance.ungoverned.done"));
            } catch (error) {
              toast.error(
                await extractApiErrorMessage(
                  error,
                  t("governance.ownership.failed"),
                ),
              );
            }
          }}
        />
      )}
      {governance && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <DescriptionCard governance={governance} onSave={save} />
            <Card>
              <CardContent className="pt-6">
                <AssetMeaningPanel assetId={governance.assetId} />
              </CardContent>
            </Card>
          </div>
          <div className="space-y-4">
            <OwnershipCard
              scope="asset"
              roles={governance.roles}
              history={governance.history}
              canGovern={governance.canGovern}
              onAssign={assign}
              onRemove={remove}
              sourceHref={sourceHref}
            />
            {governance.governed && (
              <ChecklistCard
                governance={governance}
                onStatus={(status) => save({ status }).catch(() => undefined)}
              />
            )}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
