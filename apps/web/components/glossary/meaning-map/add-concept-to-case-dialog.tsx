"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { CASE_SEVERITIES } from "@/components/case-details-form";
import { CaseSearchList } from "@/components/case-target/case-search-list";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useNsPath } from "@/lib/ns-path";
import { linkTerm } from "@/lib/semantic-api";
import { useTranslation } from "@/hooks/use-translation";

export interface ConceptRef {
  id: string;
  key: string;
  name: string;
}

/** Pin a glossary term on a case's board (SL5 A3), where the board places it. */
async function placeOnBoard(caseId: string, termId: string) {
  const board = await api.caseBoard.caseBoardControllerGet({ id: caseId });
  const res = await api.caseBoard.caseBoardControllerApplyOps({
    id: caseId,
    applyBoardOpsDto: {
      clientId: "semantic-map",
      baseVersion: board.board.version,
      ops: [{ type: "term.place", opId: crypto.randomUUID(), itemId: crypto.randomUUID(), termId }],
    },
  });
  if (res.rejected.length > 0) throw new Error(res.rejected[0]?.reason ?? "rejected");
}

/**
 * Bring a concept into a case from the semantic map (SL5 B3): the case
 * becomes *about* it (so the concept lists the case, and the case's meaning
 * panel the concept), its card is pinned on the board, and — if asked — a
 * watch for new findings about it is started for that case.
 */
export function AddConceptToCaseDialog({
  open,
  onOpenChange,
  concept,
  defaultCase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concept: ConceptRef | null;
  /** The case the map is highlighting, offered first. */
  defaultCase?: CaseResponseDto | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();
  const [mode, setMode] = React.useState<"existing" | "new">("existing");
  const [pickedCase, setPickedCase] = React.useState<CaseResponseDto | null>(null);
  const [title, setTitle] = React.useState("");
  const [severity, setSeverity] = React.useState<string>("MEDIUM");
  const [about, setAbout] = React.useState(true);
  const [pin, setPin] = React.useState(true);
  const [watch, setWatch] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setMode("existing");
    setPickedCase(defaultCase ?? null);
    setTitle(concept ? concept.name : "");
    setSeverity("MEDIUM");
    setAbout(true);
    setPin(true);
    setWatch(false);
  }, [open, concept, defaultCase]);

  const canSubmit =
    !!concept &&
    !busy &&
    (about || pin || watch) &&
    (mode === "existing" ? !!pickedCase : title.trim().length > 0);

  const submit = async () => {
    if (!concept) return;
    setBusy(true);
    try {
      let target = pickedCase?.id ?? "";
      let targetTitle = pickedCase?.title ?? "";
      if (mode === "new") {
        const created = await api.cases.casesControllerCreate({
          createCaseDto: { title: title.trim(), severity: severity as CreateCaseDto["severity"] },
        });
        target = created.id;
        targetTitle = created.title;
      }
      if (about) await linkTerm({ termId: concept.id, target: { type: "case", id: target } });
      if (pin) await placeOnBoard(target, concept.id);
      onOpenChange(false);
      if (watch) {
        router.push(
          nsPath(
            `/investigations/inquiries/new?term=${encodeURIComponent(concept.key)}&caseId=${encodeURIComponent(target)}`,
          ),
        );
        return;
      }
      toast.success(t("semanticMap.addToCase.added", { concept: concept.name, title: targetTitle }), {
        action: {
          label: t("caseTarget.openCase"),
          onClick: () => router.push(nsPath(`/investigations/${target}`)),
        },
      });
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("caseTarget.failed")));
    } finally {
      setBusy(false);
    }
  };

  const option = (
    id: string,
    checked: boolean,
    onChange: (value: boolean) => void,
    label: string,
    hint: string,
  ) => (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 rounded-[4px] px-1 py-1 hover:bg-muted/50">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={(e) => e.stopPropagation()} data-testid="add-concept-to-case">
        <DialogHeader>
          <DialogTitle>{t("semanticMap.addToCase.title", { concept: concept?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("semanticMap.addToCase.description")}</DialogDescription>
        </DialogHeader>

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
              onLoaded={(cases) => cases.length === 0 && setMode("new")}
            />
          </TabsContent>
          <TabsContent value="new" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="concept-case-title">{t("investigations.newCase.titleLabel")}</Label>
              <Input
                id="concept-case-title"
                value={title}
                maxLength={300}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("investigations.newCase.titlePlaceholder")}
              />
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

        <div className="space-y-1 border-t border-border/60 pt-3">
          {option(
            "concept-case-about",
            about,
            setAbout,
            t("semanticMap.addToCase.about"),
            t("semanticMap.addToCase.aboutHint"),
          )}
          {option(
            "concept-case-pin",
            pin,
            setPin,
            t("semanticMap.addToCase.pin"),
            t("semanticMap.addToCase.pinHint"),
          )}
          {option(
            "concept-case-watch",
            watch,
            setWatch,
            t("semanticMap.addToCase.watch"),
            t("semanticMap.addToCase.watchHint"),
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit} data-testid="add-concept-to-case-submit">
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {watch ? t("semanticMap.addToCase.submitAndWatch") : t("semanticMap.addToCase.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
