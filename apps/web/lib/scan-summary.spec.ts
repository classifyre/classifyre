import { scanSummary } from "./scan-summary";

describe("scanSummary", () => {
  it("adds up the live tables a query read", () => {
    expect(
      scanSummary([
        {
          table: "lab.indexes.movies",
          requests: 1,
          rows: 632,
          pushed: ["genre = 'Drama'", "year >= 2015"],
        },
        { table: "lab.nodes.person", requests: 1, rows: 50, pushed: [] },
      ]),
    ).toEqual({
      tables: 2,
      requests: 2,
      rows: 682,
      details: [
        {
          table: "lab.indexes.movies",
          requests: 1,
          rows: 632,
          pushed: "genre = 'Drama', year >= 2015",
        },
        { table: "lab.nodes.person", requests: 1, rows: 50, pushed: "" },
      ],
    });
  });

  it("says nothing for a query without live tables", () => {
    expect(scanSummary([])).toBeNull();
    expect(scanSummary(undefined)).toBeNull();
  });
});
