"use client";

import * as React from "react";
import { Plus, X, ThumbsUp, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CaseEvidenceDto,
  type HypothesisResponseDto,
} from "@workspace/api-client";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Badge } from "@workspace/ui/components/badge";
import { Slider } from "@workspace/ui/components/slider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { EmptyState } from "@workspace/ui/components/empty-state";

const STATUSES = ["PROPOSED", "SUPPORTED", "REFUTED", "INCONCLUSIVE"] as const;
const STANCES = ["SUPPORTS", "CONTRADICTS", "NEUTRAL"] as const;

export interface HypothesisPanelProps {
  caseId: string;
  evidence: CaseEvidenceDto[];
}

/** Flat list of all linkable targets: evidence rows + their findings. */
interface LinkTarget {
  targetType: "evidence" | "finding";
  targetId: string;
  label: string;
  group: string; // display group (evidence label)
}

function buildLinkTargets(evidence: CaseEvidenceDto[]): LinkTarget[] {
  const targets: LinkTarget[] = [];
  for (const e of evidence) {
    const assetLabel = e.entity?.label ?? e.entityId;
    targets.push({
      targetType: "evidence",
      targetId: e.id,
      label: assetLabel,
      group: assetLabel,
    });
    for (const f of e.findings ?? []) {
      targets.push({
        targetType: "finding",
        targetId: f.id,
        label: f.findingLabel,
        group: assetLabel,
      });
    }
  }
  return targets;
}

export function HypothesisPanel({ caseId, evidence }: HypothesisPanelProps) {
  const [items, setItems] = React.useState<HypothesisResponseDto[]>([]);
  const [statement, setStatement] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await api.hypotheses.hypothesesControllerList({ caseId });
    setItems(res);
  }, [caseId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!statement.trim()) return;
    setCreating(true);
    try {
      await api.hypotheses.hypothesesControllerCreate({
        caseId,
        createHypothesisDto: { statement: statement.trim() },
      });
      setStatement("");
      await load();
    } catch (err) {
      console.error(err);
      toast.error("Failed to create hypothesis");
    } finally {
      setCreating(false);
    }
  };

  const linkTargets = buildLinkTargets(evidence);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Add a competing hypothesis, e.g. Data was accessed by a contractor"
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <Button onClick={create} disabled={!statement.trim() || creating}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No hypotheses yet"
          description="Frame competing theories and weigh evidence for and against each."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((h) => (
            <HypothesisCard
              key={h.id}
              hypothesis={h}
              linkTargets={linkTargets}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HypothesisCard({
  hypothesis,
  linkTargets,
  onChanged,
}: {
  hypothesis: HypothesisResponseDto;
  linkTargets: LinkTarget[];
  onChanged: () => void;
}) {
  const [confidence, setConfidence] = React.useState(
    hypothesis.confidence != null ? Math.round(hypothesis.confidence * 100) : 0,
  );
  const [linkTargetKey, setLinkTargetKey] = React.useState<string>("");
  const [linkStance, setLinkStance] = React.useState<string>("SUPPORTS");

  const linkedKeys = new Set(
    hypothesis.links.map((l) => `${l.targetType}:${l.targetId}`),
  );
  const available = linkTargets.filter(
    (t) => !linkedKeys.has(`${t.targetType}:${t.targetId}`),
  );

  const commitConfidence = async (value: number) => {
    try {
      await api.hypotheses.hypothesesControllerUpdate({
        id: hypothesis.id,
        updateHypothesisDto: { confidence: value / 100 },
      });
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to update confidence");
    }
  };

  const updateStatus = async (status: string) => {
    await api.hypotheses.hypothesesControllerUpdate({
      id: hypothesis.id,
      updateHypothesisDto: { status: status as never },
    });
    onChanged();
  };

  const link = async () => {
    if (!linkTargetKey) return;
    const [targetType, ...rest] = linkTargetKey.split(":");
    const targetId = rest.join(":");
    await api.hypotheses.hypothesesControllerLinkSupport({
      id: hypothesis.id,
      linkSupportDto: {
        targetType: targetType as "evidence" | "finding",
        targetId,
        stance: linkStance as never,
      },
    });
    setLinkTargetKey("");
    onChanged();
  };

  const unlink = async (linkId: string) => {
    await api.hypotheses.hypothesesControllerUnlinkSupport({
      id: hypothesis.id,
      linkId,
    });
    onChanged();
  };

  const remove = async () => {
    await api.hypotheses.hypothesesControllerRemove({ id: hypothesis.id });
    onChanged();
  };

  // Group available targets by evidence asset for the selector.
  const groups = React.useMemo(() => {
    const map = new Map<string, LinkTarget[]>();
    for (const t of available) {
      const existing = map.get(t.group);
      if (existing) existing.push(t);
      else map.set(t.group, [t]);
    }
    return map;
  }, [available]);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <p className="font-medium leading-snug">{hypothesis.statement}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={remove}
          aria-label="Delete hypothesis"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Select value={hypothesis.status} onValueChange={updateStatus}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="flex items-center gap-1 text-xs text-[#16a34a]">
            <ThumbsUp className="h-3.5 w-3.5" /> {hypothesis.supportingCount}
          </span>
          <span className="flex items-center gap-1 text-xs text-[#b91c1c]">
            <ThumbsDown className="h-3.5 w-3.5" /> {hypothesis.contradictingCount}
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground uppercase tracking-wide">
              Confidence
            </span>
            <span className="font-mono tabular-nums">{confidence}%</span>
          </div>
          <Slider
            value={[confidence]}
            min={0}
            max={100}
            step={5}
            onValueChange={(v) => setConfidence(v[0] ?? 0)}
            onValueCommit={(v) => commitConfidence(v[0] ?? 0)}
          />
        </div>

        {/* Linked evidence/findings */}
        <div className="space-y-1.5">
          {hypothesis.links.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    l.stance === "SUPPORTS"
                      ? "border-[#16a34a]/40 text-[#16a34a]"
                      : l.stance === "CONTRADICTS"
                        ? "border-[#b91c1c]/40 text-[#b91c1c]"
                        : ""
                  }
                >
                  {l.stance}
                </Badge>
                <span className="text-muted-foreground text-[10px] font-mono uppercase">
                  {l.targetType}
                </span>
                <span className="truncate">{l.targetLabel}</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => unlink(l.id)}
                aria-label="Unlink"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        {/* Link selector: evidence + findings grouped by asset */}
        {available.length > 0 && (
          <div className="flex items-center gap-2 border-t border-border/50 pt-2">
            <Select value={linkTargetKey} onValueChange={setLinkTargetKey}>
              <SelectTrigger className="h-8 flex-1">
                <SelectValue placeholder="Link evidence or finding…" />
              </SelectTrigger>
              <SelectContent>
                {Array.from(groups.entries()).map(([group, targets]) => (
                  <SelectGroup key={group}>
                    <SelectLabel className="text-[10px]">{group}</SelectLabel>
                    {targets.map((t) => (
                      <SelectItem key={`${t.targetType}:${t.targetId}`} value={`${t.targetType}:${t.targetId}`}>
                        <span className="text-muted-foreground mr-1 text-[10px] font-mono uppercase">
                          {t.targetType === "finding" ? "↳" : ""}
                        </span>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Select value={linkStance} onValueChange={setLinkStance}>
              <SelectTrigger className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STANCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={link} disabled={!linkTargetKey}>
              Link
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
