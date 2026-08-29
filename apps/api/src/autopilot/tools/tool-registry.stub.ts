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
import { ScheduleToolset } from './schedule/schedule.toolset';
import { HypothesesToolset } from './hypotheses/hypotheses.toolset';
import { SupervisorToolset } from './supervisor/supervisor.toolset';
import { HygieneToolset } from './hygiene/hygiene.toolset';

/**
 * A registry built from every toolset with empty dependency stubs.
 *
 * `list()` never touches a dependency — it returns tool definitions, not
 * results — so the whole catalog can be inspected without a database, a model
 * or a Nest container. Shared between the registry spec and the capability
 * spec because the constructor argument list is long enough that keeping two
 * copies of it in sync is a chore nobody wins at.
 */
export function buildStubRegistry(): ToolRegistry {
  return new ToolRegistry(
    new ObserveToolset({} as never, {} as never),
    new InvestigationToolset({} as never),
    new KnowledgeToolset({} as never, {} as never),
    new ConfigToolset(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ),
    new DetectorToolset(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ),
    new FingerprintsToolset(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ),
    new AlertToolset({} as never, {} as never, {} as never),
    new SemanticToolset({} as never),
    new GlossaryToolset({} as never),
    new CaseLeadsToolset({} as never, {} as never, {} as never),
    new ScheduleToolset({} as never, {} as never, {} as never, {} as never),
    new HypothesesToolset({} as never, {} as never),
    new SupervisorToolset(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ),
    new HygieneToolset({} as never, {} as never, {} as never, {} as never),
  );
}
