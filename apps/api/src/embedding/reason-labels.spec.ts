import { impactOf, renderReasons } from './reason-labels';

/**
 * The contract this file has to keep is that the API response did not change.
 * Reasons stopped being stored as finished sentences to save 250 MB across
 * 577,321 rows, and the sentences now come from a template table — so the
 * thing worth testing is that both the old and the new stored shapes render to
 * exactly what a client used to receive.
 */
describe('renderReasons', () => {
  it('renders a stored code into the sentence it replaced', () => {
    expect(renderReasons([{ c: 'unique_evidence' }])).toEqual([
      {
        code: 'unique_evidence',
        label: 'Unique evidence in this corpus',
        impact: 'up',
      },
    ]);
  });

  it('fills the counts a sentence names', () => {
    expect(renderReasons([{ c: 'duplicate_group', n: 10 }])[0].label).toBe(
      '10 identical findings grouped',
    );
    expect(renderReasons([{ c: 'near_duplicate', n: 3 }])[0].label).toBe(
      '3 near-duplicate findings grouped semantically',
    );
    expect(renderReasons([{ c: 'severity_separate', s: 'low' }])[0].label).toBe(
      'low detector severity (not importance)',
    );
  });

  it('mentions sources only when there is more than one', () => {
    expect(
      renderReasons([{ c: 'cross_document_recurrence', n: 4, n2: 1 }])[0].label,
    ).toBe('Same value found in 4 assets');
    expect(
      renderReasons([{ c: 'cross_document_recurrence', n: 4, n2: 2 }])[0].label,
    ).toBe('Same value found in 4 assets across 2 sources');
  });

  it('names a register-wide group for what it is', () => {
    // Breadth changes the meaning. Below the threshold it is a duplicate;
    // above it, it is a taxonomy value and "56,404 identical findings grouped"
    // is accurate and useless.
    expect(renderReasons([{ c: 'duplicate_group', n: 1999 }])[0].label).toBe(
      '1999 identical findings grouped',
    );
    expect(renderReasons([{ c: 'duplicate_group', n: 56404 }])[0].label).toBe(
      'Register-wide value: 56405 findings carry it',
    );
  });

  it('passes through the sentence of rows written before the change', () => {
    // There is no backfill, so a corpus scored by an older version has to keep
    // reading as it did — but see the next test for the one part that does not
    // pass through.
    const legacy = {
      code: 'semantic_support',
      label: 'Consistent with its semantic neighbours',
      impact: 'neutral',
    };
    expect(renderReasons([legacy])).toEqual([legacy]);
  });

  it('takes impact from the table even when the row carries its own', () => {
    // Impact is a property of the code, so the table is the only place it may
    // come from. Honouring the stored value meant a reclassification reached
    // only the rows recalibration had already rewritten — 206,700 legacy rows
    // still carried `readable_context: 'up'` while that was exactly the impact
    // that had disabled the evidence floor.
    expect(
      renderReasons([
        {
          code: 'readable_context',
          label: 'Readable supporting context',
          impact: 'up',
        },
      ]),
    ).toEqual([
      {
        code: 'readable_context',
        label: 'Readable supporting context',
        impact: 'neutral',
      },
    ]);
  });

  it('reserves impact "up" for codes that make an evidential claim', () => {
    // The guard that would have caught the dead evidence floor. `hasPositiveImpact`
    // treats any 'up' as strength, so a hygiene signal — "the text is readable",
    // "there is surrounding context" — must never carry one: those fire on
    // essentially every finding, and a gate keyed on them can never close.
    expect(impactOf('unique_evidence')).toBe('up');
    expect(impactOf('cross_document_recurrence')).toBe('up');
    expect(impactOf('semantic_outlier')).toBe('up');
    for (const hygiene of ['readable_context', 'context']) {
      expect(impactOf(hygiene)).not.toBe('up');
    }
  });

  it('survives anything that is not a reason', () => {
    expect(renderReasons(null)).toEqual([]);
    expect(renderReasons('nonsense')).toEqual([]);
    expect(renderReasons([null, 42, {}, { c: 'context' }])).toEqual([
      {
        code: 'context',
        label: 'Substantial surrounding context',
        impact: 'neutral',
      },
    ]);
  });

  it('shows an unrecognised code rather than dropping it', () => {
    expect(renderReasons([{ c: 'some_future_signal' }])).toEqual([
      {
        code: 'some_future_signal',
        label: 'some future signal',
        impact: 'neutral',
      },
    ]);
  });
});
