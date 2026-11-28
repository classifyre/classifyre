import { parseImportedSpecJson } from "./export-diagram";

function makeTable(index: number) {
  return {
    id: `tbl_${index}`,
    assetId: `asset_${index}`,
    sqlName: `shop.public.table_${index}`,
    alias: `t${index}`,
    x: (index % 5) * 300,
    y: Math.floor(index / 5) * 260,
    keep: ["id"],
    filters: [],
  };
}

describe("parseImportedSpecJson", () => {
  it("accepts exported Data Query specs with 17 to 40 tables and defaults groups to []", () => {
    const tables = Array.from({ length: 24 }, (_, idx) => makeTable(idx + 1));
    const rawEnvelope = JSON.stringify({
      version: 1,
      spec: {
        tables,
        joins: [],
        pins: [],
      },
    });

    const parsed = parseImportedSpecJson(rawEnvelope);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.spec.tables).toHaveLength(24);
    expect(parsed.spec.groups).toEqual([]);
  });

  it("rejects specs with unknown keys or exceeding maxTables", () => {
    const unknownKey = parseImportedSpecJson(
      JSON.stringify({ tables: [], joins: [], pins: [], extra: true }),
    );
    expect(unknownKey.ok).toBe(false);

    const tooMany = parseImportedSpecJson(
      JSON.stringify({
        tables: Array.from({ length: 41 }, (_, idx) => makeTable(idx + 1)),
        joins: [],
        pins: [],
      }),
    );
    expect(tooMany.ok).toBe(false);
  });
});
