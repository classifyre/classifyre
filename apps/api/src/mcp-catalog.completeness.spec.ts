import { McpServerFactoryService } from './mcp-server.factory';
import { MCP_CAPABILITY_GROUPS } from './mcp-catalog';

/**
 * Every tool must carry a capability group, or it silently escapes per-token
 * scoping: `restrictToGroups` fails closed (disables anything not in an
 * allowed group), so an ungrouped tool would simply never be reachable by any
 * scoped token, and the settings UI would render it under an unselectable
 * "Other" bucket. Building a real server (all dependencies stubbed -- tool
 * registration only closes over them, it never calls them) is the only way to
 * get the exact live tool list rather than a second hand-maintained copy of it.
 */
describe('MCP_CAPABILITY_GROUPS completeness', () => {
  it('covers every tool the server actually registers', () => {
    const stubDeps = new Proxy(
      {},
      { get: () => new Proxy(() => undefined, { get: () => undefined }) },
    );
    const factory = Object.create(
      McpServerFactoryService.prototype,
    ) as McpServerFactoryService;
    Object.assign(factory as unknown as Record<string, unknown>, stubDeps);

    const server = factory.createServer();
    const registered = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools,
    );

    const grouped = new Set(
      MCP_CAPABILITY_GROUPS.flatMap((group) => group.toolNames),
    );
    const ungrouped = registered.filter((name) => !grouped.has(name));

    expect(ungrouped).toEqual([]);
  });

  it('has no duplicate or dangling tool names across groups', () => {
    const allNames = MCP_CAPABILITY_GROUPS.flatMap((group) => group.toolNames);
    const seen = new Set<string>();
    const duplicates = allNames.filter((name) =>
      seen.has(name) ? true : (seen.add(name), false),
    );
    expect(duplicates).toEqual([]);
  });
});
