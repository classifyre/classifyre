import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CaseActivityType,
  CaseLead,
  CaseLeadOrigin,
  CaseLeadStatus,
} from '@prisma/client';
import { PrismaService } from './prisma.service';
import { CaseActivityService } from './case-activity.service';
import { EmbeddingService } from './embedding/embedding.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import { AgentMemoryService } from './autopilot/memory/agent-memory.service';
import { GraphService } from './graph.service';

const MAX_SEED_FINDINGS = 10;
const NEIGHBORS_PER_SEED = 5;
const MAX_PROPOSALS_PER_RUN = 20;
const MIN_NEIGHBOR_SIMILARITY = 0.7;
const MIN_INQUIRY_IMPORTANCE = 0.75;

/**
 * Lead triage for cases: ranked candidates (semantic neighbours of accepted
 * evidence, high-importance inquiry matches, agent/manual proposals) that a
 * human accepts into evidence or dismisses. A dismissed lead's row persists,
 * so the same finding is never re-proposed for that case, and a decision
 * precedent is written so agents learn the rejection.
 */
@Injectable()
export class CaseLeadsService {
  private readonly logger = new Logger(CaseLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CaseActivityService,
    private readonly embeddings: EmbeddingService,
    private readonly matching: InquiryMatchingService,
    private readonly agentMemory: AgentMemoryService,
    private readonly graph: GraphService,
  ) {}

  async list(caseId: string, status?: CaseLeadStatus) {
    const leads = await this.prisma.caseLead.findMany({
      where: { caseId, ...(status ? { status } : {}) },
      orderBy: [
        { importance: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });
    return leads.map((lead) => this.toDto(lead));
  }

  /** Propose one lead (manual bookmark or agent proposal). Idempotent per (case, finding). */
  async propose(
    caseId: string,
    input: {
      findingId: string;
      rationale: string;
      origin: CaseLeadOrigin;
      proposedBy: string;
      similarity?: number;
    },
  ) {
    const finding = await this.prisma.finding.findUnique({
      where: { id: input.findingId },
      include: { evidenceAnalysis: true },
    });
    if (!finding)
      throw new NotFoundException(`Finding ${input.findingId} not found`);
    if (String(finding.status) !== 'OPEN') {
      throw new BadRequestException(
        `Finding ${input.findingId} has already been reviewed and cannot be proposed`,
      );
    }
    const alreadyEvidence = await this.prisma.caseFinding.findUnique({
      where: { caseId_findingId: { caseId, findingId: input.findingId } },
    });
    if (alreadyEvidence) {
      return { created: false, reason: 'already attached as evidence' };
    }
    const existing = await this.prisma.caseLead.findUnique({
      where: { caseId_findingId: { caseId, findingId: input.findingId } },
    });
    if (existing) {
      return {
        created: false,
        reason: `already ${existing.status.toLowerCase()}`,
        lead: this.toDto(existing),
      };
    }
    const lead = await this.prisma.caseLead.create({
      data: {
        caseId,
        findingId: finding.id,
        assetId: finding.assetId,
        origin: input.origin,
        rationale: input.rationale,
        title: `${finding.findingType}: ${finding.matchedContent.slice(0, 120)}`,
        importance: finding.evidenceAnalysis?.importanceScore ?? null,
        similarity: input.similarity ?? null,
        proposedBy: input.proposedBy,
      },
    });
    await this.activity.record(
      caseId,
      CaseActivityType.LEAD_PROPOSED,
      {
        leadId: lead.id,
        findingId: finding.id,
        label: lead.title,
        origin: input.origin,
      },
      input.proposedBy,
    );
    return { created: true, lead: this.toDto(lead) };
  }

  /**
   * Generate leads for a case from its own evidence: semantic neighbours of
   * attached findings plus high-importance matches of linked inquiries.
   * Deterministic and bounded; safe to re-run (existing leads are skipped).
   */
  async generate(caseId: string, requestedBy = 'user') {
    await this.ensureCase(caseId);
    const [attached, existingLeads, linkedInquiries] = await Promise.all([
      this.prisma.caseFinding.findMany({
        where: { caseId },
        orderBy: { createdAt: 'desc' },
        take: MAX_SEED_FINDINGS,
        select: { findingId: true, label: true },
      }),
      this.prisma.caseLead.findMany({
        where: { caseId },
        select: { findingId: true },
      }),
      this.prisma.caseInquiry.findMany({
        where: { caseId },
        select: { inquiryId: true },
      }),
    ]);
    const attachedIds = new Set(
      (
        await this.prisma.caseFinding.findMany({
          where: { caseId },
          select: { findingId: true },
        })
      ).map((row) => row.findingId),
    );
    const known = new Set([
      ...attachedIds,
      ...existingLeads.map((lead) => lead.findingId),
    ]);

    type Candidate = {
      findingId: string;
      origin: CaseLeadOrigin;
      rationale: string;
      similarity?: number;
      importance: number | null;
    };
    const candidates = new Map<string, Candidate>();

    for (const seed of attached) {
      let neighbors: Awaited<ReturnType<EmbeddingService['similarFindings']>> =
        [];
      try {
        neighbors = await this.embeddings.similarFindings(
          seed.findingId,
          NEIGHBORS_PER_SEED,
        );
      } catch {
        continue; // seed has no embedding yet
      }
      for (const neighbor of neighbors) {
        if (known.has(neighbor.id) || candidates.has(neighbor.id)) continue;
        if (String(neighbor.status) !== 'OPEN') continue;
        if (neighbor.similarity < MIN_NEIGHBOR_SIMILARITY) continue;
        candidates.set(neighbor.id, {
          findingId: neighbor.id,
          origin: 'SEMANTIC_NEIGHBOR',
          rationale: `Semantically similar (${Math.round(neighbor.similarity * 100)}%) to attached evidence "${seed.label}"`,
          similarity: neighbor.similarity,
          importance: neighbor.evidenceAnalysis?.importanceScore ?? null,
        });
      }
    }

    for (const { inquiryId } of linkedInquiries) {
      const matches = await this.matching.getLiveMatches(inquiryId, {
        limit: 50,
      });
      for (const match of matches.items) {
        if (known.has(match.findingId) || candidates.has(match.findingId))
          continue;
        const importance = match.ranking?.importance ?? null;
        if (importance === null || importance < MIN_INQUIRY_IMPORTANCE)
          continue;
        candidates.set(match.findingId, {
          findingId: match.findingId,
          origin: 'INQUIRY',
          rationale: `High-importance match (${Math.round(importance * 100)}) of a linked inquiry`,
          importance,
        });
      }
    }

    const ranked = [...candidates.values()]
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
      .slice(0, MAX_PROPOSALS_PER_RUN);
    let created = 0;
    for (const candidate of ranked) {
      const result = await this.propose(caseId, {
        findingId: candidate.findingId,
        rationale: candidate.rationale,
        origin: candidate.origin,
        proposedBy: requestedBy,
        similarity: candidate.similarity,
      });
      if (result.created) created++;
    }
    return { proposed: created, considered: candidates.size };
  }

  /** Accept a lead into evidence or dismiss it (with a remembered precedent). */
  async review(
    caseId: string,
    leadId: string,
    action: 'ACCEPT' | 'DISMISS',
    reviewedBy = 'user',
    reason?: string,
  ) {
    if (action !== 'ACCEPT' && action !== 'DISMISS') {
      throw new BadRequestException('action must be ACCEPT or DISMISS');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const lead = await tx.caseLead.findUnique({ where: { id: leadId } });
      if (!lead || lead.caseId !== caseId) {
        throw new NotFoundException(
          `Lead ${leadId} not found in case ${caseId}`,
        );
      }
      if (lead.status !== 'PROPOSED') {
        return {
          updated: false as const,
          status: lead.status,
          lead,
          assetId: null,
        };
      }

      let assetId: string | null = null;
      if (action === 'ACCEPT') {
        const finding = await tx.finding.findUnique({
          where: { id: lead.findingId },
          select: {
            id: true,
            assetId: true,
            findingType: true,
            severity: true,
            detectorType: true,
            customDetectorName: true,
            matchedContent: true,
            asset: {
              select: { name: true, assetType: true, sourceType: true },
            },
          },
        });
        if (!finding) {
          throw new BadRequestException(
            `Lead ${leadId} is stale because finding ${lead.findingId} no longer exists`,
          );
        }
        assetId = finding.assetId;
        const claimed = await tx.caseLead.updateMany({
          where: { id: leadId, caseId, status: 'PROPOSED' },
          data: { status: 'ACCEPTED', reviewedBy, reviewedAt: new Date() },
        });
        if (claimed.count === 0) {
          const current = await tx.caseLead.findUniqueOrThrow({
            where: { id: leadId },
          });
          return {
            updated: false as const,
            status: current.status,
            lead: current,
            assetId: null,
          };
        }
        const evidence = await tx.caseEvidence.upsert({
          where: {
            caseId_entityType_entityId: {
              caseId,
              entityType: 'asset',
              entityId: finding.assetId,
            },
          },
          create: {
            caseId,
            entityType: 'asset',
            entityId: finding.assetId,
            label: finding.asset?.name ?? null,
            assetType: finding.asset?.assetType ?? null,
            sourceType: finding.asset ? String(finding.asset.sourceType) : null,
            addedBy: reviewedBy,
          },
          update: {},
          select: { id: true },
        });
        await tx.caseFinding.createMany({
          data: [
            {
              caseId,
              caseEvidenceId: evidence.id,
              findingId: finding.id,
              label: finding.findingType,
              severity: String(finding.severity),
              detectorType: String(finding.detectorType),
              customDetectorName: finding.customDetectorName ?? null,
              matchedContent: finding.matchedContent,
            },
          ],
          skipDuplicates: true,
        });
        await this.activity.record(
          caseId,
          CaseActivityType.LEAD_ACCEPTED,
          { leadId, findingId: lead.findingId, label: lead.title },
          reviewedBy,
          tx,
        );
        return {
          updated: true as const,
          status: CaseLeadStatus.ACCEPTED,
          lead,
          assetId,
        };
      }

      const claimed = await tx.caseLead.updateMany({
        where: { id: leadId, caseId, status: 'PROPOSED' },
        data: { status: 'DISMISSED', reviewedBy, reviewedAt: new Date() },
      });
      if (claimed.count === 0) {
        const current = await tx.caseLead.findUniqueOrThrow({
          where: { id: leadId },
        });
        return {
          updated: false as const,
          status: current.status,
          lead: current,
          assetId: null,
        };
      }
      await this.activity.record(
        caseId,
        CaseActivityType.LEAD_DISMISSED,
        { leadId, findingId: lead.findingId, label: lead.title, reason },
        reviewedBy,
        tx,
      );
      return {
        updated: true as const,
        status: CaseLeadStatus.DISMISSED,
        lead,
        assetId: null,
      };
    });

    if (
      result.updated &&
      result.status === CaseLeadStatus.ACCEPTED &&
      result.assetId
    ) {
      await this.graph.inferEdgesForAsset(result.assetId);
      return { updated: true, status: result.status };
    }
    if (!result.updated || result.status !== CaseLeadStatus.DISMISSED) {
      return { updated: result.updated, status: result.status };
    }
    // Teach the agents: this candidate was reviewed and rejected for this case.
    await this.agentMemory
      .writeMany(
        [
          {
            kind: 'DECISION_PRECEDENT',
            key: `dismissed-lead-${caseId}-${result.lead.findingId}`,
            content: `Lead "${result.lead.title}" was dismissed for case ${caseId}${reason ? `: ${reason}` : ''}. Do not re-propose this finding for this case.`,
            tags: ['lead-dismissal'],
          },
        ],
        { refType: 'case', refId: caseId },
        'OPERATOR',
        reviewedBy,
      )
      .catch((error) =>
        this.logger.warn(
          `Failed to record lead-dismissal precedent: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    return { updated: true, status: result.status };
  }

  private async ensureCase(caseId: string) {
    const exists = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Case ${caseId} not found`);
  }

  private toDto(lead: CaseLead) {
    return {
      id: lead.id,
      caseId: lead.caseId,
      findingId: lead.findingId,
      assetId: lead.assetId,
      origin: String(lead.origin),
      status: String(lead.status),
      rationale: lead.rationale,
      title: lead.title,
      importance: lead.importance,
      similarity: lead.similarity,
      proposedBy: lead.proposedBy,
      reviewedBy: lead.reviewedBy,
      reviewedAt: lead.reviewedAt,
      createdAt: lead.createdAt,
    };
  }
}
