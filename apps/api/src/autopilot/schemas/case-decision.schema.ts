import type { JsonSchema } from '../../ai';
import { MEMORY_WRITES_SCHEMA_FRAGMENT } from './inquiry-decision.schema';

const caseOperationSchema = {
  type: 'object',
  required: ['op', 'rationale'],
  additionalProperties: false,
  properties: {
    op: {
      enum: [
        'ADD_HYPOTHESIS',
        'UPDATE_HYPOTHESIS',
        'ADD_EVIDENCE',
        'ATTACH_FINDINGS',
        'ADD_NOTE',
        'ADD_THREAD_ENTRY',
        'CREATE_EDGE',
        'CHANGE_STATUS',
        'LINK_INQUIRY',
      ],
    },
    rationale: { type: 'string', minLength: 20, maxLength: 2000 },
    threadId: { type: 'string' },
    title: { type: 'string', maxLength: 300 },
    statement: { type: 'string', maxLength: 4000 },
    hypothesisStatus: {
      enum: ['PROPOSED', 'SUPPORTED', 'REFUTED', 'INCONCLUSIVE'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    assetId: { type: 'string' },
    note: { type: 'string', maxLength: 4000 },
    findingIds: { type: 'array', items: { type: 'string' }, maxItems: 100 },
    body: { type: 'string', maxLength: 4000 },
    fromType: { enum: ['asset', 'finding'] },
    fromId: { type: 'string' },
    toType: { enum: ['asset', 'finding'] },
    toId: { type: 'string' },
    relationType: { type: 'string', maxLength: 100 },
    caseStatus: { enum: ['OPEN', 'IN_PROGRESS', 'CLOSED', 'ARCHIVED'] },
    severity: { enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] },
    inquiryIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
  },
} as const;

/**
 * Structured output for the case agent. As with inquiries, an empty cycle is
 * expressed as one NO_ACTION decision with a rationale, never an empty list.
 */
export const caseDecisionSchema: JsonSchema = {
  type: 'object',
  required: ['decisions', 'memoryWrites'],
  additionalProperties: false,
  properties: {
    decisions: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        required: ['action', 'rationale'],
        additionalProperties: false,
        properties: {
          action: { enum: ['CREATE_CASE', 'UPDATE_CASE', 'NO_ACTION'] },
          rationale: { type: 'string', minLength: 20, maxLength: 2000 },
          caseId: { type: 'string' },
          title: { type: 'string', minLength: 3, maxLength: 300 },
          description: { type: 'string', maxLength: 4000 },
          severity: { enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] },
          operations: {
            type: 'array',
            maxItems: 30,
            items: caseOperationSchema,
          },
        },
      },
    },
    memoryWrites: {
      type: 'array',
      maxItems: 15,
      default: [],
      items: MEMORY_WRITES_SCHEMA_FRAGMENT,
    },
  },
};
