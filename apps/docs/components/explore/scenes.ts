import type { ExploreGraph, ExploreScene } from "@workspace/case-board/explore";

/**
 * The Explore views the docs show. One made-up housing association runs
 * through them: a tenant's complaint about mould, and everything it turns
 * out to be connected to. Every name here is invented.
 */

const complaint: ExploreGraph = {
  assets: [
    { id: "complaint", label: "Complaint — mould in the bedroom, Flat 3.eml", assetType: "email", sourceName: "Tenant inbox", side: "seed", depth: 0, kinds: [], watches: ["Mould reported in a bedroom"] },
    { id: "inbox", label: "complaints_inbox", assetType: "table", sourceName: "Warehouse", side: "down", depth: 1, kinds: ["lineage"] },
    { id: "weekly", label: "Weekly complaints report.xlsx", assetType: "file", sourceName: "Shared drive", side: "down", depth: 2, kinds: ["lineage"] },
    { id: "forwarded", label: "FW: Complaint — mould in the bedroom.eml", assetType: "email", sourceName: "Repairs inbox", side: "side", depth: 1, kinds: ["duplicates"], cases: ["Damp at Alder Row"] },
    { id: "tenancy", label: "Tenancy agreement — Flat 3.pdf", assetType: "file", sourceName: "Shared drive", side: "side", depth: 1, kinds: ["similar", "meaning"] },
    { id: "survey", label: "Surveyor visit — Alder Row.docx", assetType: "file", sourceName: "Shared drive", side: "side", depth: 1, kinds: ["meaning", "alike"] },
    { id: "photos", label: "Inspection photos — Flat 3.jpg", assetType: "image", sourceName: "Shared drive", side: "side", depth: 1, kinds: ["meaning", "links"] },
    { id: "flat7", label: "Complaint — damp patch, Flat 7.eml", assetType: "email", sourceName: "Tenant inbox", side: "side", depth: 1, kinds: ["alike"], watches: ["Mould reported in a bedroom"] },
    { id: "flat1", label: "Repair request — black mould, Flat 1.pdf", assetType: "file", sourceName: "Shared drive", side: "side", depth: 1, kinds: ["alike"] },
  ],
  terms: [
    { id: "damp", name: "Damp and mould", kind: "CONCEPT" },
    { id: "tenant", name: "Rowan Pike", kind: "ENTITY" },
  ],
  links: [
    { id: "l1", source: "complaint", target: "inbox", kind: "lineage", label: "loaded into", directed: true },
    { id: "l2", source: "inbox", target: "weekly", kind: "lineage", label: "summarised in", directed: true },
    { id: "d1", source: "complaint", target: "forwarded", kind: "duplicates", label: "same content", strength: 1 },
    { id: "s1", source: "complaint", target: "tenancy", kind: "similar", label: "shares person ×2, phone number ×1", strength: 0.71 },
    { id: "m1", source: "complaint", target: "term:damp", kind: "meaning", label: "" },
    { id: "m2", source: "survey", target: "term:damp", kind: "meaning", label: "" },
    { id: "m3", source: "photos", target: "term:damp", kind: "meaning", label: "" },
    { id: "m4", source: "complaint", target: "term:tenant", kind: "meaning", label: "" },
    { id: "m5", source: "tenancy", target: "term:tenant", kind: "meaning", label: "" },
    { id: "a1", source: "complaint", target: "flat7", kind: "alike", label: "84% alike", strength: 0.84 },
    { id: "a2", source: "complaint", target: "flat1", kind: "alike", label: "79% alike", strength: 0.79 },
    { id: "a3", source: "complaint", target: "survey", kind: "alike", label: "72% alike", strength: 0.72 },
    { id: "u1", source: "photos", target: "complaint", kind: "links", label: "Photos taken for this complaint", manual: true, directed: true },
  ],
};

/** Where a double click on the surveyor's visit leads. */
const survey: ExploreGraph = {
  assets: [
    { id: "survey", label: "Surveyor visit — Alder Row.docx", assetType: "file", sourceName: "Shared drive", side: "seed", depth: 0, kinds: [] },
    { id: "complaint", label: "Complaint — mould in the bedroom, Flat 3.eml", assetType: "email", sourceName: "Tenant inbox", side: "side", depth: 1, kinds: ["meaning", "alike"] },
    { id: "flat7", label: "Complaint — damp patch, Flat 7.eml", assetType: "email", sourceName: "Tenant inbox", side: "side", depth: 1, kinds: ["meaning"] },
    { id: "works", label: "Works order WO-2207 — ventilation.pdf", assetType: "file", sourceName: "Contractor portal", side: "down", depth: 1, kinds: ["links"] },
    { id: "survey-old", label: "Surveyor visit — Alder Row (draft).docx", assetType: "file", sourceName: "Shared drive", side: "side", depth: 1, kinds: ["duplicates"] },
  ],
  terms: [
    { id: "damp", name: "Damp and mould", kind: "CONCEPT" },
    { id: "vent", name: "Ventilation", kind: "CONCEPT" },
  ],
  links: [
    { id: "w1", source: "survey", target: "works", kind: "links", label: "references", directed: true },
    { id: "d1", source: "survey", target: "survey-old", kind: "duplicates", label: "likely the same · person ×1, address ×1", strength: 0.66 },
    { id: "m1", source: "survey", target: "term:damp", kind: "meaning", label: "" },
    { id: "m2", source: "complaint", target: "term:damp", kind: "meaning", label: "" },
    { id: "m3", source: "flat7", target: "term:damp", kind: "meaning", label: "" },
    { id: "m4", source: "survey", target: "term:vent", kind: "meaning", label: "" },
    { id: "m5", source: "works", target: "term:vent", kind: "meaning", label: "" },
    { id: "a1", source: "survey", target: "complaint", kind: "alike", label: "72% alike", strength: 0.72 },
  ],
};

export const EXPLORE_SCENES = {
  complaint: {
    label: "Explore, started from a tenant's complaint about mould: lineage to the right, the same email above, the concepts and people it shares and what reads alike below",
    start: "complaint",
    views: { complaint, survey },
  },
  lineage: {
    label: "The lineage view of the same complaint: the table it is loaded into, and the report built on that",
    start: "complaint",
    views: { complaint },
    kinds: ["lineage", "links"],
  },
  meaning: {
    label: "The by-meaning view of the same complaint: the concepts and people it shares, and what reads alike",
    start: "complaint",
    views: { complaint },
    kinds: ["meaning", "alike"],
  },
} satisfies Record<string, ExploreScene & { label: string }>;

export type ExploreSceneName = keyof typeof EXPLORE_SCENES;
