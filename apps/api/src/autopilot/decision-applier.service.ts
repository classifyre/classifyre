import { Injectable, Logger } from '@nestjs/common';
import {
  AgentDecisionAction,
  AgentDecisionOutcome,
  AiManagementMode,
  CaseStatus,
  CaseThreadEntryType,
  CaseThreadKind,
  HypothesisStatus,
  Severity,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { InquiriesService } from '../inquiries.service';
import { CasesService } from '../cases.service';
import { CaseThreadsService } from '../case-threads.service';
import { GraphService } from '../graph.service';
import { AgentAuditService } from './audit/agent-audit.service';
import { AgentSearchService } from './search/agent-search.service';
import { AI_ACTOR } from './autopilot.constants';
import type {
  CaseDecision,
  CaseOperation,
  InquiryDecision,
  InquiryMatcherProposal,
} from './autopilot.types';

export interface ApplySummary {
  applied: number;
  skippedObserveOnly: number;
  failed: number;
  /** Inquiries created this cycle: id + title (for topic memory). */
  createdInquiries: Array<{ id: string; title: string }>;
  /** Cases created this cycle. */
  createdCases: Array<{ id: string; title: string }>;
  /** Inquiry ids the model flagged as ready to become a case. */
  caseReadyInquiryIds: string[];
}

interface AutopilotFlags {
  inquiryEnabled: boolean;
  caseEnabled: boolean;
}

/**
 * Single chokepoint between LLM output and the domain. Responsibilities:
 *  - resolve the effective AI-management mode (entity aiMode → instance flag)
 *    and never mutate OBSERVE_ONLY entities;
 *  - validate every referenced id and regex before mutating (hallucination guard);
 *  - record one AgentDecision per item — APPLIED, SKIPPED_OBSERVE_ONLY or
 *    FAILED — always with the model's rationale;
 *  - stay idempotent across run resumes via per-decision dedupe keys.
 */
@Injectable()
export class DecisionApplierService {
  private readonly logger = new Logger(DecisionApplierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inquiries: InquiriesService,
    private readonly cases: CasesService,
    private readonly threads: CaseThreadsService,
    private readonly graph: GraphService,
    private readonly audit: AgentAuditService,
    private readonly search: AgentSearchService,
  ) {}

  // ── Inquiry decisions ───────────────────────────────────────────────────────

  async applyInquiryDecisions(
    runId: string,
    decisions: InquiryDecision[],
    flags: AutopilotFlags,
  ): Promise<ApplySummary> {
    const summary = emptySummary();

    for (const [index, decision] of decisions.entries()) {
      const dedupeKey = `inquiry:${index}:${decision.action}`;
      if (await this.audit.hasDecision(runId, dedupeKey)) continue;

      try {
        await this.applyOneInquiryDecision(
          runId,
          decision,
          dedupeKey,
          flags,
          summary,
        );
      } catch (error) {
        summary.failed++;
        await this.audit.recordDecision(runId, {
          action: toDecisionAction(decision.action),
          outcome: AgentDecisionOutcome.FAILED,
          rationale: decision.rationale,
          entityType: 'inquiry',
          entityId: decision.inquiryId,
          payload: {
            error: error instanceof Error ? error.message : String(error),
            decision: asJson(decision),
          },
          dedupeKey,
        });
        this.logger.warn(
          `Inquiry decision ${decision.action} failed: ${String(error)}`,
        );
      }
    }
    return summary;
  }

  private async applyOneInquiryDecision(
    runId: string,
    decision: InquiryDecision,
    dedupeKey: string,
    flags: AutopilotFlags,
    summary: ApplySummary,
  ): Promise<void> {
    const record = (input: {
      outcome: AgentDecisionOutcome;
      entityId?: string;
      payload?: Record<string, unknown>;
    }) =>
      this.audit.recordDecision(runId, {
        action: toDecisionAction(decision.action),
        outcome: input.outcome,
        rationale: decision.rationale,
        entityType: 'inquiry',
        entityId: input.entityId ?? decision.inquiryId,
        payload: input.payload,
        dedupeKey,
      });

    switch (decision.action) {
      case 'NO_ACTION': {
        await this.audit.recordDecision(runId, {
          action: AgentDecisionAction.NO_ACTION,
          outcome: AgentDecisionOutcome.APPLIED,
          rationale: decision.rationale,
          dedupeKey,
        });
        return;
      }

      case 'SIGNAL_CASE_READY': {
        const inquiryId = decision.inquiryId;
        if (!inquiryId || !(await this.inquiryExists(inquiryId))) {
          summary.failed++;
          await record({
            outcome: AgentDecisionOutcome.FAILED,
            payload: { error: 'Unknown inquiryId' },
          });
          return;
        }
        // Pure signal — no mutation. The case agent picks it up from this run's decisions.
        summary.caseReadyInquiryIds.push(inquiryId);
        summary.applied++;
        await record({
          outcome: AgentDecisionOutcome.APPLIED,
          entityId: inquiryId,
        });
        return;
      }

      case 'CREATE_INQUIRY': {
        const proposal = decision.inquiry;
        const invalid = proposal
          ? invalidRegexes(proposal)
          : ['missing inquiry proposal'];
        if (!proposal?.title || invalid.length > 0) {
          summary.failed++;
          await record({
            outcome: AgentDecisionOutcome.FAILED,
            payload: {
              error: `Invalid proposal: ${invalid.join('; ') || 'title required'}`,
              proposal: asJson(proposal),
            },
          });
          return;
        }
        if (!flags.inquiryEnabled) {
          summary.skippedObserveOnly++;
          await record({
            outcome: AgentDecisionOutcome.SKIPPED_OBSERVE_ONLY,
            payload: { proposal: asJson(proposal) },
          });
          return;
        }
        const created = await this.inquiries.create({
          title: proposal.title,
          description: proposal.description,
          createdBy: AI_ACTOR,
          matchAllSources: proposal.matchAllSources,
          sourceIds: proposal.sourceIds,
          detectorTypes: proposal.detectorTypes,
          customDetectorKeys: proposal.customDetectorKeys,
          findingTypes: proposal.findingTypes,
          findingTypeRegex: proposal.findingTypeRegex,
          findingValueRegex: proposal.findingValueRegex,
        });
        summary.applied++;
        summary.createdInquiries.push({ id: created.id, title: created.title });
        await record({
          outcome: AgentDecisionOutcome.APPLIED,
          entityId: created.id,
          payload: { proposal: asJson(proposal) },
        });
        return;
      }

      case 'UPDATE_INQUIRY':
      case 'ENRICH_INQUIRY_MATCHERS': {
        const inquiryId = decision.inquiryId;
        const proposal = decision.inquiry ?? {};
        const invalid = invalidRegexes(proposal);
        if (!inquiryId || invalid.length > 0) {
          summary.failed++;
          await record({
            outcome: AgentDecisionOutcome.FAILED,
            payload: {
              error: invalid.join('; ') || 'inquiryId required',
              proposal: asJson(proposal),
            },
          });
          return;
        }
        const existing = await this.prisma.inquiry.findUnique({
          where: { id: inquiryId },
        });
        if (!existing) {
          summary.failed++;
          await record({
            outcome: AgentDecisionOutcome.FAILED,
            payload: { error: 'Unknown inquiryId' },
          });
          return;
        }
        const mode = this.effectiveMode(existing.aiMode, flags.inquiryEnabled);
        if (mode !== AiManagementMode.MANAGED) {
          summary.skippedObserveOnly++;
          await record({
            outcome: AgentDecisionOutcome.SKIPPED_OBSERVE_ONLY,
            payload: { proposal: asJson(proposal) },
          });
          return;
        }
        // ENRICH merges matcher arrays with the existing config; UPDATE replaces
        // the provided fields.
        const enrich = decision.action === 'ENRICH_INQUIRY_MATCHERS';
        await this.inquiries.update(inquiryId, {
          title: proposal.title,
          description: proposal.description,
          matchAllSources: proposal.matchAllSources,
          sourceIds: mergeArr(enrich, existing.sourceIds, proposal.sourceIds),
          detectorTypes: mergeArr(
            enrich,
            existing.detectorTypes,
            proposal.detectorTypes,
          ),
          customDetectorKeys: mergeArr(
            enrich,
            existing.customDetectorKeys,
            proposal.customDetectorKeys,
          ),
          findingTypes: mergeArr(
            enrich,
            existing.findingTypes,
            proposal.findingTypes,
          ),
          findingTypeRegex: mergeArr(
            enrich,
            existing.findingTypeRegex,
            proposal.findingTypeRegex,
          ),
          findingValueRegex: mergeArr(
            enrich,
            existing.findingValueRegex,
            proposal.findingValueRegex,
          ),
        });
        summary.applied++;
        await record({
          outcome: AgentDecisionOutcome.APPLIED,
          payload: { proposal: asJson(proposal), enrich },
        });
        return;
      }
    }
  }

  // ── Case decisions ──────────────────────────────────────────────────────────

  async applyCaseDecisions(
    runId: string,
    decisions: CaseDecision[],
    flags: AutopilotFlags,
  ): Promise<ApplySummary> {
    const summary = emptySummary();

    for (const [index, decision] of decisions.entries()) {
      const dedupeKey = `case:${index}:${decision.action}`;
      if (await this.audit.hasDecision(runId, dedupeKey)) continue;

      try {
        await this.applyOneCaseDecision(
          runId,
          decision,
          index,
          dedupeKey,
          flags,
          summary,
        );
      } catch (error) {
        summary.failed++;
        await this.audit.recordDecision(runId, {
          action:
            decision.action === 'CREATE_CASE'
              ? AgentDecisionAction.CREATE_CASE
              : AgentDecisionAction.UPDATE_CASE,
          outcome: AgentDecisionOutcome.FAILED,
          rationale: decision.rationale,
          entityType: 'case',
          entityId: decision.caseId,
          payload: {
            error: error instanceof Error ? error.message : String(error),
            decision: asJson(decision),
          },
          dedupeKey,
        });
        this.logger.warn(
          `Case decision ${decision.action} failed: ${String(error)}`,
        );
      }
    }
    return summary;
  }

  private async applyOneCaseDecision(
    runId: string,
    decision: CaseDecision,
    index: number,
    dedupeKey: string,
    flags: AutopilotFlags,
    summary: ApplySummary,
  ): Promise<void> {
    if (decision.action === 'NO_ACTION') {
      await this.audit.recordDecision(runId, {
        action: AgentDecisionAction.NO_ACTION,
        outcome: AgentDecisionOutcome.APPLIED,
        rationale: decision.rationale,
        dedupeKey,
      });
      return;
    }

    let caseId = decision.caseId ?? null;

    if (decision.action === 'CREATE_CASE') {
      if (!decision.title) {
        summary.failed++;
        await this.audit.recordDecision(runId, {
          action: AgentDecisionAction.CREATE_CASE,
          outcome: AgentDecisionOutcome.FAILED,
          rationale: decision.rationale,
          entityType: 'case',
          payload: { error: 'title required', decision: asJson(decision) },
          dedupeKey,
        });
        return;
      }
      if (!flags.caseEnabled) {
        summary.skippedObserveOnly++;
        await this.audit.recordDecision(runId, {
          action: AgentDecisionAction.CREATE_CASE,
          outcome: AgentDecisionOutcome.SKIPPED_OBSERVE_ONLY,
          rationale: decision.rationale,
          entityType: 'case',
          payload: { decision: asJson(decision) },
          dedupeKey,
        });
        return;
      }
      const created = await this.cases.create({
        title: decision.title,
        description: decision.description,
        severity: decision.severity ? Severity[decision.severity] : undefined,
        createdBy: AI_ACTOR,
      });
      caseId = created.id;
      summary.applied++;
      summary.createdCases.push({ id: created.id, title: created.title });
      await this.audit.recordDecision(runId, {
        action: AgentDecisionAction.CREATE_CASE,
        outcome: AgentDecisionOutcome.APPLIED,
        rationale: decision.rationale,
        entityType: 'case',
        entityId: created.id,
        payload: { title: decision.title, severity: decision.severity },
        dedupeKey,
      });
    } else {
      // UPDATE_CASE — verify the target and its effective mode once, up front.
      if (!caseId) {
        summary.failed++;
        await this.audit.recordDecision(runId, {
          action: AgentDecisionAction.UPDATE_CASE,
          outcome: AgentDecisionOutcome.FAILED,
          rationale: decision.rationale,
          entityType: 'case',
          payload: { error: 'caseId required' },
          dedupeKey,
        });
        return;
      }
      const existing = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: { aiMode: true },
      });
      if (!existing) {
        summary.failed++;
        await this.audit.recordDecision(runId, {
          action: AgentDecisionAction.UPDATE_CASE,
          outcome: AgentDecisionOutcome.FAILED,
          rationale: decision.rationale,
          entityType: 'case',
          entityId: caseId,
          payload: { error: 'Unknown caseId' },
          dedupeKey,
        });
        return;
      }
      const mode = this.effectiveMode(existing.aiMode, flags.caseEnabled);
      if (mode !== AiManagementMode.MANAGED) {
        summary.skippedObserveOnly++;
        await this.audit.recordDecision(runId, {
          action: AgentDecisionAction.UPDATE_CASE,
          outcome: AgentDecisionOutcome.SKIPPED_OBSERVE_ONLY,
          rationale: decision.rationale,
          entityType: 'case',
          entityId: caseId,
          payload: { decision: asJson(decision) },
          dedupeKey,
        });
        return;
      }
      // Top-level field changes on the case itself.
      if (decision.title || decision.description || decision.severity) {
        await this.cases.update(
          caseId,
          {
            title: decision.title,
            description: decision.description,
            severity: decision.severity
              ? Severity[decision.severity]
              : undefined,
          },
          AI_ACTOR,
        );
      }
      summary.applied++;
      await this.audit.recordDecision(runId, {
        action: AgentDecisionAction.UPDATE_CASE,
        outcome: AgentDecisionOutcome.APPLIED,
        rationale: decision.rationale,
        entityType: 'case',
        entityId: caseId,
        dedupeKey,
      });
    }

    for (const [opIndex, op] of (decision.operations ?? []).entries()) {
      const opKey = `case:${index}:op:${opIndex}:${op.op}`;
      if (await this.audit.hasDecision(runId, opKey)) continue;
      try {
        await this.applyCaseOperation(runId, caseId, op, opKey, summary);
      } catch (error) {
        summary.failed++;
        await this.audit.recordDecision(runId, {
          action: toOperationAction(op.op),
          outcome: AgentDecisionOutcome.FAILED,
          rationale: op.rationale,
          entityType: 'case',
          entityId: caseId,
          payload: {
            error: error instanceof Error ? error.message : String(error),
            op: asJson(op),
          },
          dedupeKey: opKey,
        });
        this.logger.warn(`Case op ${op.op} failed: ${String(error)}`);
      }
    }
  }

  private async applyCaseOperation(
    runId: string,
    caseId: string,
    op: CaseOperation,
    dedupeKey: string,
    summary: ApplySummary,
  ): Promise<void> {
    const record = (
      outcome: AgentDecisionOutcome,
      payload?: Record<string, unknown>,
    ) =>
      this.audit.recordDecision(runId, {
        action: toOperationAction(op.op),
        outcome,
        rationale: op.rationale,
        entityType: 'case',
        entityId: caseId,
        payload: payload ?? { op: asJson(op) },
        dedupeKey,
      });
    const failOp = async (error: string) => {
      summary.failed++;
      await record(AgentDecisionOutcome.FAILED, { error, op: asJson(op) });
    };

    switch (op.op) {
      case 'ADD_HYPOTHESIS': {
        if (!op.title) return failOp('title required');
        await this.threads.create(caseId, {
          kind: CaseThreadKind.HYPOTHESIS,
          title: op.title,
          statement: op.statement,
          status: op.hypothesisStatus
            ? HypothesisStatus[op.hypothesisStatus]
            : undefined,
          confidence: op.confidence,
          createdBy: AI_ACTOR,
        });
        break;
      }
      case 'UPDATE_HYPOTHESIS': {
        if (!op.threadId) return failOp('threadId required');
        const threads = await this.search.existingIds('caseThread', [
          op.threadId,
        ]);
        if (!threads.has(op.threadId)) return failOp('Unknown threadId');
        await this.threads.update(op.threadId, {
          title: op.title,
          status: op.hypothesisStatus
            ? HypothesisStatus[op.hypothesisStatus]
            : undefined,
          confidence: op.confidence,
          actor: AI_ACTOR,
        });
        break;
      }
      case 'ADD_EVIDENCE': {
        if (!op.assetId) return failOp('assetId required');
        const assets = await this.search.existingIds('asset', [op.assetId]);
        if (!assets.has(op.assetId)) return failOp('Unknown assetId');
        await this.cases.addEvidence(caseId, {
          entityType: 'asset',
          entityId: op.assetId,
          note: op.note,
          addedBy: AI_ACTOR,
        });
        break;
      }
      case 'ATTACH_FINDINGS': {
        const ids = op.findingIds ?? [];
        if (ids.length === 0) return failOp('findingIds required');
        const existing = await this.search.existingIds('finding', ids);
        const valid = ids.filter((id) => existing.has(id));
        if (valid.length === 0) return failOp('No valid findingIds');
        await this.cases.attachFindings(caseId, {
          findingIds: valid,
          addedBy: AI_ACTOR,
        });
        break;
      }
      case 'ADD_NOTE': {
        if (!op.body) return failOp('body required');
        const threadId = await this.resolveNotesThread(caseId);
        await this.threads.addEntry(threadId, {
          entryType: CaseThreadEntryType.NOTE,
          body: op.body,
          author: AI_ACTOR,
        });
        break;
      }
      case 'ADD_THREAD_ENTRY': {
        if (!op.threadId || !op.body)
          return failOp('threadId and body required');
        const threads = await this.search.existingIds('caseThread', [
          op.threadId,
        ]);
        if (!threads.has(op.threadId)) return failOp('Unknown threadId');
        await this.threads.addEntry(op.threadId, {
          entryType: CaseThreadEntryType.NOTE,
          body: op.body,
          author: AI_ACTOR,
        });
        break;
      }
      case 'CREATE_EDGE': {
        if (
          !op.fromType ||
          !op.fromId ||
          !op.toType ||
          !op.toId ||
          !op.relationType
        ) {
          return failOp('fromType/fromId/toType/toId/relationType required');
        }
        const fromOk = (
          await this.search.existingIds(op.fromType as 'asset' | 'finding', [
            op.fromId,
          ])
        ).has(op.fromId);
        const toOk = (
          await this.search.existingIds(op.toType as 'asset' | 'finding', [
            op.toId,
          ])
        ).has(op.toId);
        if (!fromOk || !toOk) return failOp('Unknown edge endpoint id');
        await this.graph.createManualEdge({
          fromType: op.fromType,
          fromId: op.fromId,
          toType: op.toType,
          toId: op.toId,
          relationType: op.relationType,
          confidence: op.confidence,
        });
        break;
      }
      case 'CHANGE_STATUS': {
        if (!op.caseStatus && !op.severity)
          return failOp('caseStatus or severity required');
        await this.cases.update(
          caseId,
          {
            status: op.caseStatus ? CaseStatus[op.caseStatus] : undefined,
            severity: op.severity ? Severity[op.severity] : undefined,
          },
          AI_ACTOR,
        );
        break;
      }
      case 'LINK_INQUIRY': {
        const ids = op.inquiryIds ?? [];
        if (ids.length === 0) return failOp('inquiryIds required');
        const existing = await this.search.existingIds('inquiry', ids);
        const valid = ids.filter((id) => existing.has(id));
        if (valid.length === 0) return failOp('No valid inquiryIds');
        await this.cases.linkInquiries(caseId, { inquiryIds: valid }, AI_ACTOR);
        break;
      }
    }

    summary.applied++;
    await record(AgentDecisionOutcome.APPLIED);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Effective management mode: entity override, else the instance flag. */
  effectiveMode(
    entityMode: AiManagementMode,
    instanceEnabled: boolean,
  ): AiManagementMode {
    if (entityMode !== AiManagementMode.INHERIT) return entityMode;
    return instanceEnabled
      ? AiManagementMode.MANAGED
      : AiManagementMode.OBSERVE_ONLY;
  }

  /** Find or create the case's discussion thread for autopilot notes. */
  private async resolveNotesThread(caseId: string): Promise<string> {
    const existing = await this.prisma.caseThread.findFirst({
      where: {
        caseId,
        kind: CaseThreadKind.DISCUSSION,
        title: AUTOPILOT_NOTES_THREAD_TITLE,
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.threads.create(caseId, {
      kind: CaseThreadKind.DISCUSSION,
      title: AUTOPILOT_NOTES_THREAD_TITLE,
      createdBy: AI_ACTOR,
    });
    return created.id;
  }

  private async inquiryExists(id: string): Promise<boolean> {
    return (await this.search.existingIds('inquiry', [id])).has(id);
  }
}

const AUTOPILOT_NOTES_THREAD_TITLE = 'Autopilot notes';

function emptySummary(): ApplySummary {
  return {
    applied: 0,
    skippedObserveOnly: 0,
    failed: 0,
    createdInquiries: [],
    createdCases: [],
    caseReadyInquiryIds: [],
  };
}

function toDecisionAction(
  action: InquiryDecision['action'],
): AgentDecisionAction {
  return AgentDecisionAction[action];
}

function toOperationAction(op: CaseOperation['op']): AgentDecisionAction {
  return AgentDecisionAction[op];
}

function mergeArr<T>(
  enrich: boolean,
  existing: T[],
  proposed: T[] | undefined,
): T[] | undefined {
  if (proposed === undefined) return undefined;
  return enrich ? [...new Set([...existing, ...proposed])] : proposed;
}

function invalidRegexes(proposal: InquiryMatcherProposal): string[] {
  const errors: string[] = [];
  for (const pattern of [
    ...(proposal.findingTypeRegex ?? []),
    ...(proposal.findingValueRegex ?? []),
  ]) {
    try {
      new RegExp(pattern);
    } catch {
      errors.push(`invalid regex: ${pattern.slice(0, 60)}`);
    }
  }
  return errors;
}

// LLM output is already plain JSON; this just narrows the type for Prisma.
function asJson(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
