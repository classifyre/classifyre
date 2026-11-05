import type { AccessPolicy } from '../identity/access-policy';
import type { Capability } from '../identity/capabilities';
import type { McpServerFactoryService } from '../mcp-server.factory';
import { AssistantMcpService } from './assistant-mcp.service';

describe('AssistantMcpService', () => {
  const held = new Set<Capability>(['case.view']);
  const policy: AccessPolicy = {
    check: (_actor, capability) => ({ allow: held.has(capability) }),
    capabilities: () => held,
  };
  let called: string[];

  function service() {
    const assistant = new AssistantMcpService(
      {} as McpServerFactoryService,
      policy,
    );
    called = [];
    Object.assign(assistant, {
      toolCache: [
        { name: 'get_case', readOnly: true },
        { name: 'close_case', readOnly: false },
      ].map((tool) => ({
        ...tool,
        description: '',
        inputSchema: {},
        destructive: false,
      })),
      clientPromise: Promise.resolve({
        callTool: ({ name }: { name: string }) => {
          called.push(name);
          return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] });
        },
      }),
    });
    return assistant;
  }

  it('runs a tool the person asking holds the capability for', async () => {
    await expect(
      service().callTool('get_case', { id: 'c1' }),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(called).toEqual(['get_case']);
  });

  it('refuses a tool the person asking may not use, without calling it (H-1)', async () => {
    const result = await service().callTool('close_case', { id: 'c1' });
    expect(result.ok).toBe(false);
    expect(String(result.result)).toMatch(/case\.\w+ capability/);
    expect(called).toEqual([]);
  });
});
