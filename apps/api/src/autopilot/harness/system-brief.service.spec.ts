import { Test, TestingModule } from '@nestjs/testing';
import { AgentMemoryKind } from '@prisma/client';
import { SystemBriefService, type ComposedBrief } from './system-brief.service';
import { PrismaService } from '../../prisma.service';
import { AgentMemoryService } from '../memory/agent-memory.service';

describe('SystemBriefService', () => {
  let service: SystemBriefService;

  const mockPrisma = {
    agentSystemBrief: { findUnique: jest.fn(), upsert: jest.fn() },
    source: { count: jest.fn(), findMany: jest.fn() },
    runner: { groupBy: jest.fn() },
    asset: { count: jest.fn(), groupBy: jest.fn() },
    customDetector: { count: jest.fn() },
    inquiry: { count: jest.fn() },
    case: { count: jest.fn() },
    finding: { count: jest.fn(), groupBy: jest.fn() },
    assetCluster: { count: jest.fn() },
    instanceSettings: { findUnique: jest.fn() },
    aiProviderConfig: { count: jest.fn() },
    glossaryTerm: { findMany: jest.fn() },
  };

  const mockMemory = {
    topByWeight: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemBriefService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentMemoryService, useValue: mockMemory },
      ],
    }).compile();
    service = module.get(SystemBriefService);
    jest.clearAllMocks();

    // Coverage is recomputed on every compose(), so every path needs these.
    mockPrisma.source.count.mockResolvedValue(0);
    mockPrisma.source.findMany.mockResolvedValue([]);
    mockPrisma.runner.groupBy.mockResolvedValue([]);
    mockPrisma.finding.count.mockResolvedValue(0);

    mockPrisma.glossaryTerm.findMany.mockResolvedValue([
      { term: 'pii', aliases: [], entityType: 'TERM', notes: 'personal data' },
    ]);
    mockMemory.topByWeight.mockImplementation((kind: AgentMemoryKind) => {
      const byKind: Partial<Record<AgentMemoryKind, unknown[]>> = {
        [AgentMemoryKind.ENTITY_MAP]: [
          {
            kind: 'ENTITY_MAP',
            key: 'leaks',
            content: 'maps to inquiry 1',
            weight: 2,
          },
        ],
        [AgentMemoryKind.DETECTOR_INSIGHT]: [
          {
            kind: 'DETECTOR_INSIGHT',
            key: 'detector-author:iban',
            content: 'tried IBAN regex, abandoned (too noisy)',
            weight: 1,
          },
        ],
        [AgentMemoryKind.DECISION_PRECEDENT]: [],
      };
      return Promise.resolve(byKind[kind] ?? []);
    });
  });

  describe('computeFacts', () => {
    it('counts sources that have assets but no findings as cold-start', async () => {
      mockPrisma.source.count.mockResolvedValue(3);
      mockPrisma.asset.count.mockResolvedValue(120);
      mockPrisma.customDetector.count.mockResolvedValue(2);
      mockPrisma.inquiry.count.mockResolvedValue(4);
      mockPrisma.case.count.mockResolvedValue(1);
      mockPrisma.finding.count.mockResolvedValue(50);
      mockPrisma.assetCluster.count.mockResolvedValue(7);
      mockPrisma.asset.groupBy.mockResolvedValue([
        { sourceId: 'a' },
        { sourceId: 'b' },
        { sourceId: 'c' },
      ]);
      mockPrisma.finding.groupBy.mockResolvedValue([{ sourceId: 'a' }]);

      const facts = await service.computeFacts();
      expect(facts.sourcesWithoutFindings).toBe(2);
      expect(facts.assets).toBe(120);
      expect(facts.clusters).toBe(7);
    });
  });

  describe('render', () => {
    const composed: ComposedBrief = {
      overview: 'A demo data-company instance.',
      facts: {
        sources: 3,
        sourcesWithoutFindings: 1,
        assets: 120,
        customDetectors: 2,
        activeInquiries: 4,
        openCases: 1,
        openFindings: 50,
        clusters: 7,
      },
      glossary: [{ key: 'pii', content: 'personal data', weight: 3 }],
      topics: [{ key: 'leaks', content: 'maps to inquiry 1', weight: 2 }],
      gaps: [{ key: 'detector-author:iban', content: 'abandoned', weight: 1 }],
      deferred: [],
      setup: [
        {
          status: 'ok',
          label: 'AI provider configured',
          detail: '1 provider.',
        },
      ],
      version: 4,
      updatedBy: 'ai-autopilot',
    };

    it('is deterministic — identical output across renders', () => {
      expect(service.render(composed)).toBe(service.render(composed));
    });

    it('emits the fixed section headers in order', () => {
      const out = service.render(composed);
      expect(out).toContain('## System brief (v4)');
      expect(out).toContain('### Overview');
      expect(out).toContain('### Coverage');
      expect(out).toContain('### Glossary');
      expect(out).toContain('### Topics');
      expect(out).toContain("### What's been tried / known gaps");
      expect(out).toContain('### Setup & next steps');
      // Coverage surfaces the cold-start count.
      expect(out).toContain('1 with no findings yet');
    });
  });

  describe('compose', () => {
    beforeEach(() => {
      mockPrisma.agentSystemBrief.findUnique.mockResolvedValue({
        id: 1,
        content: 'Overview text',
        facts: { sources: 2, sourcesWithoutFindings: 1 },
        version: 5,
        updatedBy: 'ai-autopilot',
      });
      mockPrisma.instanceSettings.findUnique.mockResolvedValue({
        harnessEnabled: true,
        harnessAiProviderConfigId: 'p1',
        autopilotDetectorEnabled: false,
      });
      mockPrisma.aiProviderConfig.count.mockResolvedValue(1);
    });

    it('folds glossary, topics and gaps in from memory', async () => {
      const c = await service.compose();
      expect(c.overview).toBe('Overview text');
      expect(c.glossary.map((g) => g.key)).toContain('pii');
      expect(c.topics.map((t) => t.key)).toContain('leaks');
      expect(c.gaps.map((g) => g.key)).toContain('detector-author:iban');
    });

    // agenda.defer exists so "I expect this pattern to recur in the sources
    // still to be scanned" has an expression other than creating the inquiry
    // anyway. Resurfacing a deferral before its threshold would recreate
    // exactly the pressure to act early that deferring it relieved.
    describe('deferred items', () => {
      const parked = (revisitAt: string | null, updatedAt = new Date()) => [
        {
          kind: 'DECISION_PRECEDENT',
          key: 'deferred:html-noise',
          content: 'Seen in symes-k; expect it elsewhere',
          weight: 1,
          tags:
            revisitAt === null
              ? ['deferred']
              : ['deferred', `revisit-at:${revisitAt}`],
          origin: 'AGENT',
          verified: false,
          updatedAt,
        },
      ];

      const daysAgo = (days: number) =>
        new Date(Date.now() - days * 24 * 3600 * 1000);

      const atCoverage = (scanned: number, total: number) => {
        mockPrisma.source.count.mockResolvedValue(total);
        mockPrisma.runner.groupBy.mockResolvedValue(
          Array.from({ length: scanned }, (_, i) => ({ sourceId: `s${i}` })),
        );
      };

      it('stays silent below its coverage threshold', async () => {
        mockMemory.topByWeight.mockImplementation((kind: AgentMemoryKind) =>
          Promise.resolve(
            kind === AgentMemoryKind.DECISION_PRECEDENT ? parked('0.9') : [],
          ),
        );
        atCoverage(12, 151);

        const c = await service.compose();
        expect(c.deferred).toHaveLength(0);
      });

      it('resurfaces once coverage reaches the threshold', async () => {
        mockMemory.topByWeight.mockImplementation((kind: AgentMemoryKind) =>
          Promise.resolve(
            kind === AgentMemoryKind.DECISION_PRECEDENT ? parked('0.5') : [],
          ),
        );
        atCoverage(151, 151);

        const c = await service.compose();
        expect(c.deferred.map((d) => d.key)).toContain('deferred:html-noise');
      });

      // Deferrals are DECISION_PRECEDENTs too, and would otherwise read among
      // the gaps as "already decided". They are the opposite: open questions.
      it('keeps deferrals out of the known-gaps section', async () => {
        mockMemory.topByWeight.mockImplementation((kind: AgentMemoryKind) =>
          Promise.resolve(
            kind === AgentMemoryKind.DECISION_PRECEDENT ? parked('0.5') : [],
          ),
        );
        atCoverage(151, 151);

        const c = await service.compose();
        expect(c.gaps.map((g) => g.key)).not.toContain('deferred:html-noise');
      });

      // Coverage alone was a promise the system could not keep: an instance
      // whose ratio never reached the threshold parked things permanently.
      it('resurfaces an item that has simply waited long enough', async () => {
        mockMemory.topByWeight.mockImplementation((kind: AgentMemoryKind) =>
          Promise.resolve(
            kind === AgentMemoryKind.DECISION_PRECEDENT
              ? parked('0.9', daysAgo(30))
              : [],
          ),
        );
        atCoverage(12, 151);

        const c = await service.compose();
        expect(c.deferred.map((d) => d.key)).toContain('deferred:html-noise');
      });

      it('still waits while the item is young and coverage is low', async () => {
        mockMemory.topByWeight.mockImplementation((kind: AgentMemoryKind) =>
          Promise.resolve(
            kind === AgentMemoryKind.DECISION_PRECEDENT
              ? parked('0.9', daysAgo(2))
              : [],
          ),
        );
        atCoverage(12, 151);

        const c = await service.compose();
        expect(c.deferred).toHaveLength(0);
      });

      // A dream-cycle rewrite can drop tags. Defaulting to 1.0 made that
      // deferral permanent, since full coverage is unreachable with a single
      // unscannable source.
      it('falls back to the coverage threshold, not 100%, when the tag is lost', async () => {
        mockMemory.topByWeight.mockImplementation((kind: AgentMemoryKind) =>
          Promise.resolve(
            kind === AgentMemoryKind.DECISION_PRECEDENT ? parked(null) : [],
          ),
        );
        atCoverage(95, 100);

        const c = await service.compose();
        expect(c.deferred.map((d) => d.key)).toContain('deferred:html-noise');
      });
    });

    // The ratchet itself: dead sources used to sit in the coverage denominator
    // forever, pinning the ratio below the threshold and leaving the harness in
    // permanent observe-and-defer mode.
    describe('unscannable sources', () => {
      it('leaves them out of the coverage ratio', async () => {
        mockPrisma.source.count.mockResolvedValue(100);
        mockPrisma.runner.groupBy.mockResolvedValue(
          Array.from({ length: 80 }, (_, i) => ({ sourceId: `s${i}` })),
        );
        // 20 sources that cannot be scanned, none of them ever scanned.
        mockPrisma.source.findMany.mockResolvedValue(
          Array.from({ length: 20 }, (_, i) => ({ id: `dead${i}` })),
        );

        const c = await service.compose();

        expect(c.facts.sourcesUnavailable).toBe(20);
        expect(c.facts.sourcesReachable).toBe(80);
        // 80/80, not 80/100 — the difference between "act" and "defer".
        expect(c.facts.coverageRatio).toBe(1);
      });

      it('keeps a source it has successfully scanned in the ratio, however broken it is now', async () => {
        mockPrisma.source.count.mockResolvedValue(10);
        mockPrisma.runner.groupBy.mockResolvedValue([{ sourceId: 's1' }]);
        // s1 is failing now, but we HAVE read it — it is not unavailable.
        mockPrisma.source.findMany.mockResolvedValue([{ id: 's1' }]);

        const c = await service.compose();

        expect(c.facts.sourcesUnavailable).toBe(0);
        expect(c.facts.coverageRatio).toBeCloseTo(0.1);
      });

      it('reports 0%, not full coverage, when every source is unavailable', async () => {
        mockPrisma.source.count.mockResolvedValue(5);
        mockPrisma.runner.groupBy.mockResolvedValue([]);
        mockPrisma.source.findMany.mockResolvedValue(
          Array.from({ length: 5 }, (_, i) => ({ id: `dead${i}` })),
        );

        const c = await service.compose();

        expect(c.facts.sourcesReachable).toBe(0);
        expect(c.facts.coverageRatio).toBe(0);
      });
    });

    it('derives a setup checklist that flags cold-start sources', async () => {
      const c = await service.compose();
      const labels = c.setup.map((s) => s.label);
      expect(labels).toContain('AI provider configured');
      expect(labels).toContain('Sources with no findings yet');
      // Detector autopilot is off → it is surfaced as a next step.
      expect(labels).toContain('Detector-authoring autopilot is off');
    });
  });
});
