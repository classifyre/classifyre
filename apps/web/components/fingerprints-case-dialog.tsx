"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, type CaseResponseDto } from "@workspace/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { Switch } from "@workspace/ui/components/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@workspace/ui/components/tabs";
import { useTranslation } from "@/hooks/use-translation";

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/**
 * Create a case (or add to an existing one) from the assets currently visible
 * in the fingerprints graph. A noise-filter checklist (all checked by default)
 * lets the operator drop irrelevant assets before attaching. Adds them as
 * evidence and optionally attaches their findings — handled server-side and
 * logged as a DUPLICATES run.
 */
export function FingerprintsCaseDialog({
  open,
  onOpenChange,
  assetIds,
  assetLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assetIds: string[];
  /** Resolve an asset id to its display name for the noise-filter checklist. */
  assetLabel?: (id: string) => string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [severity, setSeverity] = React.useState<(typeof SEVERITIES)[number]>("MEDIUM");
  const [attachFindings, setAttachFindings] = React.useState(true);
  const [cases, setCases] = React.useState<CaseResponseDto[]>([]);
  const [caseId, setCaseId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // Noise filter: which of the target assets actually get attached.
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!open) return;
    setMode("new");
    setTitle("");
    setDescription("");
    setSeverity("MEDIUM");
    setAttachFindings(true);
    setCaseId("");
    setSelectedIds(new Set(assetIds));
    api.cases
      .casesControllerList({})
      .then((r) => setCases(r.items ?? []))
      .catch(() => setCases([]));
  }, [open, assetIds]);

  const chosenIds = React.useMemo(
    () => assetIds.filter((id) => selectedIds.has(id)),
    [assetIds, selectedIds],
  );

  const toggleAsset = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (mode === "new" && !title.trim()) {
      toast.error(t("correlation.caseAction.titleRequired"));
      return;
    }
    if (mode === "existing" && !caseId) {
      toast.error(t("correlation.caseAction.caseRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.correlation.correlationControllerCaseAction({
        caseActionRequestDto: {
          assetIds: chosenIds,
          attachFindings,
          ...(mode === "existing"
            ? { caseId }
            : { title: title.trim(), description: description.trim() || undefined, severity }),
        },
      });
      toast.success(
        t("correlation.caseAction.done", {
          assets: String(res.assetsAdded),
          findings: String(res.findingsAttached),
        }),
      );
      onOpenChange(false);
      router.push(nsPath(`/investigations/${res.caseId}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("correlation.caseAction.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("correlation.caseAction.title")}</DialogTitle>
          <DialogDescription>
            {t("correlation.caseAction.desc", { count: String(chosenIds.length) })}
          </DialogDescription>
        </DialogHeader>

        {/* Noise filter: uncheck assets that shouldn't land in the case. */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{t("correlation.caseAction.assetChecklist")}</Label>
            <span className="text-[11px] text-muted-foreground">
              {t("correlation.caseAction.assetChecklistCount", {
                selected: String(chosenIds.length),
                total: String(assetIds.length),
              })}
            </span>
          </div>
          <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded-[4px] border border-border/60 p-1.5">
            {assetIds.map((id) => (
              <li key={id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-[3px] px-1.5 py-1 text-xs hover:bg-muted/50">
                  <Checkbox
                    checked={selectedIds.has(id)}
                    onCheckedChange={() => toggleAsset(id)}
                  />
                  <span className="min-w-0 flex-1 truncate" title={assetLabel?.(id) ?? id}>
                    {assetLabel?.(id) ?? id}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "new" | "existing")}>
          <TabsList className="w-full">
            <TabsTrigger value="new" className="flex-1">
              {t("correlation.caseAction.newCase")}
            </TabsTrigger>
            <TabsTrigger value="existing" className="flex-1">
              {t("correlation.caseAction.existingCase")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="fp-case-title">{t("correlation.caseAction.caseTitle")}</Label>
              <Input
                id="fp-case-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("correlation.caseAction.caseTitlePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-case-desc">{t("correlation.caseAction.description")}</Label>
              <Textarea
                id="fp-case-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("correlation.caseAction.severity")}</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="existing" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label>{t("correlation.caseAction.pickCase")}</Label>
              <Select value={caseId} onValueChange={setCaseId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("correlation.caseAction.pickCasePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {cases.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
        </Tabs>

        <label className="flex items-center justify-between gap-3 rounded-[4px] border border-border/60 px-3 py-2">
          <span className="text-sm">{t("correlation.caseAction.attachFindings")}</span>
          <Switch checked={attachFindings} onCheckedChange={setAttachFindings} />
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || chosenIds.length === 0}>
            {busy ? t("correlation.caseAction.working") : t("correlation.caseAction.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
