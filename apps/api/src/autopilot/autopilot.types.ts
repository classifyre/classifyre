import type {
  AgentKind,
  AgentRun,
  DetectorType,
  InstanceSettings,
} from '@prisma/client';

/** Payload of an AUTOPILOT_QUEUE job. */
export interface AutopilotJob {
  /** Absent for manual all-sources runs. */
  sourceId?: string;
  runnerId?: string;
  /** Manually triggered cycle ("steer" run): scans existing data, not a scan delta. */
  manual?: boolean;
  /** Operator instruction embedded into the agent prompts (manual runs). */
  instruction?: string;
  /** Stable cycle identity for resuming the right run on redelivery. */
  cycleKey?: string;
  /** Scheduled "dreaming" cycle: memory consolidation, no inquiry/case work. */
  dream?: boolean;
  /**
   * Rerun of one specific run: execute only this agent and treat the job as
   * explicit operator intent (instance enable-flags are bypassed).
   */
  agentKind?: 'INQUIRY' | 'CASE' | 'DREAM';
}

/** Aggregated view of one group of new findings (token-bounded). */
export interface FindingGroupSummary {
  detectorType: string;
  customDetectorKey: string | null;
  findingType: string;
  severity: string;
  count: number;
  sampleValues: string[];
  sampleFindingIds: string[];
  sampleAssetIds: string[];
}

/** Compact inquiry summary fed to the model. */
export interface InquirySummary {
  id: string;
  title: string;
  description: string | null;
  aiMode: string;
  matchAllSources: boolean;
  sourceIds: string[];
  detectorTypes: string[];
  customDetectorKeys: string[];
  findingTypes: string[];
  findingTypeRegex: string[];
  findingValueRegex: string[];
  matchCount: number;
  newMatchCount: number;
  linkedCaseIds: string[];
}

/** Compact case summary fed to the model. */
export interface CaseSummary {
  id: string;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  aiMode: string;
  linkedInquiryIds: string[];
  hypothesisTitles: string[];
  evidenceCount: number;
  findingCount: number;
}

export interface RecalledMemory {
  kind: string;
  key: string;
  content: string;
  weight: number;
}

/** Shared, mutable state passed through pipeline steps and persisted in stepState. */
export interface AgentContext {
  run: AgentRun;
  settings: InstanceSettings;
  sourceId: string | null;
  sourceName: string;
  runnerId: string | null;
  /** Manual "steer" run: review ALL existing open data, not just the scan delta. */
  manual: boolean;
  /** Operator instruction for this cycle (manual runs only). */
  instruction: string | null;
  /** Validated output of each completed step, keyed by step name. */
  state: Record<string, unknown>;
}

export interface AgentStep {
  name: string;
  /** Returns the JSON-serializable output stored in stepState[name]. */
  execute(ctx: AgentContext): Promise<unknown>;
}

// ── LLM decision shapes (mirror schemas/*.schema.ts) ─────────────────────────

export interface InquiryMatcherProposal {
  title?: string;
  description?: string;
  matchAllSources?: boolean;
  sourceIds?: string[];
  detectorTypes?: DetectorType[];
  customDetectorKeys?: string[];
  findingTypes?: string[];
  findingTypeRegex?: string[];
  findingValueRegex?: string[];
}

export interface InquiryDecision {
  action:
    | 'CREATE_INQUIRY'
    | 'UPDATE_INQUIRY'
    | 'ENRICH_INQUIRY_MATCHERS'
    | 'SIGNAL_CASE_READY'
    | 'NO_ACTION';
  rationale: string;
  inquiryId?: string;
  inquiry?: InquiryMatcherProposal;
  duplicateOfInquiryId?: string;
}

export interface MemoryWrite {
  kind: 'GLOSSARY' | 'DECISION_PRECEDENT' | 'TOPIC_INQUIRY_MAP';
  key: string;
  content: string;
  tags?: string[];
}

export interface InquiryDecisionOutput {
  decisions: InquiryDecision[];
  memoryWrites: MemoryWrite[];
}

export type CaseOperation = {
  op:
    | 'ADD_HYPOTHESIS'
    | 'UPDATE_HYPOTHESIS'
    | 'ADD_EVIDENCE'
    | 'ATTACH_FINDINGS'
    | 'ADD_NOTE'
    | 'ADD_THREAD_ENTRY'
    | 'CREATE_EDGE'
    | 'CHANGE_STATUS'
    | 'LINK_INQUIRY';
  rationale: string;
  /** ADD_HYPOTHESIS / UPDATE_HYPOTHESIS */
  threadId?: string;
  title?: string;
  statement?: string;
  hypothesisStatus?: 'PROPOSED' | 'SUPPORTED' | 'REFUTED' | 'INCONCLUSIVE';
  confidence?: number;
  /** ADD_EVIDENCE */
  assetId?: string;
  note?: string;
  /** ATTACH_FINDINGS */
  findingIds?: string[];
  /** ADD_NOTE / ADD_THREAD_ENTRY */
  body?: string;
  /** CREATE_EDGE */
  fromType?: string;
  fromId?: string;
  toType?: string;
  toId?: string;
  relationType?: string;
  /** CHANGE_STATUS */
  caseStatus?: 'OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'ARCHIVED';
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  /** LINK_INQUIRY */
  inquiryIds?: string[];
};

export interface CaseDecision {
  action: 'CREATE_CASE' | 'UPDATE_CASE' | 'NO_ACTION';
  rationale: string;
  caseId?: string;
  title?: string;
  description?: string;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  operations?: CaseOperation[];
}

export interface CaseDecisionOutput {
  decisions: CaseDecision[];
  memoryWrites: MemoryWrite[];
}

export interface AgentRunResult {
  agentKind: AgentKind;
  runId: string;
  status: string;
}
