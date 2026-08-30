import { buildStubRegistry } from '../tools/tool-registry.stub';
import { SUPERVISOR_MISSION } from './missions';

/**
 * The supervisor's prompt must not grow back into a catalog.
 *
 * Measured on a booted instance: the whole registry — 108 native tools plus the
 * 113 bridged built-in MCP tools — renders to 135,168 characters. The
 * supervisor's resident set is 11,232. Twelve times smaller, and less than half
 * of what the CASE mission carries (25,436), for an agent with authority over
 * strictly more than any of them.
 *
 * This spec sees only the native half (57,509 chars), because the bridge
 * registers on app init and a unit test has no app. The ratio it asserts is
 * therefore the conservative one; the real gap at runtime is wider.
 *
 * That gap is the design. A supervisor holding the whole registry would spend
 * more prompt listing its options than on its goals, its journal and the corpus
 * combined, and tool-selection accuracy is measurably worse with a large
 * catalog — which matters most for the one agent whose entire job is choosing
 * tools.
 *
 * The failure this guards is not a bad decision but a slow one: someone adds a
 * tool to SUPERVISOR_TOOLS because that was easier than searching for it, then
 * someone else does, and the cost creeps with nothing ever going wrong enough
 * to notice. The ceiling is deliberately loose — a ratchet, not a budget.
 */
describe('supervisor resident catalog', () => {
  const registry = buildStubRegistry();

  /** Loose: ~25% headroom over the measured 11,232. */
  const CEILING_CHARS = 14_000;

  it('stays far below the cost of the full registry', () => {
    const resident = registry.catalog(SUPERVISOR_MISSION.allowedTools).length;
    const everything = registry.catalog().length;

    expect(resident).toBeLessThan(CEILING_CHARS);
    // The point is the ratio, not the absolute number.
    expect(resident).toBeLessThan(everything / 3);
  });

  it('reaches the rest of the system through search, not disclosure', () => {
    expect(SUPERVISOR_MISSION.allowedTools).toContain('tools.search');
    expect(SUPERVISOR_MISSION.allowedTools).toContain('tools.list_namespaces');
    // Named because they are the two that make a wake a wake.
    expect(SUPERVISOR_MISSION.requiredBeforeFinish).toEqual([
      'journal.write',
      'supervisor.schedule_wake',
    ]);
  });

  it('does not hold the destructive tools resident', () => {
    // They are reachable when the capability is granted, but an agent should
    // have to go looking for them rather than being handed them every wake.
    for (const name of ['hygiene.purge_findings', 'hygiene.purge_assets']) {
      expect(SUPERVISOR_MISSION.allowedTools).not.toContain(name);
    }
  });
});
