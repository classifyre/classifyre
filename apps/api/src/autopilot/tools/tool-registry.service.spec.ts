import { buildStubRegistry } from './tool-registry.stub';
import {
  DEFAULT_ENABLED_GROUP_IDS,
  SWITCHABLE_GROUP_IDS,
  grantedToolNames,
} from '../supervisor/capabilities';
import {
  INQUIRY_MISSION,
  CASE_MISSION,
  CONFIG_MISSION,
  DETECTOR_AUTHOR_MISSION,
  ESCALATION_MISSION,
  DREAM_MISSION,
  SUPERVISOR_MISSION,
} from '../harness/missions';

describe('ToolRegistry', () => {
  // list() does not touch deps; safe to pass empty stubs.
  const registry = buildStubRegistry();

  it('registers observe, investigation, knowledge and config tools', () => {
    expect(registry.get('findings.search')).toBeDefined();
    expect(registry.get('inquiries.create')).toBeDefined();
    expect(registry.get('memory.write')).toBeDefined();
    expect(registry.get('system_brief.get')).toBeDefined();
    expect(registry.get('system_brief.update')).toBeDefined();
    expect(registry.get('config.tune_source')).toBeDefined();
    expect(registry.get('sources.get_config')).toBeDefined();
    expect(registry.get('detector.create')).toBeDefined();
    expect(registry.get('detectors.list')).toBeDefined();
    expect(registry.get('detectors.precision')).toBeDefined();
    expect(registry.get('fingerprints.similar_assets')).toBeDefined();
    expect(registry.get('cases.from_cluster')).toBeDefined();
    expect(registry.get('fingerprints.tune_config')).toBeDefined();
    expect(registry.get('operator.notify')).toBeDefined();
    expect(registry.get('alerts.recent')).toBeDefined();
    expect(registry.get('hypotheses.open')).toBeDefined();
    expect(registry.get('hypotheses.link_probe')).toBeDefined();
  });

  it('registers well-named mutating tools with fail-closed gates and domains', () => {
    for (const tool of registry.list()) {
      expect(tool.name).toMatch(/^[a-z_]+\.[a-z_]+$/);
      if (tool.sideEffect === 'mutate') {
        expect(typeof tool.resolveGate).toBe('function');
        expect(tool.domain).toBeDefined();
      }
    }
  });

  const MISSIONS = [
    INQUIRY_MISSION,
    CASE_MISSION,
    CONFIG_MISSION,
    DETECTOR_AUTHOR_MISSION,
    ESCALATION_MISSION,
    DREAM_MISSION,
    SUPERVISOR_MISSION,
  ];

  it('every tool referenced by a mission exists in the registry', () => {
    for (const mission of MISSIONS) {
      for (const name of mission.allowedTools) {
        expect(registry.get(name)).toBeDefined();
      }
    }
  });

  /**
   * The other direction, which is the one that actually goes wrong.
   *
   * A toolset can grow a tool, be merged, pass every test, and the tool still
   * be unreachable by anything — which is what happened to the five
   * duplicate-review tools added with the review queue. Nothing failed, nothing
   * warned, and the harness could not see the feature at all.
   *
   * Reachability used to mean exactly "named in some mission's allowedTools",
   * because that was the only route a tool had. The supervisor added a second:
   * it holds a small resident catalog and reaches everything else through
   * `tools.search`, with the capability menu deciding what that "everything
   * else" is. So a tool is now reachable if a mission names it OR the
   * supervisor's capability map claims it — and a tool that neither route
   * covers is still an oversight, which is what this asserts.
   *
   * There is no allowlist here on purpose. A tool nothing may call is either an
   * oversight or dead code, and both should be fixed rather than recorded as an
   * exception.
   */
  it('every registered tool is reachable by a mission or the supervisor', () => {
    const named = new Set(MISSIONS.flatMap((m) => m.allowedTools));
    const grantable = new Set(
      grantedToolNames(registry.list(), [
        ...DEFAULT_ENABLED_GROUP_IDS,
        // Ask about every group, including the ones that ship off: this test is
        // about whether a route exists at all, not about the shipped defaults.
        ...SWITCHABLE_GROUP_IDS,
      ]),
    );
    const orphaned = registry
      .list()
      .map((t) => t.name)
      .filter((name) => !named.has(name) && !grantable.has(name))
      .sort();
    expect(orphaned).toEqual([]);
  });

  it('renders a catalog for an allowed subset', () => {
    const catalog = registry.catalog(['findings.search', 'memory.write']);
    expect(catalog).toContain('findings.search');
    expect(catalog).toContain('[mutate]');
    expect(catalog).toContain('[read]');
  });

  it('isolates runtime tools by the current namespace schema', () => {
    let schema = 'ns_alpha';
    (registry as any).cls = { get: () => schema };
    registry.register({
      name: 'mcp.remote.lookup',
      description: 'test',
      inputSchema: { type: 'object' },
      sideEffect: 'read',
      handler: () => Promise.resolve({}),
    });

    expect(registry.get('mcp.remote.lookup')).toBeDefined();
    schema = 'ns_beta';
    expect(registry.get('mcp.remote.lookup')).toBeUndefined();
    schema = 'ns_alpha';
    registry.clearScope(schema);
    expect(registry.get('mcp.remote.lookup')).toBeUndefined();
    (registry as any).cls = undefined;
  });
});
