import { z } from 'zod/v4';

// ── Expected outcome shape — unified pipeline output ─────────────────────────
//
// The expected outcome mirrors the standard pipeline result format so that
// test comparators can do field-by-field matching without knowing the detector
// type.  Both `entities` and `classification` are optional: a scenario may
// assert only entities, only classification, or both.

export const entityMatchSchema = z.object({
  value: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const expectedOutcomeSchema = z.object({
  entities: z.record(z.string(), z.array(entityMatchSchema)).optional(),
  classification: z
    .record(
      z.string(),
      z.object({
        label: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .optional(),
});

// ── Request DTOs ─────────────────────────────────────────────────────────────

export const createTestScenarioSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  inputText: z.string().min(1).max(50000),
  expectedOutcome: z.record(z.string(), z.unknown()),
});

export type CreateTestScenarioDto = z.infer<typeof createTestScenarioSchema>;
export type ExpectedOutcomeDto = z.infer<typeof expectedOutcomeSchema>;

// ── Response DTOs ─────────────────────────────────────────────────────────────

export type TestResultStatus = 'PASS' | 'FAIL' | 'ERROR';
export type TestTrigger = 'MANUAL' | 'CI' | 'ASSISTANT';

export interface TestResultDto {
  id: string;
  scenarioId: string;
  status: TestResultStatus;
  actualOutput: Record<string, unknown>;
  errorMessage?: string | null;
  durationMs?: number | null;
  detectorVersion: number;
  triggeredBy: TestTrigger;
  createdAt: string;
}

export interface TestScenarioDto {
  id: string;
  detectorId: string;
  name: string;
  description?: string | null;
  inputText: string;
  expectedOutcome: Record<string, unknown>;
  lastResult?: TestResultDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunTestsResponseDto {
  detectorId: string;
  triggeredBy: TestTrigger;
  results: Array<{
    scenario: TestScenarioDto;
    result: TestResultDto;
  }>;
  summary: {
    total: number;
    passed: number;
    failed: number;
    errored: number;
  };
}
