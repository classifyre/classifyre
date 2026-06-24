import { Injectable } from '@nestjs/common';
import { AgentMemoryKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AgentMemoryService } from '../memory/agent-memory.service';
import { MAX_GLOSSARY_ENTRIES } from '../autopilot.constants';
import type { RecalledMemory } from '../autopilot.types';

const BRIEF_ID = 1;
const INSTANCE_SETTINGS_ID = 1;

// Per-section caps keep the rendered brief token-bounded regardless of how much
// memory has accumulated.
const MAX_TOPIC_ENTRIES = 12;
const MAX_GAP_ENTRIES = 12;
const MAX_MEMORY_CONTENT_LENGTH = 200;

export interface SystemBrief {
  id: number;
  content: string;
  facts: Record<string, unknown>;
  version: number;
  updatedBy: string | null;
}

export interface BriefMemoryEntry {
  key: string;
  content: string;
  weight: number;
}

export interface BriefSetupItem {
  /** ok = satisfied, todo = action recommended, info = neutral observation. */
  status: 'ok' | 'todo' | 'info';
  label: string;
  detail: string;
}

/**
 * The fully assembled brief: a small model-authored `overview` plus sections
 * the server composes deterministically from live facts and agent memory. This
 * is what makes the brief consistent (it no longer drifts with every dream
 * rewrite) and dual-purpose — it reads as an operator setup guide and grounds
 * the agents.
 */
export interface ComposedBrief {
  overview: string;
  facts: Record<string, unknown>;
  glossary: BriefMemoryEntry[];
  topics: BriefMemoryEntry[];
  gaps: BriefMemoryEntry[];
  setup: BriefSetupItem[];
  version: number;
  updatedBy: string | null;
}

/**
 * Maintains the living "system brief" — a single always-injected summary of the
 * whole system. Only the short `overview` narrative is model-authored; the
 * coverage facts, glossary, topics, known gaps and setup checklist are composed
 * by the server from current counts and the agent memory store, so the brief is
 * structurally identical every render. Granular knowledge still lives in agent
 * memory; the brief is the holistic, stable header for every harness run and
 * the orientation panel a new operator reads.
 */
@Injectable()
export class SystemBriefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: AgentMemoryService,
  ) {}

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

  /**
   * Assemble the full structured brief: the model-authored overview plus
   * server-composed coverage, glossary, topics, gaps and setup sections.
   */
  async compose(): Promise<ComposedBrief> {
    const [brief, glossary, entityMaps, topicMaps, detectorInsights, precedents] =
      await Promise.all([
        this.get(),
        this.memory.topByWeight(AgentMemoryKind.GLOSSARY, MAX_GLOSSARY_ENTRIES),
        this.memory.topByWeight(AgentMemoryKind.ENTITY_MAP, MAX_TOPIC_ENTRIES),
        this.memory.topByWeight(
          AgentMemoryKind.TOPIC_INQUIRY_MAP,
          MAX_TOPIC_ENTRIES,
        ),
        this.memory.topByWeight(
          AgentMemoryKind.DETECTOR_INSIGHT,
          MAX_GAP_ENTRIES,
        ),
        this.memory.topByWeight(
          AgentMemoryKind.DECISION_PRECEDENT,
          MAX_GAP_ENTRIES,
        ),
      ]);

    const facts = Object.keys(brief.facts ?? {}).length
      ? brief.facts
      : await this.computeFacts();

    return {
      overview: brief.content.trim(),
      facts,
      glossary: glossary.map(toEntry),
      topics: [...entityMaps, ...topicMaps].map(toEntry).slice(0, MAX_TOPIC_ENTRIES),
      gaps: [...detectorInsights, ...precedents]
        .map(toEntry)
        .slice(0, MAX_GAP_ENTRIES),
      setup: await this.computeSetup(facts),
      version: brief.version,
      updatedBy: brief.updatedBy,
    };
  }

  /**
   * Deterministic markdown prepended to every mission's system prompt. Fixed
   * section order and headers — identical structure on every render.
   */
  render(brief: ComposedBrief): string {
    const f = brief.facts ?? {};
    const sections: string[] = [`## System brief (v${brief.version})`];

    sections.push(
      heading('Overview'),
      brief.overview || '(no overview recorded yet)',
    );

    if (Object.keys(f).length > 0) {
      sections.push(
        heading('Coverage'),
        `Sources: ${num(f.sources)} (${num(f.sourcesWithoutFindings)} with no findings yet) · ` +
          `Assets: ${num(f.assets)} · Custom detectors: ${num(f.customDetectors)} · ` +
          `Active inquiries: ${num(f.activeInquiries)} · Open cases: ${num(f.openCases)} · ` +
          `Open findings: ${num(f.openFindings)} · Clusters: ${num(f.clusters)}.`,
      );
    }

    if (brief.glossary.length > 0) {
      sections.push(heading('Glossary'), bullets(brief.glossary));
    }
    if (brief.topics.length > 0) {
      sections.push(heading('Topics'), bullets(brief.topics));
    }
    if (brief.gaps.length > 0) {
      sections.push(heading("What's been tried / known gaps"), bullets(brief.gaps));
    }
    if (brief.setup.length > 0) {
      sections.push(
        heading('Setup & next steps'),
        brief.setup
          .map((s) => `- [${s.status}] ${s.label}: ${s.detail}`)
          .join('\n'),
      );
    }

    return sections.filter(Boolean).join('\n');
  }

  /** Current structured snapshot of the system (cheap counts). */
  async computeFacts(): Promise<Record<string, unknown>> {
    const [
      sources,
      assets,
      customDetectors,
      activeInquiries,
      openCases,
      openFindings,
      clusters,
      assetSourceGroups,
      findingSourceGroups,
    ] = await Promise.all([
      this.prisma.source.count(),
      this.prisma.asset.count(),
      this.prisma.customDetector.count({ where: { isActive: true } }),
      this.prisma.inquiry.count({ where: { status: 'ACTIVE' } }),
      this.prisma.case.count({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      this.prisma.finding.count({ where: { status: 'OPEN' } }),
      this.prisma.assetCluster.count(),
      this.prisma.asset.groupBy({ by: ['sourceId'] }),
      this.prisma.finding.groupBy({ by: ['sourceId'] }),
    ]);

    // Sources that have ingested assets but produced no findings — the
    // cold-start population the harness should bootstrap detection for.
    const withFindings = new Set(findingSourceGroups.map((g) => g.sourceId));
    const sourcesWithoutFindings = assetSourceGroups.filter(
      (g) => !withFindings.has(g.sourceId),
    ).length;

    return {
      sources,
      assets,
      customDetectors,
      activeInquiries,
      openCases,
      openFindings,
      clusters,
      sourcesWithoutFindings,
      refreshedAt: new Date().toISOString(),
    };
  }

  /**
   * Server-derived setup checklist for a business user standing up an instance.
   * Purely a function of current state, so it is always accurate and never
   * drifts.
   */
  private async computeSetup(
    facts: Record<string, unknown>,
  ): Promise<BriefSetupItem[]> {
    const [settings, providerCount] = await Promise.all([
      this.prisma.instanceSettings.findUnique({
        where: { id: INSTANCE_SETTINGS_ID },
      }),
      this.prisma.aiProviderConfig.count(),
    ]);

    const items: BriefSetupItem[] = [];

    items.push(
      providerCount > 0
        ? {
            status: 'ok',
            label: 'AI provider configured',
            detail: `${providerCount} provider credential(s) available.`,
          }
        : {
            status: 'todo',
            label: 'Add an AI provider',
            detail:
              'The harness and assistants need a Claude/OpenAI/Gemini credential in Settings → AI Providers.',
          },
    );

    if (settings && !settings.aiEnabled) {
      items.push({
        status: 'todo',
        label: 'Enable AI',
        detail: 'AI is switched off instance-wide; the harness will not run.',
      });
    }

    const sources = numVal(facts.sources);
    items.push(
      sources > 0
        ? {
            status: 'ok',
            label: 'Sources connected',
            detail: `${sources} source(s) ingesting data.`,
          }
        : {
            status: 'todo',
            label: 'Connect your first source',
            detail:
              'Add a data source (Confluence, Jira, S3, a database, …) to start ingesting assets.',
          },
    );

    const coldStart = numVal(facts.sourcesWithoutFindings);
    if (coldStart > 0) {
      items.push({
        status: 'info',
        label: 'Sources with no findings yet',
        detail:
          `${coldStart} source(s) have ingested assets but produced no findings. ` +
          (settings?.autopilotDetectorEnabled
            ? 'The detector-authoring autopilot will propose detectors from the asset metadata.'
            : 'Enable a detector on them, or turn on the detector-authoring autopilot to let the harness propose one.'),
      });
    }

    if (settings && !settings.autopilotDetectorEnabled) {
      items.push({
        status: 'info',
        label: 'Detector-authoring autopilot is off',
        detail:
          'Turn it on in Settings → Autopilot to let the harness create custom detectors automatically.',
      });
    }

    return items;
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
    const existing = await this.prisma.agentSystemBrief.findUnique({
      where: { id: BRIEF_ID },
      select: { version: true },
    });
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
        version: (existing?.version ?? 0) + 1,
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

function toEntry(m: RecalledMemory): BriefMemoryEntry {
  return {
    key: m.key,
    content:
      m.content.length > MAX_MEMORY_CONTENT_LENGTH
        ? `${m.content.slice(0, MAX_MEMORY_CONTENT_LENGTH)}…`
        : m.content,
    weight: m.weight,
  };
}

function bullets(entries: BriefMemoryEntry[]): string {
  return entries.map((e) => `- ${e.key}: ${e.content}`).join('\n');
}

function heading(title: string): string {
  return `\n### ${title}`;
}

function num(v: unknown): string {
  return typeof v === 'number' ? String(v) : '?';
}

function numVal(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
