import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  AgentDecisionAction,
  AgentKind,
  AgentMemoryOrigin,
  AiManagementMode,
  SupervisorGoalKind,
  SupervisorGoalStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma.service';
import { PgBossService } from '../../../scheduler/pg-boss.service';
import { AgentAuditService } from '../../audit/agent-audit.service';
import { AgentConfigService } from '../../harness/agent-config.service';
import { SupervisorService } from '../../supervisor/supervisor.service';
import { AUTOPILOT_QUEUE } from '../../autopilot.constants';
import type { AutopilotJob } from '../../autopilot.types';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

/** A string field from a validated tool input, or the fallback. */
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Pipeline agents the supervisor may command. */
const COMMANDABLE = [
  AgentKind.INQUIRY,
  AgentKind.CASE,
  AgentKind.CONFIG,
  AgentKind.DETECTOR_AUTHOR,
  AgentKind.ESCALATION,
] as const;

/**
 * AgentMemory key prefix for an instruction left for a worker's next run.
 *
 * Stored as memory rather than as a column because that is already the channel
 * an agent reads before it acts, it is already visible and editable in the
 * Memory tab, and it already survives a restart. A new table would have bought
 * a second place to look for the same thing.
 */
export const BRIEF_MEMORY_PREFIX = 'supervisor-brief';

/**
 * The supervisor's own instruments.
 *
 * These are the tools that make it a supervisor rather than another worker:
 * commanding the others, holding goals, writing the journal that is its
 * continuity, and deciding when it next costs money. Everything else it does,
 * it reaches through tools.search.
 */
@Injectable()
export class SupervisorToolset {
  private readonly logger = new Logger(SupervisorToolset.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    private readonly supervisor: SupervisorService,
    private readonly moduleRef: ModuleRef,
    private readonly audit: AgentAuditService,
  ) {}

  /**
   * AgentConfigService, resolved at call time rather than injected.
   *
   * The registry constructs every toolset, this toolset needs to read and
   * retune agent configuration, and AgentConfigService validates tool names
   * against the registry — so injecting it directly closes a dependency cycle
   * that Nest cannot resolve and, under this runtime, does not even report:
   * the application simply stops initialising, silently, with the event loop
   * draining while a promise waits forever.
   *
   * Resolving lazily keeps one implementation of "what is this agent's
   * configuration", which matters because that answer is a merge of factory
   * defaults over operator overrides that nothing else should be reproducing.
   */
  private get agentConfig(): AgentConfigService {
    return this.moduleRef.get(AgentConfigService, { strict: false });
  }

  /**
   * The supervisor's own instruments are gated by the supervisor's own switch.
   *
   * There is no per-entity mode to consult: writing a journal entry is not a
   * change to an inquiry or a source, it is the agent's record of itself. The
   * one thing that can withhold it is the operator turning the supervisor off,
   * and by the time a tool runs that has already been checked — so this is
   * MANAGED, and the meaningful control lives in the capability menu and the
   * granted set.
   */
  private selfGate = (): Promise<ToolGate> =>
    Promise.resolve({
      mode: AiManagementMode.MANAGED,
      entityType: 'system' as const,
    });

  private parseKind(value: unknown): AgentKind {
    const raw = str(value);
    const kind = raw.toUpperCase() as AgentKind;
    if (!(COMMANDABLE as readonly AgentKind[]).includes(kind)) {
      throw new Error(
        `"${raw}" is not an agent you can command. Choose one of: ` +
          `${COMMANDABLE.join(', ')}. DREAM runs on its own schedule, DUPLICATES ` +
          `is deterministic and has no model, and you cannot command yourself.`,
      );
    }
    return kind;
  }

  list(): Tool[] {
    return [
      // ── Seeing and commanding the workers ────────────────────────────────
      {
        name: 'agents.list',
        description:
          'Every worker agent: whether it is switched on, when it runs, what gates it waits for, ' +
          'when it last ran and what that run concluded. Start here when deciding whether to ' +
          'command one — an agent that is switched off will not run however often you ask, and an ' +
          'agent that ran ten minutes ago with nothing to show has not become more useful since.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async () => {
          const agents = await this.agentConfig.list();
          const recent = await this.prisma.agentRun.findMany({
            where: { agentKind: { in: [...COMMANDABLE] } },
            orderBy: { createdAt: 'desc' },
            take: 40,
            select: {
              agentKind: true,
              status: true,
              summary: true,
              createdAt: true,
              finishedAt: true,
            },
          });
          const latest = new Map<string, (typeof recent)[number]>();
          for (const run of recent) {
            if (!latest.has(run.agentKind)) latest.set(run.agentKind, run);
          }
          return agents
            .filter((a) =>
              (COMMANDABLE as readonly string[]).includes(String(a.kind)),
            )
            .map((a) => {
              const last = latest.get(String(a.kind));
              return {
                kind: a.kind,
                enabled: a.enabled,
                triggerMode: a.triggerMode,
                waitsFor: {
                  scans: a.waitForScans,
                  matching: a.waitForMatching,
                  evidence: a.waitForEvidence,
                },
                minIntervalMinutes: a.minIntervalMinutes,
                maxStalenessHours: a.maxStalenessHours,
                lastRun: last
                  ? {
                      status: last.status,
                      at: last.finishedAt ?? last.createdAt,
                      summary: last.summary,
                    }
                  : null,
              };
            });
        },
      },
      {
        name: 'agents.run',
        description:
          'Wake one worker NOW, optionally scoped to a source and carrying an instruction. This ' +
          "bypasses that agent's timing rules — its minimum gap and the gates it normally waits " +
          "for — because deciding when work happens is your job. It does NOT bypass the operator's " +
          'switch: a disabled agent stays disabled and the call tells you so. Use this when the ' +
          "work belongs to an agent that already knows how to do it; do not re-do a worker's job " +
          'with raw tools.',
        inputSchema: {
          type: 'object',
          properties: {
            agentKind: {
              type: 'string',
              enum: [...COMMANDABLE],
            },
            sourceId: {
              type: 'string',
              description:
                'Narrow the run to one source. Omit for the whole corpus.',
            },
            instruction: {
              type: 'string',
              description:
                "What you want this run to concentrate on, in a sentence or two. It becomes a top-priority section of that agent's prompt.",
            },
          },
          required: ['agentKind'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.COMMAND_AGENT,
        resolveGate: this.selfGate,
        handler: async (input) => {
          const kind = this.parseKind(input.agentKind);
          const agents = await this.agentConfig.list();
          const agent = agents.find((a) => String(a.kind) === kind);
          if (agent && !agent.enabled) {
            return {
              enqueued: false,
              agentKind: kind,
              reason:
                `${kind} is switched off by the operator. Commanding it does nothing. ` +
                `If you believe it should be running, say so in your journal — that is a ` +
                `decision for a person, not one you can take.`,
            };
          }

          const sourceId =
            typeof input.sourceId === 'string' && input.sourceId
              ? input.sourceId
              : undefined;
          if (sourceId) {
            const found = await this.prisma.source.findUnique({
              where: { id: sourceId },
              select: { id: true },
            });
            if (!found) throw new Error(`Source ${sourceId} does not exist.`);
          }

          const boss = await this.pgBoss.getBossAsync();
          const cycleKey = `supervisor:${randomUUID()}`;
          const job: AutopilotJob = {
            // `commanded`, not `manual`: timing yields to the supervisor, the
            // operator's enable flags do not.
            commanded: true,
            cycleKey,
            sourceId,
            instruction:
              typeof input.instruction === 'string' && input.instruction.trim()
                ? input.instruction.trim()
                : undefined,
            agentKinds: [kind] as AutopilotJob['agentKinds'],
          };
          await boss.send(AUTOPILOT_QUEUE, job, {
            retryLimit: 2,
            retryDelay: 90,
            retryBackoff: true,
            expireInSeconds: 3 * 3600,
          });
          return {
            enqueued: true,
            agentKind: kind,
            cycleKey,
            sourceId: sourceId ?? null,
          };
        },
      },
      {
        name: 'agents.brief',
        description:
          "Leave an instruction for a worker's NEXT run, whenever that happens. This starts " +
          'nothing — if you want it to run now, use agents.run. Use this when the timing is ' +
          'already right and only the emphasis is wrong: "when you next look at Payroll, the ' +
          'account numbers there are test fixtures". Replaces any previous brief for that agent.',
        inputSchema: {
          type: 'object',
          properties: {
            agentKind: { type: 'string', enum: [...COMMANDABLE] },
            instruction: { type: 'string' },
          },
          required: ['agentKind', 'instruction'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'memory',
        decisionAction: AgentDecisionAction.COMMAND_AGENT,
        resolveGate: this.selfGate,
        handler: async (input) => {
          const kind = this.parseKind(input.agentKind);
          const instruction = str(input.instruction).trim();
          if (!instruction) throw new Error('instruction cannot be empty.');
          const key = `${BRIEF_MEMORY_PREFIX}:${kind.toLowerCase()}`;
          await this.prisma.agentMemory.upsert({
            where: {
              kind_key: { kind: 'OPERATOR_DIRECTIVE', key },
            },
            create: {
              kind: 'OPERATOR_DIRECTIVE',
              key,
              content: instruction,
              scope: kind,
              origin: AgentMemoryOrigin.AGENT,
              tags: ['supervisor-brief'],
            },
            update: { content: instruction, scope: kind },
          });
          return {
            agentKind: kind,
            briefed: true,
            note: 'This does not start a run. It is read by that agent the next time it runs.',
          };
        },
      },
      {
        name: 'agents.configure',
        description:
          'Change WHEN a worker runs: its trigger mode, the gates it waits for, its minimum gap ' +
          'and its staleness backstop. This is an instance-wide change that affects every future ' +
          'run of that agent, so make it because a pattern justifies it, not because of one ' +
          "cycle. You cannot enable or disable an agent here — that is the operator's switch.",
        inputSchema: {
          type: 'object',
          properties: {
            agentKind: { type: 'string', enum: [...COMMANDABLE] },
            triggerMode: {
              type: 'string',
              enum: ['EAGER', 'BATCH', 'SETTLED', 'SCHEDULED', 'MANUAL'],
            },
            waitForScans: { type: 'boolean' },
            waitForMatching: { type: 'boolean' },
            waitForEvidence: { type: 'boolean' },
            minIntervalMinutes: { type: 'number' },
            maxStalenessHours: {
              type: 'number',
              description:
                'The liveness guarantee. 0 disables it, which lets a gated agent wait forever.',
            },
            rationale: {
              type: 'string',
              description:
                'The pattern that justifies this, not the single run that prompted it.',
            },
          },
          required: ['agentKind'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.CONFIGURE_AGENT,
        resolveGate: this.selfGate,
        handler: async (input) => {
          const kind = this.parseKind(input.agentKind);
          const patch: Record<string, unknown> = {};
          for (const field of [
            'triggerMode',
            'waitForScans',
            'waitForMatching',
            'waitForEvidence',
            'minIntervalMinutes',
            'maxStalenessHours',
          ] as const) {
            if (input[field] !== undefined) patch[field] = input[field];
          }
          if (Object.keys(patch).length === 0) {
            throw new Error('Nothing to change — supply at least one setting.');
          }
          const updated = await this.agentConfig.update(kind, patch);
          return {
            agentKind: kind,
            triggerMode: updated.triggerMode,
            waitsFor: {
              scans: updated.waitForScans,
              matching: updated.waitForMatching,
              evidence: updated.waitForEvidence,
            },
            minIntervalMinutes: updated.minIntervalMinutes,
            maxStalenessHours: updated.maxStalenessHours,
          };
        },
      },
      {
        name: 'agents.stop',
        description:
          'Cancel a worker run that is currently going. It aborts at its next step boundary, so ' +
          'whatever it has already applied stays applied — this stops further work, it does not ' +
          'undo what was done. Use it for a run that is clearly working from a wrong premise.',
        inputSchema: {
          type: 'object',
          properties: {
            runId: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['runId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.COMMAND_AGENT,
        resolveGate: this.selfGate,
        handler: async (input) => {
          const runId = str(input.runId);
          const run = await this.prisma.agentRun.findUnique({
            where: { id: runId },
            select: { id: true, status: true, agentKind: true },
          });
          if (!run) throw new Error(`Agent run ${runId} does not exist.`);
          if (run.agentKind === AgentKind.SUPERVISOR) {
            throw new Error(
              'Refused: that is one of your own runs. Finish the wake instead.',
            );
          }
          const cancelled = await this.audit.cancel(runId);
          return {
            runId,
            cancelled,
            status: run.status,
            note: cancelled
              ? 'Aborts at the next step boundary. Work already applied stays applied.'
              : `Run was ${run.status} and could not be cancelled.`,
          };
        },
      },

      // ── The inbox ─────────────────────────────────────────────────────────
      {
        name: 'inbox.read',
        description:
          'What actually changed since your last wake: scans that finished, workers that finished ' +
          'or failed, cases escalated, duplicate backlog growth. This is a filtered digest, not ' +
          'everything that happened — the full record is in the run and decision history, which ' +
          'you can read on demand. Reading drains the digest, so summarise anything you need to ' +
          'remember into your journal before you finish.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Default 40.' },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) => {
          const limit = Math.min(Math.max(Number(input.limit) || 40, 1), 200);
          const events = await this.supervisor.pendingEvents(limit);
          await this.supervisor.drainEvents(events.map((e) => e.id));
          const remaining = await this.supervisor.countPending();
          return {
            events: events.map((e) => ({
              type: e.type,
              severity: e.severity,
              summary: e.summary,
              at: e.createdAt,
              detail: e.payload,
            })),
            shown: events.length,
            stillPending: remaining,
          };
        },
      },

      // ── Goals ─────────────────────────────────────────────────────────────
      {
        name: 'goals.list',
        description:
          'Your goals and tasks, including finished ones when asked. The charter is the standing ' +
          'answer to what this instance is for; everything else should be traceable to it.',
        inputSchema: {
          type: 'object',
          properties: {
            includeFinished: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) => {
          const goals = await this.supervisor.listGoals({
            includeFinished: input.includeFinished === true,
          });
          return goals.map((g) => ({
            id: g.id,
            kind: g.kind,
            status: g.status,
            origin: g.origin,
            title: g.title,
            body: g.body,
            priority: g.priority,
            progress: g.progress,
            dueAt: g.dueAt,
          }));
        },
      },
      {
        name: 'goals.update',
        description:
          'Record where a goal stands, or close one out. On a goal a person wrote you may set ' +
          '`progress` and nothing else — if you think the goal itself is wrong, say so in your ' +
          'journal and propose the alternative rather than quietly rewriting the instruction.',
        inputSchema: {
          type: 'object',
          properties: {
            goalId: { type: 'string' },
            progress: { type: 'string' },
            status: {
              type: 'string',
              enum: ['ACTIVE', 'PAUSED', 'DONE', 'ABANDONED'],
            },
            priority: { type: 'number' },
          },
          required: ['goalId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.SET_GOAL,
        resolveGate: this.selfGate,
        handler: async (input) => {
          const goal = await this.supervisor.updateGoal(
            str(input.goalId),
            {
              ...(input.progress !== undefined
                ? { progress: str(input.progress) }
                : {}),
              ...(input.status !== undefined
                ? { status: str(input.status) as SupervisorGoalStatus }
                : {}),
              ...(input.priority !== undefined
                ? { priority: Number(input.priority) }
                : {}),
            },
            true,
          );
          return { id: goal.id, status: goal.status, progress: goal.progress };
        },
      },
      {
        name: 'goals.propose',
        description:
          'Open a goal or task of your own, alongside what the operator asked for. It is marked as ' +
          'yours, so a person can see which objectives they set and which you inferred. Propose ' +
          'one when you find durable work the existing goals do not cover — not as a way to ' +
          'restate a goal you would rather were different.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            kind: { type: 'string', enum: ['GOAL', 'TASK'] },
            priority: { type: 'number' },
            parentId: { type: 'string' },
          },
          required: ['title'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.SET_GOAL,
        resolveGate: this.selfGate,
        handler: async (input) => {
          const goal = await this.supervisor.createGoal({
            title: str(input.title).trim(),
            body: input.body === undefined ? null : str(input.body),
            kind:
              str(input.kind, 'GOAL') === 'TASK'
                ? SupervisorGoalKind.TASK
                : SupervisorGoalKind.GOAL,
            priority: Number(input.priority) || 0,
            parentId:
              typeof input.parentId === 'string' && input.parentId
                ? input.parentId
                : null,
            origin: AgentMemoryOrigin.AGENT,
          });
          return { id: goal.id, kind: goal.kind, title: goal.title };
        },
      },

      // ── Closing a wake ────────────────────────────────────────────────────
      {
        name: 'journal.write',
        description:
          'REQUIRED before you finish. Your record of this wake, and the only thing the next one ' +
          'will remember. Write it to someone who was not here: `situation` is what you found, ' +
          '`did` is what you changed and why, `next` is the concrete thing to pick up. "Nothing ' +
          'had changed, so I did nothing" is a good entry when it is true. Vague entries cost you ' +
          'directly — the next wake acts on this text and nothing else.',
        inputSchema: {
          type: 'object',
          properties: {
            situation: { type: 'string' },
            did: { type: 'string' },
            next: { type: 'string' },
            goalIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Goals this wake advanced, if any.',
            },
          },
          required: ['situation', 'did', 'next'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.WRITE_JOURNAL,
        resolveGate: this.selfGate,
        handler: async (input, tc: ToolContext) => {
          const entry = await this.supervisor.writeJournal({
            runId: tc.ctx.run.id,
            wakeReason: tc.ctx.instruction
              ? 'operator instruction'
              : (await this.supervisor.state()).wakeReason || 'scheduled wake',
            situation: str(input.situation),
            did: str(input.did),
            next: str(input.next),
            goalIds: Array.isArray(input.goalIds)
              ? input.goalIds.filter((g): g is string => typeof g === 'string')
              : [],
          });
          return { id: entry.id, recorded: true };
        },
      },
      {
        name: 'supervisor.schedule_wake',
        description:
          'REQUIRED before you finish. When you next run, and on what. `afterMinutes` is a delay; ' +
          '`onEvents` wakes you sooner if one of those things happens first. Sleeping is the right ' +
          'answer more often than it feels: a corpus nobody is scanning does not develop new ' +
          'opinions between one hour and the next, and every wake costs money. Wake sooner only ' +
          'when something is genuinely pending.',
        inputSchema: {
          type: 'object',
          properties: {
            afterMinutes: {
              type: 'number',
              description:
                'Minutes until the next wake. Clamped to a floor and to the instance maximum sleep.',
            },
            onEvents: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'scan_completed',
                  'agent_finished',
                  'agent_failed',
                  'provider_error',
                  'case_escalated',
                ],
              },
              description: 'Wake sooner if one of these happens.',
            },
            reason: {
              type: 'string',
              description:
                'Why this timing. Shown to the operator and read back to you.',
            },
          },
          required: ['reason'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.SCHEDULE_WAKE,
        resolveGate: this.selfGate,
        handler: async (input, tc: ToolContext) => {
          const maxSleep = tc.ctx.settings.supervisorMaxSleepHours ?? 24;
          const result = await this.supervisor.scheduleWake(
            {
              afterMinutes:
                input.afterMinutes === undefined
                  ? null
                  : Number(input.afterMinutes),
              onEvents: Array.isArray(input.onEvents)
                ? (input.onEvents as string[])
                : null,
              reason: str(input.reason).trim() || 'no reason given',
            },
            maxSleep,
          );
          return {
            nextWakeAt: result.nextWakeAt,
            wakeOn: result.onEvents,
            clamped: result.clamped,
            ...(result.clamped
              ? {
                  note: `Your requested delay was outside the allowed range and was clamped. The maximum sleep on this instance is ${maxSleep}h.`,
                }
              : {}),
          };
        },
      },
      {
        name: 'budget.status',
        description:
          'What you have spent today and what is left, plus how many destructive calls you have ' +
          'made against the daily purge budget. A null spend means this provider has no pricing ' +
          'configured, so cost cannot be measured — that is not the same as free, and you should ' +
          'pace conservatively when you see it.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (_input, tc: ToolContext) =>
          this.supervisor.budget(tc.ctx.settings),
      },
    ];
  }
}
