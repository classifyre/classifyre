"use client";

import { useTranslation } from "@/hooks/use-translation";

/** The words a row filter is read out in (lib/row-filters.ts `describeFilter`). */
export function useRowWords() {
  const { t } = useTranslation();
  return {
    in: t("rowFilters.op.in"),
    not_in: t("rowFilters.op.not_in"),
    and: t("rowFilters.andJoin"),
    or: t("rowFilters.orJoin"),
    none: t("rowFilters.noneShared"),
  };
}
