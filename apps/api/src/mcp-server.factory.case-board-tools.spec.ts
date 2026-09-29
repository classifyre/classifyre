import { McpServerFactoryService } from './mcp-server.factory';
import { MCP_CAPABILITY_GROUPS } from './mcp-catalog';

type RegisteredTool = {
  inputSchema: {
    safeParse: (input: unknown) => { success: boolean; data?: unknown };
  };
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown>;
  enabled: boolean;
  annotations?: Record<string, unknown>;
};

const CASE = '6b0f1a4e-5f8e-4c43-9d57-0f1f4c1e2a33';
const ITEM = '7c1f2b5f-6a9f-4d54-8e68-1a2b3c4d5e6f';

/**
 * The case board and clean-up tools delegate to their services with the
 * arguments a client sent, and the Case Board token scope turns exactly the
 * board tools on.
 */
describe('McpServerFactoryService case board tools', () => {
  const caseBoardTools = {
    view: jest.fn().mockResolvedValue({ board: {} }),
    place: jest.fn().mockResolvedValue({ placed: [] }),
    tidy: jest.fn().mockResolvedValue({ moves: [] }),
    frame: jest.fn().mockResolvedValue({ frameId: ITEM }),
    trace: jest.fn().mockResolvedValue({ nodes: [] }),
  };
  const caseBoardService = {
    applyOps: jest.fn().mockResolvedValue({
      version: 2,
      applied: [],
      rejected: [],
      stale: false,
    }),
  };
  const caseBoardRead = {
    currentVersion: jest.fn().mockResolvedValue(1),
    listSnapshots: jest.fn().mockResolvedValue([]),
    takeSnapshot: jest.fn().mockResolvedValue({ id: 'snap' }),
  };
  const casesService = {
    findOne: jest.fn().mockResolvedValue({
      id: CASE,
      removeGoneFindings: false,
      removeResolvedFindings: true,
      removeGoneAssets: false,
    }),
    update: jest.fn().mockResolvedValue({}),
    setInquiryAutoPull: jest.fn().mockResolvedValue({}),
    unlinkInquiry: jest.fn().mockResolvedValue({}),
  };
  const caseCleanup = {
    previewRules: jest.fn().mockResolvedValue({ goneFindings: 1 }),
  };
  const caseFindingFilters = {
    preview: jest.fn().mockResolvedValue({ matched: 3 }),
    update: jest.fn().mockResolvedValue({ filters: [] }),
  };
  const caseThreadsService = { update: jest.fn().mockResolvedValue({}) };
  const mcpToolExecutor = { assertNotDemoMode: jest.fn() };

  let tools: Record<string, RegisteredTool>;

  function build(toolGroupIds?: string[] | null) {
    const factory = Object.create(
      McpServerFactoryService.prototype,
    ) as McpServerFactoryService & Record<string, unknown>;
    // Every other dependency is only closed over at registration.
    const stub = new Proxy(
      {},
      { get: () => new Proxy(() => undefined, { get: () => undefined }) },
    );
    Object.assign(factory, stub, {
      caseBoardTools,
      caseBoardService,
      caseBoardRead,
      casesService,
      caseCleanup,
      caseFindingFilters,
      caseThreadsService,
      mcpToolExecutor,
    });
    const server = factory.createServer({ toolGroupIds });
    return (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    tools = build();
  });

  const call = (name: string, args: Record<string, unknown>) =>
    tools[name].handler(args, {});

  it('reads the board as a summary, a full payload or a snapshot', async () => {
    await call('get_case_board', { caseId: CASE });
    await call('get_case_board', {
      caseId: CASE,
      view: 'full',
      includeGraph: true,
    });
    await call('get_case_board', { caseId: CASE, snapshotId: ITEM });
    expect(caseBoardTools.view.mock.calls).toEqual([
      [
        CASE,
        { view: undefined, includeGraph: undefined, snapshotId: undefined },
      ],
      [CASE, { view: 'full', includeGraph: true, snapshotId: undefined }],
      [CASE, { view: undefined, includeGraph: undefined, snapshotId: ITEM }],
    ]);
  });

  it('numbers ops that come without an opId and keeps the ones that have one', async () => {
    const input = {
      caseId: CASE,
      ops: [
        { type: 'item.delete', id: ITEM },
        { type: 'item.restore', id: ITEM, opId: 'mine' },
      ],
    };
    expect(
      tools.apply_case_board_ops.inputSchema.safeParse(input).success,
    ).toBe(true);
    await call('apply_case_board_ops', input);
    expect(caseBoardService.applyOps).toHaveBeenCalledWith(
      CASE,
      expect.objectContaining({
        baseVersion: 1,
        ops: [
          { type: 'item.delete', id: ITEM, opId: 'op-1' },
          { type: 'item.restore', id: ITEM, opId: 'mine' },
        ],
      }),
      'mcp',
    );
  });

  it('still refuses an unknown key inside an op', () => {
    expect(
      tools.apply_case_board_ops.inputSchema.safeParse({
        caseId: CASE,
        ops: [{ type: 'item.delete', id: ITEM, idd: ITEM }],
      }).success,
    ).toBe(false);
  });

  it('places, tidies (dry runs skip the demo guard), frames and traces', async () => {
    await call('place_case_board_items', { caseId: CASE });
    expect(caseBoardTools.place).toHaveBeenCalledWith(CASE, 'mcp');

    await call('tidy_case_board', { caseId: CASE, dryRun: true });
    expect(mcpToolExecutor.assertNotDemoMode).toHaveBeenCalledTimes(1);
    await call('tidy_case_board', { caseId: CASE });
    expect(mcpToolExecutor.assertNotDemoMode).toHaveBeenCalledTimes(2);
    expect(caseBoardTools.tidy.mock.calls).toEqual([
      [CASE, { dryRun: true }, 'mcp'],
      [CASE, { dryRun: undefined }, 'mcp'],
    ]);

    await call('frame_case_board_items', {
      caseId: CASE,
      itemIds: [ITEM],
      title: 'Payroll',
    });
    expect(caseBoardTools.frame).toHaveBeenCalledWith(
      CASE,
      {
        itemIds: [ITEM],
        title: 'Payroll',
        frameId: undefined,
        color: undefined,
        arrangement: undefined,
      },
      'mcp',
    );

    await call('trace_case_connections', {
      caseId: CASE,
      direction: 'up',
      depth: 3,
    });
    expect(caseBoardTools.trace).toHaveBeenCalledWith(CASE, {
      assetIds: undefined,
      direction: 'up',
      depth: 3,
      kinds: undefined,
      limit: undefined,
    });
  });

  it('lists and takes snapshots', async () => {
    await call('list_case_board_snapshots', { caseId: CASE });
    await call('take_case_board_snapshot', { caseId: CASE });
    expect(caseBoardRead.listSnapshots).toHaveBeenCalledWith(CASE);
    expect(caseBoardRead.takeSnapshot).toHaveBeenCalledWith(
      CASE,
      'MANUAL',
      'mcp',
    );
  });

  it('previews all three clean-up switches unless some are named', async () => {
    await call('preview_case_cleanup', { id: CASE });
    await call('preview_case_cleanup', { id: CASE, removeGoneAssets: true });
    expect(caseCleanup.previewRules.mock.calls).toEqual([
      [
        CASE,
        {
          removeGoneFindings: true,
          removeResolvedFindings: true,
          removeGoneAssets: true,
        },
      ],
      [
        CASE,
        {
          removeGoneFindings: false,
          removeResolvedFindings: false,
          removeGoneAssets: true,
        },
      ],
    ]);
  });

  it('passes rule previews, rule changes, watch changes and thread updates through', async () => {
    const rules = [{ kind: 'VALUE_PATTERN', pattern: '^AT' }];
    await call('preview_case_finding_filters', {
      id: CASE,
      action: 'ESCALATE',
      rules,
    });
    expect(caseFindingFilters.preview).toHaveBeenCalledWith(CASE, {
      action: 'ESCALATE',
      inquiryId: null,
      rules,
    });
    await call('update_case_finding_filter', {
      id: CASE,
      filterId: ITEM,
      pattern: '^DE',
    });
    expect(caseFindingFilters.update).toHaveBeenCalledWith(
      CASE,
      ITEM,
      {
        pattern: '^DE',
        description: undefined,
        removeEmptiedAssets: undefined,
      },
      'mcp',
    );
    await call('set_case_inquiry_auto_pull', {
      id: CASE,
      inquiryId: ITEM,
      autoPull: false,
    });
    expect(casesService.setInquiryAutoPull).toHaveBeenCalledWith(
      CASE,
      ITEM,
      false,
      'mcp',
    );
    await call('unlink_case_inquiry', { id: CASE, inquiryId: ITEM });
    expect(casesService.unlinkInquiry).toHaveBeenCalledWith(CASE, ITEM, 'mcp');
    await call('update_case_thread', {
      threadId: ITEM,
      status: 'SUPPORTED',
      confidence: 0.8,
    });
    expect(caseThreadsService.update).toHaveBeenCalledWith(ITEM, {
      status: 'SUPPORTED',
      confidence: 0.8,
      actor: 'mcp',
    });
  });

  it('turns exactly the board tools on for a Case Board token', () => {
    const board = MCP_CAPABILITY_GROUPS.find((g) => g.id === 'case_board')!;
    const cases = MCP_CAPABILITY_GROUPS.find((g) => g.id === 'cases')!;
    expect(board.toolNames).toEqual(
      expect.arrayContaining([
        'get_case_board',
        'apply_case_board_ops',
        'place_case_board_items',
        'tidy_case_board',
        'frame_case_board_items',
        'trace_case_connections',
        'list_case_board_snapshots',
        'take_case_board_snapshot',
      ]),
    );
    const enabled = (registered: Record<string, RegisteredTool>) =>
      Object.entries(registered)
        .filter(([, t]) => t.enabled)
        .map(([name]) => name)
        .sort();

    expect(enabled(build(['case_board']))).toEqual([...board.toolNames].sort());
    const casesOnly = enabled(build(['cases']));
    expect(casesOnly).toEqual([...cases.toolNames].sort());
    expect(casesOnly).not.toContain('get_case_board');
  });
});
