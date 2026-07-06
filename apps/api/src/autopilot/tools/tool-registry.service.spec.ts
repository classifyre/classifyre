import { ToolRegistry } from './tool-registry.service';
import { ObserveToolset } from './observe/observe.toolset';
import { InvestigationToolset } from './investigation/investigation.toolset';
import { KnowledgeToolset } from './knowledge/knowledge.toolset';
import { ConfigToolset } from './config/config.toolset';
import { DetectorToolset } from './detector/detector.toolset';
import { FingerprintsToolset } from './fingerprints/fingerprints.toolset';
import { AlertToolset } from './alert/alert.toolset';
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
    ),
    new DetectorToolset(
      {} as CustomDetectorsService,
      {} as CustomDetectorTestsService,
      {} as DecisionApplierService,
      {} as AgentSearchService,
    ),
    new FingerprintsToolset(
      {} as PrismaService,
      {} as CorrelationService,
      {} as DuplicatesFinderAgentService,
      {} as DecisionApplierService,
    ),
    new AlertToolset({} as PrismaService, {} as NotificationsService),
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
  });

  it('every tool referenced by a mission exists in the registry', () => {
    for (const mission of [
      INQUIRY_MISSION,
      CASE_MISSION,
      CONFIG_MISSION,
      DETECTOR_AUTHOR_MISSION,
      ESCALATION_MISSION,
      DREAM_MISSION,
    ]) {
      for (const name of mission.allowedTools) {
        expect(registry.get(name)).toBeDefined();
      }
    }
  });

  it('renders a catalog for an allowed subset', () => {
    const catalog = registry.catalog(['findings.search', 'memory.write']);
    expect(catalog).toContain('findings.search');
    expect(catalog).toContain('[mutate]');
    expect(catalog).toContain('[read]');
  });
});
