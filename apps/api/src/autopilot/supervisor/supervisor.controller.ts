import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AgentMemoryOrigin, SupervisorGoalKind } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CliRunnerService } from '../../cli-runner/cli-runner.service';
import { TriggerType } from '@prisma/client';
import { SupervisorService } from './supervisor.service';
import { SupervisorWorker } from './supervisor.worker';
import { UndoService } from './undo.service';
import { CAPABILITY_GROUPS, groupForTool } from './capabilities';
import { OPERATOR_ACTOR } from './supervisor.constants';
import { ToolRegistry } from '../tools/tool-registry.service';
import {
  AgentUndoListDto,
  AnnotateJournalDto,
  CreateSupervisorGoalDto,
  RevertResultDto,
  SupervisorCapabilityListDto,
  SupervisorGoalDto,
  SupervisorGoalListDto,
  SupervisorJournalListDto,
  SupervisorStateDto,
  UpdateCapabilitiesDto,
  UpdateSupervisorDto,
  UpdateSupervisorGoalDto,
  WakeSupervisorDto,
} from '../dto/supervisor.dto';

const INSTANCE_SETTINGS_ID = 1;

@ApiTags('autopilot')
@Controller('autopilot/supervisor')
export class SupervisorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supervisor: SupervisorService,
    private readonly worker: SupervisorWorker,
    private readonly undo: UndoService,
    private readonly registry: ToolRegistry,
    private readonly runner: CliRunnerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Supervisor state, budget and pacing' })
  @ApiResponse({ status: 200, type: SupervisorStateDto })
  async state(): Promise<SupervisorStateDto> {
    await this.supervisor.ensureCharter();
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    const [state, goals, budget, pendingEvents] = await Promise.all([
      this.supervisor.state(),
      this.supervisor.listGoals(),
      this.supervisor.budget(settings ?? {}),
      this.supervisor.countPending(),
    ]);
    return {
      enabled: settings?.supervisorEnabled ?? false,
      nextWakeAt: state.nextWakeAt,
      wakeOnEvents: state.wakeOnEvents,
      wakeReason: state.wakeReason,
      lastWakeAt: state.lastWakeAt,
      pausedUntil: state.pausedUntil,
      consecutiveNoops: state.consecutiveNoops,
      pendingEvents,
      activeGoals: goals.filter((g) => g.kind !== SupervisorGoalKind.CHARTER)
        .length,
      budget,
      providerConfigured: !!settings?.harnessAiProviderConfigId,
    };
  }

  @Patch()
  @ApiOperation({ summary: 'Enable, pause, or re-budget the supervisor' })
  @ApiResponse({ status: 200, type: SupervisorStateDto })
  async update(@Body() dto: UpdateSupervisorDto): Promise<SupervisorStateDto> {
    const data: Record<string, unknown> = {};
    if (dto.enabled !== undefined) data.supervisorEnabled = dto.enabled;
    if (dto.dailyCostLimitUsd !== undefined) {
      data.supervisorDailyCostLimitUsd = dto.dailyCostLimitUsd;
    }
    if (dto.maxSleepHours !== undefined) {
      if (dto.maxSleepHours < 1 || dto.maxSleepHours > 168) {
        throw new BadRequestException(
          'maxSleepHours must be between 1 and 168.',
        );
      }
      data.supervisorMaxSleepHours = dto.maxSleepHours;
    }
    if (dto.purgeBudgetPerDay !== undefined) {
      data.supervisorPurgeBudgetPerDay = Math.max(dto.purgeBudgetPerDay, 0);
    }
    if (dto.undoRetentionDays !== undefined) {
      data.supervisorUndoRetentionDays = Math.max(dto.undoRetentionDays, 1);
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.instanceSettings.update({
        where: { id: INSTANCE_SETTINGS_ID },
        data,
      });
    }
    if (dto.pausedUntil !== undefined) {
      await this.supervisor.pause(
        dto.pausedUntil ? new Date(dto.pausedUntil) : null,
      );
    }
    return this.state();
  }

  @Post('wake')
  @HttpCode(202)
  @ApiOperation({ summary: 'Wake the supervisor now' })
  async wake(@Body() dto: WakeSupervisorDto): Promise<{ queued: boolean }> {
    await this.worker.requestWake({
      manual: true,
      instruction: dto.instruction?.trim() || undefined,
    });
    return { queued: true };
  }

  // ── Goals ──────────────────────────────────────────────────────────────────

  @Get('goals')
  @ApiOperation({ summary: 'Goals and tasks, including the charter' })
  @ApiResponse({ status: 200, type: SupervisorGoalListDto })
  async goals(
    @Query('includeFinished') includeFinished?: string,
  ): Promise<SupervisorGoalListDto> {
    await this.supervisor.ensureCharter();
    const goals = await this.supervisor.listGoals({
      includeFinished: includeFinished === 'true',
    });
    return { goals };
  }

  @Post('goals')
  @ApiOperation({ summary: 'Set a goal' })
  @ApiResponse({ status: 201, type: SupervisorGoalDto })
  async createGoal(
    @Body() dto: CreateSupervisorGoalDto,
  ): Promise<SupervisorGoalDto> {
    if (!dto.title?.trim()) {
      throw new BadRequestException('A goal needs a title.');
    }
    return this.supervisor.createGoal({
      title: dto.title.trim(),
      body: dto.body ?? null,
      kind: dto.kind,
      priority: dto.priority,
      parentId: dto.parentId ?? null,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      // Anything set through this endpoint is a person's instruction, which is
      // what makes it outrank the agent's own goals.
      origin: AgentMemoryOrigin.OPERATOR,
    });
  }

  @Patch('goals/:id')
  @ApiOperation({ summary: 'Edit a goal' })
  @ApiResponse({ status: 200, type: SupervisorGoalDto })
  async updateGoal(
    @Param('id') id: string,
    @Body() dto: UpdateSupervisorGoalDto,
  ): Promise<SupervisorGoalDto> {
    return this.supervisor.updateGoal(id, {
      ...dto,
      dueAt:
        dto.dueAt === undefined
          ? undefined
          : dto.dueAt
            ? new Date(dto.dueAt)
            : null,
    });
  }

  @Delete('goals/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a goal' })
  async deleteGoal(@Param('id') id: string): Promise<void> {
    await this.supervisor.deleteGoal(id);
  }

  // ── Journal ────────────────────────────────────────────────────────────────

  @Get('journal')
  @ApiOperation({ summary: 'What it did, wake by wake' })
  @ApiResponse({ status: 200, type: SupervisorJournalListDto })
  async journal(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ): Promise<SupervisorJournalListDto> {
    const entries = await this.supervisor.listJournal({
      limit: limit ? Number(limit) : 20,
      before: before ? new Date(before) : undefined,
    });
    return {
      entries: entries.map((e) => ({
        ...e,
        costUsd: e.costUsd === null ? null : Number(e.costUsd),
      })),
    };
  }

  @Post('journal/:id/note')
  @ApiOperation({
    summary: 'Correct an entry. Read back on the next wake as authoritative.',
  })
  async annotate(
    @Param('id') id: string,
    @Body() dto: AnnotateJournalDto,
  ): Promise<{ ok: true }> {
    if (!dto.note?.trim()) {
      throw new BadRequestException('A correction needs some text.');
    }
    await this.supervisor.annotateJournal(id, dto.note.trim());
    return { ok: true };
  }

  // ── Capabilities ───────────────────────────────────────────────────────────

  @Get('capabilities')
  @ApiOperation({ summary: 'What the supervisor is allowed to do' })
  @ApiResponse({ status: 200, type: SupervisorCapabilityListDto })
  async capabilities(): Promise<SupervisorCapabilityListDto> {
    const enabled = new Set(await this.supervisor.enabledCapabilityIds());
    // Counted from the live registry rather than from the static map, so the
    // number reflects the tools this instance actually has — including any
    // bridged or connected at runtime.
    const mutating = this.registry
      .list()
      .filter((t) => t.sideEffect === 'mutate');
    return {
      capabilities: CAPABILITY_GROUPS.map((g) => ({
        id: g.id,
        labelKey: g.labelKey,
        description: g.description,
        enabled: g.alwaysOn === true || enabled.has(g.id),
        alwaysOn: g.alwaysOn === true,
        defaultOn: g.defaultOn,
        destructive: g.destructive === true,
        toolCount: mutating.filter((t) => groupForTool(t.name)?.id === g.id)
          .length,
      })),
    };
  }

  @Put('capabilities')
  @ApiOperation({ summary: 'Switch capability groups off' })
  @ApiResponse({ status: 200, type: SupervisorCapabilityListDto })
  async setCapabilities(
    @Body() dto: UpdateCapabilitiesDto,
  ): Promise<SupervisorCapabilityListDto> {
    await this.supervisor.setDisabledCapabilities(dto.disabled ?? []);
    return this.capabilities();
  }

  // ── Undo ───────────────────────────────────────────────────────────────────

  @Get('undo')
  @ApiOperation({ summary: 'Agent actions that can still be taken back' })
  @ApiResponse({ status: 200, type: AgentUndoListDto })
  async undoLog(@Query('limit') limit?: string): Promise<AgentUndoListDto> {
    return { entries: await this.undo.list(limit ? Number(limit) : 50) };
  }

  @Post('undo/:id')
  @ApiOperation({ summary: 'Revert one agent action' })
  @ApiResponse({ status: 200, type: RevertResultDto })
  async revert(@Param('id') id: string): Promise<RevertResultDto> {
    const claim = await this.undo.claim(id, OPERATOR_ACTOR);

    // A rescan does not restore anything; it re-derives. Findings and assets
    // are computed from a source, so scanning it again rebuilds them — which is
    // exactly why the purge tools refuse to touch anything a person curated,
    // because that part does not come back.
    if (claim.revertKind === 'rescan') {
      const payload = claim.payload as { sourceId?: string } | null;
      const sourceId = payload?.sourceId;
      if (!sourceId) {
        return {
          id,
          revertKind: claim.revertKind,
          outcome: 'Nothing to re-scan: the entry names no source.',
        };
      }
      await this.runner.startRun(sourceId, TriggerType.MANUAL, OPERATOR_ACTOR);
      return {
        id,
        revertKind: claim.revertKind,
        outcome:
          'Re-scan started. Findings and assets will be rebuilt from current ' +
          'detection; triage decisions made before the purge do not return.',
      };
    }

    return {
      id,
      revertKind: claim.revertKind,
      outcome:
        'Marked reverted. This entry carries a stored value; restoring it is ' +
        'not yet automated — the snapshot is in the undo record.',
    };
  }
}
