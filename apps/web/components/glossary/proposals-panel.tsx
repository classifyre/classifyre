"use client";

import * as React from "react";
import { toast } from "sonner";
import { Bot, Check, Inbox, Loader2, RefreshCw, X } from "lucide-react";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  decideProposal,
  listProposals,
  refreshSuggestions,
  semanticErrorMessage,
  type ProposalDecision,
  type ProposalItem,
  type ProposalKind,
} from "@/lib/semantic-api";
import { Snippet } from "./entity-sections";
import { MICRO_LABEL, TermLink } from "./glossary-ui";

const KINDS: ProposalKind[] = [
  "BINDING",
  "TERM",
  "ALIAS",
  "RELATION",
  "LINK",
  "TERM_REF",
  "ENTITY_MENTION",
  "ENTITY_MERGE",
];

/** What an entity proposal carries (G5 R15): the value and where it occurs. */
interface EntityProposalPayload {
  label?: string;
  value?: string;
  occurrences?: number;
  conflictWith?: { id: string; key: string; term: string } | null;
}
interface EntityProposalEvidence {
  samples?: Array<{
    assetId: string;
    assetName: string;
    sourceName: string;
    snippet: { before: string; matched: string; after: string } | null;
  }>;
}

const DISMISS_REASONS = ["wrong concept", "too broad", "noise", "other"];

/**
 * The review queue (SL4): every proposal — agent drafts, machine
 * suggestions, unknown term references, entity candidates and identifier
 * conflicts (G5) — in one list, highest score first.
 * Accepting is the operator's call; nothing here changes meaning until then.
 */
export function ProposalsPanel({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = React.useState<ProposalKind | null>(null);
  const [data, setData] = React.useState<Awaited<
    ReturnType<typeof listProposals>
  > | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    listProposals({ kind: kind ?? undefined, take: 100 })
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setData({ items: [], total: 0, counts: {}, embeddings: false });
      });
    return () => {
      active = false;
    };
  }, [kind, refreshKey]);

  async function decide(
    item: ProposalItem,
    decision: ProposalDecision,
    reason?: string,
    edit?: Record<string, unknown>,
  ) {
    setBusy(item.id);
    try {
      await decideProposal({ kind: item.kind, id: item.id, decision, reason, edit });
      toast.success(
        decision === "accept"
          ? t("glossary.proposals.accepted")
          : t("glossary.proposals.dismissed"),
      );
      setData((previous) =>
        previous
          ? {
              ...previous,
              items: previous.items.filter((row) => row.id !== item.id),
              total: previous.total - 1,
            }
          : previous,
      );
      onChanged();
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy("refresh");
    try {
      await refreshSuggestions();
      toast.success(t("glossary.proposals.refreshQueued"));
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setBusy(null);
    }
  }

  const counts = data?.counts ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setKind(null)}
          className={cn(
            "rounded-[4px] border-2 px-3 py-1 text-xs",
            kind === null ? "border-accent bg-accent/10" : "border-border hover:bg-muted",
          )}
        >
          {t("glossary.proposals.all")}
        </button>
        {KINDS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            className={cn(
              "rounded-[4px] border-2 px-3 py-1 text-xs",
              kind === value ? "border-accent bg-accent/10" : "border-border hover:bg-muted",
            )}
          >
            {t(`glossary.proposals.kinds.${value}` as TranslationKey)}
            {counts[value] ? (
              <span className="ml-1.5 font-mono text-muted-foreground">
                {counts[value]}
              </span>
            ) : null}
          </button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={busy === "refresh"}
          onClick={refresh}
          className="ml-auto h-8 rounded-[4px] border-2 border-border text-xs"
        >
          {busy === "refresh" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("glossary.proposals.refresh")}
        </Button>
      </div>

      {data && !data.embeddings && (
        <p className="rounded-[4px] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("glossary.proposals.needsEmbeddings")}
        </p>
      )}

      {data === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t("glossary.proposals.empty")}
          description={t("glossary.proposals.emptyHint")}
        />
      ) : (
        <ul className="space-y-2">
          {data.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-[4px] border-2 border-border px-4 py-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="rounded-[4px] font-mono text-[10px] uppercase"
                  >
                    {t(`glossary.proposals.kinds.${item.kind}` as TranslationKey)}
                  </Badge>
                  <span className="text-sm font-semibold">{item.title}</span>
                  {item.score !== null && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {t("glossary.proposals.score", {
                        score: Math.round(item.score * 100).toString(),
                      })}
                    </span>
                  )}
                  {item.origin === "AGENT" && (
                    <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-label={t("glossary.proposedByAgent")} />
                  )}
                </div>
                {item.term && (
                  <div className="text-xs">
                    <span className={MICRO_LABEL}>{t("glossary.proposals.term")}</span>{" "}
                    <TermLink termKey={item.term.key}>{item.term.term}</TermLink>
                  </div>
                )}
                {item.asset && (
                  <div className="truncate text-xs text-muted-foreground">
                    {item.asset.name}
                  </div>
                )}
                {item.rationale && (
                  <p className="text-xs text-muted-foreground">{item.rationale}</p>
                )}
                {item.source === "entity" &&
                  ((item.evidence as EntityProposalEvidence | null)?.samples ?? []).length > 0 && (
                    <ul className="space-y-1 border-l-2 border-border pl-3">
                      {(item.evidence as EntityProposalEvidence).samples!.map((sample) => (
                        <li key={sample.assetId} className="text-xs">
                          <span className="font-medium">{sample.assetName}</span>
                          <span className="text-muted-foreground"> · {sample.sourceName}</span>
                          {sample.snippet && (
                            <span className="block">
                              <Snippet snippet={sample.snippet} />
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                {item.agentNote && (
                  <p className="text-xs italic text-muted-foreground">
                    {t("glossary.proposals.agentNote", { note: item.agentNote })}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => decide(item, "accept")}
                  className="h-8 rounded-[4px] text-xs"
                >
                  {busy === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {item.kind === "ENTITY_MERGE"
                    ? t("entities.conflict.both")
                    : t("glossary.proposals.accept")}
                </Button>
                {item.kind === "ENTITY_MERGE" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        className="h-8 rounded-[4px] border-2 border-border text-xs"
                      >
                        {t("entities.conflict.settle")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => decide(item, "accept", undefined, { resolution: "move" })}
                      >
                        {t("entities.conflict.move", { name: item.term?.term ?? "" })}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => decide(item, "accept", undefined, { resolution: "merge" })}
                      >
                        {t("entities.conflict.merge", {
                          from: item.term?.term ?? "",
                          into:
                            (item.payload as EntityProposalPayload | null)?.conflictWith?.term ?? "",
                        })}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      className="h-8 rounded-[4px] border-2 border-border text-xs"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t("glossary.proposals.dismiss")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {item.source === "entity" ? (
                      // A rejected value is remembered: it is never proposed
                      // for this entity again.
                      <DropdownMenuItem onClick={() => decide(item, "dismiss")}>
                        {item.kind === "ENTITY_MERGE"
                          ? t("entities.conflict.keep", {
                              name:
                                (item.payload as EntityProposalPayload | null)?.conflictWith
                                  ?.term ?? "",
                            })
                          : t("entities.candidates.rejectForever")}
                      </DropdownMenuItem>
                    ) : (
                      <>
                        {DISMISS_REASONS.map((reason) => (
                          <DropdownMenuItem
                            key={reason}
                            onClick={() => decide(item, "dismiss", reason)}
                          >
                            {t(
                              `glossary.proposals.reasons.${reason.replace(" ", "_")}` as TranslationKey,
                            )}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem onClick={() => decide(item, "dismiss_forever")}>
                          {t("glossary.proposals.dismissForever")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
