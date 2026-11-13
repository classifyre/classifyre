import { AiManagementMode } from '@prisma/client';
import {
  adaptBuiltinMcpTool,
  BUILTIN_MCP_PREFIX,
} from './builtin-mcp-tool-adapter';
import { MCP_BRIDGE_STATE_KEY } from './mcp-bridge-gate';
import type { ToolContext } from './tool.types';

function makeToolContext(state: Record<string, unknown> = {}): ToolContext {
  return {
    ctx: {
      run: { id: 'run-1' } as never,
      settings: {} as never,
      sourceId: null,
      sourceName: 'bridge',
      runnerId: null,
      manual: true,
      instruction: null,
      state,
    },
    audit: {} as never,
    log: {} as never,
  };
}

describe('adaptBuiltinMcpTool', () => {
  const call = jest.fn().mockResolvedValue({ ok: true });

  it('adapts read tools ungated with the builtin namespace', () => {
    const tool = adaptBuiltinMcpTool({
      remote: {
        name: 'search_sources',
        description: 'Search sources.',
        annotations: { readOnlyHint: true },
      },
      call,
    });
    expect(tool.name).toBe(`${BUILTIN_MCP_PREFIX}search_sources`);
    expect(tool.sideEffect).toBe('read');
    expect(typeof tool.resolveGate).toBe('undefined');
  });

  it('treats tools without readOnlyHint as mutating (fail closed)', () => {
    const tool = adaptBuiltinMcpTool({
      remote: { name: 'create_source' },
      call,
    });
    expect(tool.sideEffect).toBe('mutate');
    expect(typeof tool.resolveGate).toBe('function');
  });

  it('only lets a caller that set the bridge flag mutate', async () => {
    const tool = adaptBuiltinMcpTool({
      remote: { name: 'delete_source' },
      call,
    });

    const anonymous = await tool.resolveGate!({}, makeToolContext());
    expect(anonymous.mode).toBe(AiManagementMode.OBSERVE_ONLY);

    const refused = await tool.resolveGate!(
      {},
      makeToolContext({ [MCP_BRIDGE_STATE_KEY]: { allowMutations: false } }),
    );
    expect(refused.mode).toBe(AiManagementMode.OBSERVE_ONLY);

    const allowed = await tool.resolveGate!(
      {},
      makeToolContext({ [MCP_BRIDGE_STATE_KEY]: { allowMutations: true } }),
    );
    expect(allowed.mode).toBe(AiManagementMode.MANAGED);
  });
});
