"use client";

import * as React from "react";
import { Brain, Layers, Regex, Sparkles, type LucideIcon } from "lucide-react";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";

// ── Custom detector type → icon + label ──────────────────────────────────────
//
// A small reusable badge that pairs a detector's method ("type") with a
// matching icon so custom detectors are easy to differentiate at a glance —
// both in the catalog table and when picking detectors for a source.

interface DetectorTypeMeta {
  label: string;
  Icon: LucideIcon;
}

const METHOD_META: Record<string, DetectorTypeMeta> = {
  RULESET: { label: "Ruleset", Icon: Regex },
  CLASSIFIER: { label: "Classifier", Icon: Brain },
  ENTITY: { label: "Entity", Icon: Layers },
};

const FALLBACK_META: DetectorTypeMeta = { label: "Custom", Icon: Sparkles };

export function getCustomDetectorTypeMeta(method?: string | null): DetectorTypeMeta {
  if (!method) {
    return FALLBACK_META;
  }
  return METHOD_META[method.toUpperCase()] ?? FALLBACK_META;
}

export function CustomDetectorTypeBadge({
  method,
  className,
  ...props
}: {
  method?: string | null;
  className?: string;
} & Omit<React.ComponentProps<typeof Badge>, "children">) {
  const { label, Icon } = getCustomDetectorTypeMeta(method);
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
      {label}
    </Badge>
  );
}
