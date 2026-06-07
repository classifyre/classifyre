"use client";

import * as React from "react";
import { Plus, Check, Search } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type SearchAssetItemDto,
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

export function EvidencePickerDialog({
  caseId,
  open,
  onOpenChange,
  existingKeys,
  onAdded,
}: EvidencePickerDialogProps) {
  const [search, setSearch] = React.useState("");
  const [results, setResults] = React.useState<SearchAssetItemDto[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const runSearch = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.searchAssets({
        assets: { search: search.trim() || undefined },
        findings: { includeResolved: true },
        page: { skip: 0, limit: 25 },
        options: { excludeFindings: false, includeAssetsWithoutFindings: true },
      });
      setResults(res.items);
    } catch (err) {
      console.error(err);
      toast.error("Asset search failed");
    } finally {
      setLoading(false);
    }
  }, [search]);

  React.useEffect(() => {
    if (open) void runSearch();
  }, [open, runSearch]);

  const add = async (entityType: string, entityId: string) => {
    const key = `${entityType}:${entityId}`;
    setBusyKey(key);
    try {
      await api.cases.casesControllerAddEvidence({
        id: caseId,
        addEvidenceDto: { entityType, entityId },
      });
      toast.success("Evidence added");
      onAdded();
    } catch (err) {
      console.error(err);
      toast.error("Failed to add evidence");
    } finally {
      setBusyKey(null);
    }
  };

  const renderAddButton = (entityType: string, entityId: string) => {
    const key = `${entityType}:${entityId}`;
    const already = existingKeys.has(key);
    return (
      <Button
        size="sm"
        variant={already ? "ghost" : "outline"}
        disabled={already || busyKey === key}
        onClick={() => add(entityType, entityId)}
      >
        {already ? (
          <>
            <Check className="h-3.5 w-3.5" /> Added
          </>
        ) : (
          <>
            <Plus className="h-3.5 w-3.5" /> Add
          </>
        )}
      </Button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add evidence</DialogTitle>
          <DialogDescription>
            Search ingested assets and findings, then attach them to this case.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
          className="flex gap-2"
        >
          <Input
            placeholder="Search assets by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <Button type="submit" variant="outline" disabled={loading}>
            <Search className="h-4 w-4" />
          </Button>
        </form>

        <ScrollArea className="h-[420px] pr-3">
          <div className="space-y-3">
            {results.map((item) => {
              const a = item.asset;
              return (
                <div key={a.id} className="border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.name}</p>
                      <p className="text-muted-foreground text-xs">
                        <Badge variant="outline" className="mr-1">
                          {a.assetType}
                        </Badge>
                        {String(a.sourceType)}
                      </p>
                    </div>
                    {renderAddButton("asset", a.id)}
                  </div>
                  {item.findings.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                      {item.findings.slice(0, 5).map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="flex items-center gap-2">
                            <SeverityBadge
                              severity={f.severity.toLowerCase() as never}
                            >
                              {f.severity}
                            </SeverityBadge>
                            <span className="text-muted-foreground">
                              {f.findingType}
                            </span>
                          </span>
                          {renderAddButton("finding", f.id)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!loading && results.length === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No assets found.
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
