"use client";

import { useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "@workspace/api-client";
import { Spinner } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type {
  AssetQualityDto,
  AssetColumnsDto,
  AssetGovernanceDto,
  GovernanceRoleKind,
} from "@/lib/governance";
import { ColumnsCard } from "./columns-card";
import {
  CertificationCard,
  DescriptionCard,
  saveGovernance,
} from "./governance-cards";
import { GovernanceSteps, type GovernanceStep } from "./governance-steps";
import { MeaningStep } from "./meaning-step";
import { OwnershipCard } from "./ownership-card";
import { QualityStep } from "./quality-step";
import { ContractCard } from "./contract-card";
import { AccessCard } from "./access-card";
import { GovernanceBadge } from "./governance-badge";
import { QualityChip } from "./quality-chip";
import { RoleIcon } from "./role-style";
import { ChangedBy } from "@/components/audit-history";

/** Which step fixes which checklist item. */
const STEP_OF: Record<string, string> = {
  owner: "ownership",
  steward: "ownership",
  description: "description",
  meaning: "meaning",
  classification: "columns",
  quality: "quality",
  certified: "certification",
};

/**
 * The asset's Governance tab (GOV §5.7): who answers for it, what it is,
 * what it means, its columns, and its certification, one step each, with the
 * checklist as the stepper's progress.
 */
export function AssetGovernanceView({
  governance,
  loading,
  onChange,
  reload,
  columns,
  onColumnsChange,
  quality,
  onQualityChange,
  isTable,
  reloadAll,
  sourceHref,
}: {
  governance: AssetGovernanceDto | null;
  loading: boolean;
  onChange: (next: AssetGovernanceDto) => void;
  /** Re-read the checklist after a change elsewhere (meaning, columns). */
  reload: () => void;
  columns: AssetColumnsDto | null;
  onColumnsChange: (next: AssetColumnsDto) => void;
  quality: AssetQualityDto | null;
  onQualityChange: (next: AssetQualityDto) => void;
  /** SQL can read it: whole-table quality rules are possible. */
  isTable: boolean;
  /** Re-read governance, columns and quality (after a contract import). */
  reloadAll: () => void;
  sourceHref?: string;
}) {
  const { t } = useTranslation();
  const [jump, setJump] = useState<{ id: string; at: number } | null>(null);
  // Bumped on every change made here, so "last changed" reads the trail again.
  const [changes, setChanges] = useState(0);
  const changed = () => setChanges((n) => n + 1);

  if (!governance) {
    return loading ? (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    ) : null;
  }

  const done = (key: string) =>
    governance.checklist.find((item: { key: string }) => item.key === key)
      ?.done;
  const assetId = governance.assetId;
  const apply = (next: AssetGovernanceDto) => {
    onChange(next);
    changed();
  };
  const refresh = () => {
    reload();
    changed();
  };

  const assign = async (role: GovernanceRoleKind, principalRef: string) => {
    apply(
      await api.governance.governanceControllerAssignAssetRole({
        id: assetId,
        assignGovernanceRoleDto: { role, principalRef },
      }),
    );
  };
  const remove = async (roleId: string) => {
    apply(
      await api.governance.governanceControllerRemoveAssetRole({
        id: assetId,
        roleId,
      }),
    );
  };

  const steps: GovernanceStep[] = [
    {
      id: "ownership",
      title: t("governance.steps.ownership"),
      description: t("governance.steps.ownershipDesc"),
      complete: Boolean(done("owner") && done("steward")),
      content: (
        <OwnershipCard
          scope="asset"
          roles={governance.roles}
          canGovern={governance.canAssignRoles}
          onAssign={assign}
          onRemove={remove}
          sourceHref={sourceHref}
        />
      ),
    },
    {
      id: "description",
      title: t("governance.steps.description"),
      description: t("governance.steps.descriptionDesc"),
      complete: Boolean(done("description")),
      content: (
        <DescriptionCard
          governance={governance}
          onSave={async (patch) =>
            apply(await saveGovernance(assetId, patch, t))
          }
        />
      ),
    },
    {
      id: "meaning",
      title: t("governance.steps.meaning"),
      description: t("governance.steps.meaningDesc"),
      complete: Boolean(done("meaning")),
      content: <MeaningStep assetId={assetId} onChanged={refresh} />,
    },
    ...(columns && columns.columns.length > 0
      ? [
          {
            id: "columns",
            title: t("governance.steps.columns"),
            description: t("governance.steps.columnsDesc"),
            complete: Boolean(done("classification")),
            content: (
              <ColumnsCard
                assetId={assetId}
                state={columns}
                onChange={(next) => {
                  onColumnsChange(next);
                  refresh();
                }}
              />
            ),
          },
        ]
      : []),
    {
      id: "quality",
      title: t("governance.steps.quality"),
      description: t("governance.steps.qualityDesc"),
      complete: Boolean(done("quality")),
      content: (
        <QualityStep
          assetId={assetId}
          quality={quality}
          isTable={isTable}
          onChange={(next) => {
            onQualityChange(next);
            refresh();
          }}
        />
      ),
    },
    ...(isTable && governance.canGovern
      ? [
          {
            id: "access",
            title: t("governance.steps.access"),
            description: t("governance.steps.accessDesc"),
            complete: true,
            content: (
              <AccessCard
                target={{
                  type: "asset",
                  id: assetId,
                  name: t("sqlConnections.thisTable"),
                }}
              />
            ),
          },
        ]
      : []),
    {
      id: "certification",
      title: t("governance.steps.certification"),
      description: t("governance.steps.certificationDesc"),
      complete: governance.status === "ACTIVE",
      content: (
        <div className="space-y-4">
          <CertificationCard
            governance={governance}
            onStatus={async (status) => {
              try {
                apply(await saveGovernance(assetId, { status }, t));
              } catch {
                // saveGovernance already said why.
              }
            }}
            onJump={(key) =>
              setJump({ id: STEP_OF[key] ?? "ownership", at: Date.now() })
            }
          />
          <ContractCard
            assetId={assetId}
            canGovern={governance.canGovern}
            onImported={() => {
              reloadAll();
              changed();
            }}
          />
        </div>
      ),
    },
  ];

  const owner = governance.roles.find(
    (role: { role: string }) => role.role === "OWNER",
  );
  const checked = governance.checklist.filter(
    (item: { done: boolean }) => item.done,
  ).length;
  const total = governance.checklist.length;

  return (
    <GovernanceSteps
      steps={steps}
      label={t("governance.steps.label")}
      jumpTo={jump}
      banner={
        <div className="mb-8 space-y-3" data-testid="governance-overview">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewTile
              label={t("governance.overview.status")}
              icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
              onClick={() => setJump({ id: "certification", at: Date.now() })}
            >
              <GovernanceBadge status={governance.status} />
              <span className="text-[11px] leading-snug text-muted-foreground">
                {t(
                  `governance.statusHint.${governance.status ?? "UNGOVERNED"}` as Parameters<typeof t>[0],
                )}
              </span>
            </OverviewTile>
            <OverviewTile
              label={t("governance.role.OWNER")}
              icon={<RoleIcon role="OWNER" size="sm" />}
              onClick={() => setJump({ id: "ownership", at: Date.now() })}
            >
              <span className="truncate text-sm font-semibold">
                {owner?.principal.displayName ?? t("governance.ownership.nobody")}
              </span>
              {owner?.inherited && (
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {t("governance.ownership.inherited")}
                </span>
              )}
            </OverviewTile>
            <OverviewTile
              label={t("governance.overview.checklist")}
              icon={<span className="font-mono text-xs">{checked}/{total}</span>}
              onClick={() => setJump({ id: "certification", at: Date.now() })}
            >
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-accent-ink"
                  style={{ width: `${total ? Math.round((checked / total) * 100) : 0}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground">
                {t("governance.checklist.progress", { done: checked, total })}
              </span>
            </OverviewTile>
            <OverviewTile
              label={t("governance.steps.quality")}
              icon={null}
              onClick={() => setJump({ id: "quality", at: Date.now() })}
            >
              {quality && quality.rules.length > 0 ? (
                <QualityChip
                  quality={{
                    rules: quality.rules.filter((rule) => rule.enabled).length,
                    failing: quality.failing,
                    score: quality.score ?? null,
                  }}
                />
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t("governance.overview.noChecks")}
                </span>
              )}
              {quality?.lastEvaluatedAt && (
                <span className="text-[11px] text-muted-foreground">
                  {t("governance.overview.measured", {
                    when: new Date(quality.lastEvaluatedAt).toLocaleString(),
                  })}
                </span>
              )}
            </OverviewTile>
          </div>
          <ChangedBy key={changes} entityType="asset" entityId={assetId} />
          {!governance.governed && (
            <div
              className="rounded-[4px] border-2 border-dashed border-border p-4"
              data-testid="ungoverned-banner"
            >
              <div className="font-semibold">
                {t("governance.ungoverned.title")}
              </div>
              <p className="text-sm text-muted-foreground">
                {t("governance.ungoverned.body")}
              </p>
            </div>
          )}
        </div>
      }
    />
  );
}

/** One fact of the overview row; clicking it goes to the step behind it. */
function OverviewTile({
  label,
  icon,
  onClick,
  children,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-col items-start gap-2 rounded-[4px] border border-border bg-card p-3 text-left shadow-[3px_3px_0_0_var(--border)] transition-transform hover:-translate-y-0.5"
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {icon}
      </span>
      {children}
    </button>
  );
}
