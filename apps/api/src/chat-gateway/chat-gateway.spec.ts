import { AiManagementMode } from '@prisma/client';
import {
  adaptBuiltinMcpTool,
  BUILTIN_MCP_PREFIX,
  CHAT_BOT_STATE_KEY,
} from './builtin-mcp-tool-adapter';
import { allowedBuiltinToolNames } from './chat-permissions';
import { runChatTurn } from './chat-agent-loop';
import type { AgentLoopDeps } from '../autopilot/harness/agent-loop';
import type { AgentContext } from '../autopilot/autopilot.types';
import type { Tool, ToolContext } from '../autopilot/tools/tool.types';

function makeToolContext(botState?: {
  id: string;
  allowMutations: boolean;
  agentKinds: string[];
}): ToolContext {
  return {
    ctx: {
      run: { id: 'run-1' } as never,
      settings: {} as never,
      sourceId: null,
      sourceName: 'chat',
      runnerId: null,
      manual: true,
      instruction: null,
      state: botState ? { [CHAT_BOT_STATE_KEY]: botState } : {},
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

  it('gates mutations on the invoking bot allowMutations flag', async () => {
    const tool = adaptBuiltinMcpTool({
      remote: { name: 'delete_source' },
      call,
    });
    const allowed = await tool.resolveGate!(
      {},
      makeToolContext({ id: 'b1', allowMutations: true, agentKinds: [] }),
    );
    expect(allowed.mode).toBe(AiManagementMode.MANAGED);

    const readOnlyBot = await tool.resolveGate!(
      {},
      makeToolContext({ id: 'b1', allowMutations: false, agentKinds: [] }),
    );
    expect(readOnlyBot.mode).toBe(AiManagementMode.OBSERVE_ONLY);

    // No chat-bot state (e.g. an autopilot mission) → fail closed.
    const noBot = await tool.resolveGate!({}, makeToolContext());
    expect(noBot.mode).toBe(AiManagementMode.OBSERVE_ONLY);
  });
});

describe('allowedBuiltinToolNames', () => {
  const bridged = [
    `${BUILTIN_MCP_PREFIX}search_sources`,
    `${BUILTIN_MCP_PREFIX}get_source`,
    `${BUILTIN_MCP_PREFIX}search_findings`,
    `${BUILTIN_MCP_PREFIX}unlisted_tool`,
  ];

  it('returns every bridged tool when no groups are selected', () => {
    expect(allowedBuiltinToolNames([], bridged)).toEqual(bridged);
  });

  it('maps selected groups through the catalog and intersects with bridged', () => {
    const allowed = allowedBuiltinToolNames(['sources'], bridged);
    expect(allowed).toContain(`${BUILTIN_MCP_PREFIX}search_sources`);
    expect(allowed).toContain(`${BUILTIN_MCP_PREFIX}get_source`);
    expect(allowed).not.toContain(`${BUILTIN_MCP_PREFIX}search_findings`);
    expect(allowed).not.toContain(`${BUILTIN_MCP_PREFIX}unlisted_tool`);
  });

  it('ignores unknown group ids', () => {
    expect(allowedBuiltinToolNames(['nope'], bridged)).toEqual([]);
  });
});

describe('runChatTurn', () => {
  function makeCtx(): AgentContext {
    return {
      run: { id: 'run-1' } as never,
      settings: {} as never,
      sourceId: null,
      sourceName: 'chat',
      runnerId: null,
      manual: true,
      instruction: 'hello',
      state: {},
    };
  }

  function makeDeps(turns: unknown[]): {
    deps: AgentLoopDeps;
    dispatch: jest.Mock;
    saveUsage: jest.Mock;
  } {
    const completeJson = jest.fn();
    for (const turn of turns) {
      completeJson.mockResolvedValueOnce({
        content: turn,
        raw: JSON.stringify(turn),
        usage: { inputTokens: 10, outputTokens: 5 },
      });
    }
    const dispatch = jest
      .fn()
      .mockResolvedValue({ tool: 't', outcome: 'APPLIED', result: { ok: 1 } });
    const saveUsage = jest.fn().mockResolvedValue(undefined);
    const tool: Tool = {
      name: 'mcp.builtin.search_sources',
      description: 'search',
      inputSchema: { type: 'object' },
      sideEffect: 'read',
      handler: () => Promise.resolve({}),
    };
    const deps = {
      ai: { completeJson } as never,
      registry: {
        get: (name: string) => (name === tool.name ? tool : undefined),
        catalog: () => '### mcp.builtin.search_sources [read]',
      } as never,
      dispatcher: { dispatch } as never,
      audit: { saveUsage } as never,
      log: { business: jest.fn().mockResolvedValue(undefined) } as never,
    } as AgentLoopDeps;
    return { deps, dispatch, saveUsage };
  }

  it('runs tools then returns the finish reply with accumulated usage', async () => {
    const { deps, dispatch, saveUsage } = makeDeps([
      {
        thought: 'look up sources',
        toolCalls: [
          {
            tool: 'mcp.builtin.search_sources',
            input: {},
            rationale: 'check state',
          },
        ],
      },
      { thought: 'done', finish: { reply: '3 sources, all healthy.' } },
    ]);

    const result = await runChatTurn(
      makeCtx(),
      {
        userMessage: 'how are my sources?',
        history: [],
        sessionSummary: '',
        allowedTools: ['mcp.builtin.search_sources'],
        platform: 'Telegram',
      },
      deps,
    );

    expect(result.reply).toBe('3 sources, all healthy.');
    expect(result.toolCalls).toEqual([
      {
        tool: 'mcp.builtin.search_sources',
        outcome: 'APPLIED',
        rationale: 'check state',
      },
    ]);
    expect(result.inputTokens).toBe(20);
    expect(result.outputTokens).toBe(10);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(saveUsage).toHaveBeenLastCalledWith('run-1', 20, 10);
  });

  it('never leaks the internal thought — nudges the model to a real finish', async () => {
    const { deps, dispatch } = makeDeps([
      // Muses without acting: no toolCalls, no finish — must not become the reply.
      { thought: 'The operator wants a source. I will ask for the database.' },
      {
        thought: 'ok',
        finish: { reply: 'Which database should I connect to?' },
      },
    ]);

    const result = await runChatTurn(
      makeCtx(),
      {
        userMessage: 'create a postgres source',
        history: [],
        sessionSummary: '',
        allowedTools: ['mcp.builtin.search_sources'],
        platform: 'Slack',
      },
      deps,
    );

    expect(result.reply).toBe('Which database should I connect to?');
    expect(result.iterations).toBe(2);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses tools outside the allowlist without dispatching', async () => {
    const { deps, dispatch } = makeDeps([
      {
        thought: 'try something forbidden',
        toolCalls: [
          { tool: 'mcp.builtin.delete_source', input: {}, rationale: 'nope' },
        ],
      },
      { thought: 'ok', finish: { reply: 'That tool is not available.' } },
    ]);

    const result = await runChatTurn(
      makeCtx(),
      {
        userMessage: 'delete everything',
        history: [],
        sessionSummary: '',
        allowedTools: ['mcp.builtin.search_sources'],
        platform: 'Telegram',
      },
      deps,
    );

    expect(dispatch).not.toHaveBeenCalled();
    expect(result.reply).toBe('That tool is not available.');
  });
});
