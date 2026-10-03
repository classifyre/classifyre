import type { CaseLeadDto } from "@workspace/api-client";

/**
 * What the Leads panel and the board need to know about a lead, kept pure so
 * it is tested without a DOM: which leads wait, what they are filed under,
 * how they sort, what they relate to on the board, and why the case suggests
 * them (the panel puts the words to it).
 */

/** The reasons a lead can have, in the order the filters show them. */
export const LEAD_ORIGINS = ["DUPLICATE", "INQUIRY", "SEMANTIC_NEIGHBOR", "ENTITY", "AUTOPILOT", "MANUAL"] as const;
export type LeadOrigin = (typeof LEAD_ORIGINS)[number];
/** A similar finding with the very value of what it resembles is named apart. */
export type LeadReason = LeadOrigin | "SAME_VALUE";
export type LeadSort = "relevance" | "newest";

/** The actor the case settles its own leads as (CASE_LEADS_ACTOR in the API). */
export const CASE_LEADS_ACTOR = "case-leads";

const details = (lead: CaseLeadDto) => (lead.details ?? {}) as Record<string, unknown>;
const pct = (value: number | null | undefined) => Math.round((value ?? 0) * 100);

/** Waiting for a person: proposed, and not settled another way since. */
export function isPendingLead(lead: CaseLeadDto): boolean {
  return lead.status === "PROPOSED" && (lead.state ?? "OPEN") === "OPEN";
}

/** Reviewed, or joined the case another way (shown under Reviewed). */
export function isReviewedLead(lead: CaseLeadDto): boolean {
  return lead.status !== "PROPOSED" || lead.state === "IN_CASE";
}

/** Joined the case without anyone reviewing the lead. */
export function joinedAnotherWay(lead: CaseLeadDto): boolean {
  return lead.status === "PROPOSED" || lead.reviewedBy === CASE_LEADS_ACTOR;
}

export function leadReason(lead: CaseLeadDto): LeadReason {
  if (lead.origin === "SEMANTIC_NEIGHBOR" && details(lead).sameValue === true) return "SAME_VALUE";
  return lead.origin as LeadOrigin;
}

/** One order across kinds: a person-confirmed or identical copy first, then by score. */
export function leadRelevance(lead: CaseLeadDto): number {
  if (lead.origin === "DUPLICATE") {
    const d = details(lead);
    return (d.verdict === "CONFIRMED" ? 1.2 : d.relation === "identical_content" ? 1.1 : 0) + (lead.similarity ?? 0);
  }
  return lead.importance ?? lead.similarity ?? 0;
}

export function countByOrigin(leads: readonly CaseLeadDto[]): Map<LeadOrigin, number> {
  const counts = new Map<LeadOrigin, number>();
  for (const lead of leads) counts.set(lead.origin as LeadOrigin, (counts.get(lead.origin as LeadOrigin) ?? 0) + 1);
  return counts;
}

/** The waiting leads a reason filter and a search leave, in the chosen order. */
export function selectLeads(
  pending: readonly CaseLeadDto[],
  opts: { origin: LeadOrigin | "ALL"; query: string; sort: LeadSort },
): CaseLeadDto[] {
  const needle = opts.query.trim().toLowerCase();
  const list = pending.filter((lead) => {
    if (opts.origin !== "ALL" && lead.origin !== opts.origin) return false;
    if (!needle) return true;
    return [lead.title, lead.value, lead.findingType, lead.assetName, lead.sourceName, lead.viaLabel, lead.viaAssetName, lead.rationale]
      .filter(Boolean)
      .some((text) => String(text).toLowerCase().includes(needle));
  });
  return list.sort((a, b) =>
    opts.sort === "newest"
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : leadRelevance(b) - leadRelevance(a),
  );
}

/**
 * Where "Show on board" goes for a lead: what it hangs off (the evidence it
 * resembles or duplicates), else its own asset when that is on the board.
 */
export function locateLead(
  itemByAsset: ReadonlyMap<string, string>,
  lead: CaseLeadDto,
): { itemId: string; findingId: string | null } | null {
  const via = lead.viaAssetId ? itemByAsset.get(lead.viaAssetId) : undefined;
  if (via) return { itemId: via, findingId: lead.viaFindingId ?? null };
  const own = lead.assetId ? itemByAsset.get(lead.assetId) : undefined;
  if (own) return { itemId: own, findingId: lead.findingId ?? null };
  return null;
}

/** Why the case suggests a lead, as parts the panel puts into words. */
export type LeadWhy =
  | { kind: "sameValue"; via: string; asset: string | null }
  | { kind: "similar"; pct: number; via: string; asset: string | null }
  | { kind: "watch"; watch: string; isNew: boolean }
  | { kind: "confirmed" | "identical"; asset: string }
  | { kind: "shares"; labels: string[]; asset: string; pct: number }
  /** Autopilot's reasoning, a person's note, or a lead older than its `via`. */
  | { kind: "rationale"; text: string };

export function leadWhy(lead: CaseLeadDto): LeadWhy {
  const d = details(lead);
  const rationale: LeadWhy = { kind: "rationale", text: lead.rationale };
  switch (lead.origin) {
    case "SEMANTIC_NEIGHBOR":
      if (!lead.viaLabel) return rationale;
      return d.sameValue === true
        ? { kind: "sameValue", via: lead.viaLabel, asset: lead.viaAssetName ?? null }
        : { kind: "similar", pct: pct(lead.similarity), via: lead.viaLabel, asset: lead.viaAssetName ?? null };
    case "INQUIRY":
      return lead.viaLabel ? { kind: "watch", watch: lead.viaLabel, isNew: d.isNew === true } : rationale;
    case "DUPLICATE": {
      const asset = lead.viaAssetName ?? lead.viaLabel;
      if (!asset) return rationale;
      if (d.verdict === "CONFIRMED") return { kind: "confirmed", asset };
      if (d.relation === "identical_content") return { kind: "identical", asset };
      const labels = Array.isArray(d.sharedLabels) ? d.sharedLabels.map(String) : [];
      return { kind: "shares", labels, asset, pct: pct(lead.similarity) };
    }
    default:
      return rationale;
  }
}

/** The score a card shows next to its reason, as parts. */
export type LeadScore =
  | { kind: "identical" }
  | { kind: "match" | "similar"; pct: number }
  | { kind: "importance"; value: number }
  | null;

export function leadScore(lead: CaseLeadDto): LeadScore {
  if (lead.origin === "DUPLICATE") {
    return details(lead).relation === "identical_content" ? { kind: "identical" } : { kind: "match", pct: pct(lead.similarity) };
  }
  if (lead.importance != null) return { kind: "importance", value: pct(lead.importance) };
  if (lead.similarity != null) return { kind: "similar", pct: pct(lead.similarity) };
  return null;
}

/**
 * The server's list with this tab's own reviews laid over it: a lead the
 * server still lists as waiting, but that this tab reviewed, shows as
 * reviewed. Once the server agrees, the override is dropped.
 */
export function withSettled(
  fresh: CaseLeadDto[],
  settled: Map<string, CaseLeadDto["status"]>,
): CaseLeadDto[] {
  if (settled.size === 0) return fresh;
  return fresh.map((lead) => {
    const status = settled.get(lead.id);
    if (!status) return lead;
    if (lead.status !== "PROPOSED") {
      settled.delete(lead.id);
      return lead;
    }
    return { ...lead, status, reviewedAt: lead.reviewedAt ?? new Date() };
  });
}
