import { ApiProperty } from '@nestjs/swagger';

export const PROBE_TIER_VALUES = [
  'PROTOCOL',
  'TOOL_USE',
  'CHAINING',
  'JUDGMENT',
  'CAPACITY',
] as const;

export const PROBE_STATUS_VALUES = [
  'PASS',
  'FAIL',
  'SKIPPED',
  'ERROR',
] as const;

export const AGENT_READINESS_VALUES = [
  'READY',
  'DEGRADED',
  'WILL_FAIL',
  'UNKNOWN',
] as const;

export const CAPABILITY_VERDICT_VALUES = [
  'READY',
  'DEGRADED',
  'UNUSABLE',
] as const;

export class CapabilityProbeResultDto {
  @ApiProperty({
    description: 'Stable probe identifier.',
    example: 'chain.two_step',
  })
  id: string;

  @ApiProperty({ enum: PROBE_TIER_VALUES, example: 'CHAINING' })
  tier: (typeof PROBE_TIER_VALUES)[number];

  @ApiProperty({
    example: 'Carries an id from an observation into the next call',
  })
  title: string;

  @ApiProperty({
    description: 'Which harness requirement this probe stands in for.',
  })
  whatItProves: string;

  @ApiProperty({ enum: PROBE_STATUS_VALUES, example: 'PASS' })
  status: (typeof PROBE_STATUS_VALUES)[number];

  @ApiProperty({
    description: 'The grader’s explanation — always populated, pass or fail.',
  })
  reason: string;

  @ApiProperty({
    description:
      'Final user-turn text sent to the model. Null for probes with no LLM call.',
    nullable: true,
  })
  prompt: string | null;

  @ApiProperty({
    description: 'Verbatim model output, so the grade can be audited.',
    nullable: true,
  })
  rawOutput: string | null;

  @ApiProperty({ example: 1840 })
  latencyMs: number;

  @ApiProperty({ nullable: true, example: 2310 })
  inputTokens: number | null;

  @ApiProperty({ nullable: true, example: 96 })
  outputTokens: number | null;
}

export class AgentCapacityReportDto {
  @ApiProperty({ example: 'DETECTOR_AUTHOR' })
  kind: string;

  @ApiProperty({ enum: AGENT_READINESS_VALUES, example: 'READY' })
  readiness: (typeof AGENT_READINESS_VALUES)[number];

  @ApiProperty({ description: 'Operator-facing explanation of the verdict.' })
  reason: string;

  @ApiProperty({ example: 16 })
  maxIterations: number;

  @ApiProperty({
    description: 'Tools this agent may call, including scoped MCP tools.',
  })
  toolCount: number;

  @ApiProperty({
    description: 'Estimated tokens in the rendered system prompt.',
  })
  systemPromptTokens: number;

  @ApiProperty({ description: 'Estimated tokens at the final iteration.' })
  projectedPeakTokens: number;

  @ApiProperty({ nullable: true, description: 'Configured context window.' })
  contextSize: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Fraction of the window still free at peak (0–1).',
  })
  headroomPct: number | null;
}

export class CapabilityCostProjectionDto {
  @ApiProperty({ nullable: true })
  avgInputTokensPerTurn: number | null;

  @ApiProperty({ nullable: true })
  avgOutputTokensPerTurn: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Projected USD for one full run of the heaviest agent.',
  })
  estimatedCostPerRunUsd: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Agent the projection is based on.',
  })
  basedOnAgent: string | null;
}

export class AssistantCapabilityReportDto {
  @ApiProperty()
  configId: string;

  @ApiProperty()
  configName: string;

  @ApiProperty({ example: 'CLAUDE' })
  provider: string;

  @ApiProperty({ example: 'claude-sonnet-4-5' })
  model: string;

  @ApiProperty({ enum: CAPABILITY_VERDICT_VALUES, example: 'READY' })
  verdict: (typeof CAPABILITY_VERDICT_VALUES)[number];

  @ApiProperty({ description: 'Plain-language summary of the verdict.' })
  headline: string;

  @ApiProperty({
    description:
      'True when the turn-contract probes failed and later tiers were skipped.',
  })
  abortedEarly: boolean;

  @ApiProperty({ type: [CapabilityProbeResultDto] })
  probes: CapabilityProbeResultDto[];

  @ApiProperty({ type: [AgentCapacityReportDto] })
  agents: AgentCapacityReportDto[];

  @ApiProperty({ type: CapabilityCostProjectionDto })
  cost: CapabilityCostProjectionDto;

  @ApiProperty()
  totalInputTokens: number;

  @ApiProperty()
  totalOutputTokens: number;

  @ApiProperty()
  totalDurationMs: number;

  @ApiProperty({ example: '2026-07-28T10:15:00.000Z' })
  ranAt: string;

  @ApiProperty({
    type: [String],
    description:
      'Assumptions the capacity arithmetic rests on, surfaced so the numbers can be argued with.',
  })
  assumptions: string[];
}
