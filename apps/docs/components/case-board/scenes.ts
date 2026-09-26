import { Archive, Database, File, FileText, Mail, Table } from "lucide-react";
import type { DemoNode, DemoScene } from "@workspace/case-board/demo";
import { ASSET_NODE, FINDING_NODE } from "@workspace/case-board/lib/geometry";

/**
 * The boards the docs show. Two made-up investigations run through them: a
 * payroll export that ended up in a private mailbox, and a supplier whose
 * bank details changed. Positions are board coordinates; an asset is 176
 * wide, and its circle sits 88 in and 30 down.
 */

/** A finding's spot around its asset: degrees clockwise from 3 o'clock, and how far out. */
function at(degrees: number, radius = 118): { x: number; y: number } {
  const a = (degrees * Math.PI) / 180;
  return {
    x: Math.round(ASSET_NODE.cx + radius * Math.cos(a) - FINDING_NODE.cx),
    y: Math.round(ASSET_NODE.cy + radius * Math.sin(a) - FINDING_NODE.cy),
  };
}

type Scene = DemoScene & { label: string };

const overview: Scene = {
  label: "A case board: three pieces of evidence, their findings, a hypothesis, a note and a frame",
  nodes: [
    {
      id: "note",
      type: "note",
      x: -40,
      y: -120,
      width: 230,
      height: 116,
      color: "yellow",
      text: "Next step: ask IT for the mail gateway logs of 12 March.",
    },
    {
      id: "h1",
      type: "hypothesis",
      x: 388,
      y: -160,
      statement: "Payroll data was forwarded to a private mailbox",
      status: "SUPPORTED",
      confidence: 0.8,
      entries: 6,
      lastEntry: "last: Maria K. 2 hours ago",
    },
    { id: "frame", type: "frame", x: 262, y: 36, width: 556, height: 300, tint: "pink", title: "Exfiltration path" },
    { id: "payroll", type: "asset", x: 0, y: 200, label: "payroll_2026-03.xlsx", icon: Table, source: "HR SharePoint" },
    { id: "p1", type: "finding", parent: "payroll", ...at(-140), severity: "critical", detector: "IBAN", label: "IBAN: AT61 1904 3002" },
    { id: "p2", type: "finding", parent: "payroll", ...at(-90), severity: "critical", detector: "Social security number", label: "SSN: 1237 010180" },
    { id: "p3", type: "finding", parent: "payroll", ...at(-40), severity: "high", detector: "Salary figures", label: "Salary: 5 820 €" },
    { id: "export", type: "asset", x: 300, y: 200, label: "payroll_export.csv", icon: File, source: "File share" },
    { id: "e1", type: "finding", parent: "export", ...at(-90), severity: "critical", detector: "IBAN", label: "IBAN: AT61 1904 3002", state: "new" },
    { id: "mail", type: "asset", x: 600, y: 200, label: "Fwd: March numbers", icon: Mail, source: "Mail archive" },
    { id: "m1", type: "finding", parent: "mail", ...at(-90), severity: "medium", detector: "Email address", label: "j.doe.private@gmail.com" },
  ],
  edges: [
    { type: "relation", source: "payroll", target: "export", relation: "TRANSFORM", kind: "lineage" },
    { type: "relation", source: "export", target: "mail", relation: "ATTACHED_TO", kind: "reference" },
    { type: "stance", source: "h1", target: "e1", stance: "SUPPORTS", note: "The same IBAN as the payroll sheet" },
    { type: "stance", source: "h1", target: "m1", stance: "SUPPORTS", note: "Sent at 23:40, outside working hours", weight: 0.8 },
  ],
};

const evidence: Scene = {
  label: "Evidence and its findings in every state",
  nodes: [
    { id: "contract", type: "asset", x: 0, y: 150, label: "supplier_contract.pdf", icon: FileText, source: "Contracts drive" },
    { id: "a1", type: "finding", parent: "contract", severity: "critical", detector: "IBAN", label: "IBAN: DE89 3704 0044" },
    { id: "a2", type: "finding", parent: "contract", severity: "high", detector: "Person name", label: "Name: Jana Novak", state: "new" },
    { id: "a3", type: "finding", parent: "contract", severity: "medium", detector: "Phone number", label: "Phone: +43 660 1234", state: "resolved" },
    { id: "a4", type: "finding", parent: "contract", severity: "low", detector: "Email address", label: "info@supplier.at", state: "dismissed" },
    { id: "a5", type: "finding", parent: "contract", severity: "high", detector: "Social security number", label: "SSN: 1237 010180", state: "gone" },
    { id: "a6", type: "finding", parent: "contract", severity: "critical", detector: "Credit card number", label: "Card: 4111 …1111", state: "deleted" },
    { id: "a7", type: "finding", parent: "contract", severity: "medium", detector: "Postal address", label: "Hauptstraße 12", attached: false },
    {
      id: "archive",
      type: "asset",
      x: 470,
      y: 0,
      label: "HR_archive_2019.zip",
      icon: Archive,
      source: "HR SharePoint",
      isNew: true,
      folded: [
        { severity: "critical", count: 2 },
        { severity: "high", count: 3 },
        { severity: "low", count: 4 },
      ],
    },
    { id: "vendors", type: "asset", x: 470, y: 160, label: "vendor_list.xlsx", icon: Table, source: "Finance share", more: 3 },
    { id: "old", type: "asset", x: 470, y: 320, label: "old_payroll.xlsx", icon: Table, source: "File share", missing: true },
  ],
};

const relations: Scene = {
  label: "Relations the platform found, and links people drew",
  nodes: [
    { id: "brief", type: "asset", x: 0, y: -190, label: "Q3 campaign brief.docx", icon: FileText, source: "Marketing drive" },
    { id: "crm", type: "asset", x: 0, y: 0, label: "crm.customers", icon: Database, source: "CRM database" },
    { id: "csv", type: "asset", x: 330, y: 0, label: "customers_export.csv", icon: File, source: "File share" },
    { id: "c1", type: "finding", parent: "csv", ...at(-45), severity: "medium", detector: "Email address", label: "anna.berger@example.com" },
    { id: "copy", type: "asset", x: 660, y: 0, label: "customers_export (1).csv", icon: File, source: "Downloads" },
    { id: "inv", type: "asset", x: 0, y: 270, label: "Invoice 0423.pdf", icon: FileText, source: "Accounts payable" },
    { id: "rev", type: "asset", x: 330, y: 270, label: "Invoice 0423 (revised).pdf", icon: FileText, source: "Accounts payable" },
    { id: "run", type: "asset", x: 660, y: 270, label: "Payment run 14 May.xlsx", icon: Table, source: "Finance share" },
  ],
  edges: [
    { type: "relation", source: "crm", target: "csv", relation: "TRANSFORM", kind: "lineage" },
    { type: "relation", source: "brief", target: "csv", relation: "REFERENCES", kind: "reference" },
    { type: "relation", source: "csv", target: "copy", relation: "identical_content", kind: "duplicate" },
    { type: "link", source: "copy", target: "run", kind: "related_to", text: "Related to", suspected: true, confidence: 0.4 },
    { type: "link", source: "inv", target: "rev", kind: "contradicts", text: "Contradicts", confidence: 0.7 },
    { type: "link", source: "rev", target: "run", kind: "precedes", text: "Precedes", confidence: 0.95, global: true },
  ],
};

const hypotheses: Scene = {
  label: "Two competing hypotheses and the evidence for and against them",
  nodes: [
    {
      id: "h1",
      type: "hypothesis",
      x: 0,
      y: 0,
      statement: "The supplier's bank details were changed by a fraudster",
      status: "SUPPORTED",
      confidence: 0.75,
      entries: 9,
      lastEntry: "last: Maria K. yesterday",
    },
    {
      id: "h2",
      type: "hypothesis",
      x: 580,
      y: 0,
      statement: "The supplier changed banks legitimately",
      status: "INCONCLUSIVE",
      confidence: 0.3,
      entries: 4,
      lastEntry: "last: Autopilot 3 hours ago",
    },
    { id: "invoice", type: "asset", x: 0, y: 330, label: "Invoice 0423.pdf", icon: FileText, source: "Accounts payable" },
    { id: "i1", type: "finding", parent: "invoice", ...at(-60), severity: "high", detector: "IBAN", label: "IBAN: DE89 3704 0044" },
    { id: "master", type: "asset", x: 350, y: 330, label: "Vendor master.xlsx", icon: Table, source: "ERP export" },
    { id: "v1", type: "finding", parent: "master", ...at(-60), severity: "medium", detector: "IBAN", label: "IBAN: AT48 3200 0000" },
    { id: "mail", type: "asset", x: 700, y: 330, label: "Change of bank details", icon: Mail, source: "Mail archive" },
    { id: "m1", type: "finding", parent: "mail", ...at(-60), severity: "medium", detector: "Email address", label: "accounts@agency-ltd.co" },
  ],
  edges: [
    { type: "stance", source: "h1", target: "i1", stance: "SUPPORTS", note: "The invoice IBAN is not the one on file", weight: 0.8 },
    { type: "stance", source: "h1", target: "m1", stance: "SUPPORTS", note: "Look-alike domain: agency-ltd.co", weight: 0.9 },
    { type: "stance", source: "h2", target: "v1", stance: "NEUTRAL", note: "The vendor master still has the old account" },
    { type: "stance", source: "h2", target: "m1", stance: "CONTRADICTS", note: "A real change would come from the known domain" },
  ],
};

const connections: Scene = {
  label: "Show connections: what is upstream, downstream and alongside one piece of evidence",
  nodes: [
    { id: "db", type: "asset", x: -480, y: 0, label: "HR database", icon: Database, source: "HR system", trace: { side: "up", depth: 2 } },
    { id: "sheet", type: "asset", x: -240, y: 0, label: "payroll_2026-03.xlsx", icon: Table, source: "HR SharePoint", trace: { side: "up", depth: 1 } },
    { id: "export", type: "asset", x: 0, y: 0, label: "payroll_export.csv", icon: File, source: "File share" },
    { id: "e1", type: "finding", parent: "export", ...at(-90), severity: "critical", detector: "IBAN", label: "IBAN: AT61 1904 3002" },
    { id: "mail", type: "asset", x: 240, y: 0, label: "Fwd: March numbers", icon: Mail, source: "Mail archive", trace: { side: "down", depth: 1 } },
    { id: "backup", type: "asset", x: -250, y: 220, label: "backup/payroll_export.csv", icon: File, source: "Backup share", trace: { side: "side", depth: 1 } },
    { id: "old", type: "asset", x: 250, y: 220, label: "payroll_export_old.csv", icon: File, source: "File share", trace: { side: "side", depth: 1 } },
  ],
  edges: [
    { type: "trace", source: "db", target: "sheet", kind: "lineage", relation: "COPY" },
    { type: "trace", source: "sheet", target: "export", kind: "lineage", relation: "TRANSFORM" },
    { type: "trace", source: "export", target: "mail", kind: "links", relation: "ATTACHED_TO" },
    { type: "trace", source: "export", target: "backup", kind: "duplicates", relation: "identical_content" },
    { type: "trace", source: "export", target: "old", kind: "similar", relation: "related" },
  ],
};

const neighbours: Scene = {
  label: "Suggested neighbours: assets connected to the evidence that are not in the case yet",
  nodes: [
    { id: "sheet", type: "asset", x: -250, y: 120, label: "payroll_2026-03.xlsx", icon: Table, source: "HR SharePoint", suggested: true },
    { id: "export", type: "asset", x: 0, y: 120, label: "payroll_export.csv", icon: File, source: "File share" },
    { id: "mail", type: "asset", x: 250, y: 120, label: "Fwd: March numbers", icon: Mail, source: "Mail archive" },
    { id: "reply", type: "asset", x: 500, y: 120, label: "Re: March numbers", icon: Mail, source: "Mail archive", suggested: true },
    { id: "backup", type: "asset", x: 125, y: -110, label: "backup/payroll_export.csv", icon: File, source: "Backup share", suggested: true },
  ],
  edges: [
    { type: "relation", source: "sheet", target: "export", relation: "TRANSFORM", kind: "lineage" },
    { type: "relation", source: "export", target: "mail", relation: "ATTACHED_TO", kind: "reference" },
    { type: "relation", source: "reply", target: "mail", relation: "REFERENCES", kind: "reference" },
    { type: "relation", source: "export", target: "backup", relation: "identical_content", kind: "duplicate" },
  ],
};

const organise: Scene = {
  label: "A frame grouping the events of one day, sticky notes, and a highlighted piece of evidence",
  nodes: [
    { id: "day", type: "frame", x: 0, y: 0, width: 860, height: 230, tint: "blue", title: "12 March: what happened" },
    { id: "export", type: "asset", parent: "day", x: 40, y: 90, label: "payroll_export.csv", icon: File, source: "File share", highlight: "yellow" },
    { id: "fwd", type: "asset", parent: "day", x: 342, y: 90, label: "Fwd: March numbers", icon: Mail, source: "Mail archive" },
    { id: "reply", type: "asset", parent: "day", x: 644, y: 90, label: "Re: March numbers", icon: Mail, source: "Mail archive" },
    {
      id: "questions",
      type: "note",
      x: 0,
      y: 270,
      width: 270,
      height: 124,
      color: "yellow",
      text: "Open questions:\n· Who owns the export job?\n· Was the private mailbox reported?",
    },
    { id: "it", type: "note", x: 310, y: 270, width: 250, height: 96, color: "green", text: "Confirmed by IT on 14 March: the export job runs every night." },
    { id: "legal", type: "note", x: 600, y: 270, width: 230, height: 84, color: "pink", text: "Legal hold requested. Do not delete anything here." },
    { id: "background", type: "frame", x: 560, y: 390, width: 300, height: 200, tint: "gray", title: "Background", collapsed: 5 },
  ],
  edges: [
    { type: "link", source: "export", target: "fwd", kind: "precedes", text: "Precedes", confidence: 0.9 },
    { type: "link", source: "fwd", target: "reply", kind: "precedes", text: "Precedes", confidence: 0.9 },
  ],
};

const zoomLevels: Scene = {
  label: "The same corner of a board at three zoom levels",
  nodes: [
    { id: "export", type: "asset", x: 0, y: 60, label: "payroll_export.csv", icon: File, source: "File share" },
    { id: "e1", type: "finding", parent: "export", ...at(-30), severity: "critical", detector: "IBAN", label: "IBAN: AT61 1904 3002" },
    { id: "e2", type: "finding", parent: "export", ...at(30), severity: "high", detector: "Salary figures", label: "Salary: 5 820 €" },
    {
      id: "h1",
      type: "hypothesis",
      x: 360,
      y: 0,
      statement: "Payroll data was forwarded to a private mailbox",
      status: "SUPPORTED",
      confidence: 0.8,
      entries: 6,
      lastEntry: "last: Maria K. 2 hours ago",
    },
  ],
  edges: [{ type: "stance", source: "h1", target: "e1", stance: "SUPPORTS" }],
};

const spotlight: Scene = {
  ...overview,
  label: "The findings spotlight: every finding in the case lit, everything else faded",
  dim: overview.nodes.filter((n: DemoNode) => n.type !== "finding" && n.type !== "frame").map((n) => n.id),
};

export const SCENES = {
  overview,
  evidence,
  relations,
  hypotheses,
  connections,
  neighbours,
  organise,
  zoomLevels,
  spotlight,
} satisfies Record<string, Scene>;

export type SceneName = keyof typeof SCENES;
