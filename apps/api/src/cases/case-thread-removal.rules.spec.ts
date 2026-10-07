import {
  planThreadRemoval,
  type RemovalEvidence,
  type RemovalFinding,
  type RemovalLink,
} from './case-thread-removal.rules';

const f = (id: string, evidenceId: string, note: string | null = null) =>
  ({ id, evidenceId, note }) satisfies RemovalFinding;
const e = (id: string, findingIds: string[], note: string | null = null) =>
  ({ id, findingIds, note }) satisfies RemovalEvidence;
const finding = (id: string): RemovalLink => ({
  targetType: 'finding',
  targetId: id,
});
const asset = (id: string): RemovalLink => ({
  targetType: 'evidence',
  targetId: id,
});

describe('planThreadRemoval', () => {
  it('takes a linked finding out, and its asset when nothing else is left on it', () => {
    const plan = planThreadRemoval({
      own: [finding('f1')],
      others: [],
      evidence: [e('e1', ['f1'])],
      findings: [f('f1', 'e1')],
    });
    expect([...plan.findingIds]).toEqual(['f1']);
    expect([...plan.evidenceIds]).toEqual(['e1']);
    expect(plan).toMatchObject({
      linkedFindings: 1,
      linkedAssets: 1,
      keptShared: 0,
      keptNoted: 0,
    });
  });

  it('keeps an asset that still holds findings the hypothesis did not touch', () => {
    const plan = planThreadRemoval({
      own: [finding('f1')],
      others: [],
      evidence: [e('e1', ['f1', 'f2'])],
      findings: [f('f1', 'e1'), f('f2', 'e1')],
    });
    expect([...plan.findingIds]).toEqual(['f1']);
    expect(plan.evidenceIds.size).toBe(0);
  });

  it('a link to an asset speaks for all of its findings', () => {
    const plan = planThreadRemoval({
      own: [asset('e1')],
      others: [],
      evidence: [e('e1', ['f1', 'f2'])],
      findings: [f('f1', 'e1'), f('f2', 'e1')],
    });
    expect([...plan.findingIds].sort()).toEqual(['f1', 'f2']);
    expect([...plan.evidenceIds]).toEqual(['e1']);
    expect(plan.linkedFindings).toBe(2);
  });

  it('removes an asset linked as a whole that holds no findings', () => {
    const plan = planThreadRemoval({
      own: [asset('e1')],
      others: [],
      evidence: [e('e1', [])],
      findings: [],
    });
    expect([...plan.evidenceIds]).toEqual(['e1']);
  });

  it('keeps what another hypothesis is linked to', () => {
    const plan = planThreadRemoval({
      own: [finding('f1'), finding('f2')],
      others: [finding('f2')],
      evidence: [e('e1', ['f1']), e('e2', ['f2'])],
      findings: [f('f1', 'e1'), f('f2', 'e2')],
    });
    expect([...plan.findingIds]).toEqual(['f1']);
    expect([...plan.evidenceIds]).toEqual(['e1']);
    expect(plan.keptShared).toBe(1);
  });

  it('keeps findings of an asset another hypothesis is linked to as a whole', () => {
    const plan = planThreadRemoval({
      own: [finding('f1')],
      others: [asset('e1')],
      evidence: [e('e1', ['f1'])],
      findings: [f('f1', 'e1')],
    });
    expect(plan.findingIds.size).toBe(0);
    expect(plan.evidenceIds.size).toBe(0);
    expect(plan.keptShared).toBe(1);
  });

  it('keeps a finding with a note, and then its asset too', () => {
    const plan = planThreadRemoval({
      own: [finding('f1')],
      others: [],
      evidence: [e('e1', ['f1'])],
      findings: [f('f1', 'e1', 'Called the registrar')],
    });
    expect(plan.findingIds.size).toBe(0);
    expect(plan.evidenceIds.size).toBe(0);
    expect(plan.keptNoted).toBe(1);
  });

  it('keeps an asset with a note even when its findings leave', () => {
    const plan = planThreadRemoval({
      own: [finding('f1')],
      others: [],
      evidence: [e('e1', ['f1'], 'Site visit planned')],
      findings: [f('f1', 'e1')],
    });
    expect([...plan.findingIds]).toEqual(['f1']);
    expect(plan.evidenceIds.size).toBe(0);
    expect(plan.keptNoted).toBe(1);
  });

  it('treats a whitespace-only note as no note', () => {
    const plan = planThreadRemoval({
      own: [finding('f1')],
      others: [],
      evidence: [e('e1', ['f1'], '  ')],
      findings: [f('f1', 'e1', ' \n')],
    });
    expect([...plan.findingIds]).toEqual(['f1']);
    expect([...plan.evidenceIds]).toEqual(['e1']);
  });

  it('ignores links to rows the case no longer holds', () => {
    const plan = planThreadRemoval({
      own: [finding('gone'), asset('also-gone')],
      others: [],
      evidence: [],
      findings: [],
    });
    expect(plan.findingIds.size).toBe(0);
    expect(plan.evidenceIds.size).toBe(0);
    expect(plan.linkedFindings).toBe(0);
  });
});
