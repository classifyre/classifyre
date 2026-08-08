import { Injectable } from '@nestjs/common';
import {
  AgentDecisionAction,
  AgentDecisionOutcome,
  Prisma,
  RunnerStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { computeDetectionFingerprint } from '../utils/scope-fingerprint';
import {
  AUTOPILOT_TUNES_PER_DAY,
  DETECTION_POSTURE_MIN_FINDINGS,
  DETECTION_STABLE_RUNS,
} from './autopilot.constants';

/**
 * Where a source is in its detection lifecycle.
 *
 * EXPLORING  — too new or too empty to judge. Nothing is known yet, so
 *              experimenting with detectors is the correct thing to do and
 *              nothing brakes it.
 * CONVERGING — detectors are producing findings, but little of that output is
 *              being watched or cited yet. Change one thing, then evaluate it.
 * STABLE     — the detection set has survived several scans unchanged AND its
 *              findings are feeding real investigation. This is the goal
 *              state; changes here need a reason beyond "this looks noisy".
 */
export type DetectionPosture = 'EXPLORING' | 'CONVERGING' | 'STABLE';

export interface DetectionPostureReport {
  sourceId: string;
  posture: DetectionPosture;
  /** Why this posture, in one operator-readable sentence. */
  reason: string;
  openFindings: number;
  /** Findings of this source attached to a case. */
  citedByCases: number;
  /** ACTIVE inquiries whose scope covers this source. */
  watchingInquiries: number;
  /** Total matches those inquiries hold. */
  inquiryMatches: number;
  completedScans: number;
  /** Completed scans since anything about what this source detects last changed. */
  scansSinceDetectionChanged: number;
  tunesLast24h: number;
  tuneBudgetRemaining: number;
  /**
   * True when the last autopilot config change has not yet been followed by a
   * completed scan — so nothing is known about whether it helped.
   */
  lastChangeUnevaluated: boolean;
}

/**
 * Derives a source's detection posture from facts already in the database.
 *
 * Nothing here is stored. A posture column would be one more thing to keep in
 * sync with reality, and the reality — how many scans the current detection
 * fingerprint has survived, whether anything is watching the findings — is
 * already recorded. Deriving it also means the report can carry the numbers
 * behind the verdict, so the agent (and the operator) can disagree with it.
 */
@Injectable()
export class DetectionPostureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masked: MaskedConfigCryptoService,
  ) {}

  async forSource(sourceId: string): Promise<DetectionPostureReport> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true, type: true, config: true },
    });
    if (!source) throw new Error('Unknown sourceId');

    const detectionNow = computeDetectionFingerprint(
      String(source.type),
      this.masked.decryptMaskedConfig(
        (source.config ?? {}) as Record<string, unknown>,
      ),
    );

    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const completedRuns: Prisma.RunnerWhereInput = {
      sourceId,
      status: { in: [RunnerStatus.COMPLETED, RunnerStatus.WARNING] },
      completedAt: { not: null },
    };
    // Only APPLIED changes count. A decision the observe-only gate blocked
    // changed nothing, and charging the agent for it would silently shrink its
    // budget on exactly the instances where it has no effect at all.
    const appliedTunes: Prisma.AgentDecisionWhereInput = {
      action: AgentDecisionAction.TUNE_SOURCE,
      outcome: AgentDecisionOutcome.APPLIED,
      entityId: sourceId,
    };

    const [
      openFindings,
      completedScans,
      runs,
      tunesLast24h,
      lastTune,
      caseFindings,
      inquiries,
    ] = await Promise.all([
      this.prisma.finding.count({ where: { sourceId, status: 'OPEN' } }),
      this.prisma.runner.count({ where: completedRuns }),
      this.prisma.runner.findMany({
        where: completedRuns,
        orderBy: { completedAt: 'desc' },
        // Only the leading run of same-fingerprint scans matters, and the
        // threshold is small — no reason to read the whole history.
        take: DETECTION_STABLE_RUNS + 1,
        select: { detectionFingerprint: true, completedAt: true },
      }),
      this.prisma.agentDecision.count({
        where: { ...appliedTunes, createdAt: { gte: dayAgo } },
      }),
      this.prisma.agentDecision.findFirst({
        where: appliedTunes,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      // Small, human-curated table: read it whole and intersect, rather than
      // joining through findings.
      this.prisma.caseFinding.findMany({ select: { findingId: true } }),
      this.prisma.inquiry.findMany({
        where: {
          status: 'ACTIVE',
          OR: [{ matchAllSources: true }, { sourceIds: { has: sourceId } }],
        },
        select: { matchCount: true },
      }),
    ]);

    const citedByCases =
      caseFindings.length > 0
        ? await this.prisma.finding.count({
            where: {
              sourceId,
              id: { in: caseFindings.map((row) => row.findingId) },
            },
          })
        : 0;
    const inquiryMatches = inquiries.reduce((sum, q) => sum + q.matchCount, 0);

    // Walk newest-first while the recorded fingerprint still matches what the
    // source detects today. The first scan that ran under a different set ends
    // the streak — and a config changed after the last scan yields 0, which is
    // exactly "the current set has never been exercised".
    let scansSinceDetectionChanged = 0;
    for (const run of runs) {
      if (run.detectionFingerprint !== detectionNow) break;
      scansSinceDetectionChanged++;
    }

    const lastCompletedAt = runs[0]?.completedAt ?? null;
    const lastChangeUnevaluated = Boolean(
      lastTune &&
      (!lastCompletedAt ||
        lastCompletedAt.getTime() < lastTune.createdAt.getTime()),
    );

    const used = citedByCases > 0 || inquiryMatches > 0;
    const settled = scansSinceDetectionChanged >= DETECTION_STABLE_RUNS;

    let posture: DetectionPosture;
    let reason: string;
    if (completedScans === 0 || openFindings < DETECTION_POSTURE_MIN_FINDINGS) {
      posture = 'EXPLORING';
      reason =
        completedScans === 0
          ? 'no completed scan yet — nothing is known about what this source contains'
          : `only ${openFindings} open finding(s) — too little output to judge the ` +
            'detector set, so experimenting is the right move';
    } else if (settled && used) {
      posture = 'STABLE';
      reason =
        `detection unchanged across ${scansSinceDetectionChanged} completed scan(s) ` +
        `and its findings are in use (${inquiryMatches} inquiry match(es), ` +
        `${citedByCases} cited by cases)`;
    } else {
      posture = 'CONVERGING';
      reason = !settled
        ? `detection changed within the last ${DETECTION_STABLE_RUNS} scan(s) — the ` +
          'current set has not been exercised yet'
        : 'detection has settled but nothing watches or cites its findings yet';
    }

    return {
      sourceId,
      posture,
      reason,
      openFindings,
      citedByCases,
      watchingInquiries: inquiries.length,
      inquiryMatches,
      completedScans,
      scansSinceDetectionChanged,
      tunesLast24h,
      tuneBudgetRemaining: Math.max(0, AUTOPILOT_TUNES_PER_DAY - tunesLast24h),
      lastChangeUnevaluated,
    };
  }
}
