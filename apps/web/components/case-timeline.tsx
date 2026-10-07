"use client";

import * as React from "react";
import {
  Activity,
  Bot,
  Camera,
  CheckCircle2,
  ChevronDown,
  Compass,
  Crosshair,
  Download,
  Eraser,
  FileText,
  Filter,
  Fingerprint,
  FolderOpen,
  Frame,
  GitBranch,
  GitCommit,
  Globe,
  Highlighter,
  LayoutGrid,
  Link,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Search,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  Trash2,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import { api, type CaseActivityDto, type InquiryActivityDto } from "@workspace/api-client";
import { EscalationFlag } from "@workspace/case-board/components/finding-node";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { AiActorBadge, isAiActor } from "@/components/ai-actor-badge";
import { ESCALATION_INK } from "@/lib/escalation-tone";

// ─── Event metadata ───────────────────────────────────────────────────────────

type EventGroup = "case" | "inquiry" | "evidence" | "escalation" | "thread" | "board" | "ai";

/** Synthetic activityType for autopilot runs blended into the timeline. */
const AUTOPILOT_RUN = "AUTOPILOT_RUN";

/**
 * A linked watch's own history, blended in: what a scan changed about the
 * watch's answers. It is what explains "N new" and "N gone" on the Watches
 * panel, so those link here. Ids are `watch:<inquiry activity id>`.
 */
const WATCH_LANDED = "WATCH_MATCHES_LANDED";
const WATCH_RETIRED = "WATCH_MATCHES_RETIRED";
export const WATCH_ENTRY_PREFIX = "watch:";

/** The timeline id of a watch history entry. */
export function watchEntryId(activityId: string): string {
  return `${WATCH_ENTRY_PREFIX}${activityId}`;
}

/** Watch history entries blended per watch: its newest scan deltas. */
const WATCH_ENTRIES_PER_WATCH = 50;

const TYPE_META: Record<
  string,
  { icon: React.ReactNode; label: string; color: string; group: EventGroup }
> = {
  CASE_CREATED: { icon: <FolderOpen className="h-3.5 w-3.5" />, label: "Case opened", color: "text-green-600 dark:text-green-400", group: "case" },
  CASE_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Case updated", color: "text-muted-foreground", group: "case" },
  CONCLUSION_UPDATED: { icon: <FileText className="h-3.5 w-3.5" />, label: "Conclusion updated", color: "text-amber-600 dark:text-amber-400", group: "case" },
  INQUIRY_LINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Inquiry linked", color: "text-blue-600 dark:text-blue-400", group: "inquiry" },
  INQUIRY_UNLINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Inquiry unlinked", color: "text-muted-foreground", group: "inquiry" },
  INQUIRY_PULLED: { icon: <Download className="h-3.5 w-3.5" />, label: "Evidence pulled from inquiry", color: "text-blue-600 dark:text-blue-400", group: "inquiry" },
  EVIDENCE_ADDED: { icon: <Search className="h-3.5 w-3.5" />, label: "Evidence added", color: "text-green-600 dark:text-green-400", group: "evidence" },
  EVIDENCE_REMOVED: { icon: <Trash2 className="h-3.5 w-3.5" />, label: "Evidence removed", color: "text-red-600 dark:text-red-400", group: "evidence" },
  EVIDENCE_NOTE_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Evidence note updated", color: "text-muted-foreground", group: "evidence" },
  FINDING_ADDED: { icon: <Fingerprint className="h-3.5 w-3.5" />, label: "Finding attached", color: "text-green-600 dark:text-green-400", group: "evidence" },
  FINDING_REMOVED: { icon: <Trash2 className="h-3.5 w-3.5" />, label: "Finding removed", color: "text-red-600 dark:text-red-400", group: "evidence" },
  FINDING_NOTE_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Finding note updated", color: "text-muted-foreground", group: "evidence" },
  THREAD_CREATED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Thread started", color: "text-violet-600 dark:text-violet-400", group: "thread" },
  THREAD_ENTRY_ADDED: { icon: <MessageSquare className="h-3.5 w-3.5" />, label: "Note added", color: "text-violet-600 dark:text-violet-400", group: "thread" },
  THREAD_STATEMENT_UPDATED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Statement revised", color: "text-violet-600 dark:text-violet-400", group: "thread" },
  THREAD_STATUS_CHANGED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Hypothesis status changed", color: "text-amber-600 dark:text-amber-400", group: "thread" },
  THREAD_CONFIDENCE_CHANGED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Confidence updated", color: "text-amber-600 dark:text-amber-400", group: "thread" },
  SUPPORT_LINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Evidence linked to thread", color: "text-blue-600 dark:text-blue-400", group: "thread" },
  SUPPORT_UNLINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Evidence unlinked from thread", color: "text-muted-foreground", group: "thread" },
  SUPPORT_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Support updated", color: "text-muted-foreground", group: "thread" },
  // Case board (every payload carries the board itemId → "Show on board").
  BOARD_NOTE_ADDED: { icon: <StickyNote className="h-3.5 w-3.5" />, label: "Note added to the board", color: "text-amber-600 dark:text-amber-400", group: "board" },
  BOARD_NOTE_UPDATED: { icon: <StickyNote className="h-3.5 w-3.5" />, label: "Note edited", color: "text-muted-foreground", group: "board" },
  BOARD_NOTE_REMOVED: { icon: <Trash2 className="h-3.5 w-3.5" />, label: "Note removed", color: "text-muted-foreground", group: "board" },
  BOARD_FRAME_ADDED: { icon: <Frame className="h-3.5 w-3.5" />, label: "Frame added", color: "text-muted-foreground", group: "board" },
  BOARD_FRAME_UPDATED: { icon: <Frame className="h-3.5 w-3.5" />, label: "Frame renamed", color: "text-muted-foreground", group: "board" },
  BOARD_FRAME_REMOVED: { icon: <Trash2 className="h-3.5 w-3.5" />, label: "Frame removed", color: "text-muted-foreground", group: "board" },
  BOARD_LINK_ADDED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Link drawn", color: "text-blue-600 dark:text-blue-400", group: "board" },
  BOARD_LINK_UPDATED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Link edited", color: "text-muted-foreground", group: "board" },
  BOARD_LINK_REMOVED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Link removed", color: "text-muted-foreground", group: "board" },
  BOARD_LINK_PROMOTED: { icon: <Globe className="h-3.5 w-3.5" />, label: "Link made a global relationship", color: "text-blue-600 dark:text-blue-400", group: "board" },
  BOARD_ITEM_HIGHLIGHTED: { icon: <Highlighter className="h-3.5 w-3.5" />, label: "Highlighted on the board", color: "text-amber-600 dark:text-amber-400", group: "board" },
  BOARD_ARRANGED: { icon: <LayoutGrid className="h-3.5 w-3.5" />, label: "Board rearranged", color: "text-muted-foreground", group: "board" },
  BOARD_SNAPSHOT_TAKEN: { icon: <Camera className="h-3.5 w-3.5" />, label: "Board snapshot taken", color: "text-muted-foreground", group: "board" },
  COMMENT_RESOLVED: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Comment resolved", color: "text-green-600 dark:text-green-400", group: "board" },
  // Automatic clean-up and finding filters.
  INQUIRY_SETTINGS_UPDATED: { icon: <SlidersHorizontal className="h-3.5 w-3.5" />, label: "Watch settings changed", color: "text-blue-600 dark:text-blue-400", group: "inquiry" },
  CLEANUP_SETTINGS_UPDATED: { icon: <SlidersHorizontal className="h-3.5 w-3.5" />, label: "Clean-up settings changed", color: "text-amber-600 dark:text-amber-400", group: "case" },
  FINDING_FILTER_ADDED: { icon: <Filter className="h-3.5 w-3.5" />, label: "Finding filter added", color: "text-blue-600 dark:text-blue-400", group: "case" },
  FINDING_FILTER_UPDATED: { icon: <Filter className="h-3.5 w-3.5" />, label: "Finding filter changed", color: "text-muted-foreground", group: "case" },
  FINDING_FILTER_REMOVED: { icon: <Filter className="h-3.5 w-3.5" />, label: "Finding filter removed", color: "text-muted-foreground", group: "case" },
  HYPOTHESIS_RULE_ADDED: { icon: <GitBranch className="h-3.5 w-3.5" />, label: "Hypothesis rule added", color: "text-blue-600 dark:text-blue-400", group: "case" },
  HYPOTHESIS_RULE_UPDATED: { icon: <GitBranch className="h-3.5 w-3.5" />, label: "Hypothesis rule changed", color: "text-muted-foreground", group: "case" },
  HYPOTHESIS_RULE_REMOVED: { icon: <GitBranch className="h-3.5 w-3.5" />, label: "Hypothesis rule removed", color: "text-muted-foreground", group: "case" },
  FINDINGS_AUTO_LINKED: { icon: <GitBranch className="h-3.5 w-3.5" />, label: "Linked to a hypothesis", color: "text-blue-600 dark:text-blue-400", group: "evidence" },
  THREAD_EVIDENCE_REMOVED: { icon: <Eraser className="h-3.5 w-3.5" />, label: "Hypothesis deleted with its evidence", color: "text-red-600 dark:text-red-400", group: "evidence" },
  FINDINGS_ESCALATED: { icon: <TriangleAlert className="h-3.5 w-3.5" />, label: "Escalated", color: ESCALATION_INK, group: "escalation" },
  ESCALATION_CLEARED: { icon: <TriangleAlert className="h-3.5 w-3.5" />, label: "Escalation cleared", color: "text-muted-foreground", group: "escalation" },
  FINDINGS_AUTO_REMOVED: { icon: <Eraser className="h-3.5 w-3.5" />, label: "Findings taken out", color: "text-red-600 dark:text-red-400", group: "evidence" },
  // Leads: suggestions for the case, and what became of them.
  LEAD_PROPOSED: { icon: <Compass className="h-3.5 w-3.5" />, label: "Lead suggested", color: "text-muted-foreground", group: "evidence" },
  LEAD_ACCEPTED: { icon: <Compass className="h-3.5 w-3.5" />, label: "Lead accepted", color: "text-green-600 dark:text-green-400", group: "evidence" },
  LEAD_DISMISSED: { icon: <Compass className="h-3.5 w-3.5" />, label: "Lead dismissed", color: "text-muted-foreground", group: "evidence" },
  LEADS_GENERATED: { icon: <Compass className="h-3.5 w-3.5" />, label: "New leads", color: "text-blue-600 dark:text-blue-400", group: "evidence" },
  EVIDENCE_AUTO_REMOVED: { icon: <Eraser className="h-3.5 w-3.5" />, label: "Evidence taken out", color: "text-red-600 dark:text-red-400", group: "evidence" },
  [AUTOPILOT_RUN]: { icon: <Bot className="h-3.5 w-3.5" />, label: "AI autopilot run", color: "text-amber-600 dark:text-amber-400", group: "ai" },
  [WATCH_LANDED]: { icon: <Sparkles className="h-3.5 w-3.5" />, label: "New answers from a watch", color: "text-blue-600 dark:text-blue-400", group: "inquiry" },
  [WATCH_RETIRED]: { icon: <Unlink className="h-3.5 w-3.5" />, label: "Watch answers no longer found", color: "text-red-600 dark:text-red-400", group: "inquiry" },
};

// ─── Clean-up and filters ─────────────────────────────────────────────────────

/** Actors that are the platform itself, named as what they are. */
const SYSTEM_ACTORS: Record<string, string> = {
  "case-cleanup": "automatic clean-up",
  "inquiry-auto-pull": "a watch's auto-add",
  "case-leads": "the case's own lead refresh",
  mcp: "an MCP client",
};

/** Lead origins, as the Leads panel names them. */
const LEAD_ORIGINS: Record<string, [string, string]> = {
  DUPLICATE: ["look-alike document", "look-alike documents"],
  INQUIRY: ["watch answer", "watch answers"],
  SEMANTIC_NEIGHBOR: ["similar finding", "similar findings"],
  ENTITY: ["entity mention", "entity mentions"],
  AUTOPILOT: ["Autopilot proposal", "Autopilot proposals"],
  MANUAL: ["bookmark", "bookmarks"],
};

const RULE_LABELS: Record<string, string> = {
  removeGoneFindings: "Remove findings that disappear",
  removeResolvedFindings: "Remove resolved findings",
  removeGoneAssets: "Remove assets that disappear",
};

/** A removal's heading says which rule (or filter) took things out. */
const STANCE_WORDS: Record<string, string> = {
  SUPPORTS: "supports",
  CONTRADICTS: "contradicts",
  NEUTRAL: "neutral",
};

const REMOVAL_LABELS: Record<string, string> = {
  FINDING_GONE: "Taken out: no longer detected",
  FINDING_RESOLVED: "Taken out: resolved",
  FILTER: "Detached by a filter",
  ASSET_GONE: "Taken out: asset gone from its source",
  FILTER_EMPTIED: "Taken out: no findings left after a filter",
  EMPTIED: "Taken out: no findings left",
};

/** Filter and escalation rules share their entries; the action names them. */
function ruleAction(item: CaseActivityDto): "EXCLUDE" | "ESCALATE" | null {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  if (!String(item.activityType).startsWith("FINDING_FILTER_")) return null;
  const filter = (p.filter ?? (Array.isArray(p.filters) ? p.filters[0] : null)) as { action?: string } | null;
  const action = (p.action as string | undefined) ?? filter?.action;
  return action === "ESCALATE" ? "ESCALATE" : "EXCLUDE";
}

/** The group an entry files under; an escalation rule's changes go with escalations. */
function eventGroup(item: CaseActivityDto): EventGroup {
  if (ruleAction(item) === "ESCALATE") return "escalation";
  return TYPE_META[item.activityType]?.group ?? "case";
}

function eventLabel(item: CaseActivityDto, fallback: string): string {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  if (ruleAction(item) === "ESCALATE") {
    if (item.activityType === "FINDING_FILTER_ADDED") return "Escalation rule added";
    if (item.activityType === "FINDING_FILTER_UPDATED") return "Escalation rule changed";
    if (item.activityType === "FINDING_FILTER_REMOVED") return "Escalation rule removed";
  }
  if (item.activityType === "FINDINGS_ESCALATED" && p.added === true) return "Escalated and brought in";
  if (item.activityType === "FINDINGS_AUTO_REMOVED" || item.activityType === "EVIDENCE_AUTO_REMOVED") {
    return REMOVAL_LABELS[String(p.reason)] ?? fallback;
  }
  if (item.activityType === "INQUIRY_PULLED") {
    return p.automatic === true ? "Auto-added by a watch" : "Pulled from a watch";
  }
  if (isLegacyAutoPullToggle(item)) return "Watch settings changed";
  if (item.activityType === "CASE_UPDATED") {
    if (Array.isArray(p.fields)) return "Case details edited";
    if (str(p.aiMode)) return "Autopilot mode changed";
    if (p.reopened === true) return "Case reopened";
    if (str(p.status)) return "Status changed";
  }
  if (item.activityType === "CONCLUSION_UPDATED" && p.draft === true) return "Conclusion draft edited";
  return fallback;
}

/** The names of the case fields an edit entry lists. */
const FIELD_LABELS: Record<string, string> = {
  title: "title",
  description: "description",
  severity: "severity",
  assignee: "assignee",
};

/** Auto-add toggles were written as CASE_UPDATED before they had their own type. */
function isLegacyAutoPullToggle(item: CaseActivityDto): boolean {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  return item.activityType === "CASE_UPDATED" && typeof p.autoPull === "boolean";
}

const SETTING_LABELS: Record<string, string> = {
  autoPull: "Auto-add new answers",
};

/** "3 passes between 14:02 and 15:40" for an entry that absorbed several. */
function rangeText(p: Record<string, unknown>): string {
  const first = str(p.firstAt);
  const last = str(p.lastAt);
  if (!first || !last || first === last) return "";
  const a = timeLabel(new Date(first));
  const b = timeLabel(new Date(last));
  return a === b ? "" : ` between ${a} and ${b}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Source names a pass or merged passes name (older rows carry `sourceName`). */
function sourceNamesOf(p: Record<string, unknown>): string[] {
  const names = strList(p.sourceNames);
  return names.length > 0 ? names : str(p.sourceName) ? [String(p.sourceName)] : [];
}

/** Why findings escalated when they did, as the second line of the row. */
function escalationTrigger(p: Record<string, unknown>): string | null {
  switch (p.trigger) {
    case "RULE_ADDED":
      return "already in the case when the escalation rule was added";
    case "RULE_UPDATED":
      return "already in the case when the escalation rule was changed";
    case "ATTACHED":
      return "as they were attached to the case";
    case "ARRIVAL": {
      const names = sourceNamesOf(p);
      const passes = Number(p.passes ?? 1);
      const watch = str(p.inquiryTitle) ? `“${String(p.inquiryTitle)}”` : "a watch";
      const how = p.added === true ? `${watch} brought them in (auto-add is off)` : `they came in through ${watch}`;
      const when =
        passes > 1
          ? ` over ${plural(passes, "scan")}${names.length > 0 ? ` of ${names.join(", ")}` : ""}${rangeText(p)}`
          : names.length > 0
            ? ` after a scan of ${names[0]}`
            : "";
      return `${how}${when}`;
    }
    default:
      return null;
  }
}

/** When and why a clean-up pass ran, as the second line of its row. */
function triggerText(p: Record<string, unknown>): string | null {
  const passes = Number(p.passes ?? 1);
  const triggers = (p.triggers ?? null) as Record<string, number> | null;
  if (passes > 1 && triggers) {
    const names = sourceNamesOf(p);
    const parts: string[] = [];
    if (triggers.SCAN) parts.push(`${plural(triggers.SCAN, "scan")}${names.length > 0 ? ` of ${names.join(", ")}` : ""}`);
    if (triggers.STATUS_CHANGE) parts.push(plural(triggers.STATUS_CHANGE, "status change"));
    if (triggers.CHECK) parts.push(plural(triggers.CHECK, "routine check"));
    return `after ${parts.join(", ")}${rangeText(p)}`;
  }
  switch (p.trigger) {
    case "RULE_ENABLED": {
      const rule = p.reason === "FINDING_RESOLVED" ? "removeResolvedFindings" : p.reason === "ASSET_GONE" ? "removeGoneAssets" : "removeGoneFindings";
      return `when “${RULE_LABELS[rule]}” was switched on`;
    }
    case "SCAN": {
      const names = sourceNamesOf(p);
      return names.length > 0 ? `after a scan of ${names[0]}` : "after a scan";
    }
    case "STATUS_CHANGE":
      return "after someone changed a finding's status";
    case "CHECK":
      return "on a routine check of the case";
    case "FILTER_ADDED":
      return "when the filter was added";
    case "FILTER_UPDATED":
      return "when the filter was changed";
    default:
      return null;
  }
}

interface FilterPayload {
  id?: string;
  kind?: string;
  action?: string;
  pattern?: string;
  description?: string | null;
  inquiryTitle?: string | null;
}

function FilterChip({ filter }: { filter: FilterPayload }) {
  const escalation = filter.action === "ESCALATE";
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px]">
      <span className={`font-mono uppercase ${escalation ? ESCALATION_INK : "text-muted-foreground"}`}>
        {escalation ? "▲ " : ""}
        {filter.kind === "VALUE_PATTERN" ? "value" : "type"}
      </span>
      <span className="min-w-0 truncate font-mono text-foreground">{filter.pattern}</span>
      <span className="shrink-0 text-muted-foreground">
        · {filter.inquiryTitle ? `for “${filter.inquiryTitle}”` : "every watch"}
      </span>
      {filter.description && <span className="min-w-0 truncate text-muted-foreground">· {filter.description}</span>}
    </span>
  );
}

interface RemovedFinding {
  findingId?: string;
  label?: string;
  value?: string | null;
  assetLabel?: string | null;
  itemId?: string;
  state?: string;
}

interface RemovedAsset {
  label?: string;
  findings?: number;
  state?: string;
}

const LIST_PREVIEW = 5;

/** What a clean-up pass took out, one row each, the first few shown. */
function RemovedList({
  findings,
  assets,
  total,
  truncated,
  onShowOnBoard,
  marker,
  emptied = false,
}: {
  findings: RemovedFinding[];
  assets: RemovedAsset[];
  total: number;
  truncated: boolean;
  onShowOnBoard?: (itemId: string) => void;
  /** Drawn before each finding (the escalation flag). */
  marker?: React.ReactNode;
  /** Assets a filter emptied: their findings were filtered out, not taken along. */
  emptied?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const rows = findings.length > 0 ? findings : assets;
  const shown = open ? rows : rows.slice(0, LIST_PREVIEW);
  // A row names at most so many; the count says the rest.
  const notListed = truncated ? Math.max(0, total - rows.length) : 0;
  return (
    <div className="space-y-0.5">
      <ul className="space-y-0.5">
        {findings.length > 0
          ? (shown as RemovedFinding[]).map((f, index) => (
              <li key={f.findingId ?? index} className="flex min-w-0 items-center gap-1.5">
                {marker}
                <span className="min-w-0 truncate font-mono text-[11px]">
                  <span className="text-foreground">{f.label}</span>
                  {f.value ? `: ${f.value}` : ""}
                  {f.assetLabel ? <span className="text-muted-foreground/80"> · {f.assetLabel}</span> : null}
                </span>
                {f.state && (
                  <span className="shrink-0 rounded border border-border px-1 font-mono text-[9px] uppercase tracking-wide">
                    {f.state === "DELETED" ? "deleted" : "no longer detected"}
                  </span>
                )}
                {onShowOnBoard && f.itemId && (
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Show its asset on the board"
                    onClick={() => onShowOnBoard(f.itemId!)}
                  >
                    <Crosshair className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))
          : (shown as RemovedAsset[]).map((a, index) => (
              <li key={index} className="min-w-0 truncate font-mono text-[11px]">
                <span className="text-foreground">{a.label}</span>
                {a.findings
                  ? emptied
                    ? ` · its ${a.findings === 1 ? "finding was" : `${a.findings} findings were`} filtered out`
                    : ` · ${a.findings} finding${a.findings === 1 ? "" : "s"} went with it`
                  : ""}
                {a.state === "DELETED" ? " · deleted" : ""}
              </li>
            ))}
      </ul>
      {rows.length > LIST_PREVIEW && (
        <button type="button" className="text-[11px] underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
      {notListed > 0 && (open || rows.length <= LIST_PREVIEW) && (
        <span className="block text-[11px]">+{notListed} more, not listed</span>
      )}
    </div>
  );
}

const GROUP_FILTERS: Array<{ key: "ALL" | EventGroup; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "case", label: "Case" },
  { key: "inquiry", label: "Inquiries" },
  { key: "evidence", label: "Evidence" },
  { key: "escalation", label: "Escalations" },
  { key: "thread", label: "Threads" },
  { key: "board", label: "Board" },
  { key: "ai", label: "AI" },
];

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Subject of the event — the entity it happened to, shown emphasized. */
function eventSubject(item: CaseActivityDto): string | null {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  // Synthetic AI-run events are not part of the generated activity enum.
  if ((item.activityType as string) === AUTOPILOT_RUN) return str(p.instruction);
  if (isWatchEntry(item)) return str(p.inquiryTitle);
  switch (item.activityType) {
    case "INQUIRY_LINKED":
    case "INQUIRY_UNLINKED":
    case "INQUIRY_PULLED":
    case "INQUIRY_SETTINGS_UPDATED":
      return str(p.inquiryTitle);
    case "CASE_UPDATED":
      return isLegacyAutoPullToggle(item) ? str(p.inquiryTitle) : Array.isArray(p.fields) ? str(p.title) : null;
    case "THREAD_CREATED":
    case "THREAD_ENTRY_ADDED":
    case "THREAD_STATEMENT_UPDATED":
    case "THREAD_STATUS_CHANGED":
    case "THREAD_CONFIDENCE_CHANGED":
    case "SUPPORT_LINKED":
    case "SUPPORT_UNLINKED":
    case "SUPPORT_UPDATED":
    case "HYPOTHESIS_RULE_ADDED":
    case "HYPOTHESIS_RULE_UPDATED":
    case "HYPOTHESIS_RULE_REMOVED":
    case "THREAD_EVIDENCE_REMOVED":
      return str(p.threadTitle);
    case "FINDINGS_AUTO_LINKED":
      return str(p.inquiryTitle);
    case "EVIDENCE_ADDED":
    case "EVIDENCE_REMOVED":
    case "EVIDENCE_NOTE_UPDATED":
    case "FINDING_ADDED":
    case "FINDING_REMOVED":
    case "FINDING_NOTE_UPDATED":
      return str(p.label);
    case "CASE_CREATED":
      return str(p.title);
    case "LEAD_PROPOSED":
    case "LEAD_ACCEPTED":
    case "LEAD_DISMISSED":
      return str(p.label);
    case "LEADS_GENERATED":
      return plural(Number(p.proposed ?? 0), "lead");
    case "BOARD_NOTE_ADDED":
    case "BOARD_NOTE_REMOVED":
    case "BOARD_FRAME_ADDED":
    case "BOARD_FRAME_REMOVED":
      return str(p.excerpt);
    case "BOARD_LINK_ADDED":
    case "BOARD_LINK_REMOVED":
    case "BOARD_LINK_PROMOTED":
      return str(p.label) ?? str(p.kind)?.replace(/_/g, " ") ?? str(p.relationType);
    case "COMMENT_RESOLVED":
      return str(p.threadTitle);
    case "FINDINGS_AUTO_REMOVED": {
      const n = Number(p.count ?? 0);
      return `${n} finding${n === 1 ? "" : "s"}`;
    }
    case "EVIDENCE_AUTO_REMOVED": {
      const n = Number(p.count ?? 0);
      const assets = Array.isArray(p.assets) ? (p.assets as RemovedAsset[]) : [];
      return n === 1 && assets[0]?.label ? String(assets[0].label) : `${n} assets`;
    }
    // The filter chips below carry the pattern; a long regex twice is noise.
    case "FINDING_FILTER_ADDED":
    case "FINDING_FILTER_UPDATED":
    case "FINDING_FILTER_REMOVED":
      return p.scope === "WATCH" ? str(p.inquiryTitle) : "every watch";
    default:
      return null;
  }
}

/** Rich detail block under the event title. Old events may lack the newer payload fields. */
function EventDetail({
  item,
  onShowOnBoard,
}: {
  item: CaseActivityDto;
  onShowOnBoard?: (itemId: string) => void;
}) {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  const lines: React.ReactNode[] = [];

  if ((item.activityType as string) === AUTOPILOT_RUN) {
    const status = str(p.status) ?? "?";
    return (
      <div className="text-muted-foreground mt-0.5 space-y-1 text-xs">
        <span>
          <span className="font-medium text-foreground">{status.toLowerCase()}</span>
          {str(p.summary) ? ` — ${String(p.summary)}` : ""}
          {status === "FAILED" && str(p.error) ? ` — ${String(p.error)}` : ""}
        </span>
      </div>
    );
  }

  if (isWatchEntry(item)) {
    const count = Number(p.count ?? 0);
    const source = str(p.sourceName);
    const landed = (item.activityType as string) === WATCH_LANDED;
    const labels = strList(p.sampleLabels);
    return (
      <div className="text-muted-foreground mt-0.5 space-y-1 text-xs">
        <span className="block">
          {landed
            ? `${plural(count, "new answer")} after a scan${source ? ` of ${source}` : ""}`
            : `the latest scan${source ? ` of ${source}` : ""} no longer finds ${plural(count, "answer")}; what the case cites of them stays, marked gone`}
        </span>
        {labels.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {[...new Set(labels)].slice(0, 6).map((label) => (
              <span key={label} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">
                {label}
              </span>
            ))}
          </span>
        )}
      </div>
    );
  }

  switch (item.activityType) {
    case "INQUIRY_PULLED": {
      const filtered = Number(p.filtered ?? 0);
      const pulled = Number(p.pulled ?? 0);
      const available = Number(p.available ?? 0);
      if (p.automatic === true) {
        const passes = Number(p.passes ?? 1);
        const names = sourceNamesOf(p);
        lines.push(
          <span key="when" className="block">
            {passes > 1
              ? `over ${plural(passes, "scan")}${names.length > 0 ? ` of ${names.join(", ")}` : ""}${rangeText(p)}`
              : names.length > 0
                ? `after a scan of ${names[0]}`
                : "after a scan"}
          </span>,
        );
      }
      lines.push(
        <span key="count" className="block">
          {plural(pulled, "finding")} added to the case
          {filtered > 0 && (
            <>
              {" · "}
              <span className="font-medium text-foreground">{filtered} kept out by filters</span>
              {strList(p.filteredLabels).length > 0 ? ` (${strList(p.filteredLabels).slice(0, 4).join(", ")})` : ""}
            </>
          )}
          {available > pulled && ` · ${available - pulled} more new answers wait for someone to add them`}
        </span>,
      );
      const listed = Array.isArray(p.findings) ? (p.findings as RemovedFinding[]) : [];
      if (listed.length > 0) {
        lines.push(
          <RemovedList
            key="list"
            findings={listed}
            assets={[]}
            total={pulled}
            truncated={p.truncated === true}
            onShowOnBoard={onShowOnBoard}
          />,
        );
      }
      break;
    }
    case "INQUIRY_LINKED":
      if (p.autoPull === true) lines.push(<span key="auto">auto-add new answers: on</span>);
      break;
    case "LEADS_GENERATED": {
      const byOrigin = (p.byOrigin ?? {}) as Record<string, number>;
      const kinds = Object.entries(byOrigin)
        .filter(([, n]) => n > 0)
        .map(([origin, n]) => {
          const [one, many] = LEAD_ORIGINS[origin] ?? [origin.toLowerCase(), origin.toLowerCase()];
          return `${n} ${n === 1 ? one : many}`;
        });
      if (kinds.length > 0) lines.push(<span key="kinds" className="block">{kinds.join(" · ")}</span>);
      const passes = Number(p.passes ?? 1);
      if (passes > 1) {
        lines.push(
          <span key="when" className="block">
            over {passes} refreshes
            {rangeText(p)}
          </span>,
        );
      }
      const sample = strList(p.sample);
      if (sample.length > 0) {
        lines.push(
          <span key="sample" className="flex flex-wrap gap-1">
            {sample.slice(0, 6).map((label, index) => (
              <span key={`${label}-${index}`} className="max-w-full truncate rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">
                {label}
              </span>
            ))}
          </span>,
        );
      }
      break;
    }
    case "LEAD_PROPOSED":
    case "LEAD_ACCEPTED": {
      const kind = LEAD_ORIGINS[String(p.origin)];
      if (kind) lines.push(<span key="origin" className="block">{kind[0]}</span>);
      break;
    }
    case "LEAD_DISMISSED":
      if (str(p.reason)) lines.push(<span key="reason" className="block">why: “{String(p.reason)}”</span>);
      break;
    case "FINDINGS_ESCALATED": {
      const when = escalationTrigger(p);
      if (when) lines.push(<span key="when" className="block">{when}</span>);
      if (Array.isArray(p.rules) && p.rules.length > 0) {
        lines.push(
          <span key="rules" className="flex flex-wrap gap-1">
            {(p.rules as FilterPayload[]).map((f, index) => (
              <FilterChip key={f.id ?? index} filter={{ action: "ESCALATE", ...f }} />
            ))}
          </span>,
        );
      }
      const listed = Array.isArray(p.findings) ? (p.findings as RemovedFinding[]) : [];
      if (listed.length > 0) {
        lines.push(
          <RemovedList
            key="list"
            findings={listed}
            assets={[]}
            total={Number(p.count ?? listed.length)}
            truncated={p.truncated === true}
            onShowOnBoard={onShowOnBoard}
            marker={<EscalationFlag size={11} className="shrink-0" />}
          />,
        );
      }
      break;
    }
    case "ESCALATION_CLEARED": {
      const listed = Array.isArray(p.findings) ? (p.findings as RemovedFinding[]) : [];
      lines.push(
        <span key="count" className="block">
          {plural(Number(p.count ?? listed.length), "finding")} no longer escalated; they stay in the case
        </span>,
      );
      if (listed.length > 0) {
        lines.push(
          <RemovedList
            key="list"
            findings={listed}
            assets={[]}
            total={Number(p.count ?? listed.length)}
            truncated={p.truncated === true}
            onShowOnBoard={onShowOnBoard}
          />,
        );
      }
      break;
    }
    case "HYPOTHESIS_RULE_ADDED":
    case "HYPOTHESIS_RULE_UPDATED":
    case "HYPOTHESIS_RULE_REMOVED": {
      lines.push(
        <span key="rule" className="block">
          {str(p.inquiryTitle) ? <>from “{str(p.inquiryTitle)}” · </> : null}
          <span className="font-medium text-foreground">{STANCE_WORDS[String(p.stance)] ?? String(p.stance)}</span>
          {typeof p.matcher === "string" ? <> · {p.matcher}</> : null}
        </span>,
      );
      const changes = Array.isArray(p.changes) ? (p.changes as Array<{ setting?: string; from?: unknown; to?: unknown }>) : [];
      for (const change of changes) {
        lines.push(
          <span key={String(change.setting)} className="block">
            {String(change.setting)}: {String(change.from ?? "—")} →{" "}
            <span className="text-foreground">{String(change.to ?? "—")}</span>
          </span>,
        );
      }
      if (item.activityType === "HYPOTHESIS_RULE_REMOVED") {
        const unlinked = Number(p.unlinked ?? 0);
        const kept = Number(p.kept ?? 0);
        lines.push(
          <span key="links" className="block italic">
            {unlinked > 0
              ? `${unlinked} link${unlinked === 1 ? "" : "s"} it made went with it`
              : kept > 0
                ? `${kept} link${kept === 1 ? "" : "s"} it made stay`
                : "it had made no links"}
          </span>,
        );
      }
      break;
    }
    case "FINDINGS_AUTO_LINKED": {
      const linked = Number(p.linked ?? 0);
      const rows = Array.isArray(p.hypotheses)
        ? (p.hypotheses as Array<{ threadTitle?: string; stance?: string; count?: number }>)
        : [];
      for (const [index, row] of rows.entries()) {
        lines.push(
          <span key={`h${index}`} className="block">
            {Number(row.count ?? 0)} finding{Number(row.count ?? 0) === 1 ? "" : "s"} →{" "}
            <span className="font-medium text-foreground">{row.threadTitle}</span> ·{" "}
            {STANCE_WORDS[String(row.stance)] ?? String(row.stance)}
          </span>,
        );
      }
      if (rows.length === 0 && linked > 0) lines.push(<span key="n">{linked} finding(s) linked</span>);
      const findings = Array.isArray(p.findings) ? (p.findings as Array<{ label?: string; value?: string | null }>) : [];
      if (findings.length > 0) {
        lines.push(
          <span key="what" className="block font-mono text-[11px]">
            {findings.map((f) => (f.value ? `${f.label}: ${f.value}` : f.label)).join(" · ")}
          </span>,
        );
      }
      break;
    }
    case "THREAD_EVIDENCE_REMOVED": {
      const f = Number(p.findings ?? 0);
      const a = Number(p.assets ?? 0);
      lines.push(
        <span key="gone" className="block">
          took out {f} finding{f === 1 ? "" : "s"} and {a} asset{a === 1 ? "" : "s"} with it
        </span>,
      );
      const kept = Number(p.keptShared ?? 0) + Number(p.keptNoted ?? 0);
      if (kept > 0) {
        lines.push(
          <span key="kept" className="block italic">
            {Number(p.keptShared ?? 0) > 0 ? `${p.keptShared} shared with another hypothesis` : ""}
            {Number(p.keptShared ?? 0) > 0 && Number(p.keptNoted ?? 0) > 0 ? ", " : ""}
            {Number(p.keptNoted ?? 0) > 0 ? `${p.keptNoted} with a note` : ""} stayed
          </span>,
        );
      }
      break;
    }
    case "INQUIRY_SETTINGS_UPDATED": {
      const changes = Array.isArray(p.changes) ? (p.changes as Array<{ setting?: string; to?: unknown }>) : [];
      for (const change of changes) {
        lines.push(
          <span key={String(change.setting)} className="block">
            {SETTING_LABELS[String(change.setting)] ?? String(change.setting)} →{" "}
            <span className="font-medium text-foreground">{change.to === true ? "on" : change.to === false ? "off" : String(change.to)}</span>
          </span>,
        );
      }
      break;
    }
    case "INQUIRY_UNLINKED": {
      const dropped = Number(p.filtersDropped ?? 0);
      if (dropped > 0) {
        lines.push(
          <span key="dropped">
            its {dropped} filter{dropped === 1 ? "" : "s"} went with it
          </span>,
        );
      }
      break;
    }
    case "CLEANUP_SETTINGS_UPDATED": {
      const changes = Array.isArray(p.changes) ? (p.changes as Array<{ rule?: string; enabled?: boolean }>) : [];
      for (const change of changes) {
        lines.push(
          <span key={String(change.rule)} className="block">
            {RULE_LABELS[String(change.rule)] ?? String(change.rule)} →{" "}
            <span className="font-medium text-foreground">{change.enabled ? "on" : "off"}</span>
          </span>,
        );
      }
      break;
    }
    case "FINDING_FILTER_ADDED":
    case "FINDING_FILTER_REMOVED":
    case "FINDING_FILTER_UPDATED": {
      const filters =
        item.activityType === "FINDING_FILTER_ADDED"
          ? Array.isArray(p.filters)
            ? (p.filters as FilterPayload[])
            : []
          : p.filter
            ? [p.filter as FilterPayload]
            : [];
      lines.push(
        <span key="filters" className="flex flex-wrap gap-1">
          {filters.map((f, index) => (
            <FilterChip key={f.id ?? index} filter={f} />
          ))}
        </span>,
      );
      const before = p.before as { pattern?: string; description?: string | null } | undefined;
      const after = p.filter as FilterPayload | undefined;
      if (item.activityType === "FINDING_FILTER_UPDATED" && before) {
        if (before.pattern !== after?.pattern) {
          lines.push(
            <span key="pattern" className="block font-mono text-[11px]">
              {before.pattern} → <span className="text-foreground">{after?.pattern}</span>
            </span>,
          );
        }
        if ((before.description ?? null) !== (after?.description ?? null)) {
          lines.push(
            <span key="description" className="block">
              why: “{before.description ?? "—"}” → <span className="text-foreground">“{after?.description ?? "—"}”</span>
            </span>,
          );
        }
      }
      if (item.activityType === "FINDING_FILTER_REMOVED") {
        lines.push(
          <span key="note" className="block italic">
            what it took out stays out; the watches just stop skipping it
          </span>,
        );
      }
      break;
    }
    case "FINDINGS_AUTO_REMOVED":
    case "EVIDENCE_AUTO_REMOVED": {
      const when = triggerText(p);
      if (when) lines.push(<span key="when" className="block">{when}</span>);
      if ((p.reason === "FILTER" || p.reason === "FILTER_EMPTIED") && Array.isArray(p.filters) && p.filters.length > 0) {
        lines.push(
          <span key="filters" className="flex flex-wrap gap-1">
            {(p.filters as FilterPayload[]).map((f, index) => (
              <FilterChip key={f.id ?? index} filter={f} />
            ))}
          </span>,
        );
      }
      const findings = Array.isArray(p.findings) ? (p.findings as RemovedFinding[]) : [];
      const assets = Array.isArray(p.assets) ? (p.assets as RemovedAsset[]) : [];
      if (findings.length > 0 || assets.length > 0) {
        lines.push(
          <RemovedList
            key="list"
            findings={findings}
            assets={assets}
            total={Number(p.count ?? findings.length + assets.length)}
            truncated={p.truncated === true}
            onShowOnBoard={onShowOnBoard}
            emptied={p.reason === "FILTER_EMPTIED"}
          />,
        );
      }
      if (item.activityType === "EVIDENCE_AUTO_REMOVED" && Number(p.findingsRemoved ?? 0) > 0) {
        lines.push(
          <span key="with" className="block">
            {Number(p.findingsRemoved)} finding{Number(p.findingsRemoved) === 1 ? "" : "s"} left with {Number(p.count) === 1 ? "it" : "them"}
          </span>,
        );
      }
      break;
    }
    case "THREAD_ENTRY_ADDED":
    case "THREAD_STATEMENT_UPDATED": {
      const body = str(p.body);
      if (body) {
        lines.push(
          <span key="body" className="block whitespace-pre-wrap">
            “{body.slice(0, 200)}{body.length > 200 ? "…" : ""}”
          </span>,
        );
      }
      break;
    }
    case "THREAD_STATUS_CHANGED":
      lines.push(
        <span key="status">
          {String(p.previousStatus ?? "?")} → <span className="font-medium text-foreground">{String(p.status ?? "?")}</span>
        </span>,
      );
      break;
    case "THREAD_CONFIDENCE_CHANGED":
      lines.push(<span key="conf">confidence → {Math.round(Number(p.confidence ?? 0) * 100)}%</span>,);
      break;
    case "SUPPORT_LINKED":
    case "SUPPORT_UNLINKED": {
      const target = str(p.targetLabel);
      if (target) {
        lines.push(
          <span key="target">
            <span className="font-medium text-foreground">{target}</span>
            {str(p.stance) ? ` · ${String(p.stance).toLowerCase()}` : ""}
          </span>,
        );
      }
      break;
    }
    case "EVIDENCE_NOTE_UPDATED":
    case "FINDING_NOTE_UPDATED": {
      const note = str(p.note);
      lines.push(
        note ? (
          <span key="note" className="block whitespace-pre-wrap">
            “{note}”
          </span>
        ) : (
          <span key="note" className="italic">note cleared</span>
        ),
      );
      break;
    }
    case "CONCLUSION_UPDATED":
      if (p.draft === true && Number(p.passes ?? 1) > 1) {
        lines.push(
          <span key="saves">
            {plural(Number(p.passes), "save")}
            {rangeText(p)}
          </span>,
        );
      }
      if (p.closed) {
        const archived = Number(p.archivedInquiries ?? 0);
        lines.push(
          <span key="closed">
            Case closed with a conclusion
            {archived > 0 ? ` · ${archived} inquir${archived === 1 ? "y" : "ies"} archived` : ""}
          </span>,
        );
      }
      break;
    case "CASE_UPDATED":
      if (isLegacyAutoPullToggle(item)) {
        lines.push(
          <span key="auto" className="block">
            {SETTING_LABELS.autoPull} → <span className="font-medium text-foreground">{p.autoPull ? "on" : "off"}</span>
          </span>,
        );
      } else if (Array.isArray(p.fields)) {
        const fields = strList(p.fields).map((f) => FIELD_LABELS[f] ?? f);
        const passes = Number(p.passes ?? 1);
        lines.push(
          <span key="fields" className="block">
            edited {fields.join(", ")}
            {passes > 1 ? ` · ${plural(passes, "save")}${rangeText(p)}` : ""}
          </span>,
        );
        if (strList(p.fields).includes("title") && str(p.previousTitle) && p.previousTitle !== p.title) {
          lines.push(
            <span key="title" className="block">
              “{String(p.previousTitle)}” → <span className="font-medium text-foreground">“{String(p.title ?? "")}”</span>
            </span>,
          );
        }
      } else if (str(p.aiMode)) {
        lines.push(
          <span key="ai">
            {str(p.previousAiMode) ? `${String(p.previousAiMode)} → ` : ""}
            <span className="font-medium text-foreground">{String(p.aiMode)}</span>
          </span>,
        );
      } else if (str(p.status)) {
        lines.push(
          <span key="status">
            {str(p.previousStatus) ? `${String(p.previousStatus)} → ` : "status → "}
            <span className="font-medium text-foreground">{String(p.status)}</span>
          </span>,
        );
      }
      break;
    case "BOARD_NOTE_UPDATED":
    case "BOARD_FRAME_UPDATED": {
      const after = str(p.after);
      lines.push(
        after ? (
          <span key="after" className="block whitespace-pre-wrap">
            “{after.slice(0, 200)}{after.length > 200 ? "…" : ""}”
          </span>
        ) : (
          <span key="after" className="italic">text cleared</span>
        ),
      );
      break;
    }
    case "BOARD_LINK_UPDATED": {
      const changes = (p.changes ?? {}) as Record<string, { before?: unknown; after?: unknown }>;
      for (const [field, change] of Object.entries(changes).slice(0, 4)) {
        lines.push(
          <span key={field} className="block">
            {field}: {String(change?.before ?? "—")} → <span className="font-medium text-foreground">{String(change?.after ?? "—")}</span>
          </span>,
        );
      }
      break;
    }
    case "BOARD_ITEM_HIGHLIGHTED":
      lines.push(<span key="color">{str(p.color) ? `marked ${String(p.color)}` : "highlight cleared"}</span>);
      break;
    case "BOARD_ARRANGED":
      lines.push(<span key="count">items moved or resized</span>);
      break;
    case "BOARD_SNAPSHOT_TAKEN":
      lines.push(
        <span key="reason">
          {p.reason === "CASE_CLOSED" ? "captured when the case closed" : "taken by hand"}
          {p.version !== undefined ? ` · version ${String(p.version)}` : ""}
        </span>,
      );
      break;
    case "COMMENT_RESOLVED":
      if (p.resolved === false) lines.push(<span key="reopened">reopened</span>);
      break;
    default:
      break;
  }

  // Finding/asset chips for batch events (pull + batch attach). A pull that
  // names its findings shows them instead.
  const named = Array.isArray(p.findings) && p.findings.length > 0;
  const findingLabels = named ? [] : strList(p.findingLabels);
  const assetLabels = named ? [] : strList(p.assetLabels);
  const chips = [...new Set([...findingLabels, ...assetLabels])];

  if (lines.length === 0 && chips.length === 0) return null;
  return (
    <div className="text-muted-foreground mt-0.5 space-y-1 text-xs">
      {lines}
      {chips.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {chips.slice(0, 8).map((label) => (
            <span key={label} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">
              {label}
            </span>
          ))}
          {Number(p.pulled ?? p.count ?? 0) > 8 && (
            <span className="px-1 text-[10px]">+{Number(p.pulled ?? p.count) - 8} more</span>
          )}
        </span>
      )}
    </div>
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CaseTimeline({
  caseId,
  compact = false,
  onShowOnBoard,
  watches = [],
  focusEntryId = null,
  focusNonce = 0,
  onFocusEntry,
  entryLink,
}: {
  caseId: string;
  /** Narrow container (the case board's drawer): no day index column. */
  compact?: boolean;
  /** Board events carry an itemId; when given, they offer "Show on board". */
  onShowOnBoard?: (itemId: string) => void;
  /** The case's linked watches: their scan deltas are blended in. */
  watches?: ReadonlyArray<{ id: string; title: string }>;
  /** An entry to bring into view and mark (a shared link, an alert's "What changed"). */
  focusEntryId?: string | null;
  /** Bumped to scroll to the same entry again. */
  focusNonce?: number;
  /** Someone picked an entry (its time): mark it, and keep it in the address. */
  onFocusEntry?: (entryId: string) => void;
  /** The address that opens the timeline at an entry; when given, each entry can be copied as a link. */
  entryLink?: (entryId: string) => string;
}) {
  const [items, setItems] = React.useState<CaseActivityDto[]>([]);
  const [aiRuns, setAiRuns] = React.useState<CaseActivityDto[]>([]);
  const [watchEntries, setWatchEntries] = React.useState<CaseActivityDto[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<"ALL" | EventGroup>("ALL");
  const [missing, setMissing] = React.useState<string | null>(null);
  // The entry the first page must reach; later pages just continue.
  const reachRef = React.useRef<string | null>(null);
  reachRef.current = focusEntryId && !focusEntryId.startsWith(WATCH_ENTRY_PREFIX) ? focusEntryId : null;

  const load = React.useCallback(
    async (append = false, fromCursor?: string) => {
      setLoading(true);
      try {
        const res = await api.cases.caseTimelineControllerGetTimeline({
          caseId,
          cursor: append ? fromCursor : undefined,
          limit: "100",
          until: append ? undefined : (reachRef.current ?? undefined),
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor ?? null);
        if (!append) {
          // Blend case-focused autopilot runs into the stream as synthetic
          // events, so the AI's work shows up where it happened in time.
          try {
            const runs = await api.autopilot.autopilotControllerListRuns({
              caseId,
              limit: 50,
            });
            setAiRuns(
              runs.items.map(
                (r): CaseActivityDto => ({
                  id: `ai-run-${r.id}`,
                  caseId,
                  activityType: AUTOPILOT_RUN as CaseActivityDto["activityType"],
                  payload: {
                    status: r.status,
                    summary: r.summary,
                    instruction: r.instruction,
                    error: r.error,
                    runId: r.id,
                  },
                  actor: "ai-autopilot",
                  createdAt: r.createdAt,
                }),
              ),
            );
          } catch {
            setAiRuns([]);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [caseId],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  // A deep link to an entry older than the first page: read down to it.
  React.useEffect(() => {
    const target = reachRef.current;
    if (!target || loading || items.some((i) => i.id === target)) return;
    if (items.length > 0 && !cursor) return;
    void load();
    // Only a new focus asks again; `items` changing must not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntryId, focusNonce]);

  const watchKey = watches.map((w) => `${w.id}:${w.title}`).join("|");
  React.useEffect(() => {
    if (watches.length === 0) {
      setWatchEntries([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const titles = new Map(watches.map((w) => [w.id, w.title]));
      const pages = await Promise.all(
        watches.map((w) =>
          api.inquiries
            .inquiriesControllerTimeline({
              id: w.id,
              types: "MATCHES_LANDED,MATCHES_RETIRED",
              limit: String(WATCH_ENTRIES_PER_WATCH),
            })
            .catch(() => null),
        ),
      );
      const rows = pages.flatMap((page) => page?.items ?? []);
      const sourceIds = [...new Set(rows.map((r) => str((r.payload as Record<string, unknown>).sourceId)).filter(Boolean))];
      const sourceNames = new Map<string, string>();
      if (sourceIds.length > 0) {
        try {
          const sources = await api.sources.sourcesControllerListSources();
          for (const src of sources as Array<{ id: string; name?: string | null }>) {
            if (src.name) sourceNames.set(src.id, src.name);
          }
        } catch {
          // Entries still read without the source's name.
        }
      }
      if (cancelled) return;
      setWatchEntries(rows.map((row) => toWatchEntry(row, caseId, titles.get(row.inquiryId) ?? null, sourceNames)));
    })();
    return () => {
      cancelled = true;
    };
    // watchKey stands for `watches`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, caseId]);

  const merged = React.useMemo(
    () =>
      [...items, ...aiRuns, ...watchEntries].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [items, aiRuns, watchEntries],
  );
  const visible = React.useMemo(
    () => (filter === "ALL" ? merged : merged.filter((i) => eventGroup(i) === filter)),
    [merged, filter],
  );

  // Bring the focused entry into view once it is loaded: show every kind if a
  // filter hides it, then scroll it to the middle.
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!focusEntryId) {
      setMissing(null);
      return;
    }
    const entry = merged.find((i) => i.id === focusEntryId);
    if (!entry) {
      const settled = !loading && (focusEntryId.startsWith(WATCH_ENTRY_PREFIX) ? watchEntries.length > 0 || watches.length === 0 : !cursor);
      setMissing(settled ? focusEntryId : null);
      return;
    }
    setMissing(null);
    if (filter !== "ALL" && eventGroup(entry) !== filter) {
      setFilter("ALL");
      return;
    }
    const frame = requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(focusEntryId)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
    // Scroll once per focus (nonce), when the entry turns up, or when a filter reset shows it.
  }, [focusEntryId, focusNonce, merged, filter, loading, cursor, watchEntries.length, watches.length]);

  // Group by day, newest day first (API returns newest first).
  const days = React.useMemo(() => {
    const map = new Map<string, CaseActivityDto[]>();
    for (const item of visible) {
      const key = dayKey(new Date(item.createdAt));
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return Array.from(map.entries());
  }, [visible]);

  const jumpTo = (key: string) => {
    document
      .getElementById(`timeline-day-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const [copied, setCopied] = React.useState<string | null>(null);
  const copyLink = (id: string) => {
    if (!entryLink) return;
    onFocusEntry?.(id);
    void navigator.clipboard?.writeText(entryLink(id)).then(
      () => {
        setCopied(id);
        window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
      },
      () => undefined,
    );
  };

  if (loading && items.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading timeline…
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-4" : "grid gap-6 lg:grid-cols-[1fr_200px]"}>
      <div className="min-w-0 space-y-4" ref={listRef}>
        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          {GROUP_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-[4px] border-2 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                filter === key
                  ? "border-accent bg-accent/10 text-accent-ink"
                  : "border-border text-muted-foreground hover:border-foreground/30"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => void load()}
            className="text-muted-foreground ml-auto text-xs underline"
          >
            Refresh
          </button>
        </div>

        {missing && (
          <p className="rounded-[4px] border-2 border-dashed border-border px-3 py-2 text-xs text-muted-foreground" role="status">
            The entry this link points at is not in the timeline any more (it may be older than the history kept for a watch).
          </p>
        )}

        {days.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No activity {filter === "ALL" ? "yet" : "in this category"}.
          </p>
        ) : (
          days.map(([key, dayItems]) => (
            <section key={key} id={`timeline-day-${key}`} className="scroll-mt-20">
              <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1.5 backdrop-blur">
                <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">
                  {dayLabel(key)}
                  <span className="text-muted-foreground ml-2 font-normal">
                    {dayItems.length} event{dayItems.length === 1 ? "" : "s"}
                  </span>
                </h3>
              </div>
              <ol className="ml-2 border-l-2 border-border">
                {dayItems.map((item) => {
                  const meta = TYPE_META[item.activityType] ?? {
                    icon: <Activity className="h-3.5 w-3.5" />,
                    label: item.activityType.toLowerCase().replace(/_/g, " "),
                    color: "text-muted-foreground",
                    group: "case" as const,
                  };
                  const subject = eventSubject(item);
                  const focused = item.id === focusEntryId;
                  return (
                    <li
                      key={item.id}
                      id={`timeline-event-${item.id}`}
                      data-entry-id={item.id}
                      data-focused={focused || undefined}
                      className={cn(
                        "group/entry relative scroll-mt-24 py-2 pl-6 transition-colors",
                        focused && "-mr-1 rounded-r-[4px] bg-accent/10 pr-1 shadow-[inset_3px_0_0_var(--accent)]",
                      )}
                    >
                      <span
                        className={`absolute -left-[9px] top-2.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-border bg-card ${meta.color}`}
                      >
                        <span className="scale-[0.65]">{meta.icon}</span>
                      </span>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 text-sm">
                          <span className="font-medium">{eventLabel(item, meta.label)}</span>
                          {subject && (
                            <>
                              <span className="text-muted-foreground"> — </span>
                              <span className="font-medium text-foreground">{subject}</span>
                            </>
                          )}
                        </p>
                        <span className="flex shrink-0 items-center gap-1">
                          {entryLink && (
                            <button
                              type="button"
                              className={cn(
                                "text-muted-foreground hover:text-foreground focus-visible:opacity-100",
                                copied === item.id ? "opacity-100" : "opacity-0 group-hover/entry:opacity-100",
                              )}
                              title={copied === item.id ? "Link copied" : "Copy a link to this entry"}
                              aria-label="Copy a link to this entry"
                              onClick={() => copyLink(item.id)}
                            >
                              {copied === item.id ? <CheckCircle2 className="h-3 w-3" /> : <Link className="h-3 w-3" />}
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-muted-foreground font-mono text-[11px] tabular-nums hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
                            disabled={!onFocusEntry}
                            onClick={() => onFocusEntry?.(item.id)}
                            title={new Date(item.createdAt).toLocaleString()}
                          >
                            {timeLabel(new Date(item.createdAt))}
                          </button>
                        </span>
                      </div>
                      <EventDetail item={item} onShowOnBoard={onShowOnBoard} />
                      {onShowOnBoard && str((item.payload as Record<string, unknown> | null)?.itemId) && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground mt-0.5 inline-flex items-center gap-1 text-[11px] underline"
                          onClick={() => onShowOnBoard(String((item.payload as Record<string, unknown>).itemId))}
                        >
                          <Crosshair className="h-3 w-3" /> Show on board
                        </button>
                      )}
                      {item.actor &&
                        (isAiActor(item.actor) ? (
                          <p className="text-muted-foreground/70 mt-0.5 text-[11px]">
                            by <AiActorBadge className="align-middle" />
                          </p>
                        ) : (
                          <p className="text-muted-foreground/70 mt-0.5 text-[11px]">
                            by {SYSTEM_ACTORS[item.actor] ?? item.actor}
                          </p>
                        ))}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}

        {cursor && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true, cursor)}
            disabled={loading}
            className="w-full"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Load older events
          </Button>
        )}
      </div>

      {/* ── Jump navigation ── */}
      {days.length > 1 && !compact && (
        <nav className="sticky top-4 hidden self-start lg:block">
          <p className="text-muted-foreground mb-2 font-mono text-[10px] uppercase tracking-[0.14em]">
            Jump to
          </p>
          <ul className="space-y-1 border-l-2 border-border">
            {days.map(([key, dayItems]) => (
              <li key={key}>
                <button
                  onClick={() => jumpTo(key)}
                  className="text-muted-foreground hover:text-foreground block w-full truncate px-3 py-0.5 text-left text-xs transition-colors"
                >
                  {dayLabel(key)}
                  <span className="text-muted-foreground/60 ml-1">({dayItems.length})</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

function isWatchEntry(item: CaseActivityDto): boolean {
  const type = item.activityType as string;
  return type === WATCH_LANDED || type === WATCH_RETIRED;
}

/** A watch's scan delta, shaped as a case timeline entry. */
function toWatchEntry(
  row: InquiryActivityDto,
  caseId: string,
  inquiryTitle: string | null,
  sourceNames: ReadonlyMap<string, string>,
): CaseActivityDto {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const sourceId = str(p.sourceId);
  return {
    id: watchEntryId(row.id),
    caseId,
    activityType: (row.activityType === "MATCHES_RETIRED" ? WATCH_RETIRED : WATCH_LANDED) as CaseActivityDto["activityType"],
    payload: {
      ...p,
      inquiryId: row.inquiryId,
      inquiryTitle,
      sourceName: sourceId ? (sourceNames.get(sourceId) ?? null) : null,
    },
    actor: undefined,
    createdAt: row.createdAt,
  };
}
