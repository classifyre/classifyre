import { AgentKind } from '@prisma/client';

/**
 * A mission parameterizes the single agent-loop driver: the goal it pursues,
 * the tools it may call, and its iteration budget. Distinct AgentKind values
 * remain for scheduling/settings/audit, but they no longer map to bespoke
 * code pipelines — they map to missions.
 */
export interface Mission {
  kind: AgentKind;
  goal: string;
  allowedTools: string[];
  maxIterations: number;
}

const OBSERVE_TOOLS = [
  'findings.search',
  'inquiries.list',
  'inquiries.archived',
  'inquiries.sample_matches',
  'cases.list',
  'cases.closed',
  'cases.detail',
  'duplicates.summary',
  'memory.search',
  'system_brief.get',
];

/** Learning tools available to every mission. */
const KNOWLEDGE_TOOLS = ['memory.write'];

/**
 * Raw-asset observation. The cold-start signal: when a source has produced no
 * findings, these expose the ingested assets' kinds and metadata shape so a
 * mission can reason about what to detect from the data itself.
 */
const ASSET_OBSERVE_TOOLS = ['assets.profile', 'assets.sample'];

const INVESTIGATION_INQUIRY_TOOLS = [
  'inquiries.create',
  'inquiries.update',
  'inquiries.enrich',
];

const INVESTIGATION_CASE_TOOLS = [
  'cases.create',
  'cases.update_fields',
  'cases.add_hypothesis',
  'cases.update_hypothesis',
  'cases.add_evidence',
  'cases.attach_findings',
  'cases.add_note',
  'cases.add_thread_entry',
  'cases.create_edge',
  'cases.remove_edge',
  'cases.link_support',
  'cases.change_status',
  'cases.link_inquiry',
  // Fingerprints (asset similarity) — observe + act within an investigation.
  'fingerprints.similar_assets',
  'fingerprints.value_occurrences',
  'fingerprints.recompute_asset',
  'cases.from_cluster',
];

const DOMAIN_PRIMER = [
  'You are an autonomous investigation analyst for a metadata-ingestion system.',
  'Sources are scanned to produce assets; detectors flag findings on those assets.',
  'Inquiries are saved monitors (matcher rules) over findings; cases are investigations',
  'built from inquiries with hypotheses, evidence and findings. Every action you take',
  'is audited and may be observe-only — that is enforced for you, just act correctly.',
].join(' ');

export const INQUIRY_MISSION: Mission = {
  kind: AgentKind.INQUIRY,
  goal: [
    DOMAIN_PRIMER,
    '\nYour mission: review the new/open findings and keep the set of inquiries healthy.',
    'Avoid duplicates — prefer enriching an existing inquiry over creating a near-duplicate.',
    'Do not recreate intentionally archived inquiries. Use memory.search to recall precedents.',
  ].join('\n'),
  allowedTools: [
    ...OBSERVE_TOOLS,
    ...INVESTIGATION_INQUIRY_TOOLS,
    ...KNOWLEDGE_TOOLS,
  ],
  maxIterations: 12,
};

export const CASE_MISSION: Mission = {
  kind: AgentKind.CASE,
  goal: [
    DOMAIN_PRIMER,
    '\nYour mission: build and maintain investigation cases from inquiries with new matches.',
    'Create a case only when a coherent investigation is warranted; otherwise enrich an open case',
    'with hypotheses, evidence, attached findings, notes and links. Be conservative and specific.',
  ].join('\n'),
  allowedTools: [
    ...OBSERVE_TOOLS,
    ...INVESTIGATION_CASE_TOOLS,
    ...KNOWLEDGE_TOOLS,
  ],
  maxIterations: 14,
};

export const CONFIG_MISSION: Mission = {
  kind: AgentKind.CONFIG,
  goal: [
    DOMAIN_PRIMER,
    '\nYour mission: improve detection by tuning source configuration. Inspect the finding',
    'landscape and each source’s editable config, then adjust detectors (enable/disable/retune),',
    'custom_detectors, sampling, optional and resources to catch what is being missed or to cut',
    'noise. You may ONLY change those editable keys — never the base connection. Every change is',
    'schema-validated for you; if a change is rejected, read the error and try a valid one.',
    'Make the smallest correct change and explain why.',
    '\nCOLD START: if a source has ingested assets but produced NO findings, it likely has no',
    'detectors enabled. Call assets.profile (and assets.sample for detail) to see the asset kinds',
    'and metadata shape, then enable the baseline detectors that fit that data (e.g. SECRETS/PII for',
    'text, CODE_SECURITY for code). Getting a detector-less source to produce its first findings is',
    'as valuable as retuning a noisy one.',
    '\nAPPLY & VERIFY: after a config.tune_source change, call sources.rescan(sourceId) so it takes',
    'effect and produces findings, and memory.write a SOURCE_PROFILE note (tagged "pending-verification")',
    'describing what you changed and what you expect — a later cycle confirms whether it helped. First',
    'check memory for your own prior "pending-verification" notes and judge the new finding landscape',
    'against them. If this run is itself a verification re-scan, do NOT re-scan again.',
  ].join('\n'),
  allowedTools: [
    'findings.search',
    ...ASSET_OBSERVE_TOOLS,
    'sources.list',
    'sources.get_config',
    'memory.search',
    'system_brief.get',
    'config.tune_source',
    'sources.rescan',
    // Correlation/fingerprints config is tunable here too.
    'fingerprints.value_occurrences',
    'fingerprints.similar_assets',
    'fingerprints.tune_config',
    ...KNOWLEDGE_TOOLS,
  ],
  maxIterations: 14,
};

export const DETECTOR_AUTHOR_MISSION: Mission = {
  kind: AgentKind.DETECTOR_AUTHOR,
  goal: [
    DOMAIN_PRIMER,
    '\nYour mission: when existing detectors miss an important class of finding, author ONE new',
    'custom detector — as a tested, documented hypothesis. Work this bounded loop and then finish:',
    '\nVERIFY PENDING FIRST: memory.search for DETECTOR_INSIGHT entries tagged "pending-verification"',
    '— detectors you authored/changed in a previous cycle that have since been re-scanned. For each,',
    'call findings.search with its customDetectorKey to inspect the REAL findings it produced. If it',
    'works well, mark it verified (memory.write the same key, updated content, tags WITHOUT',
    '"pending-verification"). If it is noisy or wrong, make ONE corrective detector.update (or',
    'detector.deactivate/delete), call sources.rescan, and leave it pending for the next cycle.',
    'Resolve pending verifications before authoring anything new.',
    '\n0. SURVEY: call assets.profile. If the source has assets but hasFindings is false (cold start),',
    'you have NO findings to learn from — call assets.sample and hypothesise a detector directly from',
    'the asset kinds and metadata shape (e.g. column names, mime types, fields present). Otherwise',
    'proceed from the missed findings as below.',
    '1. RECALL: memory.search for DETECTOR_INSIGHT entries (keys prefixed "detector-author:") and',
    'detectors.list. Never re-attempt a concept a prior run abandoned, and never duplicate a detector',
    'that already exists.',
    '2. HYPOTHESISE: from findings.search (or, on cold start, from assets.profile/assets.sample),',
    'pick one missed finding class, then choose the SIMPLEST engine that fits from the "Detector type',
    'registry" in your system prompt — do not default to REGEX/GLINER2 when a better fit exists:',
    '   • REGEX — fixed / structured tokens (IDs, keys, account or product codes).',
    '   • GLINER2 — zero-shot entities/categories with no labelled data.',
    '   • TEXT_CLASSIFICATION — an off-the-shelf HuggingFace text classifier fits the task (spam,',
    '     sentiment, toxicity, language, prompt-injection); copy a candidate model id from the registry.',
    '   • IMAGE_CLASSIFICATION / OBJECT_DETECTION — image assets (NSFW, scene/category, or locating',
    '     objects like weapons/people/logos).',
    '   • FEATURE_EXTRACTION — embeddings for similarity / clustering / retrieval.',
    '   • LLM — only for nuanced judgement no smaller model captures (needs an aiProviderConfigId;',
    '     never include provider_runtime).',
    '3. SHAPE: call detector.examples (pass `type` to get just that engine, with candidate model ids)',
    'and copy a worked schema, following the required fields for that type exactly.',
    '4. DRY-RUN (MANDATORY — an untested detector is not shippable): call detector.test with a DRAFT',
    'pipelineSchema plus a representative POSITIVE sampleText AND a COUNTER-EXAMPLE. Proceed to create',
    'only once it matches what it should and not what it should not; otherwise re-shape and re-test.',
    '5. CREATE: detector.create, then wire it into the relevant source via',
    'config.tune_source.custom_detectors. TRAIN IF APPLICABLE: if the detector carries labelled',
    'examples (a classifier/entity schema with training_examples), call detector.train. GLINER2 and the',
    'HuggingFace pipelines are zero-shot — there is nothing to train, but never skip the dry-run.',
    '6. DRY-RUN VERIFY: detector.test the saved detector (by detectorId) for a final sanity check.',
    '7. APPLY: call sources.rescan(sourceId) so the detector runs on REAL assets. Scans are async —',
    'the real findings will NOT exist yet this cycle; a later cycle verifies them (see VERIFY PENDING).',
    'If this run is itself a verification re-scan, sources.rescan is a no-op — that is fine.',
    '8. ADJUST-OR-ABANDON (bounded): if the dry-run still fails, make AT MOST ONE corrective',
    'detector.update and re-test. If it still fails, detector.delete it (if you created it this run and',
    'never relied on it) or detector.deactivate it — then stop pursuing this concept.',
    '9. DOCUMENT (always, even on failure): memory.write kind DETECTOR_INSIGHT, key',
    '"detector-author:<concept-slug>", content = hypothesis + pipeline type + dry-run outcome +',
    'conclusion. When you shipped a detector and triggered a re-scan, tag it "pending-verification" so',
    'the next cycle evaluates its real findings; otherwise record "abandoned-because-X". Then finish.',
  ].join('\n'),
  allowedTools: [
    'findings.search',
    ...ASSET_OBSERVE_TOOLS,
    'detectors.list',
    'detector.examples',
    'sources.list',
    'sources.get_config',
    'memory.search',
    'system_brief.get',
    'detector.test',
    'detector.create',
    'detector.update',
    'detector.deactivate',
    'detector.delete',
    'detector.train',
    'config.tune_source',
    'sources.rescan',
    ...KNOWLEDGE_TOOLS,
  ],
  maxIterations: 16,
};

export const DREAM_MISSION: Mission = {
  kind: AgentKind.DREAM,
  goal: [
    DOMAIN_PRIMER,
    '\nYour mission: consolidate the long-lived memory store and refresh the system brief.',
    'Call memory.list, then delete noise/stale/duplicate entries (memory.delete), rewrite verbose',
    'entries into crisp lessons (memory.rewrite), and record durable new lessons (memory.write).',
    'NEVER delete OPERATOR_DIRECTIVE entries or operator-deletion precedents; keep entity maps that',
    'still point to live inquiries/cases. Finish by writing a SHORT, stable system-brief overview',
    '(system_brief.update): 2–4 sentences on what this instance is for and its current investigative',
    'posture. Do NOT restate coverage counts, glossary, topics or gaps — those sections are composed',
    'automatically from facts and memory; the overview is only the durable framing around them.',
  ].join('\n'),
  allowedTools: [
    'memory.list',
    'memory.write',
    'memory.delete',
    'memory.rewrite',
    'system_brief.get',
    'system_brief.update',
    'inquiries.list',
    'cases.list',
  ],
  maxIterations: 16,
};

/**
 * Factory defaults for every AgentKind that has a harness mission, in canonical
 * order. These are the single source of truth for an agent's default goal,
 * tools and iteration budget; per-agent overrides (AgentConfig rows) merge on
 * top of these (see AgentConfigService).
 */
export const DEFAULT_MISSIONS: readonly Mission[] = [
  INQUIRY_MISSION,
  CASE_MISSION,
  CONFIG_MISSION,
  DETECTOR_AUTHOR_MISSION,
  DREAM_MISSION,
];

/** Resolve the factory mission for an AgentKind, or null when it has none. */
export function missionFor(kind: AgentKind): Mission | null {
  return DEFAULT_MISSIONS.find((m) => m.kind === kind) ?? null;
}
