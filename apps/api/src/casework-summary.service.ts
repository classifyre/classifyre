import { Injectable } from '@nestjs/common';
import {
  CaseLeadStatus,
  CaseStatus,
  CaseThreadKind,
  InquiryStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from './prisma.service';
import type { CaseworkSummaryDto } from './dto/casework-summary.dto';

/** Evidence and inquiry counts, the same shape the case list already returns. */
const countSelect = {
  _count: {
    select: {
      evidence: true,
      threads: { where: { kind: CaseThreadKind.HYPOTHESIS } },
      inquiryLinks: true,
    },
  },
} satisfies Prisma.CaseInclude;

const RECENT_LIMIT = 5;

/**
 * The dashboard's view of casework.
 *
 * Every read here is a grouped count or a five-row seek, so the whole summary is
 * a handful of index scans. That matters because this runs on the workspace home
 * page: anything that scales with the number of findings does not belong in it.
 */
@Injectable()
export class CaseworkSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(): Promise<CaseworkSummaryDto> {
    // Promise.all, not $transaction: interactive transactions hold a connection
    // for their whole duration, and a read-only summary has nothing to gain from
    // a consistent snapshot across five independent counts.
    const [
      caseStatusGroups,
      recentCases,
      inquiryStatusGroups,
      newMatchAggregate,
      inquiriesWithNewMatches,
      proposedLeads,
    ] = await Promise.all([
      this.prisma.case.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.case.findMany({
        include: countSelect,
        orderBy: { updatedAt: 'desc' },
        take: RECENT_LIMIT,
      }),
      this.prisma.inquiry.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.inquiry.aggregate({ _sum: { newMatchCount: true } }),
      this.prisma.inquiry.findMany({
        where: { newMatchCount: { gt: 0 }, status: InquiryStatus.ACTIVE },
        orderBy: { newMatchCount: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          title: true,
          matchCount: true,
          newMatchCount: true,
          updatedAt: true,
        },
      }),
      this.prisma.caseLead.count({
        where: { status: CaseLeadStatus.PROPOSED },
      }),
    ]);

    const byCaseStatus = {
      open: 0,
      inProgress: 0,
      closed: 0,
      archived: 0,
    };
    let caseTotal = 0;
    for (const group of caseStatusGroups) {
      const count = group._count._all;
      caseTotal += count;
      switch (group.status) {
        case CaseStatus.OPEN:
          byCaseStatus.open += count;
          break;
        case CaseStatus.IN_PROGRESS:
          byCaseStatus.inProgress += count;
          break;
        case CaseStatus.CLOSED:
          byCaseStatus.closed += count;
          break;
        case CaseStatus.ARCHIVED:
          byCaseStatus.archived += count;
          break;
      }
    }

    const byInquiryStatus = { active: 0, archived: 0 };
    let inquiryTotal = 0;
    for (const group of inquiryStatusGroups) {
      const count = group._count._all;
      inquiryTotal += count;
      if (group.status === InquiryStatus.ACTIVE) byInquiryStatus.active += count;
      else byInquiryStatus.archived += count;
    }

    return {
      cases: {
        byStatus: byCaseStatus,
        total: caseTotal,
        recent: recentCases.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          severity: row.severity,
          evidenceCount: row._count.evidence,
          inquiryCount: row._count.inquiryLinks,
          createdBy: row.createdBy,
          updatedAt: row.updatedAt,
        })),
      },
      inquiries: {
        byStatus: byInquiryStatus,
        total: inquiryTotal,
        newMatchTotal: newMatchAggregate._sum.newMatchCount ?? 0,
        withNewMatches: inquiriesWithNewMatches,
      },
      leads: { proposed: proposedLeads },
    };
  }
}
