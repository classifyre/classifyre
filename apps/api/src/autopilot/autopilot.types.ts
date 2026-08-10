import type { AgentRun, DetectorType, InstanceSettings } from '@prisma/client';
import type { EntityOrigin } from './autopilot.constants';

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
  agentKinds?: Array<
    'INQUIRY' | 'CASE' | 'CONFIG' | 'DETECTOR_AUTHOR' | 'ESCALATION'
  >;
  /** Focus the case agent on one case (full case detail in context). */
  caseId?: string;
  /**
   * Coalesced corpus-wide cycle: scoped to every source marked dirty since the
   * last one rather than to a single scan. This is the ordinary post-scan shape
   * now; a per-source cycle means an express run or explicit operator intent.
   */
  corpus?: boolean;
  /** Why an express cycle skipped the coalescing window. */
  expressReason?: string;
  /** How many times the readiness gate has already pushed this cycle back. */
  readinessAttempts?: number;
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
 * Measured precision of one custom detector, derived from operator triage.
 * Operators dismissing a finding (FALSE_POSITIVE / IGNORED) or confirming it
 * (RESOLVED) is logged per detector; this turns that append-only feedback into
 * a per-detector false-positive rate the DETECTOR_AUTHOR consults instead of
 * judging quality from the prompt alone. `verdict` is the coarse, sample-aware
 * label: a rate over too few reviews is "unproven", not "clean" or "noisy".
 */
export interface DetectorPrecisionSummary {
  customDetectorKey: string;
  customDetectorName: string;
  /** Untriaged findings currently produced by the detector (volume context). */
  openFindings: number;
  /** Operator dismissals: FALSE_POSITIVE + IGNORED feedback (cumulative). */
  dismissed: number;
  /** Operator confirmations: RESOLVED feedback (cumulative). */
  confirmed: number;
  /** dismissed + confirmed — the denominator of the rate. */
  reviewed: number;
  /** dismissed / reviewed, rounded to 2dp; null when nothing was reviewed yet. */
  falsePositiveRate: number | null;
  verdict: 'noisy' | 'mixed' | 'clean' | 'unproven';
}

/**
 * What a detector's output is actually WORTH, as opposed to how much of it
 * there is.
 *
 * The config agent had only volume to go on, plus its own reading of a sample.
 * Volume is a metric you improve by reducing it, so it reduced: 44,174 PII
 * findings were disabled as "5000+ noise findings" on a source where an active
 * inquiry was matching over a thousand of them. This is the counterweight —
 * a detector that feeds inquiries and cases is the corpus, not noise, however
 * loud it is; one nothing has ever looked at is the candidate for retuning
 * however quiet it is.
 */
export interface DetectorValueSummary {
  /** `PII`, or `CUSTOM::my_detector` — the same identity the source config uses. */
  detector: string;
  /** Human-readable form of the same. */
  label: string;
  isCustom: boolean;
  /** Currently enabled on at least one source in scope. */
  openFindings: number;
  /** Of those, how many an ACTIVE inquiry matches. */
  watchedByInquiries: number;
  /** Of those, how many are attached to a case. */
  citedByCases: number;
  /** Of those, how many clear the high-importance bar. */
  highImportance: number;
  /** Operator dismissals (custom detectors only — built-ins carry no feedback rows). */
  dismissedByOperator: number;
  /**
   * False when the per-finding pass hit its scan cap, so the watched/cited/
   * high-importance columns describe a sample of this detector's output.
   * `openFindings` is always exact.
   */
  scanComplete: boolean;
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

/**
 * How much of the corpus has been scanned, and how much of what was scanned has
 * an evidence score yet. Answers "am I looking at the corpus or at a sample?" —
 * a question the investigation missions previously had no tool to ask.
 */
export interface CorpusCoverage {
  totalSources: number;
  scannedSources: number;
  /**
   * Sources nothing will ever read — never scanned successfully AND either
   * failing every attempt, paused, or not scheduled. Excluded from
   * `coverageRatio`: left in, they pinned it below the sample threshold for
   * good, which put the harness into permanent observe-and-defer mode.
   */
  unavailableSources: number;
  /** totalSources - unavailableSources. The ratio's denominator. */
  reachableSources: number;
  neverScanned: number;
  inFlight: number;
  failing: number;
  /** scannedSources / reachableSources, 0–1. */
  coverageRatio: number;
  findingsOpen: number;
  findingsAnalyzed: number;
  note: string;
  sources: Array<{
    sourceId: string;
    name: string;
    scanned: boolean;
    lastRunAt: Date | null;
    lastRunStatus: string | null;
    runnerStatus: string | null;
    consecutiveFailures: number;
    /** True when nothing will ever scan this source as currently configured. */
    unavailable: boolean;
    /** Assets that should have carried text but yielded none. */
    assetsWithoutText: number | null;
    textCoverage: unknown;
  }>;
}

/**
 * Open findings above the importance bar that no ACTIVE inquiry matches — the
 * inverse of corpus coverage: evidence present but unwatched.
 */
export interface UnmonitoredFindings {
  total: number;
  groups: Array<{
    detectorType: string;
    customDetectorKey: string | null;
    findingType: string;
    count: number;
    topImportance: number;
    sampleFindingIds: string[];
    sampleValues: string[];
  }>;
}

/** Bounded, explicitly-ranked list returned to an agent. */
export interface RankedList<T> {
  orderedBy: string;
  total: number;
  shown: number;
  omitted: number;
  items: T[];
}

export interface ProbeSummary {
  customDetectorKey: string;
  detectorId: string | null;
  createdAt: Date;
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
  createdBy: string | null;
  origin: EntityOrigin;
  rank: number;
  idleDays: number;
  priority: string;
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
  createdBy: string | null;
  origin: EntityOrigin;
  rank: number;
  hypothesisCount: number;
  unevaluatedHypothesisCount: number;
  idleDays: number;
  priority: string;
}

export interface OpenHypothesisSummary {
  threadId: string;
  caseId: string;
  caseTitle: string;
  caseSeverity: string;
  caseCreatedBy: string | null;
  caseOrigin: EntityOrigin;
  title: string;
  statement: string | null;
  testablePredicate: string | null;
  createdBy: string | null;
  origin: EntityOrigin;
  createdAt: Date;
  probes: ProbeSummary[];
}

export interface OpenHypothesesResult extends RankedList<OpenHypothesisSummary> {
  probedExcluded: number;
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
  createdBy: string | null;
  origin: EntityOrigin;
  hypotheses: Array<{
    threadId: string;
    title: string;
    status: string | null;
    confidence: number | null;
    supportCount: number;
    testablePredicate: string | null;
    createdBy: string | null;
    origin: EntityOrigin;
    probes: ProbeSummary[];
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
  glossary: Array<{
    id: string;
    term: string;
    aliases: string[];
    entityType: string;
    notes: string | null;
    verified: boolean;
  }>;
  linkedInquiryIds: string[];
}

export interface RecalledMemory {
  kind: string;
  key: string;
  content: string;
  weight: number;
  /** Free-form labels; `deferred` + `revisit-at:<ratio>` mark a parked item. */
  tags: string[];
  /** AGENT-authored memory is a hypothesis until verified; OPERATOR is authoritative. */
  origin: string;
  verified: boolean;
  /**
   * When the entry was last written. Optional because the full-text recall path
   * does not select it; readers must treat its absence as "age unknown" rather
   * than as "old". Used to give a deferred item a way out that does not depend
   * on coverage ever reaching its threshold.
   */
  updatedAt?: Date;
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
  /**
   * Assets in the requested scope. When scope is 'runner' this is the assets
   * that runner *last touched* — not the source's contents, and not even the
   * assets that run processed, since any later run re-stamps them.
   */
  totalAssets: number;
  hasFindings: boolean;
  /**
   * The source's live totals, independent of the runner scope. Present whenever
   * a sourceId is known.
   *
   * Exists because scope='runner' silently answers a different question than
   * the one agents ask. A CONFIG run reviewing a superseded runner saw
   * totalAssets: 0, concluded the source was empty, and wrote a false "0 assets
   * and 0 findings" memory while the source in fact held 13 assets and 3,239
   * findings. No agent may conclude a source is empty without reading this.
   */
  sourceTotals: { activeAssets: number; openFindings: number } | null;
  /**
   * The source holds assets this runner did not last touch, so the runner-scoped
   * view is partial or stale. When totalAssets is 0 and this is true, the runner
   * has been fully superseded and its scope says nothing about the source.
   */
  runnerSuperseded: boolean;
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
  /**
   * Sources scanned since the last cycle, for a coalesced corpus run. Named so
   * the mission can say which sources are new this batch without implying they
   * are the whole corpus — `corpus.coverage` is what answers that.
   */
  batchSources?: Array<{ id: string; name: string }>;
  /** Why this cycle skipped the coalescing window, if it did. */
  expressReason?: string | null;
  /**
   * Evidence analysis had not drained when the readiness gate gave up waiting.
   * Importance scores in this run are partial and the missions are told so.
   */
  evidenceAnalysisPending?: boolean;
  /** Open vs scored finding counts, so the prompt can state the real ratio. */
  evidenceCoverage?: { open: number; analyzed: number };
  /** High-importance findings no active inquiry matches, surfaced each cycle. */
  unmonitoredFindings?: number;
  /** Set when recent scans processed assets and detected nothing at all. */
  detectionBlind?: boolean;
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
    | 'DECISION_PRECEDENT'
    | 'ENTITY_MAP'
    | 'SOURCE_PROFILE'
    | 'DETECTOR_INSIGHT'
    | 'OPERATOR_DIRECTIVE';
  key: string;
  content: string;
  tags?: string[];
  /** Replace tags instead of merging them (used by deterministic live maps). */
  replaceTags?: boolean;
  /**
   * Set true only when the content was checked against real system state this
   * cycle (e.g. a detector's actual findings). Refreshed-but-unchecked content
   * must stay unverified.
   */
  verified?: boolean;
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
  testablePredicate?: string;
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
