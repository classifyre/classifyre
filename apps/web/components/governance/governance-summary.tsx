"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { ActorChip } from "@/components/actor-chip";
import {
  GOVERNANCE_ROLE_KINDS,
  rolesOf,
  type AssetGovernanceDto,
  type AssetQualityDto,
  type GovernanceRoleDto,
  type SourceGovernanceDto,
} from "@/lib/governance";
import { GovernanceBadge } from "./governance-badge";

function RoleLines({ roles }: { roles: GovernanceRoleDto[] }) {
  const { t } = useTranslation();
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
      {GOVERNANCE_ROLE_KINDS.map((kind) => {
        const held = rolesOf(roles, kind);
        return (
          <div key={kind} className="contents">
            <dt className="text-xs text-muted-foreground">
              {t(`governance.role.${kind}`)}
            </dt>
            <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {held.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                held.map((role) => (
                  <span
                    key={role.id}
                    className="inline-flex items-center gap-1"
                  >
                    <ActorChip actorRef={role.principal.ref} />
                    {role.inherited && (
                      <span className="text-[10px] text-muted-foreground">
                        ({t("governance.ownership.inherited")})
                      </span>
                    )}
                  </span>
                ))
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Governance in brief, for an asset's Overview (GOV §5.7): its lifecycle,
 * who answers for it, the start of its description and how far along it
 * is. Everything is changed in the Governance tab.
 */
export function AssetGovernanceSummary({
  governance,
  quality,
  onOpen,
}: {
  governance: AssetGovernanceDto;
  /** Score and failing rules, when the asset has quality rules. */
  quality?: AssetQualityDto | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const done = governance.checklist.filter(
    (item: { done: boolean }) => item.done,
  ).length;
  return (
    <Card data-testid="governance-summary">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          {t("governance.summary.title")}
          <GovernanceBadge status={governance.status} />
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={onOpen}
          data-testid="open-governance"
        >
          {governance.governed
            ? t("governance.summary.open")
            : t("governance.summary.start")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!governance.governed && (
          <p className="text-sm text-muted-foreground">
            {t("governance.ungoverned.title")}
          </p>
        )}
        <RoleLines roles={governance.roles} />
        {governance.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {governance.description.replace(/[#*_`>]/g, "")}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("governance.checklist.progress", {
              done,
              total: governance.checklist.length,
            })}
          </span>
          {quality && quality.rules.length > 0 && (
            <span
              className={quality.failing ? "text-destructive" : undefined}
              data-testid="summary-quality"
            >
              {t("governance.quality.brief", {
                score: quality.score ?? "—",
                failing: quality.failing,
              })}
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

/** The same for a source: its roles and how many of its assets are governed. */
export function SourceGovernanceSummary({
  governance,
  onOpen,
}: {
  governance: SourceGovernanceDto;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { assets, owned, active } = governance.coverage;
  return (
    <Card data-testid="source-governance-summary">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          {t("governance.summary.title")}
        </CardTitle>
        <Button size="sm" variant="outline" onClick={onOpen}>
          {t("governance.summary.open")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <RoleLines roles={governance.roles} />
        <p className="text-xs text-muted-foreground">
          {t("governance.coverage.owned", { owned, assets })} ·{" "}
          {t("governance.coverage.active", { active })}
        </p>
      </CardContent>
    </Card>
  );
}
