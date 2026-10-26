"use client";

import * as React from "react";
import { ArrowDownUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type EdgeClass } from "@workspace/api-client";
import type { ExploreAsset } from "@workspace/case-board/explore";
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
import { Label } from "@workspace/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Textarea } from "@workspace/ui/components/textarea";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

/**
 * What a drawn link can mean. The class decides where it shows: "feeds" is
 * lineage, "same as" sits with the duplicates, the rest are plain links.
 */
const RELATIONS: Array<{ id: string; relationType: string; relationClass: EdgeClass; directed: boolean }> = [
  { id: "related", relationType: "related_to", relationClass: "REFERENCE", directed: false },
  { id: "same", relationType: "same_as", relationClass: "IDENTITY", directed: false },
  { id: "feeds", relationType: "feeds", relationClass: "FLOW", directed: true },
  { id: "references", relationType: "references", relationClass: "REFERENCE", directed: true },
  { id: "custom", relationType: "", relationClass: "REFERENCE", directed: true },
];

/**
 * Draw a link between two assets that the data does not know about. It is
 * kept by the assets' identity, so it survives every re-scan, and it goes
 * from view when either asset is deleted at its source.
 */
export function LinkAssetsDialog({
  open,
  onOpenChange,
  from,
  to,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: ExploreAsset | null;
  to: ExploreAsset | null;
  onLinked: () => void;
}) {
  const { t } = useTranslation();
  const [relation, setRelation] = React.useState("related");
  const [custom, setCustom] = React.useState("");
  const [note, setNote] = React.useState("");
  const [swapped, setSwapped] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const chosen = RELATIONS.find((r) => r.id === relation) ?? RELATIONS[0]!;
  const [a, b] = swapped ? [to, from] : [from, to];
  const relationType = chosen.id === "custom" ? custom.trim().toLowerCase().replace(/\s+/g, "_") : chosen.relationType;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!a || !b || !relationType) return;
    setBusy(true);
    try {
      await api.graph.graphControllerCreateManualEdge({
        createManualEdgeDto: {
          fromType: "asset",
          fromId: a.id,
          toType: "asset",
          toId: b.id,
          relationType,
          relationClass: chosen.relationClass,
          note: note.trim() || undefined,
        },
      });
      toast.success(t("explore.linked"));
      onLinked();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("explore.linkFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("explore.linkTitle")}</DialogTitle>
            <DialogDescription>{t("explore.linkDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div className="min-w-0 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="explore-link-from">{chosen.directed ? t("explore.linkFrom") : t("explore.linkOne")}</Label>
                <Input id="explore-link-from" value={a?.label ?? ""} readOnly tabIndex={-1} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="explore-link-to">{chosen.directed ? t("explore.linkToField") : t("explore.linkOther")}</Label>
                <Input id="explore-link-to" value={b?.label ?? ""} readOnly tabIndex={-1} />
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => setSwapped((s) => !s)}
              disabled={!chosen.directed}
              title={t("explore.linkSwap")}
              aria-label={t("explore.linkSwap")}
              className="mb-6"
            >
              <ArrowDownUp className="size-4" aria-hidden />
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="explore-link-relation">{t("explore.linkMeans")}</Label>
            <Select value={relation} onValueChange={setRelation}>
              <SelectTrigger id="explore-link-relation" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONS.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {t(`explore.relation.${r.id}` as TranslationKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t(`explore.relationHint.${relation}` as TranslationKey)}</p>
          </div>

          {relation === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="explore-link-custom">{t("explore.relationCustom")}</Label>
              <Input
                id="explore-link-custom"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder={t("explore.relationCustomPlaceholder")}
                maxLength={60}
                autoFocus
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="explore-link-note">{t("explore.linkNote")}</Label>
            <Textarea
              id="explore-link-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("explore.linkNotePlaceholder")}
              maxLength={500}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">{t("explore.yoursLasts")}</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !a || !b || !relationType}>
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t("explore.linkSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
