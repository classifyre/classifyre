import type { JsonSchema } from '../../ai';

/**
 * Output contract of the dream (memory consolidation) agent. Only memory
 * maintenance — never inquiry/case mutations. Every operation needs a
 * rationale; the run summary becomes the dream's "important notes".
 */
export const dreamConsolidationSchema: JsonSchema = {
  type: 'object',
  required: ['deletions', 'rewrites', 'creations', 'summary'],
  additionalProperties: false,
  properties: {
    deletions: {
      type: 'array',
      maxItems: 30,
      default: [],
      items: {
        type: 'object',
        required: ['id', 'rationale'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          rationale: { type: 'string', minLength: 10, maxLength: 500 },
        },
      },
    },
    rewrites: {
      type: 'array',
      maxItems: 30,
      default: [],
      items: {
        type: 'object',
        required: ['id', 'content', 'rationale'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          content: { type: 'string', minLength: 5, maxLength: 2000 },
          tags: {
            type: 'array',
            items: { type: 'string', maxLength: 60 },
            maxItems: 10,
          },
          rationale: { type: 'string', minLength: 10, maxLength: 500 },
        },
      },
    },
    creations: {
      type: 'array',
      maxItems: 10,
      default: [],
      items: {
        type: 'object',
        required: ['kind', 'key', 'content', 'rationale'],
        additionalProperties: false,
        properties: {
          kind: {
            enum: ['GLOSSARY', 'DECISION_PRECEDENT', 'TOPIC_INQUIRY_MAP'],
          },
          key: { type: 'string', minLength: 2, maxLength: 200 },
          content: { type: 'string', minLength: 5, maxLength: 2000 },
          tags: {
            type: 'array',
            items: { type: 'string', maxLength: 60 },
            maxItems: 10,
          },
          rationale: { type: 'string', minLength: 10, maxLength: 500 },
        },
      },
    },
    summary: { type: 'string', minLength: 20, maxLength: 2000 },
  },
};

export interface DreamConsolidationOutput {
  deletions: Array<{ id: string; rationale: string }>;
  rewrites: Array<{
    id: string;
    content: string;
    tags?: string[];
    rationale: string;
  }>;
  creations: Array<{
    kind: 'GLOSSARY' | 'DECISION_PRECEDENT' | 'TOPIC_INQUIRY_MAP';
    key: string;
    content: string;
    tags?: string[];
    rationale: string;
  }>;
  summary: string;
}

const EXAMPLE: DreamConsolidationOutput = {
  deletions: [
    {
      id: '00000000-0000-0000-0000-000000000000',
      rationale: 'One-off note about a single scan; no lasting value.',
    },
  ],
  rewrites: [
    {
      id: '00000000-0000-0000-0000-000000000001',
      content:
        'PERSON findings in HR sources are routine; only escalate when paired with credentials.',
      rationale:
        'Two verbose entries said the same thing; condensed into one lesson.',
    },
  ],
  creations: [],
  summary:
    'Merged duplicate PII lessons, removed three one-off notes, kept all topic mappings for live inquiries.',
};

/** Repair hook for dream output: tolerate key synonyms and missing arrays. */
export function repairDreamOutput(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const root = value as Record<string, unknown>;
  for (const [from, to] of [
    ['delete', 'deletions'],
    ['deleted', 'deletions'],
    ['remove', 'deletions'],
    ['rewrite', 'rewrites'],
    ['updates', 'rewrites'],
    ['create', 'creations'],
    ['notes', 'summary'],
  ] as const) {
    if (root[to] === undefined && root[from] !== undefined) {
      root[to] = root[from];
      delete root[from];
    }
  }
  if (typeof root.summary !== 'string' || root.summary.length < 20) {
    root.summary =
      `(model omitted summary) ${typeof root.summary === 'string' ? root.summary : ''}`.padEnd(
        20,
        '.',
      );
  }
  return root;
}

export const DREAM_OUTPUT_EXAMPLE = EXAMPLE;
