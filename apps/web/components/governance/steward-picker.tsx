"use client";

import { X } from "lucide-react";
import { Button } from "@workspace/ui/components";
import { useActor } from "@/hooks/use-actors";
import { useTranslation } from "@/hooks/use-translation";
import { PrincipalPicker } from "./principal-picker";

/**
 * A glossary term's steward: a person or group of the tenant, held as its
 * reference (`user:<id>`, `group:<id>`), like an asset's steward
 * (docs/prd/GOV-governed-data-assets.md R11). Empty string for nobody.
 */
export function StewardPicker({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (ref: string) => void;
}) {
  const { t } = useTranslation();
  const actor = useActor(value || null);
  const current =
    value && actor
      ? {
          ref: value,
          kind: (actor.kind === "group" ? "group" : "user") as "user" | "group",
          displayName: actor.name,
        }
      : null;
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <PrincipalPicker
          id={id}
          kinds={["user", "group"]}
          value={current}
          onChange={(principal) => onChange(principal?.ref ?? "")}
          placeholder={t("governance.picker.nobody")}
        />
      </div>
      {value && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t("governance.picker.clear")}
          onClick={() => onChange("")}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
