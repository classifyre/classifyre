"use client";

import { api } from "@workspace/api-client";
import { Card, CardContent } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useSourceGovernance } from "@/lib/governance";
import { OwnershipCard } from "./ownership-card";

/**
 * A source's owner, stewards and custodian (GOV §5.7): the defaults its
 * assets inherit, and how many of its assets are governed.
 */
export function SourceOwnership({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const { data, setData } = useSourceGovernance(sourceId);
  if (!data) return null;
  const { assets, owned, active } = data.coverage;
  return (
    <div className="space-y-3" data-testid="source-governance">
      <Card>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-1 py-4 text-sm">
          <span data-testid="source-coverage-owned">
            {t("governance.coverage.owned", { owned, assets })}
          </span>
          <span>{t("governance.coverage.active", { active })}</span>
        </CardContent>
      </Card>
      <OwnershipCard
        scope="source"
        roles={data.roles}
        history={data.history}
        canGovern={data.canGovern}
        onAssign={async (role, principalRef) =>
          setData(
            await api.governance.governanceControllerAssignSourceRole({
              id: sourceId,
              assignGovernanceRoleDto: { role, principalRef },
            }),
          )
        }
        onRemove={async (roleId) =>
          setData(
            await api.governance.governanceControllerRemoveSourceRole({
              id: sourceId,
              roleId,
            }),
          )
        }
      />
    </div>
  );
}
