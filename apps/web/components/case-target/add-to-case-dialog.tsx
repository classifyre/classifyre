"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Fingerprint, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type CaseResponseDto, type CreateCaseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Textarea } from "@workspace/ui/components/textarea";
import { CASE_SEVERITIES } from "@/components/case-details-form";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import type { CaseCandidate } from "./case-target";
import { CaseSearchList } from "./case-search-list";

/**
 * Add assets and findings to a case picked here (or started here), from a
 * view that is not inside one. Assets join as evidence; a finding brings its
 * asset along. Every candidate starts ticked, so the list doubles as a
 * last look at what is about to go in.
 */
export function AddToCaseDialog({
  open,
  onOpenChange,
  candidates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: CaseCandidate[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();
  const [mode, setMode] = React.useState<"existing" | "new">("existing");
  const [pickedCase, setPickedCase] = React.useState<CaseResponseDto | null>(null);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [severity, setSeverity] = React.useState<string>("MEDIUM");
  const [chosen, setChosen] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState(false);
  const keyOf = (c: CaseCandidate) => `${c.kind}:${c.id}`;

  React.useEffect(() => {
    if (!open) return;
    setChosen(new Set(candidates.map(keyOf)));
    setPickedCase(null);
    setTitle("");
    setDescription("");
    setSeverity("MEDIUM");
  }, [open, candidates]);

  const picked = candidates.filter((c) => chosen.has(keyOf(c)));
  const canSubmit = !busy && picked.length > 0 && (mode === "existing" ? !!pickedCase : title.trim().length > 0);

  const toggle = (key: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async () => {
    setBusy(true);
    try {
      let target = pickedCase?.id ?? "";
      let targetTitle = pickedCase?.title ?? "";
      if (mode === "new") {
        const created = await api.cases.casesControllerCreate({
          createCaseDto: {
            title: title.trim(),
            description: description.trim() || undefined,
            severity: severity as CreateCaseDto["severity"],
          },
        });
        target = created.id;
        targetTitle = created.title;
      }
      let added = 0;
      for (const asset of picked.filter((c) => c.kind === "asset")) {
        try {
          await api.cases.casesControllerAddEvidence({
            id: target,
            addEvidenceDto: { entityType: "asset", entityId: asset.id },
          });
          added += 1;
        } catch {
          // Already evidence in that case: nothing to add, not a failure.
        }
      }
      const findingIds = picked.filter((c) => c.kind === "finding").map((c) => c.id);
      if (findingIds.length > 0) {
        const res = await api.cases.casesControllerAttachFindings({ id: target, attachFindingsDto: { findingIds } });
        added += res.attached;
      }
      toast.success(t("caseTarget.added", { count: added, title: targetTitle }), {
        action: {
          label: t("caseTarget.openCase"),
          onClick: () => router.push(nsPath(`/investigations/${target}`)),
        },
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("caseTarget.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={(e) => e.stopPropagation()} data-testid="add-to-case-dialog">
        <DialogHeader>
          <DialogTitle>{t("caseTarget.title")}</DialogTitle>
          <DialogDescription>{t("caseTarget.description", { count: picked.length })}</DialogDescription>
        </DialogHeader>

        <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-[4px] border border-border/60 p-1.5">
          {candidates.map((c) => {
            const Icon = c.kind === "asset" ? FileText : Fingerprint;
            return (
              <li key={keyOf(c)}>
                <label className="flex cursor-pointer items-center gap-2 rounded-[3px] px-1.5 py-1 text-xs hover:bg-muted/50">
                  <Checkbox checked={chosen.has(keyOf(c))} onCheckedChange={() => toggle(keyOf(c))} />
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={c.label}>
                    {c.label}
                  </span>
                  {c.kind === "finding" && c.assetName && (
                    <span className="max-w-[40%] shrink-0 truncate text-muted-foreground">{c.assetName}</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "existing" | "new")}>
          <TabsList className="w-full">
            <TabsTrigger value="existing" className="flex-1">
              {t("caseTarget.existing")}
            </TabsTrigger>
            <TabsTrigger value="new" className="flex-1">
              {t("caseTarget.new")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="existing" className="pt-2">
            <CaseSearchList
              selectedId={pickedCase?.id ?? null}
              onSelect={setPickedCase}
              // Nothing open yet: starting one is the only way in.
              onLoaded={(cases) => cases.length === 0 && setMode("new")}
            />
          </TabsContent>
          <TabsContent value="new" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-to-case-title">{t("investigations.newCase.titleLabel")}</Label>
              <Input
                id="add-to-case-title"
                value={title}
                maxLength={300}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("investigations.newCase.titlePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-to-case-description">{t("investigations.newCase.descriptionLabel")}</Label>
              <Textarea id="add-to-case-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("investigations.newCase.severityLabel")}</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit} data-testid="add-to-case-submit">
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t("caseTarget.submit", { count: picked.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
