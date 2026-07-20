/**
 * Comparator unit tests for CustomDetectorTestsService.compareOutcome.
 *
 * The comparator accepts both the flat scenario shapes
 *   {shouldMatch}, {label, minConfidence}, {entities: [{label, text}]}
 * and the nested pipeline-output shape
 *   {classification: {task: {label, confidence}}}, {entities: {label: [{value}]}}.
 * Labels compare case-insensitively with underscores treated as spaces.
 */
import { CustomDetectorTestsService } from './custom-detector-tests.service';

type Outcome = { status: 'PASS' | 'FAIL'; explanation: string | null };

function compare(
  pipelineSchema: Record<string, unknown>,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): Outcome {
  const service = new CustomDetectorTestsService(
    null as never,
    null as never,
    undefined,
  );
  return (
    service as unknown as {
      compareOutcome: (
        s: Record<string, unknown>,
        e: Record<string, unknown>,
        a: Record<string, unknown>,
      ) => Outcome;
    }
  ).compareOutcome(pipelineSchema, expected, actual);
}

const llmSchema = { type: 'LLM' };
const glinerSchema = { type: 'GLINER2' };
const regexSchema = { type: 'REGEX' };

describe('compareOutcome — REGEX shouldMatch', () => {
  it('PASS when shouldMatch and matched agree', () => {
    expect(
      compare(regexSchema, { shouldMatch: true }, { matched: true, findings: [{}] })
        .status,
    ).toBe('PASS');
    expect(
      compare(regexSchema, { shouldMatch: false }, { matched: false, findings: [] })
        .status,
    ).toBe('PASS');
  });

  it('FAIL includes an expected-vs-actual explanation', () => {
    const result = compare(
      regexSchema,
      { shouldMatch: true },
      { matched: false, findings: [] },
    );
    expect(result.status).toBe('FAIL');
    expect(result.explanation).toContain('Expected the pattern to match');
  });
});

describe('compareOutcome — flat classifier/LLM shape', () => {
  const finding = {
    finding_type: 'class:market_gaming_instruction',
    confidence: 0.99,
    metadata: { label_name: 'Market gaming instruction' },
  };

  it('PASS with the underscored label id', () => {
    const result = compare(
      llmSchema,
      { label: 'market_gaming_instruction', minConfidence: 0.5 },
      { findings: [finding] },
    );
    expect(result.status).toBe('PASS');
  });

  it('PASS with the human-readable space-separated label', () => {
    const result = compare(
      llmSchema,
      { label: 'Market gaming instruction' },
      { findings: [finding] },
    );
    expect(result.status).toBe('PASS');
  });

  it('FAIL below minConfidence, with explanation naming the threshold', () => {
    const result = compare(
      llmSchema,
      { label: 'market_gaming_instruction', minConfidence: 0.999 },
      { findings: [finding] },
    );
    expect(result.status).toBe('FAIL');
    expect(result.explanation).toContain('confidence >= 0.999');
    expect(result.explanation).toContain('class:market_gaming_instruction');
  });

  it('FAIL with no findings explains that none were produced', () => {
    const result = compare(
      llmSchema,
      { label: 'market_gaming_instruction' },
      { findings: [] },
    );
    expect(result.status).toBe('FAIL');
    expect(result.explanation).toContain('no findings were produced');
  });
});

describe('compareOutcome — nested pipeline-output shape', () => {
  it('PASS: nested classification maps onto label/minConfidence', () => {
    const result = compare(
      llmSchema,
      { classification: { conduct: { label: 'market_gaming_instruction', confidence: 0.5 } } },
      {
        findings: [
          { finding_type: 'class:market_gaming_instruction', confidence: 0.99 },
        ],
      },
    );
    expect(result.status).toBe('PASS');
  });

  it('FAIL: nested classification confidence acts as a minimum', () => {
    const result = compare(
      llmSchema,
      { classification: { conduct: { label: 'market_gaming_instruction', confidence: 0.999 } } },
      {
        findings: [
          { finding_type: 'class:market_gaming_instruction', confidence: 0.99 },
        ],
      },
    );
    expect(result.status).toBe('FAIL');
  });

  it('PASS: nested entities map onto the flat entities list', () => {
    const result = compare(
      glinerSchema,
      { entities: { PersonName: [{ value: 'Ostap' }] } },
      {
        findings: [
          { finding_type: 'entity:PersonName', matched_content: 'Ostap Bender' },
        ],
      },
    );
    expect(result.status).toBe('PASS');
  });

  it('FAIL: nested entities missing from findings lists what was expected', () => {
    const result = compare(
      glinerSchema,
      { entities: { PersonName: [{ value: 'Ostap' }] } },
      { findings: [{ finding_type: 'entity:Organization', matched_content: 'FERC' }] },
    );
    expect(result.status).toBe('FAIL');
    expect(result.explanation).toContain('PersonName');
  });
});

describe('compareOutcome — flat entities shape', () => {
  it('PASS on label + text substring match, case-insensitive', () => {
    const result = compare(
      glinerSchema,
      { entities: [{ label: 'person_name', text: 'ostap' }] },
      {
        findings: [
          { finding_type: 'entity:Person_Name', matched_content: 'Ostap Bender' },
        ],
      },
    );
    expect(result.status).toBe('PASS');
  });
});

describe('compareOutcome — unrecognized shape', () => {
  it('FAIL with guidance instead of a silent FAIL', () => {
    const result = compare(llmSchema, { something: 'else' }, { findings: [] });
    expect(result.status).toBe('FAIL');
    expect(result.explanation).toContain('Unrecognized expected_outcome shape');
  });
});
