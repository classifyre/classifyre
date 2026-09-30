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

/**
 * A whole asset for a code detector (CUSTOM_DETECTOR) to judge: what
 * `asset.name`, `asset.kind`, `asset.metadata`, `asset.text()`, `asset.pages()`
 * and `asset.rows()` return. Strict, so a typo is a 400 rather than a key the
 * rule silently never sees.
 */
export const assetFixtureSchema = z.strictObject({
  name: z.string().min(1).max(500),
  kind: z.string().max(64).optional(),
  mime_type: z.string().max(200).optional(),
  url: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  text: z.string().max(1_000_000).optional(),
  pages: z.array(z.string()).max(200).optional(),
  rows: z.array(z.record(z.string(), z.unknown())).max(10_000).optional(),
});

export type AssetFixture = z.infer<typeof assetFixtureSchema>;

export const createTestScenarioSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    inputText: z.string().min(1).max(50000).optional(),
    inputAsset: assetFixtureSchema.optional(),
    expectedOutcome: z.record(z.string(), z.unknown()),
  })
  .refine((dto) => Boolean(dto.inputText) || Boolean(dto.inputAsset), {
    message: 'Provide inputText, or inputAsset for a code detector',
    path: ['inputText'],
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
  inputAsset?: AssetFixture | null;
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
