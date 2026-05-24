"use client";

import * as React from "react";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import {
  getTranslationsForLanguage,
  translate,
  type TranslationKey,
} from "@/i18n";

export function useTranslation() {
  const { resolvedLanguage } = useInstanceSettings();

  const translations = React.useMemo(
    () => getTranslationsForLanguage(resolvedLanguage),
    [resolvedLanguage],
  );

  const t = React.useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string =>
      translate(translations, key, params),
    [translations],
  );

  return { t };
}
