import { visibleNav } from "./nav-access";

const groups = [
  {
    labelKey: "intelligence",
    items: [
      { titleKey: "dashboard", capability: "finding.view" },
      { titleKey: "assets", capability: "asset.view" },
      { titleKey: "query" },
    ],
  },
  {
    labelKey: "casework",
    items: [{ titleKey: "findings", capability: "finding.view" }],
  },
];

/**
 * A Data consumer (an agency given one shared dataset) was offered Assets,
 * Findings, Sources and Scans, each of which answered with a raw 403
 * (Kestrel & Finch battle test, 2026-11-23).
 */
describe("sidebar entries by capability", () => {
  it("shows everything until /me has answered (no flash for most people)", () => {
    expect(visibleNav(groups, null)).toEqual(groups);
  });

  it("keeps only what the person may open, and drops empty groups", () => {
    expect(visibleNav(groups, ["workspace.view"])).toEqual([
      { labelKey: "intelligence", items: [{ titleKey: "query" }] },
    ]);
  });

  it("keeps an entry the person holds the capability for", () => {
    const seen = visibleNav(groups, ["finding.view"]);
    expect(seen.map((g) => g.items.map((i) => i.titleKey))).toEqual([
      ["dashboard", "query"],
      ["findings"],
    ]);
  });
});
