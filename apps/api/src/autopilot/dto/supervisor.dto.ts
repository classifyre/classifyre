import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AgentMemoryOrigin,
  SupervisorGoalKind,
  SupervisorGoalStatus,
} from '@prisma/client';

export class SupervisorBudgetDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Spent today. Null when the provider has no pricing configured, which is not the same as free.',
  })
  spentTodayUsd!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  limitUsd!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  remainingUsd!: number | null;

  @ApiProperty()
  exhausted!: boolean;

  @ApiProperty()
  wakesToday!: number;

  @ApiProperty()
  purgesToday!: number;

  @ApiProperty()
  purgeBudgetPerDay!: number;
}

export class SupervisorStateDto {
  @ApiProperty({ description: 'InstanceSettings.supervisorEnabled.' })
  enabled!: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  nextWakeAt!: Date | null;

  @ApiProperty({ type: [String] })
  wakeOnEvents!: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  wakeReason!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastWakeAt!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  pausedUntil!: Date | null;

  @ApiProperty({
    description:
      'Wakes in a row that changed nothing. A few are healthy; a run of them means the pacing or the goals are wrong.',
  })
  consecutiveNoops!: number;

  @ApiProperty({ description: 'Inbox events not yet read by a wake.' })
  pendingEvents!: number;

  @ApiProperty({ description: 'Active goals and tasks, charter excluded.' })
  activeGoals!: number;

  @ApiProperty({ type: SupervisorBudgetDto })
  budget!: SupervisorBudgetDto;

  @ApiProperty({
    description:
      'False when no AI provider is assigned to the harness — nothing runs without one.',
  })
  providerConfigured!: boolean;
}

export class UpdateSupervisorDto {
  @ApiPropertyOptional()
  enabled?: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Pause without switching off. Null clears the pause.',
  })
  pausedUntil?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  dailyCostLimitUsd?: number | null;

  @ApiPropertyOptional()
  maxSleepHours?: number;

  @ApiPropertyOptional()
  purgeBudgetPerDay?: number;

  @ApiPropertyOptional()
  undoRetentionDays?: number;
}

export class SupervisorGoalDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: SupervisorGoalKind }) kind!: SupervisorGoalKind;
  @ApiProperty({ enum: SupervisorGoalStatus }) status!: SupervisorGoalStatus;
  @ApiProperty({
    enum: AgentMemoryOrigin,
    description:
      'OPERATOR goals are authoritative: the agent may record progress on one but never rewrite it.',
  })
  origin!: AgentMemoryOrigin;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) body!: string | null;
  @ApiProperty() priority!: number;
  @ApiPropertyOptional({ type: String, nullable: true })
  parentId!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dueAt!: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  progress!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class SupervisorGoalListDto {
  @ApiProperty({ type: [SupervisorGoalDto] })
  goals!: SupervisorGoalDto[];
}

export class CreateSupervisorGoalDto {
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) body?: string | null;
  @ApiPropertyOptional({ enum: SupervisorGoalKind }) kind?: SupervisorGoalKind;
  @ApiPropertyOptional() priority?: number;
  @ApiPropertyOptional({ type: String, nullable: true })
  parentId?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dueAt?: string | null;
}

export class UpdateSupervisorGoalDto {
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) body?: string | null;
  @ApiPropertyOptional({ enum: SupervisorGoalStatus })
  status?: SupervisorGoalStatus;
  @ApiPropertyOptional() priority?: number;
  @ApiPropertyOptional({ type: String, nullable: true })
  progress?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dueAt?: string | null;
}

export class SupervisorJournalEntryDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) runId!: string | null;
  @ApiProperty() wakeReason!: string;
  @ApiProperty({ description: 'What it found.' }) situation!: string;
  @ApiProperty({ description: 'What it changed, and why.' }) did!: string;
  @ApiProperty({ description: 'The concrete next step it left itself.' })
  next!: string;
  @ApiProperty({ type: [String] }) goalIds!: string[];
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  nextWakeAt!: Date | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  costUsd!: number | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'An operator correction. Read back on the next wake and treated as authoritative over what the agent wrote.',
  })
  operatorNote!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class SupervisorJournalListDto {
  @ApiProperty({ type: [SupervisorJournalEntryDto] })
  entries!: SupervisorJournalEntryDto[];
}

export class AnnotateJournalDto {
  @ApiProperty({
    description: 'What the agent got wrong, or should do instead.',
  })
  note!: string;
}

export class WakeSupervisorDto {
  @ApiPropertyOptional({
    description: 'Steering for this wake only. Not stored as a goal.',
  })
  instruction?: string;
}

export class SupervisorCapabilityDto {
  @ApiProperty() id!: string;
  @ApiProperty() labelKey!: string;
  @ApiProperty() description!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ description: 'Cannot be switched off.' }) alwaysOn!: boolean;
  @ApiProperty({ description: 'Ships switched on.' }) defaultOn!: boolean;
  @ApiProperty({
    description: 'Deletes data in a way a re-scan cannot fully rebuild.',
  })
  destructive!: boolean;
  @ApiProperty({ description: 'Mutating tools this group currently grants.' })
  toolCount!: number;
}

export class SupervisorCapabilityListDto {
  @ApiProperty({ type: [SupervisorCapabilityDto] })
  capabilities!: SupervisorCapabilityDto[];
}

export class UpdateCapabilitiesDto {
  @ApiProperty({
    type: [String],
    description: 'Group ids to switch OFF. Anything not listed is on.',
  })
  disabled!: string[];
}

export class AgentUndoEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() action!: string;
  @ApiProperty() label!: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  entityType!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  entityId!: string | null;
  @ApiProperty({
    description:
      '"restore_value" replays a snapshot; "rescan" re-derives from the source instead.',
  })
  revertKind!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() expiresAt!: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  revertedAt!: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  revertedBy!: string | null;
  @ApiProperty({
    description: 'Whether reverting it now would still mean what it says.',
  })
  undoable!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true })
  blockedReason!: string | null;
}

export class AgentUndoListDto {
  @ApiProperty({ type: [AgentUndoEntryDto] })
  entries!: AgentUndoEntryDto[];
}

export class RevertResultDto {
  @ApiProperty() id!: string;
  @ApiProperty() revertKind!: string;
  @ApiProperty({ description: 'What the revert actually did.' })
  outcome!: string;
}
