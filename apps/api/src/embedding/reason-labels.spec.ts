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

  it('passes through rows written before the change, untouched', () => {
    // There is no backfill, so a corpus scored by an older version has to keep
    // reading exactly as it did.
    const legacy = {
      code: 'semantic_support',
      label: 'Consistent with its semantic neighbours',
      impact: 'neutral',
    };
    expect(renderReasons([legacy])).toEqual([legacy]);
  });

  it('keeps the impact the evidence floor reads', () => {
    // The floor calls a finding "provably weak" when nothing has impact 'up'.
    // If impact stopped resolving, it would stand agents down on good evidence.
    const rendered = renderReasons([
      { c: 'readable_context' },
      { c: 'ocr_fragment' },
      { c: 'severity_separate', s: 'info' },
    ]);
    expect(rendered.map((r) => r.impact)).toEqual(['up', 'down', 'neutral']);
    expect(impactOf('unique_evidence')).toBe('up');
  });

  it('survives anything that is not a reason', () => {
    expect(renderReasons(null)).toEqual([]);
    expect(renderReasons('nonsense')).toEqual([]);
    expect(renderReasons([null, 42, {}, { c: 'context' }])).toEqual([
      {
        code: 'context',
        label: 'Substantial surrounding context',
        impact: 'up',
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
