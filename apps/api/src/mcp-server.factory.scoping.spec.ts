import { McpServerFactoryService } from './mcp-server.factory';
import { MCP_CAPABILITY_GROUPS } from './mcp-catalog';

describe('McpServerFactoryService token scoping', () => {
  function stubServer(toolNames: string[]) {
    const disable = new Map<string, jest.Mock>();
    const _registeredTools = Object.fromEntries(
      toolNames.map((name) => {
        const fn = jest.fn();
        disable.set(name, fn);
        return [name, { disable: fn }];
      }),
    );
    return { server: { _registeredTools }, disable };
  }

  function factory() {
    return Object.create(
      McpServerFactoryService.prototype,
    ) as McpServerFactoryService & Record<string, unknown>;
  }

  it('disables every tool outside the allowed groups', () => {
    const sourcesTool = MCP_CAPABILITY_GROUPS.find((g) => g.id === 'sources')!
      .toolNames[0];
    const detectorTool = MCP_CAPABILITY_GROUPS.find(
      (g) => g.id === 'custom_detectors',
    )!.toolNames[0];
    const { server, disable } = stubServer([sourcesTool, detectorTool]);

    (factory() as any).restrictToGroups(server, ['sources']);

    expect(disable.get(sourcesTool)).not.toHaveBeenCalled();
    expect(disable.get(detectorTool)).toHaveBeenCalledTimes(1);
  });

  it('leaves every tool enabled when the allowlist covers every group', () => {
    const allToolNames = MCP_CAPABILITY_GROUPS.flatMap((g) => g.toolNames);
    const { server, disable } = stubServer(allToolNames);
    const allGroupIds = MCP_CAPABILITY_GROUPS.map((g) => g.id);

    (factory() as any).restrictToGroups(server, allGroupIds);

    for (const fn of disable.values()) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('fails closed: disables a tool that belongs to no group', () => {
    const { server, disable } = stubServer(['ungrouped_tool']);

    (factory() as any).restrictToGroups(server, ['sources']);

    expect(disable.get('ungrouped_tool')).toHaveBeenCalledTimes(1);
  });
});
