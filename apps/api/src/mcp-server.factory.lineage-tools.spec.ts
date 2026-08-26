import { McpServerFactoryService } from './mcp-server.factory';

type RegisteredTool = {
  config: { inputSchema?: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

describe('McpServerFactoryService lineage tools', () => {
  const tools = new Map<string, RegisteredTool>();
  const graphService = {
    lineage: jest.fn(),
    getRelationTypes: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tools.clear();
    const factory = Object.create(
      McpServerFactoryService.prototype,
    ) as McpServerFactoryService & Record<string, unknown>;
    Object.assign(factory, { graphService });
    const server = {
      registerTool: (
        name: string,
        config: RegisteredTool['config'],
        handler: RegisteredTool['handler'],
      ) => tools.set(name, { config, handler }),
    };
    (factory as any).registerLineageTools(server);
  });

  it('get_asset_lineage passes traversal options through to GraphService.lineage', async () => {
    graphService.lineage.mockResolvedValue({
      nodes: [{ id: 'asset-1', type: 'asset', label: 'EVI', depth: 0 }],
      edges: [
        {
          id: 'edge-1',
          fromType: 'asset',
          fromId: 'asset-1',
          toType: 'asset',
          toId: 'asset-2',
          relationType: 'FLOW',
          confidence: 1,
          origin: 'INFERRED',
        },
      ],
      truncated: false,
    });

    const result = (await tools.get('get_asset_lineage')?.handler({
      assetId: 'asset-1',
      direction: 'up',
      depth: 2,
    })) as { structuredContent: Record<string, unknown> };

    expect(graphService.lineage).toHaveBeenCalledWith({
      assetId: 'asset-1',
      direction: 'up',
      depth: 2,
      collapseContainers: undefined,
      mergeIdentity: undefined,
    });
    expect(result.structuredContent).toMatchObject({
      nodes: [{ id: 'asset-1' }],
      edges: [{ id: 'edge-1', toId: 'asset-2' }],
    });
  });

  it('get_relation_types returns GraphService.getRelationTypes verbatim', async () => {
    graphService.getRelationTypes.mockResolvedValue({
      inUse: ['FLOW'],
      suggestions: ['FLOW', 'REFERENCE'],
      classified: [{ type: 'FLOW', relationClass: 'FLOW', count: 3 }],
    });

    const result = (await tools.get('get_relation_types')?.handler({})) as {
      structuredContent: Record<string, unknown>;
    };

    expect(graphService.getRelationTypes).toHaveBeenCalledWith();
    expect(result.structuredContent).toMatchObject({ inUse: ['FLOW'] });
  });
});
