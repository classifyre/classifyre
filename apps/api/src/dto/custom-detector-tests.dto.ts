import { z } from 'zod/v4';

// ── Expected outcome shapes per method ──────────────────────────────────────

export const rulesetExpectedOutcomeSchema = z.object({
  shouldMatch: z.boolean(),
});

export const classifierExpectedOutcomeSchema = z.object({
  label: z.string().min(1),
  minConfidence: z.number().min(0).max(1).optional(),
});

export const entityExpectedOutcomeSchema = z.object({
  entities: z
    .array(
      z.object({
        label: z.string().min(1),
        text: z.string().optional(), // if provided, must be found in extraction
      }),
    )
    .min(1),
});

export const expectedOutcomeSchema = z.union([
  rulesetExpectedOutcomeSchema,
  classifierExpectedOutcomeSchema,
  entityExpectedOutcomeSchema,
]);

// ── Request DTOs ─────────────────────────────────────────────────────────────

export const createTestScenarioSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  inputText: z.string().min(1).max(50000),
  expectedOutcome: z.record(z.string(), z.unknown()),
});

export type CreateTestScenarioDto = z.infer<typeof createTestScenarioSchema>;

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
