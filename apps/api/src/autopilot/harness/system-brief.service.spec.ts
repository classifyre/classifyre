import { Test, TestingModule } from '@nestjs/testing';
import { AgentMemoryKind } from '@prisma/client';
import { SystemBriefService, type ComposedBrief } from './system-brief.service';
import { PrismaService } from '../../prisma.service';
import { AgentMemoryService } from '../memory/agent-memory.service';

describe('SystemBriefService', () => {
  let service: SystemBriefService;

  const mockPrisma = {
    agentSystemBrief: { findUnique: jest.fn(), upsert: jest.fn() },
    source: { count: jest.fn() },
    asset: { count: jest.fn(), groupBy: jest.fn() },
    customDetector: { count: jest.fn() },
    inquiry: { count: jest.fn() },
    case: { count: jest.fn() },
    finding: { count: jest.fn(), groupBy: jest.fn() },
    assetCluster: { count: jest.fn() },
    instanceSettings: { findUnique: jest.fn() },
    aiProviderConfig: { count: jest.fn() },
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

    mockMemory.topByWeight.mockImplementation((kind: AgentMemoryKind) => {
      const byKind: Partial<Record<AgentMemoryKind, unknown[]>> = {
        [AgentMemoryKind.GLOSSARY]: [
          { kind: 'GLOSSARY', key: 'pii', content: 'personal data', weight: 3 },
        ],
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
        aiEnabled: true,
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
