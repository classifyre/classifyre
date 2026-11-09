import { McpServerFactoryService } from '../mcp-server.factory';
import { CAPABILITY_IDS, type Capability } from './capabilities';
import { BUILT_IN_ROLES } from './roles';
import {
  MCP_TOOL_CAPABILITY_OVERRIDES,
  mcpToolCapability,
} from './mcp-tool-capabilities';

type RegisteredTools = Record<
  string,
  { enabled: boolean; annotations?: { readOnlyHint?: boolean } }
>;

/** A real server with stubbed dependencies, as in mcp-catalog.completeness.spec.ts. */
function buildServer(capabilities?: ReadonlySet<Capability>): RegisteredTools {
  const stubDeps = new Proxy(
    {},
    { get: () => new Proxy(() => undefined, { get: () => undefined }) },
  );
  const factory = Object.create(
    McpServerFactoryService.prototype,
  ) as McpServerFactoryService;
  Object.assign(factory as unknown as Record<string, unknown>, stubDeps);
  const server = factory.createServer({ capabilities });
  return (server as unknown as { _registeredTools: RegisteredTools })
    ._registeredTools;
}

describe('MCP tool capabilities', () => {
  const tools = buildServer();

  it('gives every tool an explicit readOnlyHint', () => {
    const missing = Object.entries(tools)
      .filter(([, tool]) => typeof tool.annotations?.readOnlyHint !== 'boolean')
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('resolves every tool to a catalogued capability', () => {
    const unresolved = Object.entries(tools)
      .filter(([name, tool]) => {
        const capability = mcpToolCapability(
          name,
          tool.annotations?.readOnlyHint,
        );
        return !capability || !CAPABILITY_IDS.includes(capability);
      })
      .map(([name]) => name);
    expect(unresolved).toEqual([]);
  });

  it('only overrides tools that exist', () => {
    const unknown = Object.keys(MCP_TOOL_CAPABILITY_OVERRIDES).filter(
      (name) => !(name in tools),
    );
    expect(unknown).toEqual([]);
  });

  it('keeps every tool enabled when no capabilities are passed', () => {
    expect(Object.values(tools).every((tool) => tool.enabled)).toBe(true);
  });

  it('leaves a viewer only read-only tools', () => {
    const viewer = BUILT_IN_ROLES.find((role) => role.key === 'viewer');
    const restricted = buildServer(new Set(viewer?.capabilities));
    const enabledWrites = Object.entries(restricted)
      .filter(
        ([, tool]) => tool.enabled && tool.annotations?.readOnlyHint === false,
      )
      .map(([name]) => name);
    expect(enabledWrites).toEqual([]);
    expect(restricted.search_findings?.enabled).toBe(true);
    expect(restricted.update_source?.enabled).toBe(false);
  });
});
