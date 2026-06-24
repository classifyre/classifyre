import type { AgentRun, DetectorType, InstanceSettings } from '@prisma/client';

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
   * Manual trigger of a specific set of pipeline agents (or a single-agent
   * rerun): execute exactly these, in canonical order, as one chained cycle and
   * treat the job as explicit operator intent (instance enable-flags bypassed).
   * DREAM is carried via `dream`; DUPLICATES runs on the correlation queue.
   */
  agentKinds?: Array<'INQUIRY' | 'CASE' | 'CONFIG' | 'DETECTOR_AUTHOR'>;
  /** Focus the case agent on one case (full case detail in context). */
  caseId?: string;
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

/**
 * Compact summary of what the DUPLICATES FINDER AGENT found for this scan,
 * fed to the inquiry/case agents so they can take same-entity / cross-source
 * duplicate signals into account.
 */
export interface DuplicateSummary {
  clusters: Array<{
    clusterId: string;
    memberCount: number;
    sourceCount: number;
    label: string | null;
    commonValues: Array<{ label: string; value: string; count: number }>;
  }>;
  topPairs: Array<{
    fromAssetId: string;
    toAssetId: string;
    relationType: string;
    matchPercent: number;
    reasons: string[];
  }>;
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

/**
 * Full detail of ONE case for focused (case-targeted) runs: every id the
 * model may reference — hypothesis threads, evidence, findings, edges — so a
 * natural-language instruction alone can target anything in the case.
 */
export interface FocusedCaseDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  hypotheses: Array<{
    threadId: string;
    title: string;
    status: string | null;
    confidence: number | null;
    supportCount: number;
  }>;
  evidence: Array<{
    evidenceId: string;
    assetId: string;
    label: string | null;
    note: string | null;
  }>;
  findings: Array<{
    caseFindingId: string;
    findingId: string;
    evidenceId: string;
    label: string;
    severity: string | null;
    detectorType: string | null;
    matchedContent: string | null;
  }>;
  edges: Array<{
    edgeId: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    relationType: string;
    origin: string;
  }>;
  linkedInquiryIds: string[];
}

export interface RecalledMemory {
  kind: string;
  key: string;
  content: string;
  weight: number;
}

/**
 * Bounded, redacted view of one ingested asset's shape — name, kind and the
 * keys/preview of its metadata. Lets the harness reason about a source that has
 * produced no findings yet (cold start) from the data's structure alone.
 */
export interface AssetSampleSummary {
  id: string;
  assetType: string;
  sourceType: string;
  name: string;
  url: string | null;
  metadataKeys: string[];
  metadataPreview: Record<string, string>;
}

/**
 * Aggregate metadata profile of a source's assets: what kinds of things were
 * ingested and which metadata fields are common. The primary cold-start signal
 * the CONFIG / DETECTOR_AUTHOR missions use when there are no findings to learn
 * from.
 */
export interface AssetMetadataProfile {
  scope: 'runner' | 'source' | 'instance';
  totalAssets: number;
  hasFindings: boolean;
  assetTypes: Array<{ type: string; count: number }>;
  sourceTypes: Array<{ type: string; count: number }>;
  commonMetadataKeys: Array<{ type: string; count: number }>;
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
  /** Case-focused run: the case agent works on exactly this case. */
  caseId?: string | null;
  /** Validated output of each completed step, keyed by step name. */
  state: Record<string, unknown>;
}

export interface AgentStep {
  name: string;
  /** Returns the JSON-serializable output stored in stepState[name]. */
  execute(ctx: AgentContext): Promise<unknown>;
}

// ── Tool input shapes ────────────────────────────────────────────────────────

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

export interface MemoryWrite {
  kind:
    | 'GLOSSARY'
    | 'DECISION_PRECEDENT'
    | 'TOPIC_INQUIRY_MAP'
    | 'ENTITY_MAP'
    | 'SOURCE_PROFILE'
    | 'DETECTOR_INSIGHT'
    | 'OPERATOR_DIRECTIVE';
  key: string;
  content: string;
  tags?: string[];
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
    | 'REMOVE_EDGE'
    | 'LINK_SUPPORT'
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
  /** REMOVE_EDGE */
  edgeId?: string;
  /** LINK_SUPPORT — assign evidence/findings to a hypothesis thread */
  targetType?: 'evidence' | 'finding';
  targetId?: string;
  stance?: 'SUPPORTS' | 'CONTRADICTS';
  /** CHANGE_STATUS */
  caseStatus?: 'OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'ARCHIVED';
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  /** LINK_INQUIRY */
  inquiryIds?: string[];
};
