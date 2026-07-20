import type { AssistantContextKey } from '@workspace/schemas/assistant';

/**
 * Server-side definition of one assistant context ("module"). A module scopes
 * the agent loop to a page domain: which MCP tools it may call, which UI
 * actions it may emit, and the domain knowledge injected into its prompt.
 *
 * Tool allowlists are intersected with the live MCP catalog at request time,
 * so a module may reference tools that ship later — they simply don't appear
 * in the prompt until the MCP server registers them.
 */
export interface AssistantContextModule {
  /** MCP tool names this context may call (read tools run immediately, mutating tools require user confirmation). */
  tools: string[];
  /** UI action types the model may emit for this context. */
  uiActions: Array<'patch_fields' | 'navigate' | 'show_toast'>;
  /** Extra domain knowledge appended to the system prompt. */
  knowledge?: string;
}

const NAVIGATION_MAP = [
  'App routes you can navigate the user to (uiActions type "navigate"):',
  '  /sources — source list; /sources/new — create a source; /sources/{id}/edit — edit a source',
  '  /detectors — custom detector list; /detectors/new — create a detector; /detectors/{id} — detector detail (test, train, tune)',
  '  /fingerprints — correlation / duplicates graph and tuning panel',
  '  /discovery — findings discovery dashboard',
  '  /investigations — case list; /investigations/{id} — case detail (threads, hypotheses, graph)',
  '  /investigations/cases/new — create a case',
  '  /investigations/inquiries/new — create an inquiry; /investigations/inquiries/{id} — inquiry detail and matches',
].join('\n');

const DETECTOR_KNOWLEDGE = [
  '## Detector domain knowledge',
  'There are three detector methods. Choose based on user intent:',
  '',
  'RULESET — deterministic regex/keyword matching. No training required.',
  '  Use when: the signal is a fixed pattern or keyword list.',
  '  Good for: IBANs, GDPR keyword density, "Vertraulich" markers, financial amounts.',
  '  regex_rules items MUST have exactly: { id (string), name (string), pattern (string), flags? (string, e.g. "i"), severity? ("critical"|"high"|"medium"|"low"|"info") }',
  '  keyword_rules items MUST have exactly: { id (string), name (string), keywords (string[]), case_sensitive? (boolean), severity? }',
  '  NO other properties allowed (no label, no weight, no flag_threshold — these do not exist).',
  '',
  'CLASSIFIER — semantic document-level label assignment. Zero-shot, fine-tunable.',
  '  Use when: you need to categorize by topic, tone, intent, or risk level.',
  '  classifier.labels items MUST have exactly: { id (string), name (string), description? (string) } — an array of OBJECTS, never plain strings.',
  '  classifier.training_examples items: { text (string), label (string) }',
  '',
  'ENTITY — named span extraction (NER) via GLiNER2. Multilingual and schema-driven.',
  '  entity.entity_labels is a flat array of plain strings (the label names in English), e.g. ["PersonName","IBAN","PhoneNumber","Email"].',
  '  Optional entity.entity_descriptions explains labels, e.g. { "IBAN": "bank account number" }.',
  '  NO "labels" field — the field is called entity_labels.',
  '',
  '## Key naming — ALWAYS derive from name, never leave as default',
  'The key must be a unique snake_case slug. Whenever you patch "name", IMMEDIATELY also patch "key" with a slug derived from the name, prefixed with the method (e.g. "ruleset_gdpr_keywords", "classifier_financial_advice", "entity_dach_pii").',
  'The key is immutable once findings are recorded — choose it carefully.',
  '',
  '## Exact patch paths for the detector form',
  '  name, key, method ("RULESET"|"CLASSIFIER"|"ENTITY"),',
  '  config.ruleset.regex_rules, config.ruleset.keyword_rules,',
  '  config.classifier.labels, config.classifier.training_examples,',
  '  config.entity.entity_labels, config.entity.entity_descriptions,',
  '  config.confidence_threshold (0–1), config.languages (["de","en",...])',
  '',
  '## Workflow',
  'Use list_custom_detector_examples to ground configs in proven templates.',
  'ALWAYS call validate_detector_config on the pipeline schema before proposing create/update.',
  'After creating a detector, proactively add at least one positive and one negative test scenario (create_detector_test_scenario) and run run_detector_tests.',
  'Expected outcome format for scenarios: RULESET {"shouldMatch":true|false}; CLASSIFIER {"label":"advice","minConfidence":0.6}; ENTITY {"entities":[{"label":"PersonName","text":"Ostap"}]}. Labels compare case-insensitively with underscores treated as spaces. Re-run a single scenario via run_detector_tests scenario_ids to avoid paying for a full re-run.',
].join('\n');

const SOURCE_KNOWLEDGE = [
  '## Source workflow',
  'Use get_source_schema for the exact config schema of the chosen source type.',
  'ALWAYS call validate_source_config with the assembled config BEFORE proposing create_source or update_source — fix every reported error first (patch the form via patch_fields so the user sees the corrections).',
  'Credentials/secrets: set them only from explicit user input, never invent them.',
  'After creating a source, offer a connection test (test_source_connection).',
].join('\n');

const FINGERPRINTS_KNOWLEDGE = [
  '## Correlation ("fingerprints") tuning knowledge',
  'The duplicates finder scores asset similarity from shared finding values. Tunable config (get_correlation_config / save_correlation_config):',
  '  defaultWeight (0–100) — weight for any finding label without an explicit override. Lower it when generic labels (e.g. common words) dominate the graph.',
  '  labelWeights [{label, weight}] — per-label overrides. Raise strong identifiers (IBAN, Email, PhoneNumber → 80–100); lower noisy ones (URL, Date → 0–20).',
  '  relatedMin (0–1) — similarity above which two assets count as "related". Typical 0.35–0.55.',
  '  duplicateMin (0–1) — stricter threshold for "likely duplicate". Typical 0.7–0.9; must be ≥ relatedMin.',
  '  exclusions — rules (value | regex | label) that drop noisy values from scoring entirely (e.g. a shared footer, a company-wide phone number).',
  '',
  'Retuning playbook:',
  '  Too many false links → raise relatedMin, lower defaultWeight, or exclude the dominant shared value (find it with get_value_occurrences).',
  '  Missing obvious duplicates → raise weights of the identifying labels or lower duplicateMin slightly.',
  '  One value connects half the graph → add an exclusion for it rather than reweighting everything.',
  'Saving the config schedules a full recompute; warn the user that the graph refreshes afterwards.',
].join('\n');

const INQUIRY_KNOWLEDGE = [
  '## Inquiry knowledge',
  'An inquiry is a saved matcher that continuously watches findings. Matcher fields: matchAllSources | sourceIds, detectorTypes[], customDetectorKeys[], findingTypes[], findingTypeRegex[], findingValueRegex[].',
  'Use get_inquiry_match_options to learn which detector types / finding types exist before building a matcher.',
  'ALWAYS preview (preview_inquiry_matchers) before proposing create_inquiry or update_inquiry so the user sees real match counts.',
  'After editing matchers on an existing inquiry, propose rematch_inquiry so live matches refresh.',
  'Good inquiry ideas to suggest when asked: watch a new source for critical findings, track a specific custom detector key, regex on finding values (e.g. a project codename), or all findings of a type across sources.',
].join('\n');

const CASE_KNOWLEDGE = [
  '## Case knowledge',
  'A case is an investigation container: evidence (assets), findings, linked inquiries, and threads.',
  'Threads have kinds; HYPOTHESIS threads represent working theories. Evidence/findings can be linked to a hypothesis as supporting or contradicting via link_case_thread_support.',
  'Typical flows:',
  '  Create a hypothesis → create_case_thread (kind HYPOTHESIS), then link the evidence that supports or contradicts it.',
  '  Summarize a thread or the whole case → read list_case_threads / add_case_thread_entry entries and get_case_timeline, then write the summary in your reply (offer to post it as a thread entry via add_case_thread_entry — that is a mutation, so propose it).',
  '  Pull matches from an inquiry into the case → pull_case_from_inquiry.',
  'Closing or reopening a case is a significant action — always explain why before proposing it.',
].join('\n');

export const assistantContextModules: Record<
  AssistantContextKey,
  AssistantContextModule
> = {
  'source.create': {
    tools: [
      'list_source_types',
      'get_source_schema',
      'validate_source_config',
      'create_source',
      'test_source_connection',
      'search_sources',
      'list_custom_detectors',
    ],
    uiActions: ['patch_fields', 'navigate', 'show_toast'],
    knowledge: SOURCE_KNOWLEDGE,
  },
  'source.edit': {
    tools: [
      'get_source',
      'get_source_schema',
      'validate_source_config',
      'update_source',
      'test_source_connection',
      'start_source_run',
      'list_source_runs',
      'get_run_logs',
      'list_custom_detectors',
    ],
    uiActions: ['patch_fields', 'navigate', 'show_toast'],
    knowledge: SOURCE_KNOWLEDGE,
  },
  'detector.create': {
    tools: [
      'list_custom_detector_examples',
      'validate_detector_config',
      'create_custom_detector',
      'list_custom_detectors',
      'list_detector_test_scenarios',
      'create_detector_test_scenario',
      'run_detector_tests',
      'train_custom_detector',
    ],
    uiActions: ['patch_fields', 'navigate', 'show_toast'],
    knowledge: DETECTOR_KNOWLEDGE,
  },
  'detector.edit': {
    tools: [
      'get_custom_detector',
      'list_custom_detector_examples',
      'validate_detector_config',
      'update_custom_detector',
      'train_custom_detector',
      'get_custom_detector_training_history',
      'list_detector_test_scenarios',
      'create_detector_test_scenario',
      'run_detector_tests',
      'get_extraction_coverage',
      'search_extractions',
      'list_extractor_schema',
    ],
    uiActions: ['patch_fields', 'navigate', 'show_toast'],
    knowledge: DETECTOR_KNOWLEDGE,
  },
  'fingerprints.tune': {
    tools: [
      'get_correlation_config',
      'save_correlation_config',
      'add_correlation_exclusion',
      'remove_correlation_exclusion',
      'recompute_correlation',
      'get_value_occurrences',
      'search_findings',
      'search_assets',
    ],
    uiActions: ['patch_fields', 'navigate', 'show_toast'],
    knowledge: FINGERPRINTS_KNOWLEDGE,
  },
  'inquiry.create': {
    tools: [
      'get_inquiry_match_options',
      'preview_inquiry_matchers',
      'create_inquiry',
      'list_inquiries',
      'search_sources',
      'list_custom_detectors',
      'search_findings',
    ],
    uiActions: ['patch_fields', 'navigate', 'show_toast'],
    knowledge: INQUIRY_KNOWLEDGE,
  },
  'inquiry.manage': {
    tools: [
      'get_inquiry',
      'update_inquiry',
      'rematch_inquiry',
      'list_inquiry_matches',
      'preview_inquiry_matchers',
      'get_inquiry_match_options',
      'search_findings',
      'get_finding',
      'update_finding',
      'bulk_update_findings',
      'search_assets',
      'get_asset',
      'list_asset_finding_summaries',
    ],
    uiActions: ['patch_fields', 'navigate', 'show_toast'],
    knowledge: INQUIRY_KNOWLEDGE,
  },
  'case.create': {
    tools: [
      'create_case',
      'search_cases',
      'list_inquiries',
      'get_inquiry',
      'search_findings',
      'search_assets',
    ],
    uiActions: ['patch_fields', 'navigate', 'show_toast'],
    knowledge: CASE_KNOWLEDGE,
  },
  'case.manage': {
    tools: [
      'get_case',
      'update_case',
      'close_case',
      'reopen_case',
      'add_case_evidence',
      'attach_case_findings',
      'pull_case_from_inquiry',
      'link_case_inquiries',
      'get_case_graph',
      'get_case_timeline',
      'list_case_threads',
      'create_case_thread',
      'add_case_thread_entry',
      'link_case_thread_support',
      'search_findings',
      'get_finding',
      'search_assets',
      'get_asset',
      'list_inquiries',
    ],
    uiActions: ['navigate', 'show_toast'],
    knowledge: CASE_KNOWLEDGE,
  },
  'app.global': {
    tools: [
      'search_sources',
      'get_source',
      'list_source_types',
      'list_custom_detectors',
      'get_custom_detector',
      'search_findings',
      'get_finding',
      'get_findings_discovery',
      'search_assets',
      'get_asset',
      'search_runs',
      'get_run',
      'list_inquiries',
      'get_inquiry',
      'search_cases',
      'get_case',
      'get_correlation_config',
    ],
    uiActions: ['navigate', 'show_toast'],
    knowledge: NAVIGATION_MAP,
  },
};

/** Domain knowledge plus the navigation map (which helps in every context). */
export function contextKnowledge(key: AssistantContextKey): string {
  const module = assistantContextModules[key];
  const parts =
    module.knowledge === NAVIGATION_MAP
      ? [NAVIGATION_MAP]
      : [module.knowledge, NAVIGATION_MAP];
  return parts.filter(Boolean).join('\n\n');
}
