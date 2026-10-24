"use client";

import * as React from "react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group";
import { useTranslation } from "@/hooks/use-translation";
import { createRelation, semanticErrorMessage, type MapNode, type RelationType } from "@/lib/semantic-api";

type Choice = "narrower" | "broader" | "related" | "custom";

/**
 * Say how two concepts picked on the map relate (SL1 R5): one is a kind of
 * the other, they are related, or a verb of your own. An operator's relation
 * is approved at once and the map draws it straight away.
 */
export function RelateDialog({
  from,
  to,
  onOpenChange,
  onRelated,
}: {
  from: MapNode | null;
  to: MapNode | null;
  onOpenChange: (open: boolean) => void;
  onRelated: () => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = React.useState<Choice>("narrower");
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const open = !!from && !!to;

  React.useEffect(() => {
    if (!open) return;
    // Same scheme suggests a taxonomy; across schemes, a plain relation.
    setChoice(from?.scheme?.id && from.scheme.id === to?.scheme?.id ? "narrower" : "related");
    setLabel("");
  }, [open, from, to]);

  async function save() {
    if (!from || !to) return;
    const spec: { fromTermId: string; toTermId: string; type: RelationType; label?: string } =
      choice === "narrower"
        ? { fromTermId: from.termId, toTermId: to.termId, type: "BROADER" }
        : choice === "broader"
          ? { fromTermId: to.termId, toTermId: from.termId, type: "BROADER" }
          : choice === "related"
            ? { fromTermId: from.termId, toTermId: to.termId, type: "RELATED" }
            : { fromTermId: from.termId, toTermId: to.termId, type: "CUSTOM", label: label.trim() };
    setBusy(true);
    try {
      await createRelation(spec);
      toast.success(t("semanticMap.edit.related"));
      onRelated();
      onOpenChange(false);
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.relations.failed")));
    } finally {
      setBusy(false);
    }
  }

  const a = from?.name ?? "";
  const b = to?.name ?? "";
  const options: Array<[Choice, string]> = [
    ["narrower", t("semanticMap.edit.isKindOf", { a, b })],
    ["broader", t("semanticMap.edit.isKindOf", { a: b, b: a })],
    ["related", t("semanticMap.edit.isRelated", { a, b })],
    ["custom", t("semanticMap.edit.custom")],
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" data-testid="meaning-relate-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            {t("semanticMap.edit.relateTitle")}
          </DialogTitle>
          <DialogDescription>{t("semanticMap.edit.relateDescription", { a, b })}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={choice} onValueChange={(value) => setChoice(value as Choice)} className="gap-2">
          {options.map(([value, text]) => (
            <label key={value} className="flex cursor-pointer items-center gap-2.5 rounded-[4px] border-2 border-border/60 px-3 py-2 text-sm has-[[data-state=checked]]:border-foreground">
              <RadioGroupItem value={value} />
              {text}
            </label>
          ))}
        </RadioGroup>
        {choice === "custom" && (
          <Input
            autoFocus
            value={label}
            maxLength={64}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t("glossary.relations.labelPlaceholder")}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || (choice === "custom" && !label.trim())}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t("semanticMap.edit.relateSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
