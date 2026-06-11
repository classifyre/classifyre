import { runPipeline, stepOutput } from './agent-runtime';
import type { AgentAuditService } from './audit/agent-audit.service';
import type { AgentContext, AgentStep } from './autopilot.types';
import { validateAgainstSchema } from '../ai/schema-validate';
import { inquiryDecisionSchema } from './schemas/inquiry-decision.schema';
import { caseDecisionSchema } from './schemas/case-decision.schema';

function makeCtx(
  stepState: Record<string, unknown> | null = null,
): AgentContext {
  return {
    run: { id: 'run-1', stepState } as never,
    settings: {} as never,
    sourceId: 's1',
    sourceName: 'Source',
    runnerId: 'r1',
    manual: false,
    instruction: null,
    state: {},
  };
}

describe('agent-runtime', () => {
  const saveStep = jest.fn();
  const audit = { saveStep } as unknown as AgentAuditService;

  beforeEach(() => jest.clearAllMocks());

  it('runs steps in order and persists each output', async () => {
    const ctx = makeCtx();
    const steps: AgentStep[] = [
      { name: 'a', execute: jest.fn().mockResolvedValue({ x: 1 }) },
      {
        name: 'b',
        execute: jest.fn((c) =>
          Promise.resolve({ y: stepOutput<{ x: number }>(c, 'a').x + 1 }),
        ),
      },
    ];
    await runPipeline(ctx, steps, audit);
    expect(stepOutput(ctx, 'b')).toEqual({ y: 2 });
    expect(saveStep).toHaveBeenCalledTimes(2);
  });

  it('resumes from persisted stepState without re-running completed steps', async () => {
    const llmStep = jest.fn().mockResolvedValue({ decisions: [] });
    const ctx = makeCtx({
      gather: { groups: [] },
      decide: { decisions: ['cached'] },
    });
    const apply = jest.fn((c: AgentContext) =>
      Promise.resolve(stepOutput(c, 'decide')),
    );
    await runPipeline(
      ctx,
      [
        { name: 'gather', execute: jest.fn() },
        { name: 'decide', execute: llmStep },
        { name: 'apply', execute: apply },
      ],
      audit,
    );
    // The expensive LLM step must NOT be re-executed on resume.
    expect(llmStep).not.toHaveBeenCalled();
    expect(stepOutput(ctx, 'apply')).toEqual({ decisions: ['cached'] });
  });

  it('stepOutput throws on missing step (ordering bug guard)', () => {
    expect(() => stepOutput(makeCtx(), 'nope')).toThrow(/missing/);
  });
});

describe('decision schemas', () => {
  it('accepts a valid inquiry decision payload', () => {
    expect(() =>
      validateAgainstSchema(
        {
          decisions: [
            {
              action: 'CREATE_INQUIRY',
              rationale: 'A coherent new topic with strong recurring findings.',
              inquiry: { title: 'Leaked AWS keys', detectorTypes: ['SECRETS'] },
            },
          ],
          memoryWrites: [
            {
              kind: 'GLOSSARY',
              key: 'aws-key',
              content: 'AKIA-prefixed access keys.',
            },
          ],
        },
        inquiryDecisionSchema,
      ),
    ).not.toThrow();
  });

  it('rejects an empty decisions list — doing nothing still needs a NO_ACTION rationale', () => {
    expect(() =>
      validateAgainstSchema(
        { decisions: [], memoryWrites: [] },
        inquiryDecisionSchema,
      ),
    ).toThrow();
  });

  it('rejects decisions without a rationale', () => {
    expect(() =>
      validateAgainstSchema(
        { decisions: [{ action: 'NO_ACTION' }], memoryWrites: [] },
        inquiryDecisionSchema,
      ),
    ).toThrow();
  });

  it('accepts a valid case decision with typed operations', () => {
    expect(() =>
      validateAgainstSchema(
        {
          decisions: [
            {
              action: 'UPDATE_CASE',
              rationale: 'New matches strengthen the running hypothesis.',
              caseId: 'c1',
              operations: [
                {
                  op: 'ADD_HYPOTHESIS',
                  rationale: 'The keys probably share one origin pipeline.',
                  title: 'Single origin',
                  confidence: 0.6,
                },
              ],
            },
          ],
          memoryWrites: [],
        },
        caseDecisionSchema,
      ),
    ).not.toThrow();
  });

  it('rejects unknown operation kinds', () => {
    expect(() =>
      validateAgainstSchema(
        {
          decisions: [
            {
              action: 'UPDATE_CASE',
              rationale: 'New matches strengthen the running hypothesis.',
              caseId: 'c1',
              operations: [
                {
                  op: 'DROP_DATABASE',
                  rationale: 'This should never validate, obviously.',
                },
              ],
            },
          ],
          memoryWrites: [],
        },
        caseDecisionSchema,
      ),
    ).toThrow();
  });
});
