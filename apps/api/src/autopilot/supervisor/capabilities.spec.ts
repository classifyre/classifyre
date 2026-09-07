import { buildStubRegistry } from '../tools/tool-registry.stub';
import {
  CAPABILITY_GROUPS,
  DEFAULT_ENABLED_GROUP_IDS,
  SUPERVISOR_CORE_TOOLS,
  groupForTool,
  grantedToolNames,
} from './capabilities';

/**
 * The capability menu is the only real control over an agent that has authority
 * over everything, so the mapping behind it has to be total.
 *
 * The direction that matters is fail-closed: a mutating tool that no group
 * claims must be UNREACHABLE, not free. Adding a tool and forgetting to
 * classify it is a normal thing to do; having that tool silently become
 * available to a self-directed agent with a purge budget is not a normal
 * consequence. This mirrors mcp-catalog.completeness.spec.ts, which exists so
 * no MCP tool can escape token scoping the same way.
 */
describe('supervisor capability groups', () => {
  const registry = buildStubRegistry();
  const tools = registry.list();

  it('classifies every mutating tool in the registry', () => {
    const unclassified = tools
      .filter((t) => t.sideEffect === 'mutate')
      .filter((t) => !SUPERVISOR_CORE_TOOLS.includes(t.name))
      .filter((t) => groupForTool(t.name) === null)
      .map((t) => t.name)
      .sort();

    expect(unclassified).toEqual([]);
  });

  it('withholds an unclassified mutating tool rather than granting it', () => {
    const granted = grantedToolNames(
      [
        {
          name: 'rogue.delete_everything',
          description: 'x',
          inputSchema: {},
          sideEffect: 'mutate',
          handler: () => Promise.resolve({}),
        },
        {
          name: 'rogue.look',
          description: 'x',
          inputSchema: {},
          sideEffect: 'read',
          handler: () => Promise.resolve({}),
        },
      ],
      DEFAULT_ENABLED_GROUP_IDS,
    );

    expect(granted).not.toContain('rogue.delete_everything');
    // Reads fall through to the always-on corpus view: an agent that cannot
    // look at anything cannot decide anything, and the honest way to stop it is
    // the enable switch.
    expect(granted).toContain('rogue.look');
  });

  it('ships corpus hygiene switched off', () => {
    const hygiene = CAPABILITY_GROUPS.find((g) => g.id === 'corpus_hygiene')!;
    expect(hygiene.defaultOn).toBe(false);
    expect(hygiene.destructive).toBe(true);

    const granted = grantedToolNames(tools, DEFAULT_ENABLED_GROUP_IDS);
    expect(granted).not.toContain('hygiene.purge_findings');
    expect(granted).not.toContain('hygiene.purge_assets');
    // The preview is a read and stays available: knowing what a purge would
    // cost is exactly the thing that should never require a permission.
    expect(granted).toContain('hygiene.preview_purge');
  });

  it('grants the destructive tools once the group is switched on', () => {
    const granted = grantedToolNames(tools, [
      ...DEFAULT_ENABLED_GROUP_IDS,
      'corpus_hygiene',
    ]);
    expect(granted).toContain('hygiene.purge_findings');
    expect(granted).toContain('hygiene.purge_assets');
  });

  it('keeps the supervisor able to journal and reschedule whatever is off', () => {
    // Switching everything off must leave it able to record why it could do
    // nothing and when to try again. An agent that cannot close a wake is not a
    // restricted agent, it is a stopped one.
    const granted = grantedToolNames(tools, []);
    expect(granted).toContain('journal.write');
    expect(granted).toContain('supervisor.schedule_wake');
    expect(granted).toContain('goals.list');
    expect(granted).not.toContain('agents.run');
    expect(granted).not.toContain('config.tune_source');
  });

  it('never routes a hygiene tool into a broader group', () => {
    // Ordering in CAPABILITY_GROUPS is load-bearing: a prefix elsewhere must
    // not sweep up the destructive namespace.
    expect(groupForTool('hygiene.purge_findings')?.id).toBe('corpus_hygiene');
    expect(groupForTool('mcp.builtin.purge_source_findings')?.id).toBe(
      'corpus_hygiene',
    );
    expect(groupForTool('mcp.builtin.delete_source')?.id).toBe(
      'corpus_hygiene',
    );
  });

  it('routes an external MCP server tool to the external group', () => {
    expect(groupForTool('mcp.acme.do_thing')?.id).toBe('external_mcp');
  });
});
