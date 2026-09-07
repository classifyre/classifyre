"use client";

import { Badge } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import {
  getCaseStatusBadgeLabel,
  getCaseStatusBadgeTone,
} from "@/lib/case-status-badge";
import { statusBadgeClass } from "@/lib/status-tone";

interface CaseStatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  status?: string | null;
}

export function CaseStatusBadge({ status, className, ...props }: CaseStatusBadgeProps) {
  const { t } = useTranslation();

  return (
    <Badge
      variant="outline"
      className={`${statusBadgeClass} ${getCaseStatusBadgeTone(status)} ${className ?? ""}`}
      {...props}
    >
      {t(getCaseStatusBadgeLabel(status))}
    </Badge>
  );
}
