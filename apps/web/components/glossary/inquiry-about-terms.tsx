"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Badge, Label, Switch } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { LookupHit } from "@/lib/semantic-api";
import { TermPicker } from "./glossary-ui";

/**
 * A watch's *About* section (SL3 R7.6): the findings must be evidence of one
 * of these glossary terms — a concept, through an APPROVED binding of their
 * output or a manual link, optionally including narrower concepts; or an
 * entity, through a mention of one of its confirmed values (G5 R18).
 */
export function InquiryAboutTerms({
  termKeys,
  onTermKeysChange,
  includeNarrower,
  onIncludeNarrowerChange,
}: {
  termKeys: string[];
  onTermKeysChange: (keys: string[]) => void;
  includeNarrower: boolean;
  onIncludeNarrowerChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = React.useState<LookupHit | null>(null);
  const [names, setNames] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!picking) return;
    if (!termKeys.includes(picking.key)) {
      onTermKeysChange([...termKeys, picking.key]);
    }
    setNames((previous) => ({ ...previous, [picking.key]: picking.term }));
    setPicking(null);
  }, [picking, termKeys, onTermKeysChange]);

  return (
    <div className="space-y-2">
      <Label>{t("glossary.inquiry.aboutLabel")}</Label>
      <p className="text-[11px] text-muted-foreground">{t("glossary.inquiry.aboutHint")}</p>
      {termKeys.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {termKeys.map((key) => (
            <Badge key={key} variant="outline" className="gap-1 rounded-[4px] text-[11px]">
              {names[key] ?? key}
              <button
                type="button"
                aria-label={t("glossary.inquiry.remove", { term: names[key] ?? key })}
                onClick={() => onTermKeysChange(termKeys.filter((value) => value !== key))}
                className="rounded-[2px] hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <TermPicker value={picking} onChange={setPicking} />
      {termKeys.length > 0 && (
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={includeNarrower} onCheckedChange={onIncludeNarrowerChange} />
          {t("glossary.inquiry.includeNarrower")}
        </label>
      )}
    </div>
  );
}
