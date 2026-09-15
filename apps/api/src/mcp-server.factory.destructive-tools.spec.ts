import { McpServerFactoryService } from './mcp-server.factory';

type RegisteredTool = {
  inputSchema: {
    parse: (input: unknown) => unknown;
    safeParse: (input: unknown) => { success: boolean };
  };
  annotations?: Record<string, unknown>;
};

/**
 * Every destructive MCP tool takes a strict outer schema: an unknown
 * top-level key is a parse failure (a 400 to the caller), never a stripped
 * typo that widens what the tool does. `dry_run` for `dryRun`,
 * `expectedcount` for `expectedCount` or `confim` for `confirm` must refuse,
 * not execute unguarded.
 */
describe('McpServerFactoryService destructive tools reject unknown keys', () => {
  const uuid = '6b0f1a4e-5f8e-4c43-9d57-0f1f4c1e2a33';
  // Minimal valid input per destructive tool.
  const valid: Record<string, Record<string, unknown>> = {
    delete_case_event: { caseId: uuid, eventId: uuid },
    delete_source: { id: uuid },
    delete_notebook_cell: { sourceId: uuid, baseRevision: 1, cellId: 'c1' },
    delete_notebook_file: { sourceId: uuid, fileId: uuid },
    delete_custom_detector: { id: uuid },
    retire_out_of_scope_findings: { customDetectorId: uuid },
    delete_detector_test_scenario: {
      detector_id: 'det-1',
      scenario_id: 's-1',
    },
    stop_run: { runnerId: uuid },
    bulk_update_findings: { dryRun: true },
    purge_source_findings: { source_id: 'src-1', confirm: true },
    purge_source_assets: { source_id: 'src-1', confirm: true },
    delete_inquiry: { id: uuid },
  };

  let registered: Record<string, RegisteredTool>;

  beforeEach(() => {
    const factory = Object.create(
      McpServerFactoryService.prototype,
    ) as McpServerFactoryService & Record<string, unknown>;
    Object.assign(factory, {
      mcpToolExecutor: { assertNotDemoMode: jest.fn() },
    });
    const server = factory.createServer();
    registered = (
      server as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools;
  });

  it.each(Object.keys(valid))('`%s` is registered and destructive', (name) => {
    expect(registered[name]?.annotations).toMatchObject({
      destructiveHint: true,
    });
  });

  it.each(Object.keys(valid))('`%s` accepts its valid input', (name) => {
    expect(() => registered[name].inputSchema.parse(valid[name])).not.toThrow();
  });

  it.each(Object.keys(valid))(
    '`%s` rejects an unknown top-level key',
    (name) => {
      expect(
        registered[name].inputSchema.safeParse({
          ...valid[name],
          __typo__: 1,
        }).success,
      ).toBe(false);
    },
  );

  it.each(['dry_run', 'expectedcount', 'confim'])(
    'bulk_update_findings rejects the `%s` typo instead of executing unguarded',
    (typo) => {
      const tool = registered.bulk_update_findings;
      expect(
        tool.inputSchema.safeParse({
          filters: {},
          status: 'RESOLVED',
          confirm: true,
          [typo]: true,
        }).success,
      ).toBe(false);
    },
  );
});
