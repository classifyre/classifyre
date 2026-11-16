import { describeFilter, parseValues, valuesText } from "./row-filters";

const words = {
  in: "is one of",
  not_in: "is none of",
  and: " and ",
  or: "; or ",
  none: "no rows",
};

describe("row filters", () => {
  it("turns a typed line into values and back", () => {
    expect(parseValues(" Tirol, Salzburg ,, Tirol")).toEqual([
      "Tirol",
      "Salzburg",
    ]);
    expect(valuesText(["Tirol", 3, true])).toBe("Tirol, 3, true");
  });

  it("says what a filter selects", () => {
    expect(
      describeFilter(
        [
          [
            { column: "region", op: "in", values: ["Tirol"] },
            { column: "year", op: "not_in", values: [2020] },
          ],
          [{ column: "public", op: "in", values: [true] }],
        ],
        words,
      ),
    ).toBe(
      "region is one of Tirol and year is none of 2020; or public is one of true",
    );
    expect(describeFilter([], words)).toBe("no rows");
  });
});
