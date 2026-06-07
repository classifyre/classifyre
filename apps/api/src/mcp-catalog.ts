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
      'search_sources',
      'get_source',
      'create_source',
      'update_source',
      'delete_source',
      'test_source_connection',
      'start_source_run',
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
];

export const MCP_PROMPTS: McpPromptSummaryDto[] = [
  {
    name: 'brainstorm_custom_detector',
    title: 'Brainstorm Custom Detector',
    description:
      'Guide an MCP client to propose regex, classifier, or entity detector configs before training.',
  },
];
