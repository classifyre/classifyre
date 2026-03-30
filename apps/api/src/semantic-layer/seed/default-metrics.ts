/**
 * Default metric definitions for the semantic layer.
 * These provide out-of-the-box governed metrics that can be used across
 * dashboards, API queries, MCP tools, and the metric explorer.
 */
export const DEFAULT_METRICS = [
  {
    displayName: 'Total Findings',
    description: 'Total number of findings across all detectors and sources.',
    type: 'SIMPLE' as const,
    definition: {
      aggregation: 'COUNT',
      entity: 'finding',
    },
    allowedDimensions: [
      'severity',
      'detectorType',
      'status',
      'findingType',
      'category',
    ],
    format: 'number',
    unit: 'findings',
  },
  {
    displayName: 'Open Findings',
    description: 'Number of findings currently in OPEN status.',
    type: 'SIMPLE' as const,
    definition: {
      aggregation: 'COUNT',
      entity: 'finding',
      filters: { statuses: ['OPEN'] },
    },
    allowedDimensions: ['severity', 'detectorType', 'findingType'],
    format: 'number',
    unit: 'findings',
  },
  {
    displayName: 'False Positive Rate',
    description:
      'Percentage of findings marked as false positive out of all findings.',
    type: 'RATIO' as const,
    definition: {
      numerator: {
        aggregation: 'COUNT',
        entity: 'finding',
        filters: { statuses: ['FALSE_POSITIVE'] },
      },
      denominator: {
        aggregation: 'COUNT',
        entity: 'finding',
      },
    },
    allowedDimensions: ['detectorType', 'severity'],
    format: 'percentage',
    unit: '%',
  },
  {
    displayName: 'Resolution Rate',
    description:
      'Percentage of findings that have been resolved out of all findings.',
    type: 'RATIO' as const,
    definition: {
      numerator: {
        aggregation: 'COUNT',
        entity: 'finding',
        filters: { statuses: ['RESOLVED'] },
      },
      denominator: {
        aggregation: 'COUNT',
        entity: 'finding',
      },
    },
    allowedDimensions: ['detectorType', 'severity'],
    format: 'percentage',
    unit: '%',
  },
  {
    displayName: 'Scan Coverage',
    description:
      'Percentage of assets that have at least one finding (have been scanned and analyzed).',
    type: 'RATIO' as const,
    definition: {
      numerator: {
        aggregation: 'COUNT_DISTINCT',
        entity: 'finding',
        field: 'assetId',
      },
      denominator: {
        aggregation: 'COUNT',
        entity: 'asset',
      },
    },
    allowedDimensions: [],
    format: 'percentage',
    unit: '%',
  },
  {
    displayName: 'Average Confidence Score',
    description: 'Average confidence score across all findings.',
    type: 'SIMPLE' as const,
    definition: {
      aggregation: 'AVG',
      entity: 'finding',
      field: 'confidence',
    },
    allowedDimensions: ['detectorType', 'severity'],
    format: 'number',
    unit: '',
  },
  {
    displayName: 'Weekly Finding Trend',
    description:
      'Week-over-week change in total findings. Positive values indicate an increase.',
    type: 'TREND' as const,
    definition: {
      baseMetricId: '', // Set to the ID of the 'Total Findings' metric after seeding
      compareWindow: '7d',
      currentWindow: '7d',
    },
    allowedDimensions: [],
    format: 'percentage',
    unit: '%',
  },
];
