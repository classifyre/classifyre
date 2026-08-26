import { ConflictException } from '@nestjs/common';
import { McpServerFactoryService } from './mcp-server.factory';

type RegisteredTool = {
  config: { inputSchema?: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

describe('McpServerFactoryService notebook tools', () => {
  const tools = new Map<string, RegisteredTool>();
  const notebookService = {
    get: jest.fn(),
    update: jest.fn(),
    getExecution: jest.fn(),
    listExecutions: jest.fn(),
  };
  const notebookExecutionService = {
    create: jest.fn(),
    cancel: jest.fn(),
    toDto: jest.fn((execution: unknown) => execution),
  };
  const sourceFilesService = {
    create: jest.fn(),
    list: jest.fn(),
    delete: jest.fn(),
  };
  const sourceService = {
    source: jest.fn(),
    decryptSourceConfig: jest.fn(),
  };
  const mcpToolExecutor = {
    assertNotDemoMode: jest.fn(),
    updateSource: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tools.clear();
    const factory = Object.create(
      McpServerFactoryService.prototype,
    ) as McpServerFactoryService & Record<string, unknown>;
    Object.assign(factory, {
      notebookService,
      notebookExecutionService,
      sourceFilesService,
      sourceService,
      mcpToolExecutor,
    });
    const server = {
      registerTool: (
        name: string,
        config: RegisteredTool['config'],
        handler: RegisteredTool['handler'],
      ) => tools.set(name, { config, handler }),
    };
    (factory as any).registerNotebookTools(server);
  });

  it('get_notebook merges cells/revision with packages and local folders from source config', async () => {
    notebookService.get.mockResolvedValue({
      revision: 3,
      cells: [{ id: 'extract', type: 'code', source: 'def extract(): ...' }],
      variables: {},
      secretKeys: [],
    });
    sourceService.source.mockResolvedValue({ id: 'source-1', config: {} });
    sourceService.decryptSourceConfig.mockReturnValue({
      optional: { packages: [{ name: 'httpx' }], local_folders: [] },
    });

    const result = (await tools
      .get('get_notebook')
      ?.handler({ sourceId: 'source-1' })) as {
      structuredContent: Record<string, unknown>;
    };

    expect(result.structuredContent).toMatchObject({
      revision: 3,
      packages: [{ name: 'httpx' }],
      localFolders: [],
    });
  });

  it('update_notebook_cell patches only the targeted cell and saves the rest unchanged', async () => {
    notebookService.get.mockResolvedValue({
      revision: 1,
      cells: [
        { id: 'a', type: 'code', source: 'old a' },
        { id: 'b', type: 'code', source: 'old b' },
      ],
    });
    notebookService.update.mockResolvedValue({ revision: 2 });

    await tools.get('update_notebook_cell')?.handler({
      sourceId: 'source-1',
      baseRevision: 1,
      cellId: 'b',
      source: 'new b',
    });

    expect(notebookService.update).toHaveBeenCalledWith('source-1', {
      baseRevision: 1,
      cells: [
        { id: 'a', type: 'code', source: 'old a' },
        { id: 'b', type: 'code', source: 'new b' },
      ],
    });
  });

  it('update_notebook_cell surfaces a revision conflict instead of clobbering concurrent edits', async () => {
    notebookService.get.mockResolvedValue({
      revision: 1,
      cells: [{ id: 'a', type: 'code', source: 'old a' }],
    });
    notebookService.update.mockRejectedValue(
      new ConflictException('revision moved on'),
    );

    await expect(
      tools.get('update_notebook_cell')?.handler({
        sourceId: 'source-1',
        baseRevision: 1,
        cellId: 'a',
        source: 'new a',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('run_notebook creates an execution at the current revision', async () => {
    notebookService.get.mockResolvedValue({ revision: 4, cells: [] });
    notebookExecutionService.create.mockResolvedValue({
      id: 'exec-1',
      status: 'PENDING',
    });

    await tools.get('run_notebook')?.handler({
      sourceId: 'source-1',
      mode: 'test_connection',
    });

    expect(notebookExecutionService.create).toHaveBeenCalledWith(
      'source-1',
      {
        revision: 4,
        mode: 'test_connection',
        targetCellId: undefined,
        maxAssets: undefined,
      },
      'mcp',
    );
  });

  it('set_notebook_packages merges into optional config without dropping other fields', async () => {
    sourceService.source.mockResolvedValue({ id: 'source-1', config: {} });
    sourceService.decryptSourceConfig.mockReturnValue({
      type: 'CUSTOM',
      required: { notebook: { revision: 1, cells: [] } },
      optional: { variables: { base_url: 'https://x' } },
    });
    mcpToolExecutor.updateSource.mockResolvedValue({ id: 'source-1' });

    await tools.get('set_notebook_packages')?.handler({
      sourceId: 'source-1',
      packages: [{ name: 'httpx', version: '>=0.27' }],
    });

    expect(mcpToolExecutor.updateSource).toHaveBeenCalledWith({
      id: 'source-1',
      config: {
        type: 'CUSTOM',
        required: { notebook: { revision: 1, cells: [] } },
        optional: {
          variables: { base_url: 'https://x' },
          packages: [{ name: 'httpx', version: '>=0.27' }],
        },
      },
    });
  });
});
