"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  BadgeCheck,
  Boxes,
  CircleDashed,
  Gauge,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { api } from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import type { SourceGovernanceDto } from "@/lib/governance";
import { ChangedBy } from "@/components/audit-history";
import { OwnershipCard } from "./ownership-card";
import { RoleIcon } from "./role-style";

/**
 * A source's Governance tab (GOV §5.7), on the page's full width: how much of
 * it is governed, each number a way to those assets, and the roles its assets
 * inherit. Who changed what is in Activity.
 */
export function SourceGovernanceView({
  sourceId,
  governance,
  onChange,
}: {
  sourceId: string;
  governance: SourceGovernanceDto;
  onChange: (next: SourceGovernanceDto) => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const { assets, owned, active, checked, failing } = governance.coverage;
  const list = (filter?: string) =>
    nsPath(
      `/assets?source=${encodeURIComponent(sourceId)}${filter ? `&governance=${filter}` : ""}`,
    );
  const owner = governance.roles.find((role) => role.role === "OWNER");

  return (
    <div className="w-full space-y-6" data-testid="source-governance">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <CoverageTile
          icon={Boxes}
          label={t("governance.coverage.assets")}
          value={assets}
          href={list()}
        />
        <CoverageTile
          icon={RoleIconOwner}
          label={t("governance.page.totals.owned")}
          value={owned}
          of={assets}
          href={list("governed")}
        />
        <CoverageTile
          icon={BadgeCheck}
          label={t("governance.page.totals.active")}
          value={active}
          of={assets}
          href={list("active")}
          tone="done"
        />
        <CoverageTile
          icon={CircleDashed}
          label={t("governance.page.totals.ungoverned")}
          value={assets - owned}
          of={assets}
          href={list("ungoverned")}
          tone={assets - owned > 0 ? "warn" : undefined}
        />
        <CoverageTile
          icon={failing > 0 ? TriangleAlert : Gauge}
          label={t("governance.coverage.failing")}
          value={failing}
          of={checked}
          ofLabel={t("governance.coverage.checked", { count: checked })}
          href={list("failing")}
          tone={failing > 0 ? "error" : undefined}
        />
      </div>

      <ChangedBy entityType="source" entityId={sourceId} />

      <OwnershipCard
        scope="source"
        roles={governance.roles}
        canGovern={governance.canAssignRoles}
        onAssign={async (role, principalRef) =>
          onChange(
            await api.governance.governanceControllerAssignSourceRole({
              id: sourceId,
              assignGovernanceRoleDto: { role, principalRef },
            }),
          )
        }
        onRemove={async (roleId) =>
          onChange(
            await api.governance.governanceControllerRemoveSourceRole({
              id: sourceId,
              roleId,
            }),
          )
        }
      />

      <Card data-testid="source-coverage">
        <CardHeader className="pb-3">
          <CardTitle>{t("governance.steps.coverage")}</CardTitle>
          <CardDescription>{t("governance.coverage.lead")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Bar
            label={t("governance.page.totals.owned")}
            value={owned}
            of={assets}
          />
          <Bar
            label={t("governance.page.totals.active")}
            value={active}
            of={assets}
          />
          <Bar
            label={t("governance.coverage.withChecks")}
            value={checked}
            of={assets}
          />
          {!owner && (
            <p className="text-sm text-muted-foreground">
              {t("governance.coverage.noSourceOwner")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RoleIconOwner() {
  return <RoleIcon role="OWNER" size="sm" />;
}

const TONE = {
  done: "border-border bg-accent/20",
  warn: "border-amber-600/40 bg-amber-50 dark:bg-amber-950/30",
  error: "border-destructive/50 bg-destructive/10",
} as const;

/** One number of the coverage row, linking to the assets it counts. */
function CoverageTile({
  icon: Icon,
  label,
  value,
  of,
  ofLabel,
  href,
  tone,
}: {
  icon: LucideIcon | (() => ReactNode);
  label: string;
  value: number;
  of?: number;
  ofLabel?: string;
  href: string;
  tone?: keyof typeof TONE;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-col gap-2 rounded-[4px] border p-4 shadow-[3px_3px_0_0_var(--border)] transition-transform hover:-translate-y-0.5 ${
        tone ? TONE[tone] : "border-border bg-card"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-3xl font-black leading-none">
        {value}
        {of !== undefined && (
          <span className="text-sm font-normal text-muted-foreground">
            {" "}
            / {of}
          </span>
        )}
      </span>
      {ofLabel && (
        <span className="text-[11px] text-muted-foreground">{ofLabel}</span>
      )}
    </Link>
  );
}

function Bar({ label, value, of }: { label: string; value: number; of: number }) {
  const percent = of ? Math.round((value / of) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-accent-ink" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
