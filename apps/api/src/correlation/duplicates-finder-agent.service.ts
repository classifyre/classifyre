import { Injectable, Logger } from '@nestjs/common';
import { AgentKind, Severity } from '@prisma/client';
import { AgentAuditService } from '../autopilot/audit/agent-audit.service';
import { AgentLoggerService } from '../autopilot/audit/agent-logger.service';
import { CasesService } from '../cases.service';
import { CorrelationService } from './correlation.service';

export interface CaseActionInput {
  assetIds: string[];
  /** Add to this existing case; when omitted a new case is created. */
  caseId?: string | null;
  title?: string | null;
  description?: string | null;
  severity?: Severity | null;
  attachFindings?: boolean;
}

export interface CaseActionResult {
  caseId: string;
  caseTitle: string;
  created: boolean;
  assetsAdded: number;
  findingsAttached: number;
}

/**
 * DUPLICATES FINDER AGENT.
 *
 * A deterministic step (no LLM) that runs after every scan, *before* the
 * inquiry/case agents. It recomputes asset correlation for the scan's assets
 * and records the work as a first-class AgentRun so it shows up in the
 * autopilot log alongside the AI agents — and so the inquiry/case agents can
 * take the duplicate/cluster results into account. Runs regardless of whether
 * AI is enabled: duplicate detection is always on.
 */
@Injectable()
export class DuplicatesFinderAgentService {
  private readonly logger = new Logger(DuplicatesFinderAgentService.name);

  constructor(
    private readonly correlation: CorrelationService,
    private readonly cases: CasesService,
    private readonly audit: AgentAuditService,
    private readonly log: AgentLoggerService,
  ) {}

  async runForScan(input: {
    sourceId: string;
    runnerId: string;
    cycleKey: string;
    sourceName: string;
  }): Promise<void> {
    const run = await this.audit.openRun(AgentKind.DUPLICATES, {
      sourceId: input.sourceId,
      runnerId: input.runnerId,
      cycleKey: input.cycleKey,
      trigger: 'scan_completed',
    });
    // Another worker already owns this cycle's run (resume guard).
    if (run.status !== 'RUNNING') return;

    try {
      await this.log.business(
        run.id,
        `Duplicates finder started after a scan of ${input.sourceName}.`,
      );

      const summary = await this.correlation.recomputeForRunner(
        input.sourceId,
        input.runnerId,
        (msg, data) => this.log.technical(run.id, msg, data),
      );

      await this.log.technical(run.id, 'Correlation recompute finished.', {
        ...summary,
      });

      if (summary.topMatch) {
        await this.audit.recordDecision(run.id, {
          action: 'LINK_DUPLICATE',
          outcome: 'APPLIED',
          entityType: 'asset',
          entityId: summary.topMatch.fromAssetId,
          rationale: `Top match ${summary.topMatch.weighted * 100}% with asset ${summary.topMatch.toAssetId}: ${summary.topMatch.reasons.join(', ')}.`,
          payload: { topMatch: summary.topMatch },
          dedupeKey: `top-match:${summary.topMatch.fromAssetId}:${summary.topMatch.toAssetId}`,
        });
      }
      if (summary.clustersTouched > 0) {
        await this.audit.recordDecision(run.id, {
          action: 'UPDATE_CLUSTER',
          outcome: 'APPLIED',
          entityType: 'cluster',
          rationale: `Maintained ${summary.clustersTouched} identity cluster(s) from the new fingerprints.`,
          payload: { clustersTouched: summary.clustersTouched },
          dedupeKey: 'clusters-touched',
        });
      }

      const text = formatSummary(summary);
      await this.audit.complete(run.id, text);
      await this.log.business(run.id, `Duplicates finder finished: ${text}`);
      this.logger.log(`Duplicates run ${run.id} completed: ${text}`);
    } catch (error) {
      await this.log.error(run.id, 'TECHNICAL', 'Duplicates finder failed.', {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.audit.fail(run.id, error);
      throw error;
    }
  }

  /**
   * The correlation tuning changed — recompute every asset's fingerprints and
   * clusters under the new weights/thresholds. Logged as a DUPLICATES run.
   */
  async runForConfigChange(): Promise<void> {
    const run = await this.audit.openRun(AgentKind.DUPLICATES, {
      sourceId: null,
      runnerId: null,
      cycleKey: `config:${Date.now()}`,
      trigger: 'config_changed',
    });
    if (run.status !== 'RUNNING') return;
    try {
      await this.log.business(
        run.id,
        'Correlation tuning changed — recomputing all fingerprints under the new weights/thresholds.',
      );
      const summary = await this.correlation.recomputeAll(
        (msg, data) => this.log.technical(run.id, msg, data),
      );
      await this.log.technical(run.id, 'Full recompute finished.', {
        ...summary,
      });
      const text = formatSummary(summary);
      await this.audit.complete(run.id, text);
      await this.log.business(run.id, `Recompute finished: ${text}`);
      this.logger.log(`Config recompute run ${run.id} completed: ${text}`);
    } catch (error) {
      await this.log.error(run.id, 'TECHNICAL', 'Config recompute failed.', {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.audit.fail(run.id, error);
      throw error;
    }
  }

  /**
   * Spin up (or extend) an investigation case from assets picked in the
   * fingerprints graph. Adds each asset as evidence and optionally attaches its
   * findings. Recorded as a DUPLICATES run so the action shows in the autopilot
   * log (CaseActivity also tracks the individual mutations).
   */
  async runCaseAction(input: CaseActionInput): Promise<CaseActionResult> {
    const assetIds = [...new Set(input.assetIds)].filter(Boolean);
    const run = await this.audit.openRun(AgentKind.DUPLICATES, {
      sourceId: null,
      runnerId: null,
      cycleKey: `caseaction:${Date.now()}`,
      trigger: 'manual',
    });
    try {
      if (assetIds.length === 0) throw new Error('No assets selected.');

      let caseId = input.caseId ?? null;
      let caseTitle = '';
      let created = false;
      if (caseId) {
        const existing = await this.cases.findOne(caseId);
        if (!existing) throw new Error(`Case ${caseId} not found.`);
        caseTitle = existing.title;
      } else {
        const newCase = await this.cases.create({
          title: input.title?.trim() || 'Correlated assets',
          description: input.description?.trim() || undefined,
          severity: input.severity ?? undefined,
        });
        caseId = newCase.id;
        caseTitle = newCase.title;
        created = true;
        await this.audit.recordDecision(run.id, {
          action: 'CREATE_CASE',
          outcome: 'APPLIED',
          entityType: 'case',
          entityId: caseId,
          rationale: `Created case "${caseTitle}" from ${assetIds.length} correlated asset(s) selected in the fingerprints graph.`,
        });
      }

      let assetsAdded = 0;
      for (const entityId of assetIds) {
        try {
          await this.cases.addEvidence(caseId, {
            entityType: 'asset',
            entityId,
          });
          assetsAdded++;
        } catch (err) {
          // Already-evidence or transient — keep going.
          this.logger.debug(
            `addEvidence skipped for ${entityId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      let findingsAttached = 0;
      if (input.attachFindings) {
        const findingIds = await this.correlation.findingIdsForAssets(assetIds);
        if (findingIds.length > 0) {
          const res = await this.cases.attachFindings(caseId, { findingIds });
          findingsAttached = res.attached;
        }
      }

      await this.audit.recordDecision(run.id, {
        action: 'ADD_EVIDENCE',
        outcome: 'APPLIED',
        entityType: 'case',
        entityId: caseId,
        rationale: `Added ${assetsAdded} asset(s)${input.attachFindings ? ` and ${findingsAttached} finding(s)` : ''} to case "${caseTitle}" from the fingerprints graph.`,
      });

      const text = `${created ? 'created' : 'updated'} case "${caseTitle}": +${assetsAdded} assets, +${findingsAttached} findings`;
      await this.audit.complete(run.id, text);
      await this.log.business(run.id, `Fingerprints → case: ${text}`);
      return { caseId, caseTitle, created, assetsAdded, findingsAttached };
    } catch (error) {
      await this.log.error(run.id, 'TECHNICAL', 'Case action failed.', {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.audit.fail(run.id, error);
      throw error;
    }
  }
}

function formatSummary(s: {
  assetsProcessed: number;
  valuesIndexed: number;
  relatedPairs: number;
  duplicatePairs: number;
  clustersTouched: number;
  topMatch: { weighted: number; reasons: string[] } | null;
}): string {
  const parts = [
    `fingerprinted ${s.assetsProcessed} asset(s) (${s.valuesIndexed} values)`,
    `${s.duplicatePairs} duplicate pair(s)`,
    `${s.relatedPairs} related pair(s)`,
    `${s.clustersTouched} cluster(s) touched`,
  ];
  if (s.topMatch) {
    parts.push(
      `top match ${Math.round(s.topMatch.weighted * 100)}% (${s.topMatch.reasons.join(', ')})`,
    );
  }
  return parts.join('; ');
}
