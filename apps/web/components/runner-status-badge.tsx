"use client";

import { Badge, Spinner } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import {
  getRunnerStatusBadgeLabel,
  getRunnerStatusBadgeTone,
  isRunnerStatusRunning,
} from "@/lib/runner-status-badge";

interface RunnerStatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  status?: string | null;
}

export function RunnerStatusBadge({ status, className, ...props }: RunnerStatusBadgeProps) {
  const { t } = useTranslation();

  return (
    <Badge
      className={`rounded-[4px] border ${getRunnerStatusBadgeTone(status)} ${className || ""}`}
      {...props}
    >
      {isRunnerStatusRunning(status) && (
        <Spinner
          size="sm"
          className="gap-0 [&_svg]:size-3"
          data-icon="inline-start"
        />
      )}
      {t(getRunnerStatusBadgeLabel(status))}
    </Badge>
  );
}
