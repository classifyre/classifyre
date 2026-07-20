import type {
  McpCapabilityGroupDto,
  McpPromptSummaryDto,
} from './dto/mcp-settings.dto';

export const MCP_TOKEN_PREFIX = 'inmcp';

export const MCP_CAPABILITY_GROUPS: McpCapabilityGroupDto[] = [
  {
    id: 'sources',
    title: 'Sources',
    description:
      'Create, validate, update, delete, inspect, and run ingestion sources.',
    toolNames: [
      'list_source_types',
      'get_source_schema',
      'search_sources',
      'get_source',
      'create_source',
      'update_source',
      'delete_source',
      'test_source_connection',
      'start_source_run',
      'validate_source_config',
    ],
    operations: [
      'Search and filter sources',
      'Validate source configs against JSON Schema before save',
      'Start connection tests and runs',
    ],
  },
  {
    id: 'custom_detectors',
    title: 'Custom Detectors',
    description:
      'Manage regex, classifier, and entity detectors and train them on feedback.',
    toolNames: [
      'list_custom_detectors',
      'get_custom_detector',
      'list_custom_detector_examples',
      'create_custom_detector',
      'update_custom_detector',
      'delete_custom_detector',
      'train_custom_detector',
      'get_custom_detector_training_history',
      'validate_detector_config',
      'list_detector_test_scenarios',
      'create_detector_test_scenario',
      'run_detector_tests',
      'delete_detector_test_scenario',
    ],
    operations: [
      'Create detectors for rulesets, classifiers, and entities',
      'Inspect starter examples before authoring a detector',
      'Trigger training and inspect training history',
    ],
  },
  {
    id: 'runs',
    title: 'Runs',
    description:
      'Inspect ingestion runs, stop stuck runs, and fetch logs for debugging.',
    toolNames: [
      'search_runs',
      'get_run',
      'get_run_logs',
      'stop_run',
      'list_source_runs',
    ],
    operations: [
      'Search runs across the instance or by source',
      'Read paginated runner logs',
      'Stop long-running jobs',
    ],
  },
  {
    id: 'findings',
    title: 'Findings',
    description:
      'Search, inspect, and update findings including bulk status changes.',
    toolNames: [
      'search_findings',
      'get_finding',
      'update_finding',
      'bulk_update_findings',
      'get_findings_discovery',
      'purge_source_findings',
    ],
    operations: [
      'Search and filter findings by status, severity, type, and text',
      'Resolve or reopen findings',
      'Summarize discovery totals for MCP clients',
    ],
  },
  {
    id: 'assets',
    title: 'Assets',
    description:
      'Inspect assets, search asset inventory, and link findings back to content.',
    toolNames: [
      'search_assets',
      'get_asset',
      'list_source_assets',
      'list_asset_finding_summaries',
    ],
    operations: [
      'Search assets with nested finding filters',
      'Inspect a single asset',
      'Browse asset-level finding summaries',
    ],
  },
  {
    id: 'inquiries',
    title: 'Inquiries',
    description:
      'Create and manage saved questions — standing finding queries that surface new matches over time.',
    toolNames: [
      'list_inquiries',
      'get_inquiry',
      'create_inquiry',
      'update_inquiry',
      'delete_inquiry',
      'list_inquiry_matches',
      'rematch_inquiry',
      'preview_inquiry_matchers',
      'get_inquiry_match_options',
    ],
    operations: [
      'Preview matcher configs before saving a question',
      'List findings currently matching a saved question',
      'Recompute matches on demand',
    ],
  },
  {
    id: 'cases',
    title: 'Cases',
    description:
      'Investigation workspaces: evidence, findings, hypotheses/discussion threads, and the case graph.',
    toolNames: [
      'search_cases',
      'get_case',
      'create_case',
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
    ],
    operations: [
      'Attach evidence and findings to a case',
      "Pull a saved question's current matches into a case",
      'Track hypotheses and discussion threads with supporting/contradicting links',
      'Close and reopen cases, archiving or reactivating linked questions',
    ],
  },
  {
    id: 'autopilot',
    title: 'AI Autopilot',
    description:
      'Observe and control the autonomous agents: runs, decisions, memory, per-agent enable/disable, and manual triggers.',
    toolNames: [
      'list_autopilot_agents',
      'update_autopilot_agent',
      'list_autopilot_runs',
      'get_autopilot_run',
      'get_autopilot_run_logs',
      'list_autopilot_activity',
      'list_autopilot_memory',
      'get_autopilot_stats',
      'trigger_autopilot',
      'cancel_autopilot_run',
    ],
    operations: [
      'Audit what each agent did, to which entity, and why',
      'Enable or disable individual agents for scan cycles',
      'Trigger a steered autopilot cycle or cancel a running one',
      'Inspect agent memory and aggregate health stats',
    ],
  },
  {
    id: 'correlation',
    title: 'Correlation',
    description:
      'Tune and inspect deterministic asset correlation (evidence fingerprints and duplicate detection).',
    toolNames: [
      'get_correlation_config',
      'save_correlation_config',
      'add_correlation_exclusion',
      'remove_correlation_exclusion',
      'recompute_correlation',
      'get_value_occurrences',
    ],
    operations: [
      'Tune label weights and related/duplicate thresholds',
      'Exclude noisy values, regexes, or labels from correlation',
      'Recompute a single asset synchronously or schedule a full background recompute',
      'Trace where a normalized finding value appears across assets',
    ],
  },
];

export const MCP_PROMPTS: McpPromptSummaryDto[] = [
  {
    name: 'brainstorm_custom_detector',
    title: 'Brainstorm Custom Detector',
    description:
      'Guide an MCP client to propose regex, classifier, or entity detector configs before training.',
  },
];
