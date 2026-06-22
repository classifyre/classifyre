import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const BRIEF_ID = 1;

export interface SystemBrief {
  id: number;
  content: string;
  facts: Record<string, unknown>;
  version: number;
  updatedBy: string | null;
}

/**
 * Maintains the living "system brief" — a single always-injected summary of the
 * whole system. `content` is a model-authored narrative ("what's been tried",
 * "known gaps"); `facts` is a structured snapshot refreshed from current counts.
 * The brief is the holistic header for every harness run; granular knowledge
 * lives in agent memory instead.
 */
@Injectable()
export class SystemBriefService {
  constructor(private readonly prisma: PrismaService) {}

  /** Read the singleton; returns an empty default when none exists yet. */
  async get(): Promise<SystemBrief> {
    const row = await this.prisma.agentSystemBrief.findUnique({
      where: { id: BRIEF_ID },
    });
    if (!row) {
      return {
        id: BRIEF_ID,
        content: '',
        facts: {},
        version: 0,
        updatedBy: null,
      };
    }
    return {
      id: row.id,
      content: row.content,
      facts: (row.facts ?? {}) as Record<string, unknown>,
      version: row.version,
      updatedBy: row.updatedBy,
    };
  }

  /** Compact, token-bounded text prepended to every mission's system prompt. */
  render(brief: SystemBrief): string {
    const f = brief.facts ?? {};
    const has = Object.keys(f).length > 0;
    const snapshot = has
      ? `Snapshot: ${num(f.sources)} sources, ${num(f.customDetectors)} custom detectors, ${num(f.activeInquiries)} active inquiries, ${num(f.openCases)} open cases, ${num(f.openFindings)} open findings.`
      : '';
    const body = brief.content.trim() || '(no narrative recorded yet)';
    return [`## System brief (v${brief.version})`, body, snapshot]
      .filter(Boolean)
      .join('\n');
  }

  /** Current structured snapshot of the system (cheap counts). */
  async computeFacts(): Promise<Record<string, unknown>> {
    const [sources, customDetectors, activeInquiries, openCases, openFindings] =
      await Promise.all([
        this.prisma.source.count(),
        this.prisma.customDetector.count({ where: { isActive: true } }),
        this.prisma.inquiry.count({ where: { status: 'ACTIVE' } }),
        this.prisma.case.count({
          where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
        }),
        this.prisma.finding.count({ where: { status: 'OPEN' } }),
      ]);
    return {
      sources,
      customDetectors,
      activeInquiries,
      openCases,
      openFindings,
      refreshedAt: new Date().toISOString(),
    };
  }

  /**
   * Upsert the brief. `facts` defaults to a fresh snapshot when omitted; the
   * narrative is only changed when `content` is provided. Version is bumped.
   */
  async update(
    input: { content?: string; facts?: Record<string, unknown> },
    updatedBy: string,
  ): Promise<SystemBrief> {
    const facts = input.facts ?? (await this.computeFacts());
    const row = await this.prisma.agentSystemBrief.upsert({
      where: { id: BRIEF_ID },
      create: {
        id: BRIEF_ID,
        content: input.content ?? '',
        facts: facts as Prisma.InputJsonValue,
        version: 1,
        updatedBy,
      },
      update: {
        ...(input.content !== undefined ? { content: input.content } : {}),
        facts: facts as Prisma.InputJsonValue,
        version: { increment: 1 },
        updatedBy,
      },
    });
    return {
      id: row.id,
      content: row.content,
      facts: (row.facts ?? {}) as Record<string, unknown>,
      version: row.version,
      updatedBy: row.updatedBy,
    };
  }

  /** Refresh only the structured snapshot (used by the nightly dream cycle). */
  async refreshFacts(updatedBy: string): Promise<SystemBrief> {
    return this.update({ facts: await this.computeFacts() }, updatedBy);
  }
}

function num(v: unknown): string {
  return typeof v === 'number' ? String(v) : '?';
}
