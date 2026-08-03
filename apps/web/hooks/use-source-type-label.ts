"use client";

import * as React from "react";
import { getSourceLabel } from "@workspace/schemas/source-labels";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

/**
 * Human, localized name for a connector type: `S3_COMPATIBLE_STORAGE` reads as
 * "S3-Compatible Storage" (or "S3-kompatibler Speicher" in German) rather than
 * leaking the enum into the UI.
 *
 * Falls back to the schema's canonical English label — and finally to the raw
 * enum — so a source type added to `all_input_sources.json` still renders
 * sensibly before anyone writes its translation.
 */
export function useSourceTypeLabel(): (sourceType: string | undefined) => string {
  const { t } = useTranslation();

  return React.useCallback(
    (sourceType: string | undefined) => {
      if (!sourceType) return "";
      const normalized = sourceType.toUpperCase();
      const key = `sourceTypes.${normalized}` as TranslationKey;
      const translated = t(key);
      // `translate` echoes the key back when it is missing from the dictionary.
      if (translated !== key) return translated;
      return getSourceLabel(normalized) || sourceType;
    },
    [t],
  );
}
