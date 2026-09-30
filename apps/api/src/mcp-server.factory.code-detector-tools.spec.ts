import { McpServerFactoryService } from './mcp-server.factory';
import { MCP_CAPABILITY_GROUPS } from './mcp-catalog';

type RegisteredTool = {
  description?: string;
  enabled?: boolean;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const CODE_SCHEMA = {
  type: 'CUSTOM_DETECTOR',
  notebook: {
    cells: [
      { id: 'c', type: 'code', source: 'def detect(asset):\n    pass\n' },
    ],
  },
};

/**
 * A code detector is Python that runs in every scan it is attached to, so
 * writing one over MCP needs the code-authoring group, not only the detector
 * group -- and an agent choosing an engine must be told when to pick it.
 */
describe('McpServerFactoryService code detectors (CUSTOM_DETECTOR)', () => {
  const mcpToolExecutor = {
    assertNotDemoMode: jest.fn(),
    createCustomDetector: jest.fn().mockResolvedValue({ id: 'd1' }),
  };
  const customDetectorsService = {
    update: jest.fn().mockResolvedValue({ id: 'd1' }),
    getById: jest.fn().mockResolvedValue({
      id: 'd1',
      pipelineSchema: {
        ...CODE_SCHEMA,
        notebook: { ...CODE_SCHEMA.notebook, revision: 4 },
      },
    }),
  };
  const notebookExecutionService = {
    createForDetector: jest.fn().mockResolvedValue({ id: 'e1' }),
    toDto: jest.fn((execution: unknown) => execution),
  };

  function tools(toolGroupIds: string[] | null) {
    jest.clearAllMocks();
    const factory = Object.create(
      McpServerFactoryService.prototype,
    ) as McpServerFactoryService & Record<string, unknown>;
    Object.assign(factory, {
      mcpToolExecutor,
      customDetectorsService,
      notebookExecutionService,
    });
    const server = factory.createServer({ toolGroupIds });
    return (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools;
  }

  it('refuses to create a code detector without custom_source_code', async () => {
    const registered = tools(['custom_detectors']);
    await expect(
      registered.create_custom_detector.handler({
        name: 'rule',
        pipeline_schema: CODE_SCHEMA,
      }),
    ).rejects.toThrow(/custom_source_code/);
    expect(mcpToolExecutor.createCustomDetector).not.toHaveBeenCalled();
  });

  it('still lets a detector-only token create a regex detector', async () => {
    const registered = tools(['custom_detectors']);
    await registered.create_custom_detector.handler({
      name: 'ids',
      pipeline_schema: { type: 'REGEX', patterns: { a: { pattern: 'x' } } },
    });
    expect(mcpToolExecutor.createCustomDetector).toHaveBeenCalled();
  });

  it('allows it with both groups, and for unscoped tokens', async () => {
    for (const groups of [['custom_detectors', 'custom_source_code'], null]) {
      const registered = tools(groups);
      await registered.create_custom_detector.handler({
        name: 'rule',
        pipeline_schema: CODE_SCHEMA,
      });
      await registered.update_custom_detector.handler({
        id: 'd1',
        pipeline_schema: CODE_SCHEMA,
      });
    }
    expect(mcpToolExecutor.createCustomDetector).toHaveBeenCalledTimes(1);
  });

  it('guides the engine choice where the agent chooses', () => {
    const description = tools(null).create_custom_detector.description ?? '';
    expect(description).toContain('CUSTOM_DETECTOR');
    expect(description).toContain('Choose it when');
    expect(description).toContain('preview_detect');
  });

  it("runs a preview at the detector's current revision", async () => {
    const registered = tools(null);
    await registered.run_custom_detector_notebook.handler({
      detectorId: 'd1',
      mode: 'preview_detect',
      sourceId: 's1',
    });
    expect(notebookExecutionService.createForDetector).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        revision: 4,
        mode: 'preview_detect',
        sourceId: 's1',
      }),
      'mcp',
    );
  });

  it('files the new tools under custom_source_code', () => {
    const group = MCP_CAPABILITY_GROUPS.find(
      (g) => g.id === 'custom_source_code',
    );
    for (const name of [
      'run_custom_detector_notebook',
      'list_custom_detector_files',
      'upload_custom_detector_file',
      'delete_custom_detector_file',
    ]) {
      expect(group?.toolNames).toContain(name);
    }
  });
});
