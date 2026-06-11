import type { JsonSchema } from '../../ai';

const memoryWriteSchema = {
  type: 'object',
  required: ['kind', 'key', 'content'],
  additionalProperties: false,
  properties: {
    kind: { enum: ['GLOSSARY', 'DECISION_PRECEDENT', 'TOPIC_INQUIRY_MAP'] },
    key: { type: 'string', minLength: 2, maxLength: 200 },
    content: { type: 'string', minLength: 2, maxLength: 2000 },
    tags: {
      type: 'array',
      items: { type: 'string', maxLength: 60 },
      maxItems: 10,
    },
  },
} as const;

export const MEMORY_WRITES_SCHEMA_FRAGMENT = memoryWriteSchema;

/**
 * Structured output for the inquiry agent. `decisions` must never be empty —
 * doing nothing is itself a decision (NO_ACTION) and requires a rationale.
 */
export const inquiryDecisionSchema: JsonSchema = {
  type: 'object',
  required: ['decisions', 'memoryWrites'],
  additionalProperties: false,
  properties: {
    decisions: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        required: ['action', 'rationale'],
        additionalProperties: false,
        properties: {
          action: {
            enum: [
              'CREATE_INQUIRY',
              'UPDATE_INQUIRY',
              'ENRICH_INQUIRY_MATCHERS',
              'SIGNAL_CASE_READY',
              'NO_ACTION',
            ],
          },
          rationale: { type: 'string', minLength: 20, maxLength: 2000 },
          inquiryId: { type: 'string' },
          duplicateOfInquiryId: { type: 'string' },
          inquiry: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', minLength: 3, maxLength: 300 },
              description: { type: 'string', maxLength: 4000 },
              matchAllSources: { type: 'boolean' },
              sourceIds: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 50,
              },
              detectorTypes: {
                type: 'array',
                items: {
                  enum: [
                    'SECRETS',
                    'PII',
                    'YARA',
                    'BROKEN_LINKS',
                    'CODE_SECURITY',
                    'CUSTOM',
                  ],
                },
              },
              customDetectorKeys: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 50,
              },
              findingTypes: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 50,
              },
              findingTypeRegex: {
                type: 'array',
                items: { type: 'string', maxLength: 500 },
                maxItems: 10,
              },
              findingValueRegex: {
                type: 'array',
                items: { type: 'string', maxLength: 500 },
                maxItems: 10,
              },
            },
          },
        },
      },
    },
    memoryWrites: { type: 'array', maxItems: 15, items: memoryWriteSchema },
  },
};
