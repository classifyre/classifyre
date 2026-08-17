import { ApiProperty } from '@nestjs/swagger';

export const INSTANCE_LANGUAGE_VALUES = [
  'AUTOMATIC',
  'ENGLISH',
  'GERMAN',
] as const;
export type InstanceLanguageValue = (typeof INSTANCE_LANGUAGE_VALUES)[number];

export const INSTANCE_TIME_FORMAT_VALUES = [
  'AUTOMATIC',
  'TWELVE_HOUR',
  'TWENTY_FOUR_HOUR',
] as const;
export type InstanceTimeFormatValue =
  (typeof INSTANCE_TIME_FORMAT_VALUES)[number];

/**
 * Upper bound for the per-workspace scan concurrency setting.
 *
 * Not a capability limit — the runner would happily start more — but a guard
 * against a value that only makes the machine slower. Scans spawn the Python
 * CLI with its own detector process pool sized to half the cores, so past a
 * handful of concurrent scans they contend for the same CPUs and the whole
 * workspace gets less done, not more.
 */
export const MAX_CONCURRENT_RUNNERS_LIMIT = 16;

export class InstanceSettingsResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({
    description: 'When false, the MCP endpoint is disabled instance-wide.',
    example: true,
  })
  mcpEnabled: boolean;

  @ApiProperty({ enum: INSTANCE_LANGUAGE_VALUES, example: 'ENGLISH' })
  language: InstanceLanguageValue;

  @ApiProperty({
    description:
      'Default IANA timezone used for date/time rendering. Use "AUTOMATIC" to detect from browser.',
    example: 'AUTOMATIC',
  })
  timezone: string;

  @ApiProperty({
    enum: INSTANCE_TIME_FORMAT_VALUES,
    example: 'TWELVE_HOUR',
  })
  timeFormat: InstanceTimeFormatValue;

  @ApiProperty({
    description:
      'Id of the AI provider credential used by the interactive AI assistant. Assigning a provider enables the Assistant; null disables it.',
    nullable: true,
  })
  aiProviderConfigId: string | null;

  @ApiProperty({
    description:
      'Id of the AI provider credential used by the autonomous AI harness. Assigning a provider enables the Harness; null disables it.',
    nullable: true,
  })
  harnessAiProviderConfigId: string | null;

  @ApiProperty({
    description:
      'When true, the autopilot inquiry agent manages inquiries automatically after scans.',
    example: true,
  })
  autopilotInquiryEnabled: boolean;

  @ApiProperty({
    description:
      'When true, the autopilot case agent manages investigation cases automatically after scans.',
    example: true,
  })
  autopilotCaseEnabled: boolean;

  @ApiProperty({
    description:
      'When true, the config-tuning agent may change editable source config.',
    example: true,
  })
  autopilotConfigEnabled: boolean;

  @ApiProperty({
    description:
      'When true, the detector-authoring agent may create/train detectors.',
    example: true,
  })
  autopilotDetectorEnabled: boolean;

  @ApiProperty({
    description:
      'When true, the escalation agent may raise operator notifications for high-severity cases.',
    example: true,
  })
  autopilotEscalationEnabled: boolean;

  @ApiProperty({
    description:
      'When true, the harness may call tools from connected external MCP servers.',
    example: true,
  })
  autopilotMcpEnabled: boolean;

  @ApiProperty({
    description:
      'How long one agent run may take before it is stopped. A run holds a namespace job slot, so a wedged one stalls every queue behind it.',
    example: 20,
  })
  harnessRunBudgetMinutes: number;

  @ApiProperty({
    description:
      'When a run still marked RUNNING is presumed dead and reaped. Must exceed the run budget: past this, a run is not slow, it is gone.',
    example: 60,
  })
  harnessRunStaleAfterMinutes: number;

  @ApiProperty({
    description:
      'Wall-clock budget for one cycle. Checked before each agent starts, so a chain can overshoot by at most one run budget.',
    example: 30,
  })
  harnessCycleBudgetMinutes: number;

  @ApiProperty({
    description:
      'Scored findings above which the evidence gate opens regardless of coverage. The absolute floor is the honest test; the ratio below is the fallback for small corpora.',
    example: 2000,
  })
  harnessEvidenceUsableFindings: number;

  @ApiProperty({
    description:
      'Fraction of open findings that must be scored for the evidence gate to open, when the absolute floor is not met.',
    example: 0.25,
  })
  harnessEvidenceUsableCoverage: number;

  @ApiProperty({
    description:
      'Below this coverage the agents are told their triage order is partial. Shapes the prompt; does not block a run.',
    example: 0.8,
  })
  harnessEvidenceWarnCoverage: number;

  @ApiProperty({
    description:
      'Importance at or above which a single new finding earns an immediate cycle instead of waiting for the batch.',
    example: 0.75,
  })
  harnessExpressImportance: number;

  @ApiProperty({
    description: 'Character cap on one tool result before it is truncated.',
    example: 8000,
  })
  harnessObservationChars: number;

  @ApiProperty({
    description:
      'Character cap on all tool results in one turn. The transcript is resent every iteration, so this bounds the quadratic growth.',
    example: 24000,
  })
  harnessTurnObservationChars: number;

  @ApiProperty({
    description: 'How many ranked findings a run may see at once.',
    example: 25,
  })
  harnessMaxRankedFindings: number;

  @ApiProperty({
    description: 'How many glossary entries are injected into each run.',
    example: 20,
  })
  harnessMaxGlossaryEntries: number;

  @ApiProperty({
    description: 'How many recalled memories are injected into each run.',
    example: 30,
  })
  harnessMaxRecalledMemories: number;

  @ApiProperty({
    description: 'How often the memory-consolidation agent runs, in days.',
    example: 2,
  })
  harnessDreamIntervalDays: number;

  @ApiProperty({
    description:
      'Master switch for adaptive ("automatic") source scheduling. When false, ' +
      'no AUTO source is started; each source keeps its phase, so turning this ' +
      'back on resumes exactly where it left off.',
    example: true,
  })
  autoScheduleEnabled: boolean;

  @ApiProperty({
    description:
      'How many scans this workspace may run at once. 0 means unlimited.',
    example: 2,
  })
  maxConcurrentRunners: number;

  @ApiProperty({
    description:
      'Read-only. When true, the instance runs in demo mode and all mutating operations are rejected.',
    example: false,
  })
  demoMode: boolean;

  @ApiProperty({
    description:
      'Read-only. Whether a user-configured Hugging Face token is stored (encrypted at rest).',
    example: false,
  })
  hfTokenSet: boolean;

  @ApiProperty({
    description:
      'Read-only. Whether an instance-level HF_TOKEN is configured via Kubernetes Secret. ' +
      'When true, the instance token takes priority over any user-configured token.',
    example: false,
  })
  hfTokenInstanceSet: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
