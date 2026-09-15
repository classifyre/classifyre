import { McpServerFactoryService } from './mcp-server.factory';

type RegisteredTool = {
  inputSchema: { parse: (input: unknown) => Record<string, unknown> };
  annotations?: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Retiring out-of-scope findings through MCP must never reach the inquiry
 * override: emptying what an investigation watches is an operator decision,
 * and the agents that hold this tool are exactly who it must not reach.
 */
describe('McpServerFactoryService retire_out_of_scope_findings', () => {
  const retireOutOfScope = {
    startDryRun: jest.fn().mockResolvedValue({ id: 'op-dry' }),
    startRetire: jest.fn().mockResolvedValue({ id: 'op-retire' }),
  };
  const findingBulkOperations = {
    toDto: jest.fn((operation: unknown) => operation),
  };
  const mcpToolExecutor = { assertNotDemoMode: jest.fn() };
  let tool: RegisteredTool;

  beforeEach(() => {
    jest.clearAllMocks();
    const factory = Object.create(
      McpServerFactoryService.prototype,
    ) as McpServerFactoryService & Record<string, unknown>;
    Object.assign(factory, {
      retireOutOfScope,
      findingBulkOperations,
      mcpToolExecutor,
    });
    const server = factory.createServer();
    tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.retire_out_of_scope_findings;
  });

  it('is destructive and has no inquiry override in its schema', () => {
    expect(tool.annotations).toMatchObject({ destructiveHint: true });
    const parsed = tool.inputSchema.parse({
      customDetectorId: '6b0f1a4e-5f8e-4c43-9d57-0f1f4c1e2a33',
      dryRun: false,
      fromOperationId: '0e2a4c6d-8f10-4a2b-9c3d-4e5f60718293',
      expectedCount: 37,
      confirm: true,
      includeInquiryWatched: true,
    });
    expect(parsed).not.toHaveProperty('includeInquiryWatched');
  });

  it('asks the service to refuse the override, whatever the caller sends', async () => {
    await tool.handler({
      customDetectorId: 'det-1',
      dryRun: false,
      fromOperationId: 'op-dry',
      expectedCount: 37,
      confirm: true,
      includeInquiryWatched: true,
    });

    expect(retireOutOfScope.startRetire).toHaveBeenCalledWith(
      'det-1',
      {
        fromOperationId: 'op-dry',
        expectedCount: 37,
        confirm: true,
        createdBy: 'mcp',
      },
      { allowInquiryOverride: false },
    );
  });

  it('runs a dry run by default', async () => {
    await tool.handler({ customDetectorId: 'det-1' });

    expect(retireOutOfScope.startDryRun).toHaveBeenCalledWith('det-1', {
      sourceIds: undefined,
      createdBy: 'mcp',
    });
    expect(retireOutOfScope.startRetire).not.toHaveBeenCalled();
  });
});
