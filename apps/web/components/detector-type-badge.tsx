"use client";

import * as React from "react";
import {
  Bot,
  Brain,
  Eye,
  Image,
  Layers,
  Link2,
  Network,
  Regex,
  ScanSearch,
  Shield,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  detectorTypeIconName,
  detectorTypeTranslationKey,
} from "@/lib/custom-detector-badge";

const ICON_MAP: Record<string, LucideIcon> = {
  Bot,
  Brain,
  Image,
  Layers,
  Link2,
  Network,
  Regex,
  ScanSearch,
  Shield,
  ShieldAlert,
  Sparkles,
};

export function CustomDetectorTypeBadge({
  method,
  pipelineType,
  className,
  ...props
}: {
  method?: string | null;
  pipelineType?: string | null;
  className?: string;
} & Omit<React.ComponentProps<typeof Badge>, "children">) {
  const { t } = useTranslation();
  const iconName = detectorTypeIconName(method, pipelineType);
  const labelKey = detectorTypeTranslationKey(method, pipelineType);
  const Icon = ICON_MAP[iconName] ?? Sparkles;

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-2 border-border text-[10px] font-mono uppercase tracking-[0.08em]",
        className,
      )}
      {...props}
    >
      <Icon className="h-3 w-3" />
      {t(labelKey as TranslationKey)}
    </Badge>
  );
}

/**
 * Badge marking a detector that processes content visually (images) rather than
 * as text — e.g. image classification, object detection, or a vision-enabled LLM.
 */
export function VisualScanBadge({
  className,
  ...props
}: { className?: string } & Omit<React.ComponentProps<typeof Badge>, "children">) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      title={t("detectors.visual.tooltip")}
      className={cn(
        "gap-1 border-2 border-border text-[10px] font-mono uppercase tracking-[0.08em]",
        className,
      )}
      {...props}
    >
      <Eye className="h-3 w-3" />
      {t("detectors.visual.badge")}
    </Badge>
  );
}
