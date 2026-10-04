import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CaseActivityType,
  CaseLead,
  CaseLeadOrigin,
  CaseLeadStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from './prisma.service';
import {
  CaseActivityService,
  type ActivityPayload,
} from './case-activity.service';
import { EmbeddingService } from './embedding/embedding.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import { AgentMemoryService } from './autopilot/memory/agent-memory.service';
import { GraphService } from './graph.service';
// Value imports: an @Optional() injection resolves from emitted metadata.
import { CaseCleanupService } from './cases/case-cleanup.service';
import {
  CaseEscalationService,
  candidateOf,
} from './cases/case-escalation.service';
import { CorrelationSwitchService } from './correlation/correlation-switch.service';
import { CASE_LEADS_ACTOR } from './cases/case-leads.constants';
import { normalizeLabel, normalizeValue } from './correlation/value-normalizer';

/** Findings of the case a refresh expands from: the newest and the most important. */
const SEEDS_RECENT = 6;
const SEEDS_IMPORTANT = 6;
const NEIGHBORS_PER_SEED = 6;
/** One seed may bring at most this many leads, so one value cannot flood a refresh. */
const LEADS_PER_SEED = 3;
const MIN_NEIGHBOR_SIMILARITY = 0.7;
// Same "high importance" standard as the express lane and the unmonitored
// signal (both 0.85 since the recurrence-bonus re-tune): the bonus lifts ~68k
// narrow-group findings over the old 0.75 bar, and leaving this one behind
// would recreate the same meaning-drift inside lead proposals.
const MIN_INQUIRY_IMPORTANCE = 0.85;
const INQUIRY_MATCHES_READ = 50;
const MAX_WATCHES_READ = 10;
/** The duplicates engine's relations that say "the same document". */
const DUPLICATE_RELATIONS = ['identical_content', 'likely_duplicate'];
const DUPLICATE_EDGES_READ = 400;
const DUPLICATES_PER_EVIDENCE = 5;
/** Evidence documents a refresh finds look-alikes of: the most recently added. */
const LOOK_ALIKE_SEEDS = 300;
/**
 * New leads per refresh, per kind: no one kind crowds the others out, and a
 * refresh never hands a person more than they can look at.
 */
const QUOTA: Record<GeneratedOrigin, number> = {
  INQUIRY: 10,
  DUPLICATE: 10,
  SEMANTIC_NEIGHBOR: 10,
  ENTITY: 10,
};
/** A case never holds more than this many leads waiting for review. */
const MAX_OPEN_LEADS = 60;
/** Origins the case proposes by itself (and may withdraw by itself). */
const GENERATED_ORIGINS = [
  'SEMANTIC_NEIGHBOR',
  'INQUIRY',
  'DUPLICATE',
  'ENTITY',
] as const;
/** Mentions of the case's entities read per refresh, newest first. */
const ENTITY_MENTIONS_READ = 200;
type GeneratedOrigin = (typeof GENERATED_ORIGINS)[number];
const VALUE_MAX = 160;

type LeadState = 'OPEN' | 'IN_CASE' | 'GONE';

interface Candidate {
  origin: GeneratedOrigin;
  findingId: string | null;
  assetId: string | null;
  title: string;
  rationale: string;
  importance: number | null;
  similarity: number | null;
  viaFindingId?: string | null;
  viaAssetId?: string | null;
  viaInquiryId?: string | null;
  details?: Record<string, unknown>;
  /** Order within its kind, best first. */
  rank: number;
}

interface CaseKnowledge {
  caseId: string;
  /**
   * Every finding a lead was ever made of. Whether a candidate is in the case
   * is asked per candidate ({@link CaseLeadsService.findingsInCase}): a case
   * fed by a broad watch holds tens of thousands of findings.
   */
  knownFindings: Set<string>;
  /** Every asset an asset lead was ever made of, and the evidence below. */
  knownAssets: Set<string>;
  /** The evidence documents look-alikes are found for, with their labels. */
  evidenceAssets: Map<string, string | null>;
  caseWideGate: (f: {
    findingType: string;
    matchedContent: string | null;
  }) => unknown;
}

export interface GenerateLeadsResult {
  proposed: number;
  considered: number;
  /** Leads the case settled: already in it another way, gone, or filtered out. */
  settled: number;
  byOrigin: Record<string, number>;
  /** The case already holds as many waiting leads as it may. */
  full?: boolean;
}

const short = (value: string | null | undefined, max = 60): string => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const pct = (value: number) => Math.round(value * 100);
const leadTitle = (label: string, value: string | null | undefined) =>
  `${label}: ${short(value, 120)}`;

/** The same value under the same label, the way the duplicates engine compares them. */
function sameValue(
  a: { findingType: string; matchedContent: string | null },
  b: { findingType: string; matchedContent: string | null },
): boolean {
  if (!a.matchedContent || !b.matchedContent) return false;
  if (normalizeLabel(a.findingType) !== normalizeLabel(b.findingType)) {
    return false;
  }
  const left = normalizeValue(a.findingType, a.matchedContent);
  return (
    left !== null && left === normalizeValue(b.findingType, b.matchedContent)
  );
}

/** Pairs are stored with `aId` < `bId`, like the edges they came from. */
const pairKey = (x: string, y: string) => (x <= y ? `${x}|${y}` : `${y}|${x}`);

/**
 * Lead triage for cases: ranked candidates that a human accepts into evidence
 * or dismisses. Four kinds come from the case itself — findings similar to
 * its evidence, important answers of its watches, documents the duplicates
 * engine pairs with its evidence, and new mentions of its entities — and two
 * from outside: Autopilot's proposals and a person's bookmarks.
 *
 * The case refreshes them by itself (CaseLeadsScheduler → CaseLeadsWorker →
 * {@link generate}). A dismissed lead's row persists, so the same finding or
 * asset is never proposed again for that case, and a decision precedent is
 * written so agents learn the rejection. A lead whose finding or asset joins
 * the case another way settles itself as accepted.
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
    @Optional() private readonly cleanup?: CaseCleanupService,
    @Optional() private readonly escalation?: CaseEscalationService,
    @Optional() private readonly duplicates?: CorrelationSwitchService,
  ) {}

  async list(caseId: string, status?: CaseLeadStatus) {
    const leads = await this.prisma.caseLead.findMany({
      where: { caseId, ...(status ? { status } : {}) },
      orderBy: [
        { importance: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });
    return this.enrich(caseId, leads);
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
        title: leadTitle(finding.findingType, finding.matchedContent),
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
   * Refresh a case's leads from its own evidence: findings similar to it,
   * important answers of its watches, and documents the duplicates engine
   * pairs with it. Settles the leads it already holds first. Deterministic,
   * bounded and safe to re-run: nothing is proposed twice.
   *
   * `automatic` refreshes (the worker) fold into one timeline entry and pass
   * quietly over a case that was deleted in the meantime.
   */
  async generate(
    caseId: string,
    requestedBy = 'user',
    opts: { automatic?: boolean } = {},
  ): Promise<GenerateLeadsResult> {
    const empty: GenerateLeadsResult = {
      proposed: 0,
      considered: 0,
      settled: 0,
      byOrigin: {},
    };
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, status: true },
    });
    if (!kase) {
      if (opts.automatic) return empty;
      throw new NotFoundException(`Case ${caseId} not found`);
    }
    // A closed case is a record: nothing new is suggested for it.
    if (kase.status === 'CLOSED' || kase.status === 'ARCHIVED') return empty;

    const settled = await this.settle(caseId);
    const [evidence, leads, linked] = await Promise.all([
      this.prisma.caseEvidence.findMany({
        where: { caseId, entityType: 'asset' },
        orderBy: { createdAt: 'desc' },
        take: LOOK_ALIKE_SEEDS,
        select: { entityId: true, label: true },
      }),
      this.prisma.caseLead.findMany({
        where: { caseId },
        select: { findingId: true, assetId: true, status: true },
      }),
      this.prisma.caseInquiry.findMany({
        where: { caseId },
        orderBy: { createdAt: 'asc' },
        take: MAX_WATCHES_READ,
        select: { inquiryId: true, inquiry: { select: { title: true } } },
      }),
    ]);
    const waiting = leads.filter((l) => l.status === 'PROPOSED').length;
    const room = MAX_OPEN_LEADS - waiting;
    if (room <= 0) return { ...empty, settled, full: true };

    // A kind of finding the investigator filtered out of the case is not a
    // lead either: case-wide filters for every candidate, a watch's own for
    // its answers.
    const knowledge: CaseKnowledge = {
      caseId,
      knownFindings: new Set(
        leads.flatMap((l) => (l.findingId ? [l.findingId] : [])),
      ),
      knownAssets: new Set([
        ...evidence.map((row) => row.entityId),
        ...leads.flatMap((l) => (!l.findingId && l.assetId ? [l.assetId] : [])),
      ]),
      evidenceAssets: new Map(evidence.map((row) => [row.entityId, row.label])),
      caseWideGate: this.cleanup
        ? await this.cleanup.pullGate(caseId, null)
        : () => null,
    };

    const byKind: Record<GeneratedOrigin, Candidate[]> = {
      INQUIRY: await this.watchAnswers(
        knowledge,
        linked.map((l) => ({ id: l.inquiryId, title: l.inquiry.title })),
      ),
      DUPLICATE: await this.lookAlikes(knowledge),
      SEMANTIC_NEIGHBOR: await this.similarContent(knowledge),
      ENTITY: await this.entityMentions(knowledge),
    };
    const considered = Object.values(byKind).reduce((n, c) => n + c.length, 0);
    const chosen = interleave(
      (Object.keys(byKind) as GeneratedOrigin[]).map((kind) =>
        byKind[kind].slice(0, QUOTA[kind]),
      ),
      room,
    );
    if (chosen.length === 0) return { ...empty, settled, considered };

    const created = await this.prisma.caseLead.createManyAndReturn({
      data: chosen.map((c) => ({
        caseId,
        findingId: c.findingId,
        assetId: c.assetId,
        origin: c.origin,
        rationale: c.rationale,
        title: c.title,
        importance: c.importance,
        similarity: c.similarity,
        viaFindingId: c.viaFindingId ?? null,
        viaAssetId: c.viaAssetId ?? null,
        viaInquiryId: c.viaInquiryId ?? null,
        details: c.details
          ? (c.details as Prisma.InputJsonValue)
          : Prisma.DbNull,
        proposedBy: requestedBy,
      })),
      // A refresh racing another (a board read and a change) must not fail on
      // the leads the other one already wrote.
      skipDuplicates: true,
      select: { origin: true, title: true },
    });
    const byOrigin: Record<string, number> = {};
    for (const lead of created) {
      byOrigin[lead.origin] = (byOrigin[lead.origin] ?? 0) + 1;
    }
    if (created.length > 0) {
      await this.recordGenerated(caseId, requestedBy, opts.automatic === true, {
        proposed: created.length,
        byOrigin,
        sample: created.slice(0, 5).map((lead) => lead.title),
      });
    }
    return { proposed: created.length, considered, settled, byOrigin };
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
      const unchanged = (status: CaseLeadStatus, current = lead) => ({
        updated: false as const,
        status,
        lead: current,
        assetId: null,
        attachedFindingId: null,
      });
      if (lead.status !== 'PROPOSED') return unchanged(lead.status);

      const claim = async (status: CaseLeadStatus) => {
        const claimed = await tx.caseLead.updateMany({
          where: { id: leadId, caseId, status: 'PROPOSED' },
          data: { status, reviewedBy, reviewedAt: new Date() },
        });
        if (claimed.count > 0) return null;
        const current = await tx.caseLead.findUniqueOrThrow({
          where: { id: leadId },
        });
        return unchanged(current.status, current);
      };

      if (action === 'DISMISS') {
        const lost = await claim('DISMISSED');
        if (lost) return lost;
        await this.activity.record(
          caseId,
          CaseActivityType.LEAD_DISMISSED,
          {
            leadId,
            findingId: lead.findingId,
            assetId: lead.findingId ? undefined : lead.assetId,
            label: lead.title,
            origin: lead.origin,
            reason,
          },
          reviewedBy,
          tx,
        );
        return {
          updated: true as const,
          status: CaseLeadStatus.DISMISSED,
          lead,
          assetId: null,
          attachedFindingId: null,
        };
      }

      // An asset lead (a look-alike document) brings the asset in; its
      // findings wait around it on the board, to be attached one by one.
      if (!lead.findingId) {
        const asset = lead.assetId
          ? await tx.asset.findUnique({
              where: { id: lead.assetId },
              select: {
                id: true,
                name: true,
                assetType: true,
                sourceType: true,
              },
            })
          : null;
        if (!asset) {
          throw new BadRequestException(
            `Lead ${leadId} is stale because its asset no longer exists`,
          );
        }
        const lost = await claim('ACCEPTED');
        if (lost) return lost;
        await tx.caseEvidence.upsert({
          where: {
            caseId_entityType_entityId: {
              caseId,
              entityType: 'asset',
              entityId: asset.id,
            },
          },
          create: {
            caseId,
            entityType: 'asset',
            entityId: asset.id,
            label: asset.name,
            assetType: asset.assetType,
            sourceType: String(asset.sourceType),
            addedBy: reviewedBy,
          },
          update: {},
        });
        await this.activity.record(
          caseId,
          CaseActivityType.LEAD_ACCEPTED,
          {
            leadId,
            assetId: asset.id,
            label: lead.title,
            origin: lead.origin,
          },
          reviewedBy,
          tx,
        );
        return {
          updated: true as const,
          status: CaseLeadStatus.ACCEPTED,
          lead,
          assetId: asset.id,
          attachedFindingId: null,
        };
      }

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
      const lost = await claim('ACCEPTED');
      if (lost) return lost;
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
      const attached = await tx.caseFinding.createMany({
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
        {
          leadId,
          findingId: lead.findingId,
          label: lead.title,
          origin: lead.origin,
        },
        reviewedBy,
        tx,
      );
      return {
        updated: true as const,
        status: CaseLeadStatus.ACCEPTED,
        lead,
        assetId: finding.assetId,
        // Only a finding that was not in the case already is an arrival.
        attachedFindingId: attached.count > 0 ? finding.id : null,
      };
    });

    if (result.updated && result.status === CaseLeadStatus.ACCEPTED) {
      if (result.assetId) await this.graph.inferEdgesForAsset(result.assetId);
      if (result.attachedFindingId) {
        await this.escalateAccepted(
          caseId,
          result.attachedFindingId,
          reviewedBy,
        );
      }
      if (result.lead.origin === 'DUPLICATE') {
        await this.markVerdictUsed(caseId, result.lead);
      }
      return { updated: true, status: result.status };
    }
    if (!result.updated || result.status !== CaseLeadStatus.DISMISSED) {
      return { updated: result.updated, status: result.status };
    }
    // Teach the agents: this candidate was reviewed and rejected for this case.
    const subject = result.lead.findingId ?? result.lead.assetId;
    await this.agentMemory
      .writeMany(
        [
          {
            kind: 'DECISION_PRECEDENT',
            key: `dismissed-lead-${caseId}-${subject}`,
            content: `Lead "${result.lead.title}" was dismissed for case ${caseId}${reason ? `: ${reason}` : ''}. Do not re-propose this ${result.lead.findingId ? 'finding' : 'asset'} for this case.`,
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

  /** Review several leads with one decision (the panel's "Dismiss all shown"). */
  async reviewMany(
    caseId: string,
    leadIds: string[],
    action: 'ACCEPT' | 'DISMISS',
    reviewedBy = 'user',
    reason?: string,
  ) {
    if (action !== 'ACCEPT' && action !== 'DISMISS') {
      throw new BadRequestException('action must be ACCEPT or DISMISS');
    }
    let updated = 0;
    let failed = 0;
    for (const leadId of [...new Set(leadIds)]) {
      try {
        const res = await this.review(
          caseId,
          leadId,
          action,
          reviewedBy,
          reason,
        );
        if (res.updated) updated++;
      } catch (error) {
        // A stale lead in a bulk decision must not stop the rest.
        failed++;
        this.logger.debug(
          `Bulk ${action.toLowerCase()} skipped lead ${leadId}: ${String(error)}`,
        );
      }
    }
    return { updated, failed };
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  /**
   * Findings similar to the case's evidence. Seeds are the newest findings of
   * the case and its most important ones, so older evidence keeps expanding
   * too. A neighbour carrying the very value of its seed says so: the same
   * IBAN in another document is a pivot, not a resemblance.
   */
  private async similarContent(k: CaseKnowledge): Promise<Candidate[]> {
    const seedIds = await this.seedFindingIds(k.caseId);
    if (seedIds.length === 0) return [];
    const seedRows = await this.prisma.finding.findMany({
      where: { id: { in: seedIds } },
      select: {
        id: true,
        findingType: true,
        matchedContent: true,
        assetId: true,
        asset: { select: { name: true } },
      },
    });
    const seeds = seedIds.flatMap((id) => {
      const row = seedRows.find((r) => r.id === id);
      return row ? [row] : [];
    });

    type Neighbours = Awaited<ReturnType<EmbeddingService['similarFindings']>>;
    const found: Array<{
      seed: (typeof seeds)[number];
      neighbours: Neighbours;
    }> = [];
    for (const seed of seeds) {
      try {
        found.push({
          seed,
          neighbours: await this.embeddings.similarFindings(
            seed.id,
            NEIGHBORS_PER_SEED,
          ),
        });
      } catch (error) {
        // Embeddings are off: no seed will do better.
        if (error instanceof ServiceUnavailableException) break;
        continue; // this seed has no embedding yet
      }
    }
    const inCase = await this.findingsInCase(
      k.caseId,
      found.flatMap((f) => f.neighbours.map((n) => n.id)),
    );

    const out = new Map<string, Candidate>();
    const valueInAsset = new Set<string>();
    for (const { seed, neighbours } of found) {
      let fromSeed = 0;
      for (const n of neighbours) {
        if (fromSeed >= LEADS_PER_SEED) break;
        if (out.has(n.id) || k.knownFindings.has(n.id) || inCase.has(n.id))
          continue;
        if (String(n.status) !== 'OPEN') continue;
        if (n.similarity < MIN_NEIGHBOR_SIMILARITY) continue;
        const candidate = {
          findingType: n.findingType,
          matchedContent: n.matchedContent ?? null,
        };
        if (k.caseWideGate(candidate)) continue;
        const same = sameValue(seed, candidate);
        // The same value twice in one document is one lead.
        const normalized = same
          ? `${n.assetId}|${normalizeValue(n.findingType, n.matchedContent ?? '')}`
          : null;
        if (normalized && valueInAsset.has(normalized)) continue;
        if (normalized) valueInAsset.add(normalized);
        const where = seed.asset?.name ? ` in "${short(seed.asset.name)}"` : '';
        out.set(n.id, {
          origin: 'SEMANTIC_NEIGHBOR',
          findingId: n.id,
          assetId: n.assetId,
          title: leadTitle(n.findingType, n.matchedContent),
          rationale: same
            ? `Same ${seed.findingType} value as the evidence${where}`
            : `${pct(n.similarity)}% similar to "${short(seed.matchedContent)}" (${seed.findingType})${where}`,
          importance: n.evidenceAnalysis?.importanceScore ?? null,
          similarity: n.similarity,
          viaFindingId: seed.id,
          viaAssetId: seed.assetId,
          details: same ? { sameValue: true } : undefined,
          rank:
            (same ? 2 : 0) +
            (n.evidenceAnalysis?.importanceScore ?? 0) +
            n.similarity,
        });
        fromSeed++;
      }
    }
    return [...out.values()].sort((a, b) => b.rank - a.rank);
  }

  /** Which of these findings are in the case already. */
  private async findingsInCase(
    caseId: string,
    findingIds: string[],
  ): Promise<Set<string>> {
    const ids = [...new Set(findingIds)];
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.caseFinding.findMany({
      where: { caseId, findingId: { in: ids } },
      select: { findingId: true },
    });
    return new Set(rows.map((row) => row.findingId));
  }

  /** The newest findings of the case and its most important ones, newest first. */
  private async seedFindingIds(caseId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ finding_id: string }>>`
      (SELECT cf.finding_id
         FROM case_findings cf
        WHERE cf.case_id = ${caseId}
        ORDER BY cf.created_at DESC
        LIMIT ${SEEDS_RECENT})
      UNION ALL
      (SELECT cf.finding_id
         FROM case_findings cf
         JOIN finding_evidence_analyses a ON a.finding_id = cf.finding_id
        WHERE cf.case_id = ${caseId}
        ORDER BY a.importance_score DESC
        LIMIT ${SEEDS_IMPORTANT})
    `;
    return [...new Set(rows.map((row) => row.finding_id))];
  }

  /**
   * Important answers of the case's watches that are not in it yet. With a
   * watch's auto-add off its new answers wait in the Watches panel; these are
   * the few of them worth a person's attention now.
   */
  private async watchAnswers(
    k: CaseKnowledge,
    watches: Array<{ id: string; title: string }>,
  ): Promise<Candidate[]> {
    const out = new Map<string, Candidate>();
    for (const watch of watches) {
      const matches = await this.matching.getLiveMatches(watch.id, {
        limit: INQUIRY_MATCHES_READ,
      });
      const gate = this.cleanup
        ? await this.cleanup.pullGate(k.caseId, watch.id)
        : () => null;
      const inCase = await this.findingsInCase(
        k.caseId,
        matches.items.map((m) => m.findingId),
      );
      for (const match of matches.items) {
        if (
          out.has(match.findingId) ||
          k.knownFindings.has(match.findingId) ||
          inCase.has(match.findingId)
        )
          continue;
        const importance = match.ranking?.importance ?? null;
        if (importance === null || importance < MIN_INQUIRY_IMPORTANCE)
          continue;
        if (
          gate({
            findingType: match.label,
            matchedContent: match.matchedContent ?? null,
          })
        )
          continue;
        out.set(match.findingId, {
          origin: 'INQUIRY',
          findingId: match.findingId,
          assetId: match.assetId,
          title: leadTitle(match.label, match.matchedContent),
          rationale: `Answer to the watch "${short(watch.title)}" · importance ${pct(importance)}`,
          importance,
          similarity: null,
          viaInquiryId: watch.id,
          details: match.isNew ? { isNew: true } : undefined,
          rank: importance,
        });
      }
    }
    return [...out.values()].sort((a, b) => b.rank - a.rank);
  }

  /**
   * Findings that mention an entity linked to the case and are not in it yet
   * (G5 R17), newest first: "ACME is in this case, and three documents scanned
   * since then name it". A mention is the value index's representative
   * finding for one of the entity's confirmed values in an asset, so a
   * document that repeats a name is one lead, not twenty.
   */
  private async entityMentions(k: CaseKnowledge): Promise<Candidate[]> {
    let rows: Array<{
      finding_id: string;
      asset_id: string;
      term: string;
      finding_type: string;
      matched_content: string;
      importance_score: number | null;
      seen: Date | null;
    }>;
    try {
      const config = await this.prisma.entityConfig.findUnique({
        where: { id: 1 },
        select: { enabled: true },
      });
      if (config && !config.enabled) return [];
      rows = await this.prisma.$queryRaw`
        SELECT acv.finding_id, acv.asset_id, t.term, f.finding_type,
               f.matched_content, f.importance_score,
               COALESCE(f.first_detected_at, f.detected_at) AS seen
          FROM glossary_references r
          JOIN glossary_terms t ON t.id = r.glossary_term_id
                               AND t.kind = 'ENTITY' AND t.status = 'APPROVED'
          JOIN entity_values ev ON ev.term_id = t.id AND ev.verdict = 'CONFIRMED'
          JOIN asset_correlation_values acv ON acv.value_hash = ev.value_hash
          JOIN findings f ON f.id = acv.finding_id AND f.status = 'OPEN'
         WHERE r.entity_type = 'case' AND r.entity_id = ${k.caseId} AND r.role = 'ABOUT'
         ORDER BY seen DESC NULLS LAST
         LIMIT ${ENTITY_MENTIONS_READ}`;
    } catch (error) {
      // Entities are optional to a case's leads: never fail the refresh.
      this.logger.debug(`Entity leads skipped: ${String(error)}`);
      return [];
    }
    const inCase = await this.findingsInCase(
      k.caseId,
      rows.map((row) => row.finding_id),
    );
    const out = new Map<string, Candidate>();
    for (const row of rows) {
      if (
        out.has(row.finding_id) ||
        k.knownFindings.has(row.finding_id) ||
        inCase.has(row.finding_id) ||
        k.knownAssets.has(row.asset_id)
      ) {
        continue;
      }
      if (
        k.caseWideGate({
          findingType: row.finding_type,
          matchedContent: row.matched_content,
        })
      ) {
        continue;
      }
      out.set(row.finding_id, {
        origin: 'ENTITY',
        findingId: row.finding_id,
        assetId: row.asset_id,
        title: leadTitle(row.finding_type, row.matched_content),
        rationale: `Mentions ${short(row.term)}, an entity of this case`,
        importance: row.importance_score,
        similarity: null,
        details: { entity: row.term },
        rank: row.seen ? row.seen.getTime() : 0,
      });
    }
    return [...out.values()].sort((a, b) => b.rank - a.rank);
  }

  /**
   * Documents the duplicates engine pairs with the case's evidence: a
   * byte-identical copy, or one sharing most of its weighted values. Duplicate
   * review is the authority on a pair: one marked "not a duplicate" or split is
   * never suggested, and one confirmed comes first and says so.
   */
  private async lookAlikes(k: CaseKnowledge): Promise<Candidate[]> {
    if (k.evidenceAssets.size === 0) return [];
    if (this.duplicates && !(await this.duplicates.isEnabled())) return [];
    const ids = [...k.evidenceAssets.keys()];
    const [edges, verdicts] = await Promise.all([
      this.prisma.edge.findMany({
        where: {
          relationType: { in: DUPLICATE_RELATIONS },
          OR: [
            { fromType: 'asset', fromId: { in: ids } },
            { toType: 'asset', toId: { in: ids } },
          ],
        },
        orderBy: { confidence: 'desc' },
        take: DUPLICATE_EDGES_READ,
        select: {
          fromType: true,
          fromId: true,
          toType: true,
          toId: true,
          relationType: true,
          confidence: true,
          metadata: true,
        },
      }),
      this.prisma.correlationPairVerdict.findMany({
        where: { OR: [{ aId: { in: ids } }, { bId: { in: ids } }] },
        select: { aId: true, bId: true, verdict: true, scoreAtVerdict: true },
      }),
    ]);
    const verdictOf = new Map(
      verdicts.map((v) => [pairKey(v.aId, v.bId), v] as const),
    );

    interface Pair {
      evidenceId: string;
      otherId: string;
      relation: string;
      weight: number;
      confirmed: boolean;
      sharedLabels: string[];
    }
    const pairs: Pair[] = [];
    const seen = new Set<string>();
    const consider = (pair: Pair) => {
      const key = pairKey(pair.evidenceId, pair.otherId);
      if (seen.has(key) || k.knownAssets.has(pair.otherId)) return;
      seen.add(key);
      pairs.push(pair);
    };
    for (const edge of edges) {
      if (edge.fromType !== 'asset' || edge.toType !== 'asset') continue;
      const fromIsEvidence = k.evidenceAssets.has(edge.fromId);
      const evidenceId = fromIsEvidence ? edge.fromId : edge.toId;
      const otherId = fromIsEvidence ? edge.toId : edge.fromId;
      const verdict = verdictOf.get(pairKey(evidenceId, otherId))?.verdict;
      if (verdict === 'REJECTED' || verdict === 'SPLIT') continue;
      consider({
        evidenceId,
        otherId,
        relation: edge.relationType,
        weight:
          edge.relationType === 'identical_content'
            ? 1
            : Number(edge.confidence),
        confirmed: verdict === 'CONFIRMED',
        sharedLabels: sharedLabelsOf(edge.metadata),
      });
    }
    // A pair a person confirmed is a duplicate whatever the engine called it.
    for (const v of verdicts) {
      if (v.verdict !== 'CONFIRMED') continue;
      const evidenceId = k.evidenceAssets.has(v.aId) ? v.aId : v.bId;
      const otherId = evidenceId === v.aId ? v.bId : v.aId;
      consider({
        evidenceId,
        otherId,
        relation: 'confirmed',
        weight: Number(v.scoreAtVerdict),
        confirmed: true,
        sharedLabels: [],
      });
    }
    if (pairs.length === 0) return [];

    const otherIds = [...new Set(pairs.map((p) => p.otherId))];
    const [others, alsoEvidence] = await Promise.all([
      this.prisma.asset.findMany({
        where: { id: { in: otherIds }, status: { not: 'DELETED' } },
        select: { id: true, name: true },
      }),
      // Evidence older than the look-alike seeds is still evidence.
      this.prisma.caseEvidence.findMany({
        where: {
          caseId: k.caseId,
          entityType: 'asset',
          entityId: { in: otherIds },
        },
        select: { entityId: true },
      }),
    ]);
    const excluded = new Set(alsoEvidence.map((row) => row.entityId));
    const nameOf = new Map(others.map((a) => [a.id, a.name] as const));
    const perEvidence = new Map<string, number>();
    const out: Candidate[] = [];
    pairs.sort(
      (a, b) =>
        Number(b.confirmed) - Number(a.confirmed) ||
        Number(b.relation === 'identical_content') -
          Number(a.relation === 'identical_content') ||
        b.weight - a.weight,
    );
    for (const pair of pairs) {
      const name = nameOf.get(pair.otherId);
      if (!name || excluded.has(pair.otherId)) continue;
      const count = perEvidence.get(pair.evidenceId) ?? 0;
      if (count >= DUPLICATES_PER_EVIDENCE) continue;
      perEvidence.set(pair.evidenceId, count + 1);
      const evidenceName = short(
        k.evidenceAssets.get(pair.evidenceId) ?? 'the evidence',
      );
      const identical = pair.relation === 'identical_content';
      out.push({
        origin: 'DUPLICATE',
        findingId: null,
        assetId: pair.otherId,
        title: name,
        rationale: `${
          identical
            ? `Identical copy of "${evidenceName}"`
            : `Shares ${pair.sharedLabels.length > 0 ? pair.sharedLabels.join(', ') : 'most of its values'} with "${evidenceName}" · match weight ${pct(pair.weight)}%`
        }${pair.confirmed ? ' · confirmed a duplicate in Duplicate review' : ''}`,
        importance: null,
        similarity: Math.min(1, Math.max(0, pair.weight)),
        viaAssetId: pair.evidenceId,
        details: {
          relation: pair.relation,
          ...(pair.confirmed ? { verdict: 'CONFIRMED' } : {}),
          ...(pair.sharedLabels.length > 0
            ? { sharedLabels: pair.sharedLabels }
            : {}),
        },
        rank: (pair.confirmed ? 4 : 0) + (identical ? 2 : 0) + pair.weight,
      });
    }
    return out;
  }

  // ── Keeping the list honest ───────────────────────────────────────────────

  /**
   * Settle the leads waiting for review that no longer need a person:
   *
   * - its finding or asset joined the case another way → accepted, by the case;
   * - its finding or asset is gone, or no longer open (for the kinds the case
   *   proposes itself — a bookmark or an agent's proposal of a resolved
   *   finding stays, since a resolved finding can still be evidence) → removed;
   * - a finding filter of the case now keeps its kind out → removed (except a
   *   person's own bookmark: attaching by hand still works past a filter).
   *
   * Removed leads were never reviewed, so nothing is lost: if the finding
   * comes back and still qualifies, a later refresh proposes it again.
   */
  private async settle(caseId: string): Promise<number> {
    const open = await this.prisma.caseLead.findMany({
      where: { caseId, status: 'PROPOSED' },
      select: {
        id: true,
        findingId: true,
        assetId: true,
        origin: true,
        viaInquiryId: true,
      },
    });
    if (open.length === 0) return 0;
    const facts = await this.subjectFacts(caseId, open);
    const gates = new Map<string | null, CaseKnowledge['caseWideGate']>();
    const gateFor = async (inquiryId: string | null) => {
      if (!this.cleanup) return () => null;
      if (!gates.has(inquiryId)) {
        gates.set(inquiryId, await this.cleanup.pullGate(caseId, inquiryId));
      }
      return gates.get(inquiryId)!;
    };

    const inCase: string[] = [];
    const removed: string[] = [];
    for (const lead of open) {
      const state = this.stateOf(lead, facts);
      if (state === 'IN_CASE') {
        inCase.push(lead.id);
        continue;
      }
      if (state === 'GONE') {
        removed.push(lead.id);
        continue;
      }
      const finding = lead.findingId
        ? facts.findings.get(lead.findingId)
        : null;
      if (finding && lead.origin !== 'MANUAL') {
        const gate = await gateFor(
          lead.origin === 'INQUIRY' ? lead.viaInquiryId : null,
        );
        if (
          gate({
            findingType: finding.findingType,
            matchedContent: finding.matchedContent,
          })
        ) {
          removed.push(lead.id);
        }
      }
    }
    if (inCase.length > 0) {
      await this.prisma.caseLead.updateMany({
        where: { id: { in: inCase }, status: 'PROPOSED' },
        data: {
          status: 'ACCEPTED',
          reviewedBy: CASE_LEADS_ACTOR,
          reviewedAt: new Date(),
        },
      });
    }
    if (removed.length > 0) {
      await this.prisma.caseLead.deleteMany({
        where: { id: { in: removed }, status: 'PROPOSED' },
      });
    }
    return inCase.length + removed.length;
  }

  /** What is true now of the findings and assets some leads are about. */
  private async subjectFacts(
    caseId: string,
    leads: Array<Pick<CaseLead, 'findingId' | 'assetId'>>,
  ) {
    const findingIds = [
      ...new Set(leads.flatMap((l) => (l.findingId ? [l.findingId] : []))),
    ];
    const assetIds = [
      ...new Set(
        leads.flatMap((l) => (!l.findingId && l.assetId ? [l.assetId] : [])),
      ),
    ];
    const [findings, assets, attached, evidence] = await Promise.all([
      findingIds.length
        ? this.prisma.finding.findMany({
            where: { id: { in: findingIds } },
            select: {
              id: true,
              status: true,
              findingType: true,
              matchedContent: true,
            },
          })
        : [],
      assetIds.length
        ? this.prisma.asset.findMany({
            where: { id: { in: assetIds } },
            select: { id: true, status: true },
          })
        : [],
      findingIds.length
        ? this.prisma.caseFinding.findMany({
            where: { caseId, findingId: { in: findingIds } },
            select: { findingId: true },
          })
        : [],
      assetIds.length
        ? this.prisma.caseEvidence.findMany({
            where: { caseId, entityType: 'asset', entityId: { in: assetIds } },
            select: { entityId: true },
          })
        : [],
    ]);
    return {
      findings: new Map(findings.map((f) => [f.id, f] as const)),
      assets: new Map(assets.map((a) => [a.id, a] as const)),
      attached: new Set(attached.map((row) => row.findingId)),
      evidence: new Set(evidence.map((row) => row.entityId)),
    };
  }

  private stateOf(
    lead: Pick<CaseLead, 'findingId' | 'assetId' | 'origin'>,
    facts: Awaited<ReturnType<CaseLeadsService['subjectFacts']>>,
  ): LeadState {
    if (lead.findingId) {
      if (facts.attached.has(lead.findingId)) return 'IN_CASE';
      const finding = facts.findings.get(lead.findingId);
      if (!finding) return 'GONE';
      const generated = (GENERATED_ORIGINS as readonly string[]).includes(
        String(lead.origin),
      );
      return generated && String(finding.status) !== 'OPEN' ? 'GONE' : 'OPEN';
    }
    if (!lead.assetId) return 'GONE';
    if (facts.evidence.has(lead.assetId)) return 'IN_CASE';
    const asset = facts.assets.get(lead.assetId);
    return !asset || String(asset.status) === 'DELETED' ? 'GONE' : 'OPEN';
  }

  // ── Around a review ───────────────────────────────────────────────────────

  /** A case-wide escalation rule holds however a finding came in, a lead included. */
  private async escalateAccepted(
    caseId: string,
    findingId: string,
    actor: string,
  ): Promise<void> {
    if (!this.escalation) return;
    try {
      const rows = await this.prisma.caseFinding.findMany({
        where: { caseId, findingId },
        include: { caseEvidence: { select: { entityId: true, label: true } } },
      });
      await this.escalation.escalateArrivals(
        caseId,
        null,
        rows.map(candidateOf),
        { trigger: 'ATTACHED', actor },
      );
    } catch (error) {
      this.logger.warn(
        `Escalation check after accepting a lead in case ${caseId} failed: ${String(error)}`,
      );
    }
  }

  /**
   * A confirmed duplicate that now serves a case is followed through: Duplicate
   * review's Decisions shows where it went instead of "went nowhere yet".
   */
  private async markVerdictUsed(caseId: string, lead: CaseLead): Promise<void> {
    if (!lead.assetId || !lead.viaAssetId) return;
    const [aId, bId] =
      lead.assetId <= lead.viaAssetId
        ? [lead.assetId, lead.viaAssetId]
        : [lead.viaAssetId, lead.assetId];
    await this.prisma.correlationPairVerdict
      .updateMany({
        where: { aId, bId, verdict: 'CONFIRMED', caseId: null },
        data: { caseId },
      })
      .catch((error) =>
        this.logger.warn(
          `Could not link duplicate verdict ${aId}|${bId} to case ${caseId}: ${String(error)}`,
        ),
      );
  }

  /** One entry per refresh; the automatic ones fold into the latest. */
  private async recordGenerated(
    caseId: string,
    actor: string,
    automatic: boolean,
    payload: {
      proposed: number;
      byOrigin: Record<string, number>;
      sample: string[];
    },
  ): Promise<void> {
    try {
      if (!automatic) {
        await this.activity.record(
          caseId,
          CaseActivityType.LEADS_GENERATED,
          payload,
          actor,
        );
        return;
      }
      await this.activity.recordCoalesced(
        caseId,
        CaseActivityType.LEADS_GENERATED,
        { ...payload, automatic: true },
        actor,
        {
          key: 'leads',
          merge: (previous: ActivityPayload, next: ActivityPayload) => {
            const byOrigin: Record<string, number> = {
              ...((previous.byOrigin as Record<string, number>) ?? {}),
            };
            for (const [origin, n] of Object.entries(
              (next.byOrigin as Record<string, number>) ?? {},
            )) {
              byOrigin[origin] = (byOrigin[origin] ?? 0) + n;
            }
            return {
              ...next,
              proposed:
                (Number(previous.proposed) || 0) + (Number(next.proposed) || 0),
              byOrigin,
              sample: [
                ...((previous.sample as string[]) ?? []),
                ...((next.sample as string[]) ?? []),
              ].slice(0, 8),
            };
          },
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not record the lead refresh of case ${caseId}: ${String(error)}`,
      );
    }
  }

  // ── Presentation ──────────────────────────────────────────────────────────

  /**
   * Leads with what a person needs to judge them without opening anything:
   * where the finding or document is, what in the case it hangs off, and
   * whether it still waits (a lead whose subject joined the case another way,
   * or left, is marked until the next refresh settles it).
   */
  private async enrich(caseId: string, leads: CaseLead[]) {
    if (leads.length === 0) return [];
    const findingIds = [
      ...new Set(
        leads.flatMap((l) =>
          [l.findingId, l.viaFindingId].filter((id): id is string => !!id),
        ),
      ),
    ];
    const assetIds = [
      ...new Set(
        leads.flatMap((l) =>
          [l.assetId, l.viaAssetId].filter((id): id is string => !!id),
        ),
      ),
    ];
    const inquiryIds = [
      ...new Set(
        leads.flatMap((l) => (l.viaInquiryId ? [l.viaInquiryId] : [])),
      ),
    ];
    const pending = leads.filter((l) => l.status === 'PROPOSED');
    const [findings, assets, inquiries, facts] = await Promise.all([
      findingIds.length
        ? this.prisma.finding.findMany({
            where: { id: { in: findingIds } },
            select: {
              id: true,
              status: true,
              findingType: true,
              matchedContent: true,
              severity: true,
              assetId: true,
            },
          })
        : [],
      assetIds.length
        ? this.prisma.asset.findMany({
            where: { id: { in: assetIds } },
            select: {
              id: true,
              name: true,
              assetType: true,
              sourceType: true,
              source: { select: { name: true } },
            },
          })
        : [],
      inquiryIds.length
        ? this.prisma.inquiry.findMany({
            where: { id: { in: inquiryIds } },
            select: { id: true, title: true },
          })
        : [],
      this.subjectFacts(caseId, pending),
    ]);
    const findingOf = new Map(findings.map((f) => [f.id, f] as const));
    const assetOf = new Map(assets.map((a) => [a.id, a] as const));
    const watchOf = new Map(inquiries.map((q) => [q.id, q.title] as const));

    return leads.map((lead) => {
      const finding = lead.findingId
        ? findingOf.get(lead.findingId)
        : undefined;
      const asset = lead.assetId ? assetOf.get(lead.assetId) : undefined;
      const via = lead.viaFindingId
        ? findingOf.get(lead.viaFindingId)
        : undefined;
      const viaAsset = lead.viaAssetId
        ? assetOf.get(lead.viaAssetId)
        : undefined;
      return {
        ...this.toDto(lead),
        kind: lead.findingId ? ('FINDING' as const) : ('ASSET' as const),
        state:
          lead.status === 'PROPOSED' ? this.stateOf(lead, facts) : undefined,
        findingType: finding?.findingType ?? null,
        value: finding ? short(finding.matchedContent, VALUE_MAX) : null,
        severity: finding ? String(finding.severity) : null,
        findingStatus: finding ? String(finding.status) : null,
        assetName: asset?.name ?? null,
        assetType: asset?.assetType ?? null,
        sourceType: asset ? String(asset.sourceType) : null,
        sourceName: asset?.source?.name ?? null,
        viaLabel: via
          ? `${via.findingType}: ${short(via.matchedContent)}`
          : lead.viaInquiryId
            ? (watchOf.get(lead.viaInquiryId) ?? null)
            : (viaAsset?.name ?? null),
        viaAssetName: viaAsset?.name ?? null,
      };
    });
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
      viaFindingId: lead.viaFindingId,
      viaAssetId: lead.viaAssetId,
      viaInquiryId: lead.viaInquiryId,
      details: (lead.details ?? null) as Record<string, unknown> | null,
      proposedBy: lead.proposedBy,
      reviewedBy: lead.reviewedBy,
      reviewedAt: lead.reviewedAt,
      createdAt: lead.createdAt,
    };
  }
}

/** The labels a pair shares most, from the edge the duplicates engine wrote. */
function sharedLabelsOf(metadata: Prisma.JsonValue | null): string[] {
  const byLabel =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).sharedByLabel
      : null;
  if (!byLabel || typeof byLabel !== 'object') return [];
  return Object.entries(byLabel as Record<string, unknown>)
    .filter(([, n]) => Number(n) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([label]) => label);
}

/**
 * Take from each list in turn until `room` is filled, so a short refresh
 * still carries every kind that had something to say.
 */
function interleave<T>(lists: T[][], room: number): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < room; i++) {
    let took = false;
    for (const list of lists) {
      if (i < list.length && out.length < room) {
        out.push(list[i]);
        took = true;
      }
    }
    if (!took) break;
  }
  return out;
}
