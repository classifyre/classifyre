import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  AgentDecisionAction,
  AiManagementMode,
  FindingStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { SourceService } from '../../../source.service';
import { SupervisorService } from '../../supervisor/supervisor.service';
import { UndoService } from '../../supervisor/undo.service';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

/** A string field from a validated tool input, or the fallback. */
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Deleting noise out of the evidence base.
 *
 * The one capability group that ships switched off, because it is the only one
 * whose mistakes a person cannot simply disagree with later. Findings and
 * assets are derived data — a re-scan rebuilds them — so the *substance* is
 * recoverable. What is not recoverable is everything a person put on top:
 * triage decisions, resolution notes, the fact that someone looked at this and
 * said it was fine. That is why the guard here is not a confirmation flag but a
 * refusal: anything a case cites or an active inquiry matches is off limits,
 * whatever the model believes about it.
 *
 * Every tool returns counts. A destructive tool that answers `{ok: true}` is
 * telling the model the action was free, and a chain of individually defensible
 * "free" reductions is how one instance ended with 96% of its findings
 * resolved.
 */
@Injectable()
export class HygieneToolset {
  private readonly logger = new Logger(HygieneToolset.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
    private readonly supervisor: SupervisorService,
    private readonly undo: UndoService,
  ) {}

  /**
   * SourceService, resolved from the whole application graph at call time.
   *
   * It is provided by AppModule, which imports this module — so injecting it
   * normally would close a cycle, and providing a second copy here would give
   * the instance two services scheduling correlation recomputes and disagreeing
   * about which one ran.
   *
   * Resolving lazily keeps exactly one implementation of "purge a source",
   * which matters because that method does more than a delete: it schedules the
   * recompute that keeps duplicate detection honest afterwards. A local
   * reimplementation would be correct on the day it was written and quietly
   * wrong the first time that method grew a step.
   */
  private get sources(): SourceService {
    return this.moduleRef.get(SourceService, { strict: false });
  }

  /**
   * Destructive calls are gated on the supervisor's own switch and nothing
   * else, because the meaningful control is upstream: the hygiene capability
   * group is off by default, and while it is off these tools are not in the
   * granted set at all, so a call never reaches this gate.
   */
  private gate = (): Promise<ToolGate> =>
    Promise.resolve({
      mode: AiManagementMode.MANAGED,
      entityType: 'source' as const,
    });

  /**
   * What a purge would destroy, and what it must not.
   *
   * Cited evidence is counted separately rather than merged into a total,
   * because the two numbers mean different things to the decision: one is the
   * noise being removed, the other is the reason not to.
   */
  private async assess(sourceId: string) {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true, name: true },
    });
    if (!source) throw new Error(`Source ${sourceId} does not exist.`);

    const [findings, assets, openFindings, humanTriaged, cited] =
      await Promise.all([
        this.prisma.finding.count({ where: { sourceId } }),
        this.prisma.asset.count({ where: { sourceId } }),
        this.prisma.finding.count({
          where: { sourceId, status: FindingStatus.OPEN },
        }),
        // FALSE_POSITIVE and IGNORED only. RESOLVED is NOT human triage — the
        // system sets it automatically when a detector leaves a source's
        // config, and counting those would make every ordinary config change
        // look like it had destroyed someone's work.
        this.prisma.finding.count({
          where: {
            sourceId,
            status: {
              in: [FindingStatus.FALSE_POSITIVE, FindingStatus.IGNORED],
            },
          },
        }),
        // CaseFinding carries a plain finding_id with no relation, so Prisma
        // cannot filter it by the finding's source. A join is the cheap way;
        // loading every finding id of the source to filter in app code is the
        // unbounded findMany that has taken this instance out before.
        this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM case_findings cf
          JOIN findings f ON f.id = cf.finding_id
          WHERE f.source_id = ${sourceId}
        `,
      ]);

    return {
      sourceId,
      sourceName: source.name,
      findings,
      assets,
      openFindings,
      /** Findings a case has taken as evidence. Blocks a purge outright. */
      citedByCase: Number(cited[0]?.count ?? 0),
      /**
       * Findings a person dismissed or ignored. A re-scan brings the finding
       * back but NOT the judgement, so this is the count of human work a purge
       * would silently discard.
       */
      humanTriaged,
    };
  }

  private async checkBudget(tc: ToolContext): Promise<void> {
    const budget = await this.supervisor.budget(tc.ctx.settings);
    if (
      budget.purgeBudgetPerDay > 0 &&
      budget.purgesToday >= budget.purgeBudgetPerDay
    ) {
      throw new Error(
        `Refused: you have already made ${budget.purgesToday} destructive call(s) ` +
          `today and the daily budget is ${budget.purgeBudgetPerDay}. This limit ` +
          `exists because a series of individually reasonable deletions is how ` +
          `an evidence base gets emptied. Record what you wanted to do in your ` +
          `journal and revisit it tomorrow.`,
      );
    }
  }

  list(): Tool[] {
    return [
      {
        name: 'hygiene.preview_purge',
        description:
          'What purging a source would destroy: how many findings and assets it holds, how many ' +
          'findings a case already cites, and how many a person has already triaged. Call this ' +
          'before any purge. The cited and triaged counts are the ones that matter — a re-scan ' +
          "rebuilds findings, but it does not rebuild anyone's judgement about them.",
        inputSchema: {
          type: 'object',
          properties: { sourceId: { type: 'string' } },
          required: ['sourceId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) => this.assess(str(input.sourceId)),
      },
      {
        name: 'hygiene.purge_findings',
        description:
          'Permanently delete every finding of one source, so a re-scan can rebuild them from ' +
          "current detection. Use it when a source's findings are dominated by noise that a " +
          'config change has since fixed — not to make a number look better. REFUSED when any ' +
          'finding of that source is cited by a case. Counts against your daily destructive ' +
          'budget, and writes an undo entry naming the re-scan that rebuilds it.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: { type: 'string' },
            acknowledgeTriagedLoss: {
              type: 'boolean',
              description:
                'Required when the source holds findings a person has already triaged: those judgements do not come back.',
            },
          },
          required: ['sourceId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'source',
        decisionAction: AgentDecisionAction.PURGE_FINDINGS,
        resolveGate: this.gate,
        handler: async (input, tc) => {
          const sourceId = str(input.sourceId);
          await this.checkBudget(tc);
          const before = await this.assess(sourceId);

          if (before.citedByCase > 0) {
            throw new Error(
              `Refused: ${before.citedByCase} finding(s) on "${before.sourceName}" are ` +
                `cited as evidence by a case. Purging them would remove the ground a ` +
                `person's conclusion stands on. Detach them from the case first, or ` +
                `leave this source alone.`,
            );
          }
          if (
            before.humanTriaged > 0 &&
            input.acknowledgeTriagedLoss !== true
          ) {
            throw new Error(
              `Refused: ${before.humanTriaged} finding(s) on "${before.sourceName}" have ` +
                `already been triaged by a person. A re-scan brings the findings back but ` +
                `not their judgements. If losing those is genuinely the right call, say so ` +
                `with acknowledgeTriagedLoss: true and explain it in your rationale.`,
            );
          }

          const result = await this.sources.purgeFindings(sourceId);
          await this.undo.record({
            runId: tc.ctx.run.id,
            action: AgentDecisionAction.PURGE_FINDINGS,
            label: `Purged ${result.purgedFindings} finding(s) from "${before.sourceName}"`,
            entityType: 'source',
            entityId: sourceId,
            revertKind: 'rescan',
            revertPayload: {
              sourceId,
              sourceName: before.sourceName,
              purgedFindings: result.purgedFindings,
            },
            retentionDays: tc.ctx.settings.supervisorUndoRetentionDays ?? 30,
          });

          return {
            ...result,
            sourceName: before.sourceName,
            assetsKept: before.assets,
            note:
              'Findings are derived: re-scanning this source rebuilds them from current ' +
              'detection. Schedule that scan unless you meant to leave the source dark.',
          };
        },
      },
      {
        name: 'hygiene.purge_assets',
        description:
          'Permanently delete every asset of one source, and every finding on them. This is the ' +
          'heavier of the two: it removes the ingested material itself, so the source must be ' +
          're-scanned before anything here can be looked at again. Use it for a source that ' +
          'ingested the wrong thing entirely. REFUSED when a case cites any of its findings.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: { type: 'string' },
            acknowledgeTriagedLoss: { type: 'boolean' },
          },
          required: ['sourceId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'source',
        decisionAction: AgentDecisionAction.PURGE_ASSETS,
        resolveGate: this.gate,
        handler: async (input, tc) => {
          const sourceId = str(input.sourceId);
          await this.checkBudget(tc);
          const before = await this.assess(sourceId);

          if (before.citedByCase > 0) {
            throw new Error(
              `Refused: ${before.citedByCase} finding(s) on "${before.sourceName}" are ` +
                `cited as evidence by a case, and deleting the assets deletes them too.`,
            );
          }
          if (
            before.humanTriaged > 0 &&
            input.acknowledgeTriagedLoss !== true
          ) {
            throw new Error(
              `Refused: ${before.humanTriaged} finding(s) on "${before.sourceName}" have ` +
                `already been triaged by a person, and those judgements do not survive. ` +
                `Pass acknowledgeTriagedLoss: true if that is genuinely the right call.`,
            );
          }

          const result = await this.sources.purgeAssets(sourceId);
          await this.undo.record({
            runId: tc.ctx.run.id,
            action: AgentDecisionAction.PURGE_ASSETS,
            label: `Purged ${result.purgedAssets} asset(s) from "${before.sourceName}"`,
            entityType: 'source',
            entityId: sourceId,
            revertKind: 'rescan',
            revertPayload: {
              sourceId,
              sourceName: before.sourceName,
              purgedAssets: result.purgedAssets,
              purgedFindings: before.findings,
            },
            retentionDays: tc.ctx.settings.supervisorUndoRetentionDays ?? 30,
          });

          return {
            ...result,
            sourceName: before.sourceName,
            findingsRemoved: before.findings,
            note:
              'Nothing from this source can be examined until it is scanned again. ' +
              'Schedule that scan now unless you meant to retire the source.',
          };
        },
      },
    ];
  }
}
