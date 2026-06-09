"use client";

import { Badge } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import {
  getCaseStatusBadgeLabel,
  getCaseStatusBadgeTone,
} from "@/lib/case-status-badge";

interface CaseStatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  status?: string | null;
}

export function CaseStatusBadge({ status, className, ...props }: CaseStatusBadgeProps) {
  const { t } = useTranslation();

  return (
    <Badge
      className={`rounded-[4px] border ${getCaseStatusBadgeTone(status)} ${className ?? ""}`}
      {...props}
    >
      {t(getCaseStatusBadgeLabel(status))}
    </Badge>
  );
}
