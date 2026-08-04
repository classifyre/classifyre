import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { SITEMAP_ENTITY_TYPES } from './sitemap.entities';
import {
  DEFAULT_SITEMAP_CHUNK_SIZE,
  MAX_SITEMAP_CHUNK_SIZE,
  MIN_SITEMAP_CHUNK_SIZE,
  SitemapService,
} from './sitemap.service';

describe('SitemapService', () => {
  let service: SitemapService;

  const mockPrisma = { $queryRaw: jest.fn() };
  const mockCls = { get: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SitemapService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ClsService, useValue: mockCls },
      ],
    }).compile();
    service = module.get(SitemapService);
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('ns_test');
  });

  describe('normalizeChunkSize', () => {
    it('defaults and clamps to the protocol-safe range', () => {
      expect(SitemapService.normalizeChunkSize(undefined)).toBe(
        DEFAULT_SITEMAP_CHUNK_SIZE,
      );
      expect(SitemapService.normalizeChunkSize(Number.NaN)).toBe(
        DEFAULT_SITEMAP_CHUNK_SIZE,
      );
      expect(SitemapService.normalizeChunkSize(1)).toBe(MIN_SITEMAP_CHUNK_SIZE);
      expect(SitemapService.normalizeChunkSize(10_000_000)).toBe(
        MAX_SITEMAP_CHUNK_SIZE,
      );
      expect(SitemapService.normalizeChunkSize(2_500)).toBe(2_500);
    });
  });

  describe('getIndex', () => {
    it('rolls chunk counts and the newest timestamp up into each section', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          chunk: 0,
          count: 100,
          last_modified: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          chunk: 1,
          count: 7,
          last_modified: new Date('2026-02-02T00:00:00.000Z'),
        },
      ]);

      const index = await service.getIndex(100);

      expect(index.chunkSize).toBe(100);
      expect(index.sections).toHaveLength(SITEMAP_ENTITY_TYPES.length);
      const findings = index.sections.find((s) => s.type === 'finding');
      expect(findings).toMatchObject({
        total: 107,
        lastModified: '2026-02-02T00:00:00.000Z',
      });
      expect(findings?.chunks).toEqual([
        { index: 0, count: 100, lastModified: '2026-01-01T00:00:00.000Z' },
        { index: 1, count: 7, lastModified: '2026-02-02T00:00:00.000Z' },
      ]);
    });

    it('reports an empty section instead of failing when a table is missing', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(
        new Error('relation "inquiries" does not exist'),
      );

      const index = await service.getIndex(1_000);

      expect(index.sections).toHaveLength(SITEMAP_ENTITY_TYPES.length);
      for (const section of index.sections) {
        expect(section).toMatchObject({
          total: 0,
          lastModified: null,
          chunks: [],
        });
      }
    });

    it('serves a second call for the same namespace from cache', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await service.getIndex(1_000);
      const callsAfterFirst = mockPrisma.$queryRaw.mock.calls.length;
      await service.getIndex(1_000);

      expect(mockPrisma.$queryRaw.mock.calls.length).toBe(callsAfterFirst);

      // A different tenant must not read the first tenant's index.
      mockCls.get.mockReturnValue('ns_other');
      await service.getIndex(1_000);
      expect(mockPrisma.$queryRaw.mock.calls.length).toBe(callsAfterFirst * 2);
    });
  });

  describe('getEntries', () => {
    it('returns ids with ISO timestamps for the requested chunk', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: 'a', last_modified: new Date('2026-03-03T12:00:00.000Z') },
        { id: 'b', last_modified: null },
      ]);

      const page = await service.getEntries('finding', 2, 500);

      expect(page).toEqual({
        type: 'finding',
        chunk: 2,
        chunkSize: 500,
        entries: [
          { id: 'a', lastModified: '2026-03-03T12:00:00.000Z' },
          { id: 'b', lastModified: null },
        ],
      });
    });

    it('floors a negative chunk to zero', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await expect(service.getEntries('asset', -5)).resolves.toMatchObject({
        chunk: 0,
      });
    });
  });
});
