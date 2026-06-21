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
  ].join('\n'),
  allowedTools: [
    'findings.search',
    'sources.list',
    'sources.get_config',
    'memory.search',
    'system_brief.get',
    'config.tune_source',
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
    '\nYour mission: when existing detectors miss an important class of finding, author a new',
    'custom detector. Inspect findings and current detectors first. Choose the simplest pipeline',
    'that fits: REGEX for fixed patterns, GLINER2 for entities, a HuggingFace classification',
    'pipeline for categories, or a pure-LLM detector for nuanced judgement (LLM detectors require',
    'an aiProviderConfigId; never include provider_runtime). Create it (detector.create), then wire',
    'it into the relevant source via config.tune_source.custom_detectors. Train it only if it has',
    'examples. Be conservative — do not duplicate an existing detector.',
  ].join('\n'),
  allowedTools: [
    'findings.search',
    'detectors.list',
    'sources.list',
    'sources.get_config',
    'memory.search',
    'system_brief.get',
    'detector.create',
    'detector.train',
    'config.tune_source',
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
    'still point to live inquiries/cases. Finish by rewriting the system brief narrative',
    '(system_brief.update) to reflect the current state, what has been tried, and known gaps.',
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

/** Resolve the mission for an AgentKind, or null when it has no harness mission. */
export function missionFor(kind: AgentKind): Mission | null {
  switch (kind) {
    case AgentKind.INQUIRY:
      return INQUIRY_MISSION;
    case AgentKind.CASE:
      return CASE_MISSION;
    case AgentKind.CONFIG:
      return CONFIG_MISSION;
    case AgentKind.DETECTOR_AUTHOR:
      return DETECTOR_AUTHOR_MISSION;
    case AgentKind.DREAM:
      return DREAM_MISSION;
    default:
      return null;
  }
}
