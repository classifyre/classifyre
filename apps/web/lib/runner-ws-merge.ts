import type {
  LatestRunnerSummaryDto,
  RunnerDto,
  SearchSourceItemDto,
  SearchRunnersFiltersInputDto,
} from "@workspace/api-client";
import { RunnerDtoFromJSON } from "@workspace/api-client";

export function parseRunnerSocketPayload(raw: unknown): RunnerDto {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(
      `Expected runner payload object, got ${raw === null ? "null" : typeof raw}`,
    );
  }
  return RunnerDtoFromJSON(raw as object);
}

export function runnerDtoToLatestSummary(runner: RunnerDto): LatestRunnerSummaryDto {
  return {
    id: runner.id,
    status: runner.status,
    startedAt: runner.startedAt,
    completedAt: runner.completedAt,
    durationMs: runner.durationMs,
    assetsCreated: runner.assetsCreated,
    assetsUpdated: runner.assetsUpdated,
    assetsUnchanged: runner.assetsUnchanged,
    assetsDeleted: runner.assetsDeleted,
    totalFindings: runner.totalFindings,
    errorMessage: runner.errorMessage,
    triggeredAt: runner.triggeredAt,
  };
}

/** Applies a runner event to a source row when it represents that source's latest run. */
export function mergeRunnerIntoSearchSourceItem(
  source: SearchSourceItemDto,
  runner: RunnerDto,
): SearchSourceItemDto | null {
  if (source.id !== runner.sourceId) return null;

  const prev = source.latestRunner;
  const nextTs = new Date(runner.triggeredAt).getTime();
  const prevTs = prev ? new Date(prev.triggeredAt).getTime() : 0;

  const sameRun = prev?.id === runner.id;
  const replacesLatest = !prev || sameRun || nextTs >= prevTs;
  if (!replacesLatest) return null;

  return {
    ...source,
    runnerStatus: runner.status,
    latestRunner: runnerDtoToLatestSummary(runner),
  };
}

export function mergeRunnerWsIntoRow(prev: RunnerDto, next: RunnerDto): RunnerDto {
  return {
    ...prev,
    ...next,
    recipe: next.recipe ?? prev.recipe,
    detectors: next.detectors ?? prev.detectors,
    source: next.source ?? prev.source,
  };
}

export function runnerMatchesRunnersListFilters(
  runner: RunnerDto,
  filters: SearchRunnersFiltersInputDto | undefined,
): boolean {
  if (!filters) return true;
  if (filters.status?.length) {
    const st = runner.status as (typeof filters.status)[number];
    if (!filters.status.includes(st)) return false;
  }
  if (filters.sourceId?.length && !filters.sourceId.includes(runner.sourceId)) {
    return false;
  }
  if (filters.triggerType?.length) {
    const tt = runner.triggerType as (typeof filters.triggerType)[number];
    if (!filters.triggerType.includes(tt)) return false;
  }
  if (filters.search?.trim()) {
    const q = filters.search.trim().toLowerCase();
    const name = runner.source?.name?.toLowerCase() ?? "";
    if (!name.includes(q)) return false;
  }
  return true;
}
