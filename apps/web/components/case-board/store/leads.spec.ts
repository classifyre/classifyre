import type { CaseLeadDto } from "@workspace/api-client";
import {
  countByOrigin,
  isPendingLead,
  isReviewedLead,
  joinedAnotherWay,
  leadReason,
  leadScore,
  leadWhy,
  locateLead,
  selectLeads,
} from "./leads";

let n = 0;
function lead(patch: Partial<CaseLeadDto>): CaseLeadDto {
  n += 1;
  return {
    id: `lead-${n}`,
    caseId: "case-1",
    findingId: `finding-${n}`,
    assetId: `asset-${n}`,
    origin: "SEMANTIC_NEIGHBOR",
    status: "PROPOSED",
    state: "OPEN",
    rationale: "because",
    title: `EMAIL: v${n}`,
    proposedBy: "case-leads",
    createdAt: new Date(2026, 8, 27, 10, n),
    ...patch,
  } as CaseLeadDto;
}

describe("leads", () => {
  it("waits only for proposed leads that did not join the case another way", () => {
    expect(isPendingLead(lead({}))).toBe(true);
    expect(isPendingLead(lead({ state: undefined }))).toBe(true);
    expect(isPendingLead(lead({ state: "IN_CASE" }))).toBe(false);
    expect(isPendingLead(lead({ state: "GONE" }))).toBe(false);
    expect(isPendingLead(lead({ status: "DISMISSED", state: undefined }))).toBe(false);
  });

  it("files leads that joined another way under Reviewed, and names them so", () => {
    const joined = lead({ state: "IN_CASE" });
    const settled = lead({ status: "ACCEPTED", state: undefined, reviewedBy: "case-leads" });
    const accepted = lead({ status: "ACCEPTED", state: undefined, reviewedBy: "Ana" });

    expect([joined, settled, accepted].every(isReviewedLead)).toBe(true);
    expect(isReviewedLead(lead({ state: "GONE" }))).toBe(false);
    expect(joinedAnotherWay(joined)).toBe(true);
    expect(joinedAnotherWay(settled)).toBe(true);
    expect(joinedAnotherWay(accepted)).toBe(false);
  });

  it("names a similar finding with the very value of its seed apart", () => {
    expect(leadReason(lead({ details: { sameValue: true } }))).toBe("SAME_VALUE");
    expect(leadReason(lead({}))).toBe("SEMANTIC_NEIGHBOR");
    expect(leadReason(lead({ origin: "DUPLICATE" }))).toBe("DUPLICATE");
  });

  it("filters by reason and text, and puts confirmed and identical copies first", () => {
    const similar = lead({ importance: 0.9, value: "jane@example.com" });
    const weak = lead({ origin: "DUPLICATE", findingId: null, similarity: 0.65, assetName: "draft.docx" });
    const identical = lead({ origin: "DUPLICATE", findingId: null, similarity: 1, details: { relation: "identical_content" } });
    const confirmed = lead({ origin: "DUPLICATE", findingId: null, similarity: 0.4, details: { verdict: "CONFIRMED" } });
    const all = [similar, weak, identical, confirmed];

    expect(selectLeads(all, { origin: "ALL", query: "", sort: "relevance" }).map((l) => l.id)).toEqual([
      identical.id,
      confirmed.id,
      similar.id,
      weak.id,
    ]);
    expect(selectLeads(all, { origin: "DUPLICATE", query: "draft", sort: "relevance" })).toEqual([weak]);
    expect(selectLeads(all, { origin: "ALL", query: "JANE@", sort: "relevance" })).toEqual([similar]);
    expect(selectLeads(all, { origin: "ALL", query: "", sort: "newest" })[0]).toBe(confirmed);
    expect(countByOrigin(all)).toEqual(new Map([["SEMANTIC_NEIGHBOR", 1], ["DUPLICATE", 3]]));
  });

  it("shows a lead next to what it relates to, else where it already is", () => {
    const items = new Map([
      ["evidence-asset", "item-1"],
      ["own-asset", "item-2"],
    ]);

    expect(locateLead(items, lead({ viaAssetId: "evidence-asset", viaFindingId: "seed" }))).toEqual({
      itemId: "item-1",
      findingId: "seed",
    });
    expect(locateLead(items, lead({ assetId: "own-asset", findingId: "f" }))).toEqual({ itemId: "item-2", findingId: "f" });
    expect(locateLead(items, lead({ viaInquiryId: "q" }))).toBeNull();
  });

  it("says why, from what the lead hangs off", () => {
    expect(leadWhy(lead({ similarity: 0.87, viaLabel: "IBAN: DE89…", viaAssetName: "invoice.pdf" }))).toEqual({
      kind: "similar",
      pct: 87,
      via: "IBAN: DE89…",
      asset: "invoice.pdf",
    });
    expect(leadWhy(lead({ details: { sameValue: true }, viaLabel: "IBAN: DE89…" }))).toEqual({
      kind: "sameValue",
      via: "IBAN: DE89…",
      asset: null,
    });
    expect(leadWhy(lead({ origin: "INQUIRY", viaLabel: "Payments", details: { isNew: true } }))).toEqual({
      kind: "watch",
      watch: "Payments",
      isNew: true,
    });
    expect(
      leadWhy(
        lead({
          origin: "DUPLICATE",
          similarity: 0.74,
          viaAssetName: "contract.txt",
          details: { relation: "likely_duplicate", sharedLabels: ["EMAIL", "PERSON"] },
        }),
      ),
    ).toEqual({ kind: "shares", labels: ["EMAIL", "PERSON"], asset: "contract.txt", pct: 74 });
    expect(leadWhy(lead({ origin: "DUPLICATE", viaAssetName: "a.pdf", details: { verdict: "CONFIRMED" } })).kind).toBe(
      "confirmed",
    );
    // An agent's reasoning, and a lead from before leads knew what they hang off.
    expect(leadWhy(lead({ origin: "AUTOPILOT", rationale: "Same account as H2" }))).toEqual({
      kind: "rationale",
      text: "Same account as H2",
    });
    expect(leadWhy(lead({ rationale: "old" }))).toEqual({ kind: "rationale", text: "old" });
  });

  it("scores each kind by what makes it strong", () => {
    expect(leadScore(lead({ origin: "DUPLICATE", details: { relation: "identical_content" } }))).toEqual({ kind: "identical" });
    expect(leadScore(lead({ origin: "DUPLICATE", similarity: 0.72 }))).toEqual({ kind: "match", pct: 72 });
    expect(leadScore(lead({ importance: 0.91, similarity: 0.8 }))).toEqual({ kind: "importance", value: 91 });
    expect(leadScore(lead({ similarity: 0.8 }))).toEqual({ kind: "similar", pct: 80 });
    expect(leadScore(lead({}))).toBeNull();
  });
});
