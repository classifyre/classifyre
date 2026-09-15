import { splitRunnerErrorDetails } from "./runner-degradation";

describe("splitRunnerErrorDetails", () => {
  it("separates disabled detectors from any other error details", () => {
    const result = splitRunnerErrorDetails({
      detectorsDegraded: [
        {
          detector: "fb_solvency_outlook",
          cause: "provider_refused",
          reason: "quota exhausted",
          assetsSkipped: 450,
        },
      ],
      exitCode: 1,
    });

    expect(result.degraded).toEqual([
      {
        detector: "fb_solvency_outlook",
        cause: "provider_refused",
        reason: "quota exhausted",
        assetsSkipped: 450,
      },
    ]);
    expect(result.rest).toEqual({ exitCode: 1 });
  });

  it("returns no leftover details when degradation is all there is", () => {
    expect(
      splitRunnerErrorDetails({
        detectorsDegraded: [{ detector: "PII", cause: "consecutive_failures" }],
      }).rest,
    ).toBeNull();
  });

  it("ignores malformed entries rather than rendering them", () => {
    expect(
      splitRunnerErrorDetails({
        detectorsDegraded: [null, "x", { cause: "provider_refused" }],
      }).degraded,
    ).toEqual([]);
  });

  it("passes non-object details through untouched", () => {
    expect(splitRunnerErrorDetails(null)).toEqual({ degraded: [], rest: null });
    expect(splitRunnerErrorDetails("boom")).toEqual({ degraded: [], rest: null });
  });
});
