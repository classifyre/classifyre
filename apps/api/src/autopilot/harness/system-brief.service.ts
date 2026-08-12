import { Injectable } from '@nestjs/common';
import {
  AgentMemoryKind,
  AutoSchedulePhase,
  Prisma,
  RunnerStatus,
  SourceScheduleMode,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AgentMemoryService } from '../memory/agent-memory.service';
import {
  CORPUS_SAMPLE_COVERAGE_THRESHOLD,
  COVERAGE_UNAVAILABLE_FAILURE_STREAK,
  DEFERRAL_MAX_AGE_DAYS,
  DEFERRED_TAG,
  MAX_DEFERRED_ENTRIES,
  MAX_GLOSSARY_ENTRIES,
} from '../autopilot.constants';
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
  /** Items parked by agenda.defer whose coverage threshold has now been met. */
  deferred: BriefMemoryEntry[];
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

  /** Top glossary terms as brief entries: verified first, then newest. */
  private async glossaryEntries(): Promise<BriefMemoryEntry[]> {
    const terms = await this.prisma.glossaryTerm.findMany({
      orderBy: [
        { verifiedAt: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' },
      ],
      take: MAX_GLOSSARY_ENTRIES,
      select: { term: true, aliases: true, entityType: true, notes: true },
    });
    return terms.map((term) => ({
      key: term.term,
      content: [
        term.entityType !== 'TERM' ? term.entityType : null,
        term.aliases.length ? `aka ${term.aliases.join(', ')}` : null,
        term.notes,
      ]
        .filter(Boolean)
        .join(' — ')
        .slice(0, MAX_MEMORY_CONTENT_LENGTH),
      weight: 1,
    }));
  }

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
    const [brief, glossary, entityMaps, detectorInsights, precedents] =
      await Promise.all([
        this.get(),
        // Canonical operator-facing vocabulary. GlossaryTerm is the only
        // glossary store, so what operators edit is exactly what agents see.
        this.glossaryEntries(),
        this.memory.topByWeight(AgentMemoryKind.ENTITY_MAP, MAX_TOPIC_ENTRIES),
        this.memory.topByWeight(
          AgentMemoryKind.DETECTOR_INSIGHT,
          MAX_GAP_ENTRIES,
        ),
        this.memory.topByWeight(
          AgentMemoryKind.DECISION_PRECEDENT,
          MAX_GAP_ENTRIES,
        ),
      ]);

    // Stored facts are a snapshot; coverage is always recomputed and overlaid.
    // A brief that understates how much of the corpus has been scanned is
    // exactly the failure this section exists to prevent, and compose() runs
    // once per agent run, so the handful of extra counts is cheap insurance.
    const stored = Object.keys(brief.facts ?? {}).length
      ? brief.facts
      : await this.computeFacts();
    const facts = { ...stored, ...(await this.computeCoverage()) };

    return {
      overview: brief.content.trim(),
      facts,
      glossary,
      topics: entityMaps.map(toEntry).slice(0, MAX_TOPIC_ENTRIES),
      // Deferred items are DECISION_PRECEDENTs too, so they would otherwise
      // read as "already decided" among the gaps. They are the opposite: open
      // questions waiting on coverage.
      gaps: [...detectorInsights, ...precedents]
        .filter((m) => !isDeferred(m))
        .map(toEntry)
        .slice(0, MAX_GAP_ENTRIES),
      deferred: dueDeferrals(precedents, numVal(facts.coverageRatio)),
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
        heading('Corpus coverage'),
        renderCoverage(f),
      );
    }

    if (brief.glossary.length > 0) {
      sections.push(heading('Glossary'), bullets(brief.glossary));
    }
    if (brief.topics.length > 0) {
      sections.push(heading('Topics'), bullets(brief.topics));
    }
    if (brief.gaps.length > 0) {
      sections.push(
        heading("What's been tried / known gaps"),
        bullets(brief.gaps),
      );
    }
    if (brief.deferred.length > 0) {
      sections.push(
        heading('Deferred, now due'),
        'Coverage has reached the threshold these were parked at. Re-examine them:',
        bullets(brief.deferred),
      );
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
      ...(await this.computeCoverage()),
      refreshedAt: new Date().toISOString(),
    };
  }

  /**
   * How much of the corpus the agent has actually seen.
   *
   * `sourcesWithoutFindings` above is derived from sources that HAVE assets, so
   * a source that has never been scanned is invisible to it. On the first real
   * run that meant the brief reported "Sources: 151" while 121 of them had
   * never been scanned at all — the agent drew corpus-wide conclusions from
   * 8% of the data and had no way to know it.
   *
   * WARNING runs count as scanned: a run with partial OCR failure still
   * ingested assets and still fired a cycle, so excluding it would understate
   * coverage in exactly the direction that matters least.
   *
   * The ratio is scanned / (scanned + reachable-but-unread), NOT scanned / all.
   * Sources that cannot be scanned — a failure streak with no successful run
   * ever, a paused adaptive schedule, or scheduling switched off on a source
   * nobody has ever run — are counted separately and named in the brief. Left in
   * the denominator they made coverage a ratchet: it could never reach the
   * threshold, so the agent was permanently told it was seeing a sample and
   * permanently told to defer instead of act. Excluding them does not hide the
   * gap; `sourcesUnavailable` is rendered on its own line, and getting those
   * sources scanning is the config agent's job, not the investigators'.
   */
  async computeCoverage(): Promise<Record<string, unknown>> {
    const [
      sources,
      scannedGroups,
      sourcesNeverScanned,
      sourcesInFlight,
      sourcesFailing,
      findingsOpen,
      findingsAnalyzed,
    ] = await Promise.all([
      this.prisma.source.count(),
      this.prisma.runner.groupBy({
        by: ['sourceId'],
        where: {
          status: { in: [RunnerStatus.COMPLETED, RunnerStatus.WARNING] },
        },
      }),
      this.prisma.source.count({ where: { lastRunAt: null } }),
      this.prisma.source.count({
        where: {
          runnerStatus: { in: [RunnerStatus.PENDING, RunnerStatus.RUNNING] },
        },
      }),
      this.prisma.source.count({
        where: { lastRunStatus: RunnerStatus.ERROR },
      }),
      this.prisma.finding.count({ where: { status: 'OPEN' } }),
      // Denormalized by a DB trigger, so this needs no join. Unanalyzed
      // findings sit at exactly 0 and are "pending, not unimportant".
      this.prisma.finding.count({
        where: { status: 'OPEN', importanceScore: { gt: 0 } },
      }),
    ]);

    const sourcesScanned = scannedGroups.length;
    const scannedIds = new Set(scannedGroups.map((g) => g.sourceId));

    // Sources nothing will ever read: never scanned successfully AND either
    // repeatedly failing, paused by the adaptive scheduler, or not scheduled at
    // all. `scannedIds` is the guard that keeps a source we HAVE read out of
    // this set however broken it has become since.
    const unavailableCandidates = await this.prisma.source.findMany({
      where: {
        OR: [
          { consecutiveFailures: { gte: COVERAGE_UNAVAILABLE_FAILURE_STREAK } },
          { scheduleMode: SourceScheduleMode.OFF },
          {
            autoPhase: AutoSchedulePhase.PAUSED,
            scheduleMode: SourceScheduleMode.AUTO,
          },
        ],
      },
      select: { id: true },
    });
    const sourcesUnavailable = unavailableCandidates.filter(
      (s) => !scannedIds.has(s.id),
    ).length;

    // Everything we could still read: what we have read, plus what is genuinely
    // waiting. Zero only on an instance where nothing is readable at all, and
    // then the honest ratio is 0 — not 1.
    const reachable = Math.max(0, sources - sourcesUnavailable);
    return {
      sources,
      sourcesScanned,
      sourcesNeverScanned,
      sourcesInFlight,
      sourcesFailing,
      sourcesUnavailable,
      sourcesReachable: reachable,
      coverageRatio: reachable > 0 ? sourcesScanned / reachable : 0,
      findingsOpen,
      findingsAnalyzed,
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
              'The harness and assistant need a Claude/OpenAI/Gemini credential in Harness AI → Configuration.',
          },
    );

    if (settings && !settings.harnessAiProviderConfigId) {
      items.push({
        status: 'todo',
        label: 'Assign a Harness provider',
        detail:
          'Choose which AI provider the harness should use in Harness AI → Configuration.',
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

    if (settings && !settings.autopilotEscalationEnabled) {
      items.push({
        status: 'info',
        label: 'Escalation agent is off',
        detail:
          'No operator is notified when a high-severity case appears. Turn on the escalation agent in Settings → Autopilot so the harness can raise alerts while running unattended.',
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

function isDeferred(m: RecalledMemory): boolean {
  return (m.tags ?? []).includes(DEFERRED_TAG);
}

/**
 * Deferred items that are due: either the corpus has reached the coverage they
 * were waiting for, or they have simply waited long enough.
 *
 * Below that they stay silent — resurfacing them every cycle would recreate the
 * pressure to act early that deferring them was meant to relieve. But coverage
 * alone was a promise the system could not keep: on an instance whose ratio
 * never reached the threshold, "revisit later" meant "never", and everything
 * the agent parked stayed parked. The age fallback makes deferral a delay
 * rather than a disposal.
 */
function dueDeferrals(
  memories: RecalledMemory[],
  coverageRatio: number,
): BriefMemoryEntry[] {
  const now = Date.now();
  return memories
    .filter(isDeferred)
    .filter((m) => coverageRatio >= revisitThreshold(m) || isOverdue(m, now))
    .map(toEntry)
    .slice(0, MAX_DEFERRED_ENTRIES);
}

/**
 * Default to the coverage threshold rather than 1.0. Requiring a full 100% was
 * unreachable on any instance with a single unscannable source, so a deferral
 * whose `revisit-at:` tag was lost — a dream-cycle rewrite drops tags — became
 * permanent.
 */
function revisitThreshold(m: RecalledMemory): number {
  const tag = (m.tags ?? []).find((t) => t.startsWith('revisit-at:'));
  const parsed = tag ? Number(tag.slice('revisit-at:'.length)) : NaN;
  return Number.isFinite(parsed) ? parsed : CORPUS_SAMPLE_COVERAGE_THRESHOLD;
}

/** Waited past {@link DEFERRAL_MAX_AGE_DAYS}, whatever coverage says. */
function isOverdue(m: RecalledMemory, now: number): boolean {
  const at = m.updatedAt ? new Date(m.updatedAt).getTime() : NaN;
  if (!Number.isFinite(at)) return false;
  return now - at >= DEFERRAL_MAX_AGE_DAYS * 24 * 3600 * 1000;
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

/**
 * The corpus-coverage paragraph, stated so it cannot be skimmed past.
 *
 * This exists because the agent's first real run created inquiries like "Grand
 * Cayman offshore references" (0 matches) and opened cases scoped to a single
 * mailbox while 121 of 151 sources had never been scanned. It had the counts in
 * front of it and no reason to read them as a limit. Saying the percentage out
 * loud, next to what it forbids, is the cheapest available correction.
 */
export function renderCoverage(f: Record<string, unknown>): string {
  const sources = numVal(f.sources);
  const scanned = numVal(f.sourcesScanned);
  const unavailable = numVal(f.sourcesUnavailable);
  // Reachable, not total. A source that cannot be scanned is not corpus the
  // investigators are still waiting for, and counting it as such pinned the
  // ratio below the threshold permanently — see computeCoverage.
  const reachable =
    numVal(f.sourcesReachable) || Math.max(0, sources - unavailable);
  const ratio = reachable > 0 ? scanned / reachable : 0;
  const pct = Math.round(ratio * 100);

  const state = [
    `${scanned} of ${reachable} reachable sources scanned (${pct}%).`,
    `${num(f.sourcesNeverScanned)} never scanned,`,
    `${num(f.sourcesInFlight)} in flight,`,
    `${num(f.sourcesFailing)} failing.`,
    // Named rather than folded into the ratio: it is a real gap and somebody
    // has to fix it, but it is an operator/config problem, not a reason for the
    // investigation agents to distrust everything they can see.
    unavailable > 0
      ? `${unavailable} of ${sources} sources cannot be scanned at all (switched off, paused, or failing every attempt) and are excluded from this percentage — they are a configuration problem, not missing evidence you should wait for.`
      : '',
    `Evidence analysis: ${num(f.findingsAnalyzed)} of ${num(f.findingsOpen)} open findings scored`,
    `(unscored findings are pending, not unimportant).`,
  ]
    .filter(Boolean)
    .join(' ');

  if (sources === 0 || ratio >= CORPUS_SAMPLE_COVERAGE_THRESHOLD) {
    return state;
  }

  return [
    state,
    '',
    `YOU ARE SEEING ${pct}% OF THIS CORPUS. Any claim about "the corpus", about the`,
    'absence of something, or about a pattern holding across sources is unsupported at',
    'this coverage. Scope every conclusion to the sources you actually observed, and name',
    'them. A pattern you expect to recur in the sources still to be scanned is an',
    'observation for memory.write, not an inquiry.',
  ].join('\n');
}

function numVal(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
