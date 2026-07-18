import { McpServerFactoryService } from './mcp-server.factory';

type RegisteredTool = {
  config: { inputSchema?: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

describe('McpServerFactoryService semantic tools', () => {
  const tools = new Map<string, RegisteredTool>();
  const findingsService = {
    searchFindings: jest.fn(),
  };
  const assetService = {
    searchAssets: jest.fn(),
  };
  const embeddingService = {
    similarFindings: jest.fn(),
    boilerplateClusters: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tools.clear();
    const factory = Object.create(
      McpServerFactoryService.prototype,
    ) as McpServerFactoryService & Record<string, unknown>;
    Object.assign(factory, {
      findingsService,
      assetService,
      embeddingService,
    });
    const server = {
      registerTool: (
        name: string,
        config: RegisteredTool['config'],
        handler: RegisteredTool['handler'],
      ) => tools.set(name, { config, handler }),
    };
    (factory as any).registerFindingTools(server);
    (factory as any).registerAssetTools(server);
  });

  it('passes semantic finding search and importance ranking to the service', async () => {
    findingsService.searchFindings.mockResolvedValue({
      findings: [{ id: 'finding-1', ranking: { reasons: ['Distinctive'] } }],
      ranking: { mode: 'hybrid', explained: true },
    });

    const tool = tools.get('search_findings');
    expect(tool?.config.inputSchema).toEqual(
      expect.objectContaining({
        semantic_query: expect.anything(),
        semantic_mode: expect.anything(),
        ranking: expect.anything(),
      }),
    );
    const result = (await tool?.handler({
      semantic_query: 'legal payment relationship',
      semantic_mode: 'hybrid',
    })) as { structuredContent: Record<string, unknown> };

    expect(findingsService.searchFindings).toHaveBeenCalledWith({
      filters: undefined,
      page: undefined,
      semantic: { query: 'legal payment relationship', mode: 'hybrid' },
      ranking: { sort: 'importance' },
    });
    expect(result.structuredContent).toMatchObject({
      ranking: { mode: 'hybrid', explained: true },
    });
  });

  it('registers semantic asset, neighbour, and boilerplate handlers', async () => {
    assetService.searchAssets.mockResolvedValue({ assets: [] });
    embeddingService.similarFindings.mockResolvedValue([
      { id: 'finding-2', similarity: 0.98 },
    ]);
    embeddingService.boilerplateClusters.mockResolvedValue([
      { groupHash: 'group-1', findingCount: 12 },
    ]);

    await tools.get('search_assets')?.handler({
      semantic_query: 'aircraft maintenance',
      semantic_mode: 'vector',
    });
    await tools.get('find_similar_findings')?.handler({
      findingId: 'finding-1',
      limit: 5,
    });
    const clusters = (await tools.get('find_boilerplate_clusters')?.handler({
      sourceIds: ['source-1'],
    })) as { structuredContent: Record<string, unknown> };

    expect(assetService.searchAssets).toHaveBeenCalledWith({
      assets: undefined,
      findings: undefined,
      page: undefined,
      options: undefined,
      semantic: { query: 'aircraft maintenance', mode: 'vector' },
    });
    expect(embeddingService.similarFindings).toHaveBeenCalledWith(
      'finding-1',
      5,
    );
    expect(embeddingService.boilerplateClusters).toHaveBeenCalledWith({
      sourceIds: ['source-1'],
      threshold: undefined,
      limit: undefined,
    });
    expect(clusters.structuredContent).toEqual({
      result: [{ groupHash: 'group-1', findingCount: 12 }],
    });
  });
});
