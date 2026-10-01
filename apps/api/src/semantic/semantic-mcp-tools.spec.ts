import type { z } from 'zod';
import {
  SEMANTIC_MCP_TOOL_NAMES,
  registerSemanticMcpTools,
  type SemanticMcpDeps,
} from './semantic-mcp-tools';

type Registered = {
  schema: z.ZodTypeAny;
  readOnly: boolean;
  run: (args: unknown) => Promise<unknown>;
};

function register(deps: Partial<Record<keyof SemanticMcpDeps, unknown>>) {
  const tools = new Map<string, Registered>();
  const assertNotDemoMode = jest.fn((): void => {
    throw new Error('demo mode');
  });
  registerSemanticMcpTools(
    {
      registerTool: (name, config, cb) => {
        tools.set(name, {
          schema: config.inputSchema!,
          readOnly: config.annotations?.readOnlyHint === true,
          run: cb as unknown as (args: unknown) => Promise<unknown>,
        });
      },
    },
    deps as SemanticMcpDeps,
    { json: (payload) => payload, assertNotDemoMode },
  );
  return { tools, assertNotDemoMode };
}

describe('semantic MCP tools', () => {
  it('registers exactly the catalogued names', () => {
    const { tools } = register({});
    expect([...tools.keys()].sort()).toEqual(
      [...SEMANTIC_MCP_TOOL_NAMES].sort(),
    );
  });

  it('refuses unknown keys instead of stripping them (rule 4)', () => {
    const { tools } = register({});
    for (const [name, tool] of tools) {
      expect({
        name,
        ok: tool.schema.safeParse({ notAKey: true }).success,
      }).toEqual({ name, ok: false });
    }
    const spec = tools.get('preview_binding')!.schema;
    expect(
      spec.safeParse({ spec: { mode: 'OUTPUT', regex: '.*' } }).success,
    ).toBe(false);
  });

  it('every write refuses in demo mode before touching anything', async () => {
    const touched = jest.fn();
    const proxy = new Proxy(
      {},
      { get: () => new Proxy(touched, { get: () => touched }) },
    );
    const { tools, assertNotDemoMode } = register({
      glossary: proxy,
      relations: proxy,
      transfer: proxy,
      bindings: proxy,
      vocabulary: proxy,
      meaning: proxy,
      packs: proxy,
      findInText: proxy,
      proposals: proxy,
      suggestions: proxy,
      map: proxy,
    });
    const writes = [...tools].filter(([, tool]) => !tool.readOnly);
    expect(writes.length).toBeGreaterThan(10);
    for (const [, tool] of writes) {
      await expect(tool.run({})).rejects.toThrow('demo mode');
    }
    expect(assertNotDemoMode).toHaveBeenCalledTimes(writes.length);
    expect(touched).not.toHaveBeenCalled();
  });

  it('imports and pack installs are dry runs unless asked otherwise', async () => {
    const importFile = jest.fn().mockResolvedValue({});
    const install = jest.fn().mockResolvedValue({});
    const { tools, assertNotDemoMode } = register({
      transfer: { importFile },
      packs: { install },
    });
    assertNotDemoMode.mockImplementation(() => undefined);
    const unlocked = tools;
    await unlocked.get('import_glossary')!.run({ format: 'csv', content: 'x' });
    await unlocked.get('install_glossary_pack')!.run({ key: 'gdpr' });
    expect(importFile).toHaveBeenCalledWith(
      'csv',
      'x',
      expect.objectContaining({ dryRun: true }),
    );
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
  });
});
