import { Injectable } from '@nestjs/common';
import {
  AiManagementMode,
  CaseStatus,
  CaseThreadEntryType,
  CaseThreadKind,
  EvidenceStance,
  HypothesisStatus,
  InquiryStatus,
  Severity,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { InquiriesService } from '../inquiries.service';
import { CasesService } from '../cases.service';
import { CaseThreadsService } from '../case-threads.service';
import { GraphService } from '../graph.service';
import { AgentSearchService } from './search/agent-search.service';
import { AI_ACTOR } from './autopilot.constants';
import type { CaseOperation, InquiryMatcherProposal } from './autopilot.types';

type SeverityLiteral = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** Aggregated outcome of a harness run, formatted by the worker. */
export interface ApplySummary {
  applied: number;
  skippedObserveOnly: number;
  failed: number;
  createdInquiries: Array<{ id: string; title: string }>;
  createdCases: Array<{ id: string; title: string }>;
  caseReadyInquiryIds: string[];
}

/**
 * Domain mutation primitives for the investigation tools. Each method performs
 * validation + the mutation only — it throws on invalid input so the
 * ToolDispatcher records FAILED. Auditing, OBSERVE_ONLY gating and dedupe live
 * in the dispatcher; the `*Gate` helpers feed it the effective management mode.
 */
@Injectable()
export class DecisionApplierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inquiries: InquiriesService,
    private readonly cases: CasesService,
    private readonly threads: CaseThreadsService,
    private readonly graph: GraphService,
    private readonly search: AgentSearchService,
  ) {}

  // ── Gates ────────────────────────────────────────────────────────────────

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

  /** Effective mode for an inquiry (unknown id → MANAGED so the handler fails). */
  async inquiryGate(
    inquiryId: string,
    instanceEnabled: boolean,
  ): Promise<AiManagementMode> {
    const existing = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: { aiMode: true },
    });
    if (!existing) return AiManagementMode.MANAGED;
    return this.effectiveMode(existing.aiMode, instanceEnabled);
  }

  /** Effective mode for a case (unknown id → MANAGED so the handler fails). */
  async caseGate(
    caseId: string,
    instanceEnabled: boolean,
  ): Promise<AiManagementMode> {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { aiMode: true },
    });
    if (!existing) return AiManagementMode.MANAGED;
    return this.effectiveMode(existing.aiMode, instanceEnabled);
  }

  /** Effective mode for a source (unknown id → MANAGED so the handler fails). */
  async sourceGate(
    sourceId: string,
    instanceEnabled: boolean,
  ): Promise<AiManagementMode> {
    const existing = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { aiMode: true },
    });
    if (!existing) return AiManagementMode.MANAGED;
    return this.effectiveMode(existing.aiMode, instanceEnabled);
  }

  /** Effective mode for a custom detector (unknown id → MANAGED). */
  async detectorGate(
    detectorId: string,
    instanceEnabled: boolean,
  ): Promise<AiManagementMode> {
    const existing = await this.prisma.customDetector.findUnique({
      where: { id: detectorId },
      select: { aiMode: true },
    });
    if (!existing) return AiManagementMode.MANAGED;
    return this.effectiveMode(existing.aiMode, instanceEnabled);
  }

  // ── Inquiry primitives ─────────────────────────────────────────────────────

  async createInquiryCore(
    proposal: InquiryMatcherProposal,
  ): Promise<{ id: string; title: string }> {
    const invalid = invalidRegexes(proposal);
    if (!proposal.title) throw new Error('title required');
    if (invalid.length > 0) throw new Error(invalid.join('; '));
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
    return { id: created.id, title: created.title };
  }

  async updateInquiryCore(
    inquiryId: string,
    proposal: InquiryMatcherProposal,
    enrich: boolean,
  ): Promise<void> {
    const invalid = invalidRegexes(proposal);
    if (invalid.length > 0) throw new Error(invalid.join('; '));
    const existing = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
    });
    if (!existing) throw new Error('Unknown inquiryId');
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
  }

  // ── Case primitives ─────────────────────────────────────────────────────────

  async createCaseCore(input: {
    title: string;
    description?: string;
    severity?: SeverityLiteral;
  }): Promise<{ id: string; title: string }> {
    if (!input.title) throw new Error('title required');
    const created = await this.cases.create({
      title: input.title,
      description: input.description,
      severity: input.severity ? Severity[input.severity] : undefined,
      createdBy: AI_ACTOR,
    });
    return { id: created.id, title: created.title };
  }

  async updateCaseFieldsCore(
    caseId: string,
    input: {
      title?: string;
      description?: string;
      severity?: SeverityLiteral;
    },
  ): Promise<void> {
    if (!(await this.idExists('case', caseId)))
      throw new Error('Unknown caseId');
    await this.cases.update(
      caseId,
      {
        title: input.title,
        description: input.description,
        severity: input.severity ? Severity[input.severity] : undefined,
      },
      AI_ACTOR,
    );
  }

  /**
   * Close a case with a written conclusion (the explanation). Reuses
   * CasesService.close(), which also archives the case's linked inquiries.
   */
  async closeCaseCore(
    caseId: string,
    conclusion: string,
  ): Promise<{ archivedInquiries: number }> {
    if (!(await this.idExists('case', caseId)))
      throw new Error('Unknown caseId');
    if (!conclusion || conclusion.trim().length === 0)
      throw new Error('A conclusion is required to close a case');
    const result = await this.cases.close(caseId, {
      conclusion,
      closedBy: AI_ACTOR,
    });
    return { archivedInquiries: result.archivedInquiries };
  }

  /**
   * Reopen a closed case (e.g. the issue recurred) and reactivate the inquiries
   * that were archived when it closed, so monitoring resumes.
   */
  async reopenCaseCore(
    caseId: string,
    note: string,
  ): Promise<{ reactivatedInquiries: number }> {
    if (!(await this.idExists('case', caseId)))
      throw new Error('Unknown caseId');
    const result = await this.cases.reopen(caseId, {
      note,
      reopenedBy: AI_ACTOR,
    });
    return { reactivatedInquiries: result.reactivatedInquiries };
  }

  /**
   * Archive or reactivate an inquiry. On reactivation we rematch so the revived
   * monitor reflects current findings.
   */
  async setInquiryStatusCore(
    inquiryId: string,
    status: 'ACTIVE' | 'ARCHIVED',
  ): Promise<void> {
    if (!(await this.idExists('inquiry', inquiryId)))
      throw new Error('Unknown inquiryId');
    await this.inquiries.update(inquiryId, { status: InquiryStatus[status] });
    if (status === 'ACTIVE') {
      await this.inquiries.rematch(inquiryId);
    }
  }

  /**
   * Apply one case operation (validation + mutation only). Throws on invalid
   * input; the ToolDispatcher owns the audit/gate.
   */
  async applyCaseOperationCore(
    caseId: string,
    op: CaseOperation,
  ): Promise<void> {
    switch (op.op) {
      case 'ADD_HYPOTHESIS': {
        if (!op.title) throw new Error('title required');
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
        return;
      }
      case 'UPDATE_HYPOTHESIS': {
        if (!op.threadId) throw new Error('threadId required');
        if (!(await this.idExists('caseThread', op.threadId)))
          throw new Error('Unknown threadId');
        await this.threads.update(op.threadId, {
          title: op.title,
          status: op.hypothesisStatus
            ? HypothesisStatus[op.hypothesisStatus]
            : undefined,
          confidence: op.confidence,
          actor: AI_ACTOR,
        });
        return;
      }
      case 'ADD_EVIDENCE': {
        if (!op.assetId) throw new Error('assetId required');
        if (!(await this.idExists('asset', op.assetId)))
          throw new Error('Unknown assetId');
        await this.cases.addEvidence(caseId, {
          entityType: 'asset',
          entityId: op.assetId,
          note: op.note,
          addedBy: AI_ACTOR,
        });
        return;
      }
      case 'ATTACH_FINDINGS': {
        const ids = op.findingIds ?? [];
        if (ids.length === 0) throw new Error('findingIds required');
        const existing = await this.search.existingIds('finding', ids);
        const valid = ids.filter((id) => existing.has(id));
        if (valid.length === 0) throw new Error('No valid findingIds');
        await this.cases.attachFindings(caseId, {
          findingIds: valid,
          addedBy: AI_ACTOR,
        });
        return;
      }
      case 'ADD_NOTE': {
        const body = op.body ?? op.note;
        if (!body) throw new Error('body required');
        const threadId = await this.resolveNotesThread(caseId);
        await this.threads.addEntry(threadId, {
          entryType: CaseThreadEntryType.NOTE,
          body,
          author: AI_ACTOR,
        });
        return;
      }
      case 'ADD_THREAD_ENTRY': {
        const entryBody = op.body ?? op.note;
        if (!op.threadId || !entryBody)
          throw new Error('threadId and body required');
        if (!(await this.idExists('caseThread', op.threadId)))
          throw new Error('Unknown threadId');
        await this.threads.addEntry(op.threadId, {
          entryType: CaseThreadEntryType.NOTE,
          body: entryBody,
          author: AI_ACTOR,
        });
        return;
      }
      case 'CREATE_EDGE': {
        if (
          !op.fromType ||
          !op.fromId ||
          !op.toType ||
          !op.toId ||
          !op.relationType
        ) {
          throw new Error('fromType/fromId/toType/toId/relationType required');
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
        if (!fromOk || !toOk) throw new Error('Unknown edge endpoint id');
        await this.graph.createManualEdge({
          fromType: op.fromType,
          fromId: op.fromId,
          toType: op.toType,
          toId: op.toId,
          relationType: op.relationType,
          confidence: op.confidence,
        });
        return;
      }
      case 'REMOVE_EDGE': {
        if (!op.edgeId) throw new Error('edgeId required');
        await this.graph.deleteEdge(op.edgeId);
        return;
      }
      case 'LINK_SUPPORT': {
        if (!op.threadId || !op.targetType || !op.targetId)
          throw new Error('threadId, targetType and targetId required');
        if (!(await this.idExists('caseThread', op.threadId)))
          throw new Error('Unknown threadId');
        await this.threads.linkSupport(op.threadId, {
          targetType: op.targetType,
          targetId: op.targetId,
          stance: op.stance ? EvidenceStance[op.stance] : undefined,
          note: op.note,
        });
        return;
      }
      case 'CHANGE_STATUS': {
        if (!op.caseStatus && !op.severity)
          throw new Error('caseStatus or severity required');
        await this.cases.update(
          caseId,
          {
            status: op.caseStatus ? CaseStatus[op.caseStatus] : undefined,
            severity: op.severity ? Severity[op.severity] : undefined,
          },
          AI_ACTOR,
        );
        return;
      }
      case 'LINK_INQUIRY': {
        const ids = op.inquiryIds ?? [];
        if (ids.length === 0) throw new Error('inquiryIds required');
        const existing = await this.search.existingIds('inquiry', ids);
        const valid = ids.filter((id) => existing.has(id));
        if (valid.length === 0) throw new Error('No valid inquiryIds');
        await this.cases.linkInquiries(caseId, { inquiryIds: valid }, AI_ACTOR);
        return;
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async idExists(
    model: 'inquiry' | 'case' | 'finding' | 'asset' | 'caseThread',
    id: string,
  ): Promise<boolean> {
    return (await this.search.existingIds(model, [id])).has(id);
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
}

const AUTOPILOT_NOTES_THREAD_TITLE = 'Autopilot notes';

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
