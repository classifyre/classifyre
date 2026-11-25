"use client";

import { Search, TableProperties } from "lucide-react";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { STATUS_TONE, statusBadgeClass } from "@/lib/status-tone";

export interface CaseKindBadgeProps
  extends React.HTMLAttributes<HTMLDivElement> {
  kind?: "INVESTIGATION" | "DATA_REQUEST" | string | null;
}

export function CaseKindBadge({
  kind,
  className,
  ...props
}: CaseKindBadgeProps) {
  const { t } = useTranslation();
  const isDataRequest = kind === "DATA_REQUEST";
  const Icon = isDataRequest ? TableProperties : Search;

  return (
    <Badge
      variant="outline"
      className={cn(
        statusBadgeClass,
        "inline-flex items-center gap-1",
        isDataRequest ? STATUS_TONE.fresh : STATUS_TONE.neutral,
        className,
      )}
      {...props}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {t(
        isDataRequest
          ? "cases.kind.DATA_REQUEST"
          : "cases.kind.INVESTIGATION",
      )}
    </Badge>
  );
}
