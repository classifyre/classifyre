"use client";

import * as React from "react";
import {
  Plus,
  Check,
  Search,
  ChevronLeft,
  Fingerprint,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type SearchAssetItemDto,
  type HypothesisResponseDto,
} from "@workspace/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { ScrollArea } from "@workspace/ui/components/scroll-area";

export interface EvidencePickerDialogProps {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingKeys: Set<string>;
  onAdded: () => void;
}

function abbrev(dt: string | undefined): string {
  if (!dt) return "";
  return dt.replace(/^UNSTRUCTURED_API_/, "").replace(/_/g, " ").toLowerCase();
}

export function EvidencePickerDialog({
  caseId,
  open,
  onOpenChange,
  existingKeys,
  onAdded,
}: EvidencePickerDialogProps) {
  const [step, setStep] = React.useState<"hypotheses" | "pick">("hypotheses");
  const [hypotheses, setHypotheses] = React.useState<HypothesisResponseDto[]>([]);
  const [selectedHypIds, setSelectedHypIds] = React.useState<Set<string>>(new Set());

  // Asset search state
  const [search, setSearch] = React.useState("");
  const [results, setResults] = React.useState<SearchAssetItemDto[]>([]);
  const [loadingAssets, setLoadingAssets] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<Set<string>>(new Set());
  const [addedFindings, setAddedFindings] = React.useState<Set<string>>(new Set());
  const [addedAssets, setAddedAssets] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!open) return;
    setStep("hypotheses");
    setSelectedHypIds(new Set());
    setSearch("");
    setResults([]);
    setExpanded(new Set());
    setBusy(new Set());
    setAddedFindings(new Set());
    setAddedAssets(new Set());
    api.hypotheses.hypothesesControllerList({ caseId })
      .then(setHypotheses)
      .catch(() => toast.error("Could not load hypotheses"));
  }, [open, caseId]);

  // Asset search
  const runSearch = React.useCallback(async () => {
    setLoadingAssets(true);
    try {
      const res = await api.searchAssets({
        assets: { search: search.trim() || undefined },
        findings: { includeResolved: false },
        page: { skip: 0, limit: 25 },
        options: { excludeFindings: false, includeAssetsWithoutFindings: true },
      });
      setResults(res.items);
    } catch (err) {
      console.error(err);
      toast.error("Asset search failed");
    } finally {
      setLoadingAssets(false);
    }
  }, [search]);

  const goToPick = () => {
    setStep("pick");
    void runSearch();
  };

  const toggleHyp = (id: string) => {
    setSelectedHypIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const ensureAssetEvidence = async (assetId: string): Promise<boolean> => {
    if (existingKeys.has(`asset:${assetId}`) || addedAssets.has(assetId)) return true;
    try {
      await api.cases.casesControllerAddEvidence({
        id: caseId,
        addEvidenceDto: {
          entityType: "asset",
          entityId: assetId,
          hypothesisIds: Array.from(selectedHypIds),
        },
      });
      setAddedAssets((prev) => new Set([...prev, assetId]));
      onAdded();
      return true;
    } catch (err) {
      console.error(err);
      toast.error("Failed to add asset as evidence");
      return false;
    }
  };

  const addAsset = async (assetId: string) => {
    const key = `asset:${assetId}`;
    setBusy((prev) => new Set([...prev, key]));
    try {
      await ensureAssetEvidence(assetId);
      toast.success("Asset added as evidence");
    } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  const addFinding = async (assetId: string, findingId: string) => {
    const key = `finding:${assetId}:${findingId}`;
    setBusy((prev) => new Set([...prev, key]));
    try {
      const ok = await ensureAssetEvidence(assetId);
      if (!ok) return;
      const caseData = await api.cases.casesControllerFindOne({ id: caseId });
      const evidence = caseData.evidence?.find(
        (e) => e.entityType === "asset" && e.entityId === assetId,
      );
      if (!evidence) { toast.error("Could not find evidence record — try again"); return; }
      await api.cases.casesControllerAddFinding({
        id: caseId,
        evidenceId: evidence.id,
        addFindingDto: { findingId },
      });
      setAddedFindings((prev) => new Set([...prev, findingId]));
      onAdded();
      toast.success("Finding attached to evidence");
    } catch (err) {
      console.error(err);
      toast.error("Failed to attach finding");
    } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  const hypCount = selectedHypIds.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === "hypotheses" ? "Link to hypothesis" : "Add evidence"}
          </DialogTitle>
          <DialogDescription>
            {step === "hypotheses"
              ? "Optionally link this evidence to one or more hypotheses."
              : "Search for assets to add as evidence."}
          </DialogDescription>
        </DialogHeader>

        {step === "hypotheses" ? (
          <div className="space-y-4">
            {hypotheses.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                No hypotheses yet — you can add evidence now and link it later.
              </p>
            ) : (
              <div className="space-y-2">
                {hypotheses.map((h) => {
                  const selected = selectedHypIds.has(h.id);
                  return (
                    <button
                      key={h.id}
                      onClick={() => toggleHyp(h.id)}
                      className={`w-full rounded-md border p-3 text-left transition-colors ${
                        selected ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center ${
                            selected ? "border-primary bg-primary" : "border-muted-foreground"
                          }`}
                        >
                          {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                        <span className="font-medium text-sm">{h.statement}</span>
                        {h.color && (
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: h.color }} />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={goToPick}>
                Next: Pick evidence →
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <Button variant="ghost" size="sm" className="-ml-1" onClick={() => setStep("hypotheses")}>
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <span className="text-sm text-muted-foreground">
                Linking to {hypCount} hypothesis{hypCount !== 1 ? "es" : ""}
              </span>
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); void runSearch(); }}
              className="flex gap-2 mb-3"
            >
              <Input
                placeholder="Search assets by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              <Button type="submit" variant="outline" disabled={loadingAssets}>
                <Search className="h-4 w-4" />
              </Button>
            </form>

            <ScrollArea className="h-[340px] pr-3">
              <div className="space-y-3">
                {results.map((item) => {
                  const a = item.asset;
                  const assetKey = `asset:${a.id}`;
                  const alreadyAsset = existingKeys.has(assetKey) || addedAssets.has(a.id);
                  const isExpanded = expanded.has(a.id);
                  const busyAsset = busy.has(assetKey);

                  return (
                    <div key={a.id} className="border border-border">
                      <div className="flex items-center justify-between gap-2 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-sm">{a.name}</p>
                          <p className="text-muted-foreground text-xs">
                            <Badge variant="outline" className="mr-1 text-[10px]">{a.assetType}</Badge>
                            {String(a.sourceType)}
                            {item.findings.length > 0 && (
                              <span className="ml-1">· {item.findings.length} finding{item.findings.length !== 1 ? "s" : ""}</span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {item.findings.length > 0 && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleExpand(a.id)}>
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={alreadyAsset ? "ghost" : "outline"}
                            disabled={alreadyAsset || busyAsset}
                            onClick={() => addAsset(a.id)}
                          >
                            {alreadyAsset ? <><Check className="h-3.5 w-3.5" /> Added</> : <><Plus className="h-3.5 w-3.5" /> Add asset</>}
                          </Button>
                        </div>
                      </div>
                      {isExpanded && item.findings.length > 0 && (
                        <div className="border-t border-border/50 bg-muted/30 px-3 pb-2 pt-1 space-y-1">
                          <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide mb-1.5">Add individual finding</p>
                          {item.findings.map((f) => {
                            const fKey = `finding:${a.id}:${f.id}`;
                            const alreadyF = addedFindings.has(f.id);
                            return (
                              <div key={f.id} className="flex items-center justify-between gap-2 py-0.5">
                                <span className="flex min-w-0 items-center gap-1.5 text-sm">
                                  <Fingerprint className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                                  <SeverityBadge severity={f.severity.toLowerCase() as never}>{f.severity}</SeverityBadge>
                                  <span className="font-medium shrink-0">{f.findingType}</span>
                                  {f.detectorType && <span className="text-muted-foreground text-[10px] shrink-0">{abbrev(f.detectorType)}</span>}
                                  {f.matchedContent && <span className="text-muted-foreground truncate text-[11px]">{f.matchedContent.slice(0, 40)}</span>}
                                </span>
                                <Button
                                  size="sm"
                                  variant={alreadyF ? "ghost" : "outline"}
                                  className="h-6 px-2 text-xs shrink-0"
                                  disabled={alreadyF || busy.has(fKey)}
                                  onClick={() => addFinding(a.id, f.id)}
                                >
                                  {alreadyF ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!loadingAssets && results.length === 0 && (
                  <p className="text-muted-foreground py-8 text-center text-sm">No assets found.</p>
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
