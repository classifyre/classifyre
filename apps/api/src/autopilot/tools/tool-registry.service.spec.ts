import { ToolRegistry } from './tool-registry.service';
import { ObserveToolset } from './observe/observe.toolset';
import { InvestigationToolset } from './investigation/investigation.toolset';
import { KnowledgeToolset } from './knowledge/knowledge.toolset';
import { ConfigToolset } from './config/config.toolset';
import { DetectorToolset } from './detector/detector.toolset';
import { FingerprintsToolset } from './fingerprints/fingerprints.toolset';
import { AlertToolset } from './alert/alert.toolset';
import { SemanticToolset } from './semantic/semantic.toolset';
import { GlossaryToolset } from './glossary/glossary.toolset';
import { CaseLeadsToolset } from './leads/case-leads.toolset';
import {
  INQUIRY_MISSION,
  CASE_MISSION,
  CONFIG_MISSION,
  DETECTOR_AUTHOR_MISSION,
  ESCALATION_MISSION,
  DREAM_MISSION,
} from '../harness/missions';
import type { NotificationsService } from '../../notifications.service';
import type { AgentSearchService } from '../search/agent-search.service';
import type { AgentMemoryService } from '../memory/agent-memory.service';
import type { DecisionApplierService } from '../decision-applier.service';
import type { SystemBriefService } from '../harness/system-brief.service';
import type { PrismaService } from '../../prisma.service';
import type { ValidationService } from '../../validation.service';
import type { MaskedConfigCryptoService } from '../../masked-config-crypto.service';
import type { CustomDetectorsService } from '../../custom-detectors.service';
import type { CustomDetectorTestsService } from '../../custom-detector-tests.service';
import type { CliRunnerService } from '../../cli-runner/cli-runner.service';
import type { CorrelationService } from '../../correlation/correlation.service';
import type { DuplicatesFinderAgentService } from '../../correlation/duplicates-finder-agent.service';
import type { AgentSemanticService } from '../search/agent-semantic.service';
import type { GlossaryService } from '../../glossary/glossary.service';
import type { CaseLeadsService } from '../../case-leads.service';
import type { CaseEventsService } from '../../case-events.service';
import type { AutoScheduleService } from '../../scheduler/auto-schedule.service';
import type { DetectionImpactService } from '../detection-impact.service';
import type { DetectionPostureService } from '../detection-posture.service';
import { ScheduleToolset } from './schedule/schedule.toolset';
import { HypothesesToolset } from './hypotheses/hypotheses.toolset';
import type { CorrelationReviewService } from '../../correlation/review/correlation-review.service';

describe('ToolRegistry', () => {
  // list() does not touch deps; safe to pass empty stubs.
  const registry = new ToolRegistry(
    new ObserveToolset({} as AgentSearchService, {} as AgentMemoryService),
    new InvestigationToolset({} as DecisionApplierService),
    new KnowledgeToolset({} as AgentMemoryService, {} as SystemBriefService),
    new ConfigToolset(
      {} as PrismaService,
      {} as ValidationService,
      {} as MaskedConfigCryptoService,
      {} as DecisionApplierService,
      {} as CliRunnerService,
      {} as NotificationsService,
      {} as AutoScheduleService,
      {} as CustomDetectorsService,
      {} as DetectionImpactService,
      {} as DetectionPostureService,
    ),
    new DetectorToolset(
      {} as CustomDetectorsService,
      {} as CustomDetectorTestsService,
      {} as DecisionApplierService,
      {} as AgentSearchService,
      {} as never,
      {} as never,
    ),
    new FingerprintsToolset(
      {} as PrismaService,
      {} as CorrelationService,
      {} as DuplicatesFinderAgentService,
      {} as DecisionApplierService,
      {} as CorrelationReviewService,
    ),
    new AlertToolset({} as PrismaService, {} as NotificationsService),
    new SemanticToolset({} as AgentSemanticService),
    new GlossaryToolset({} as GlossaryService),
    new CaseLeadsToolset(
      {} as CaseLeadsService,
      {} as CaseEventsService,
      {} as DecisionApplierService,
    ),
    new ScheduleToolset(
      {} as PrismaService,
      {} as AutoScheduleService,
      {} as DecisionApplierService,
      {} as NotificationsService,
    ),
    new HypothesesToolset(
      {} as AgentSearchService,
      {} as DecisionApplierService,
    ),
  );

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
   * A tool reaches an agent only by being named in a mission's `allowedTools`;
   * registering it does nothing on its own. So a toolset can grow a tool, be
   * merged, pass every test, and the tool is simply unreachable — which is
   * what happened to the five duplicate-review tools added with the review
   * queue. Nothing failed, nothing warned, and the harness could not see the
   * feature at all.
   *
   * There is no allowlist here on purpose. A tool no mission may call is
   * either an oversight or dead code, and both should be fixed rather than
   * recorded as an exception.
   */
  it('every registered tool is reachable by at least one mission', () => {
    const reachable = new Set(MISSIONS.flatMap((m) => m.allowedTools));
    const orphaned = registry
      .list()
      .map((t) => t.name)
      .filter((name) => !reachable.has(name))
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
