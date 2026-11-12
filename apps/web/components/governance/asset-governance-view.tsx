"use client";

import { useState } from "react";
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

  const assign = async (role: GovernanceRoleKind, principalRef: string) => {
    onChange(
      await api.governance.governanceControllerAssignAssetRole({
        id: assetId,
        assignGovernanceRoleDto: { role, principalRef },
      }),
    );
  };
  const remove = async (roleId: string) => {
    onChange(
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
          history={governance.history}
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
            onChange(await saveGovernance(assetId, patch, t))
          }
        />
      ),
    },
    {
      id: "meaning",
      title: t("governance.steps.meaning"),
      description: t("governance.steps.meaningDesc"),
      complete: Boolean(done("meaning")),
      content: <MeaningStep assetId={assetId} onChanged={reload} />,
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
                  reload();
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
          columns={(columns?.columns ?? []).map((column) => column.name)}
          isTable={isTable}
          onChange={(next) => {
            onQualityChange(next);
            reload();
          }}
        />
      ),
    },
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
                onChange(await saveGovernance(assetId, { status }, t));
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
            onImported={reloadAll}
          />
        </div>
      ),
    },
  ];

  return (
    <GovernanceSteps
      steps={steps}
      label={t("governance.steps.label")}
      jumpTo={jump}
      banner={
        !governance.governed ? (
          <div
            className="mb-6 rounded-md border-2 border-dashed border-border p-4"
            data-testid="ungoverned-banner"
          >
            <div className="font-semibold">
              {t("governance.ungoverned.title")}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("governance.ungoverned.body")}
            </p>
          </div>
        ) : undefined
      }
    />
  );
}
