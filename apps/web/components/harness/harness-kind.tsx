"use client";

import * as React from "react";
import {
  Copy,
  FlaskConical,
  FolderSearch,
  Moon,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { TranslationKey } from "@/i18n";

const KIND_ICON: Record<string, LucideIcon> = {
  INQUIRY: FolderSearch,
  CASE: Workflow,
  CONFIG: SlidersHorizontal,
  DETECTOR_AUTHOR: FlaskConical,
  DREAM: Moon,
  DUPLICATES: Copy,
};

/** Icon for an agent kind / mission. */
export function KindGlyph({
  kind,
  className,
}: {
  kind: string;
  className?: string;
}) {
  const Icon = KIND_ICON[kind] ?? Workflow;
  return <Icon className={className} />;
}

/** i18n key for a kind's label (falls back gracefully for unknown kinds). */
export function kindLabelKey(kind: string): TranslationKey {
  return `harness.kinds.${kind}` as TranslationKey;
}
