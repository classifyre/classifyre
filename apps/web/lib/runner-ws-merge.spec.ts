import { parseRunnerSocketPayload, runnerMatchesRunnersListFilters, mergeRunnerIntoSearchSourceItem } from "./runner-ws-merge";
import type { RunnerDto, SearchSourceItemDto } from "@workspace/api-client";

// ---------------------------------------------------------------------------
// parseRunnerSocketPayload — null / type guard
// ---------------------------------------------------------------------------

describe("parseRunnerSocketPayload", () => {
  it("throws TypeError when payload is null", () => {
    expect(() => parseRunnerSocketPayload(null)).toThrow(TypeError);
  });

  it("throws TypeError when payload is undefined", () => {
    expect(() => parseRunnerSocketPayload(undefined)).toThrow(TypeError);
  });

  it("throws TypeError when payload is a string", () => {
    expect(() => parseRunnerSocketPayload("runner-id")).toThrow(TypeError);
  });

  it("throws TypeError when payload is a number", () => {
    expect(() => parseRunnerSocketPayload(42)).toThrow(TypeError);
  });

  it("throws TypeError when payload is an array", () => {
    expect(() => parseRunnerSocketPayload([])).toThrow(TypeError);
  });

  it("does not throw for a plain object", () => {
    expect(() =>
      parseRunnerSocketPayload({
        id: "r-1",
        sourceId: "s-1",
        status: "COMPLETED",
        triggerType: "MANUAL",
        triggeredAt: new Date().toISOString(),
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// runnerMatchesRunnersListFilters
// ---------------------------------------------------------------------------

function makeRunner(overrides: Partial<RunnerDto> = {}): RunnerDto {
  return {
    id: "r-1",
    sourceId: "s-1",
    status: "COMPLETED" as RunnerDto["status"],
    triggerType: "MANUAL" as RunnerDto["triggerType"],
    triggeredAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    durationMs: null,
    assetsCreated: 0,
    assetsUpdated: 0,
    assetsUnchanged: 0,
    assetsDeleted: 0,
    totalFindings: 0,
    errorMessage: null,
    recipe: null,
    detectors: null,
    source: null,
    ...overrides,
  } as unknown as RunnerDto;
}

describe("runnerMatchesRunnersListFilters", () => {
  it("returns true with no filters", () => {
    expect(runnerMatchesRunnersListFilters(makeRunner(), undefined)).toBe(true);
  });

  it("filters by status", () => {
    const runner = makeRunner({ status: "RUNNING" as RunnerDto["status"] });
    expect(runnerMatchesRunnersListFilters(runner, { status: ["RUNNING" as never] })).toBe(true);
    expect(runnerMatchesRunnersListFilters(runner, { status: ["COMPLETED" as never] })).toBe(false);
  });

  it("filters by sourceId", () => {
    const runner = makeRunner({ sourceId: "s-42" });
    expect(runnerMatchesRunnersListFilters(runner, { sourceId: ["s-42"] })).toBe(true);
    expect(runnerMatchesRunnersListFilters(runner, { sourceId: ["s-99"] })).toBe(false);
  });

  it("filters by search matches source name case-insensitively", () => {
    const runner = makeRunner({ source: { name: "My Confluence" } as never });
    expect(runnerMatchesRunnersListFilters(runner, { search: "confluence" })).toBe(true);
    expect(runnerMatchesRunnersListFilters(runner, { search: "CONFLUENCE" })).toBe(true);
    expect(runnerMatchesRunnersListFilters(runner, { search: "jira" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeRunnerIntoSearchSourceItem
// ---------------------------------------------------------------------------

function makeSource(overrides: Partial<SearchSourceItemDto> = {}): SearchSourceItemDto {
  return {
    id: "s-1",
    name: "My Source",
    type: "CONFLUENCE",
    runnerStatus: null,
    latestRunner: null,
    ...overrides,
  } as unknown as SearchSourceItemDto;
}

describe("mergeRunnerIntoSearchSourceItem", () => {
  it("returns null when sourceId does not match", () => {
    const source = makeSource({ id: "s-1" });
    const runner = makeRunner({ sourceId: "s-2" });
    expect(mergeRunnerIntoSearchSourceItem(source, runner)).toBeNull();
  });

  it("merges when there is no previous runner", () => {
    const source = makeSource({ id: "s-1", latestRunner: null });
    const runner = makeRunner({ sourceId: "s-1", status: "RUNNING" as RunnerDto["status"] });
    const result = mergeRunnerIntoSearchSourceItem(source, runner);
    expect(result).not.toBeNull();
    expect(result!.runnerStatus).toBe("RUNNING");
  });

  it("replaces an older run with a newer one", () => {
    const older = { id: "r-old", triggeredAt: "2024-01-01T00:00:00Z" } as never;
    const source = makeSource({ id: "s-1", latestRunner: older });
    const runner = makeRunner({
      id: "r-new",
      sourceId: "s-1",
      triggeredAt: "2024-06-01T00:00:00Z" as never,
      status: "COMPLETED" as RunnerDto["status"],
    });
    const result = mergeRunnerIntoSearchSourceItem(source, runner);
    expect(result!.latestRunner!.id).toBe("r-new");
  });

  it("does not replace a newer run with an older one", () => {
    const newer = { id: "r-new", triggeredAt: "2024-06-01T00:00:00Z" } as never;
    const source = makeSource({ id: "s-1", latestRunner: newer });
    const runner = makeRunner({
      id: "r-old",
      sourceId: "s-1",
      triggeredAt: "2024-01-01T00:00:00Z" as never,
    });
    const result = mergeRunnerIntoSearchSourceItem(source, runner);
    expect(result).toBeNull();
  });
});
