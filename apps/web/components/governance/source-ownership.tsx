"use client";

import Link from "next/link";
import { api } from "@workspace/api-client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import type { SourceGovernanceDto } from "@/lib/governance";
import { GovernanceSteps } from "./governance-steps";
import { OwnershipCard } from "./ownership-card";

/**
 * A source's Governance tab (GOV §5.7): the roles its assets inherit, and how
 * many of them are owned and certified, with the way to the ones that are not.
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
  const { assets, owned, active } = governance.coverage;
  const list = (filter: string) =>
    nsPath(
      `/assets?source=${encodeURIComponent(sourceId)}&governance=${filter}`,
    );

  return (
    <GovernanceSteps
      label={t("governance.steps.label")}
      steps={[
        {
          id: "ownership",
          title: t("governance.steps.ownership"),
          description: t("governance.steps.sourceOwnershipDesc"),
          complete: governance.roles.some((role) => role.role === "OWNER"),
          content: (
            <OwnershipCard
              scope="source"
              roles={governance.roles}
              history={governance.history}
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
          ),
        },
        {
          id: "coverage",
          title: t("governance.steps.coverage"),
          description: t("governance.steps.coverageDesc"),
          complete: assets > 0 && active === assets,
          content: (
            <Card data-testid="source-coverage">
              <CardHeader>
                <CardTitle>{t("governance.steps.coverage")}</CardTitle>
                <CardDescription>
                  {t("governance.coverage.lead")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["owned", owned],
                      ["active", active],
                      ["ungoverned", assets - owned],
                    ] as const
                  ).map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-md border border-border/60 p-3"
                    >
                      <div className="text-2xl font-black">
                        {value}
                        <span className="text-sm font-normal text-muted-foreground">
                          /{assets}
                        </span>
                      </div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {t(`governance.page.totals.${key}`)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link href={list("ungoverned")}>
                      {t("governance.coverage.showUngoverned")}
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={list("draft")}>
                      {t("governance.coverage.showDraft")}
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ),
        },
      ]}
    />
  );
}
