import { AgentDecisionAction } from '@prisma/client';
import { DetectorToolset } from './detector.toolset';
import type { CustomDetectorsService } from '../../../custom-detectors.service';
import type { CustomDetectorTestsService } from '../../../custom-detector-tests.service';
import type { DecisionApplierService } from '../../decision-applier.service';
import type { AgentSearchService } from '../../search/agent-search.service';
import type { Tool, ToolContext } from '../tool.types';

describe('DetectorToolset', () => {
  const mockDetectors = {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    listExamples: jest.fn(),
  };
  const mockTests = { evaluateSample: jest.fn() };
  const mockApplier = { detectorGate: jest.fn(), effectiveMode: jest.fn() };
  const mockSearch = { customDetectorPrecision: jest.fn() };

  const toolset = new DetectorToolset(
    mockDetectors as unknown as CustomDetectorsService,
    mockTests as unknown as CustomDetectorTestsService,
    mockApplier as unknown as DecisionApplierService,
    mockSearch as unknown as AgentSearchService,
  );
  const tools = toolset.list();
  const byName = (name: string) => tools.find((t) => t.name === name) as Tool;
  const tc = { ctx: { run: { id: 'r1' } } } as unknown as ToolContext;

  beforeEach(() => jest.clearAllMocks());

  describe('detector.test', () => {
    const test = () => byName('detector.test');

    it('dry-runs a draft pipelineSchema and summarises matches', async () => {
      mockTests.evaluateSample.mockResolvedValue({
        matched: true,
        findingsCount: 7,
        findings: Array.from({ length: 7 }, (_v, i) => ({ i })),
      });
      const out = (await test().handler(
        { pipelineSchema: { type: 'REGEX', patterns: {} }, sampleText: 'hi' },
        tc,
      )) as { matched: boolean; findingsCount: number; findings: unknown[] };

      expect(mockTests.evaluateSample).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'draft-test',
          name: 'draft',
          pipelineSchema: { type: 'REGEX', patterns: {} },
        }),
        'hi',
      );
      expect(out.matched).toBe(true);
      expect(out.findingsCount).toBe(7);
      expect(out.findings).toHaveLength(5); // capped at 5
      expect(mockDetectors.getById).not.toHaveBeenCalled();
    });

    it('tests a saved detector by id', async () => {
      mockDetectors.getById.mockResolvedValue({
        key: 'cust_x',
        name: 'X',
        pipelineSchema: { type: 'GLINER2' },
      });
      mockTests.evaluateSample.mockResolvedValue({
        matched: false,
        findings: [],
      });
      await test().handler({ detectorId: 'd1', sampleText: 'hi' }, tc);
      expect(mockDetectors.getById).toHaveBeenCalledWith('d1');
      expect(mockTests.evaluateSample).toHaveBeenCalledWith(
        {
          key: 'cust_x',
          name: 'X',
          pipelineSchema: { type: 'GLINER2' },
          aiProviderConfigId: null,
        },
        'hi',
      );
    });

    it('throws when neither detectorId nor pipelineSchema is given', async () => {
      await expect(test().handler({ sampleText: 'hi' }, tc)).rejects.toThrow(
        /detectorId or pipelineSchema/,
      );
    });

    it('is a read tool (never gated)', () => {
      expect(test().sideEffect).toBe('read');
    });
  });

  describe('detector.update', () => {
    it('dispatches to update with the UPDATE_DETECTOR action', async () => {
      const tool = byName('detector.update');
      mockDetectors.update.mockResolvedValue({
        id: 'd1',
        key: 'k',
        name: 'n',
        version: 2,
      });
      await tool.handler(
        { detectorId: 'd1', pipelineSchema: { type: 'REGEX', patterns: {} } },
        tc,
      );
      expect(mockDetectors.update).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({
          pipelineSchema: { type: 'REGEX', patterns: {} },
        }),
      );
      expect(tool.decisionAction).toBe(AgentDecisionAction.UPDATE_DETECTOR);
      expect(tool.sideEffect).toBe('mutate');
    });
  });

  describe('detector.deactivate', () => {
    it('updates isActive=false', async () => {
      const tool = byName('detector.deactivate');
      mockDetectors.update.mockResolvedValue({
        id: 'd1',
        key: 'k',
        isActive: false,
      });
      await tool.handler({ detectorId: 'd1' }, tc);
      expect(mockDetectors.update).toHaveBeenCalledWith('d1', {
        isActive: false,
      });
      expect(tool.decisionAction).toBe(AgentDecisionAction.UPDATE_DETECTOR);
    });
  });

  describe('detector.delete', () => {
    it('dispatches to delete with the DELETE_DETECTOR action', async () => {
      const tool = byName('detector.delete');
      mockDetectors.delete.mockResolvedValue({ deleted: true });
      const out = await tool.handler({ detectorId: 'd1' }, tc);
      expect(mockDetectors.delete).toHaveBeenCalledWith('d1');
      expect(out).toEqual({ deleted: true });
      expect(tool.decisionAction).toBe(AgentDecisionAction.DELETE_DETECTOR);
    });
  });

  describe('detectors.precision', () => {
    it('is a read tool that forwards the optional key to the search service', async () => {
      const tool = byName('detectors.precision');
      expect(tool.sideEffect).toBe('read');
      const rows = [
        {
          customDetectorKey: 'cust_x',
          customDetectorName: 'X',
          openFindings: 3,
          dismissed: 8,
          confirmed: 2,
          reviewed: 10,
          falsePositiveRate: 0.8,
          verdict: 'noisy',
        },
      ];
      mockSearch.customDetectorPrecision.mockResolvedValue(rows);
      const out = await tool.handler({ customDetectorKey: 'cust_x' }, tc);
      expect(mockSearch.customDetectorPrecision).toHaveBeenCalledWith('cust_x');
      expect(out).toBe(rows);
    });

    it('passes null when no key is given', async () => {
      mockSearch.customDetectorPrecision.mockResolvedValue([]);
      await byName('detectors.precision').handler({}, tc);
      expect(mockSearch.customDetectorPrecision).toHaveBeenCalledWith(null);
    });
  });

  describe('detector.examples', () => {
    it('returns the worked examples', async () => {
      mockDetectors.listExamples.mockReturnValue([
        { name: 'Ex', description: 'd', pipelineSchema: { type: 'REGEX' } },
      ]);
      const out = (await byName('detector.examples').handler(
        {},
        tc,
      )) as unknown[];
      expect(out).toHaveLength(1);
      expect(mockDetectors.listExamples).toHaveBeenCalledWith(undefined);
    });

    it('passes the type filter through to listExamples', async () => {
      mockDetectors.listExamples.mockReturnValue([]);
      await byName('detector.examples').handler(
        { type: 'TEXT_CLASSIFICATION' },
        tc,
      );
      expect(mockDetectors.listExamples).toHaveBeenCalledWith(
        'TEXT_CLASSIFICATION',
      );
    });
  });
});
