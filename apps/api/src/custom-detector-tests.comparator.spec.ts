/**
 * Comparator unit tests for the unified GLiNER2 pipeline output format.
 *
 * The pipeline always produces:
 *   {
 *     entities: { label: [{ value, confidence, start, end }] },
 *     classification: { task: { label, confidence } },
 *     metadata: { model, latency_ms, timestamp }
 *   }
 *
 * Expected outcome in test scenarios mirrors this format.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Comparator logic — mirrors CustomDetectorTestsService.compareOutcome()
// ─────────────────────────────────────────────────────────────────────────────

type PipelineEntitySpan = { value?: string; confidence?: number; start?: number; end?: number };
type PipelineClassificationOutcome = { label?: string; confidence?: number };
type PipelineResult = {
  entities: Record<string, PipelineEntitySpan[]>;
  classification: Record<string, PipelineClassificationOutcome>;
  metadata?: Record<string, unknown>;
};

type ExpectedEntityMatch = { value?: string; confidence?: number };
type ExpectedClassificationMatch = { label?: string; confidence?: number };
type ExpectedOutcome = {
  entities?: Record<string, ExpectedEntityMatch[]>;
  classification?: Record<string, ExpectedClassificationMatch>;
};

function comparePipelineOutcome(
  expected: ExpectedOutcome,
  actual: PipelineResult,
): 'PASS' | 'FAIL' {
  // Check entities
  for (const [label, expectedSpans] of Object.entries(expected.entities ?? {})) {
    const actualSpans = actual.entities[label] ?? [];
    for (const expectedSpan of expectedSpans) {
      const minConf = typeof expectedSpan.confidence === 'number' ? expectedSpan.confidence : 0;
      const hit = actualSpans.some((span) => {
        const confOk =
          typeof span.confidence === 'number' ? span.confidence >= minConf : true;
        const valueOk = expectedSpan.value
          ? (span.value ?? '').toLowerCase().includes(expectedSpan.value.toLowerCase())
          : true;
        return confOk && valueOk;
      });
      if (!hit) return 'FAIL';
    }
  }

  // Check classification
  for (const [task, expectedOutcome] of Object.entries(expected.classification ?? {})) {
    const actualOutcome = actual.classification[task];
    if (!actualOutcome) return 'FAIL';
    if (expectedOutcome.label && actualOutcome.label !== expectedOutcome.label) {
      return 'FAIL';
    }
    if (
      typeof expectedOutcome.confidence === 'number' &&
      typeof actualOutcome.confidence === 'number' &&
      actualOutcome.confidence < expectedOutcome.confidence
    ) {
      return 'FAIL';
    }
  }

  return 'PASS';
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity extraction comparisons
// ─────────────────────────────────────────────────────────────────────────────

describe('Pipeline entity comparator', () => {
  const actual: PipelineResult = {
    entities: {
      order_id: [{ value: 'ORD-123', confidence: 0.95, start: 10, end: 17 }],
      amount: [{ value: '50€', confidence: 0.88, start: 25, end: 28 }],
    },
    classification: {},
    metadata: { model: 'fastino/gliner2-base-v1', latency_ms: 32 },
  };

  it('PASS: expected entity label exists with value match', () => {
    const result = comparePipelineOutcome(
      { entities: { order_id: [{ value: 'ORD-123' }] } },
      actual,
    );
    expect(result).toBe('PASS');
  });

  it('PASS: expected entity label exists with confidence threshold', () => {
    const result = comparePipelineOutcome(
      { entities: { order_id: [{ confidence: 0.9 }] } },
      actual,
    );
    expect(result).toBe('PASS');
  });

  it('FAIL: confidence below threshold', () => {
    const result = comparePipelineOutcome(
      { entities: { order_id: [{ confidence: 0.99 }] } },
      actual,
    );
    expect(result).toBe('FAIL');
  });

  it('FAIL: wrong value', () => {
    const result = comparePipelineOutcome(
      { entities: { order_id: [{ value: 'ORD-999' }] } },
      actual,
    );
    expect(result).toBe('FAIL');
  });

  it('FAIL: entity label not in result', () => {
    const result = comparePipelineOutcome(
      { entities: { customer_email: [{}] } },
      actual,
    );
    expect(result).toBe('FAIL');
  });

  it('PASS: empty entities expectation always passes', () => {
    const result = comparePipelineOutcome({ entities: {} }, actual);
    expect(result).toBe('PASS');
  });

  it('PASS: multiple expected entities all found', () => {
    const result = comparePipelineOutcome(
      {
        entities: {
          order_id: [{ value: 'ORD-123' }],
          amount: [{ value: '50€' }],
        },
      },
      actual,
    );
    expect(result).toBe('PASS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Classification comparisons
// ─────────────────────────────────────────────────────────────────────────────

describe('Pipeline classification comparator', () => {
  const actual: PipelineResult = {
    entities: {},
    classification: {
      intent: { label: 'refund', confidence: 0.97 },
      sentiment: { label: 'negative', confidence: 0.82 },
    },
    metadata: {},
  };

  it('PASS: label matches expected', () => {
    const result = comparePipelineOutcome(
      { classification: { intent: { label: 'refund' } } },
      actual,
    );
    expect(result).toBe('PASS');
  });

  it('FAIL: wrong label', () => {
    const result = comparePipelineOutcome(
      { classification: { intent: { label: 'bug' } } },
      actual,
    );
    expect(result).toBe('FAIL');
  });

  it('PASS: confidence above threshold', () => {
    const result = comparePipelineOutcome(
      { classification: { intent: { label: 'refund', confidence: 0.9 } } },
      actual,
    );
    expect(result).toBe('PASS');
  });

  it('FAIL: confidence below threshold', () => {
    const result = comparePipelineOutcome(
      { classification: { intent: { label: 'refund', confidence: 0.99 } } },
      actual,
    );
    expect(result).toBe('FAIL');
  });

  it('FAIL: task not present in actual', () => {
    const result = comparePipelineOutcome(
      { classification: { language: { label: 'de' } } },
      actual,
    );
    expect(result).toBe('FAIL');
  });

  it('PASS: multiple tasks all match', () => {
    const result = comparePipelineOutcome(
      {
        classification: {
          intent: { label: 'refund' },
          sentiment: { label: 'negative' },
        },
      },
      actual,
    );
    expect(result).toBe('PASS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Combined entities + classification
// ─────────────────────────────────────────────────────────────────────────────

describe('Pipeline combined comparator', () => {
  const actual: PipelineResult = {
    entities: {
      order_id: [{ value: 'ORD-456', confidence: 0.91 }],
    },
    classification: {
      intent: { label: 'refund', confidence: 0.95 },
    },
    metadata: {},
  };

  it('PASS: both entities and classification match', () => {
    const result = comparePipelineOutcome(
      {
        entities: { order_id: [{ value: 'ORD-456' }] },
        classification: { intent: { label: 'refund' } },
      },
      actual,
    );
    expect(result).toBe('PASS');
  });

  it('FAIL: entities match but classification does not', () => {
    const result = comparePipelineOutcome(
      {
        entities: { order_id: [{ value: 'ORD-456' }] },
        classification: { intent: { label: 'bug' } },
      },
      actual,
    );
    expect(result).toBe('FAIL');
  });

  it('PASS: no expectations → always passes', () => {
    const result = comparePipelineOutcome({}, actual);
    expect(result).toBe('PASS');
  });
});
