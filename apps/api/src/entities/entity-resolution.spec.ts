import {
  normalizeValue,
  phoneticFingerprint,
  valueHash,
} from '../correlation/value-normalizer';
import { foldKey } from './entity-labels';
import {
  scoreCandidates,
  type BlockingValue,
  type IndexedValue,
} from './entity-resolution.service';

const indexed = (label: string, raw: string): IndexedValue => {
  const normalized = normalizeValue(label, raw)!;
  return {
    valueHash: valueHash(label, normalized),
    label,
    normalizedValue: normalized,
    phoneticHash: phoneticFingerprint(label, normalized),
  };
};

const alias = (termId: string, label: string, raw: string): BlockingValue => {
  const normalized = normalizeValue(label, raw)!;
  return {
    termId,
    label,
    normalizedValue: normalized,
    phoneticHash: phoneticFingerprint(label, normalized),
    foldKey: foldKey(normalized),
  };
};

/**
 * Candidate generation (G5 R4). A candidate is only ever a proposal: these
 * pin what gets proposed, and — as important — what does not.
 */
describe('scoreCandidates', () => {
  it('proposes a spelling that differs only in punctuation', () => {
    // The PRD's own acceptance case. The phonetic fingerprints differ
    // ("g m b h" is four tokens), so it is the fold key that finds it.
    const out = scoreCandidates(
      indexed('organization', 'Acme Holding G.m.b.H.'),
      [alias('acme', 'organization', 'ACME Holding GmbH')],
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ termId: 'acme', method: 'FUZZY' });
    expect(out[0].score).toBeGreaterThanOrEqual(0.97);
  });

  it('proposes a name that sounds the same and is nearly the same', () => {
    const out = scoreCandidates(indexed('person', 'Jon Smith'), [
      alias('john', 'person', 'John Smith'),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ termId: 'john', method: 'PHONETIC' });
    expect(out[0].score).toBeGreaterThanOrEqual(0.92);
  });

  it('does not propose a phonetic twin that is spelled too differently', () => {
    // Same DoubleMetaphone codes, well under the 0.92 threshold.
    const value = indexed('person', 'Jane Smyth');
    const blocking = alias('john', 'person', 'Juan Zmit');
    blocking.phoneticHash = value.phoneticHash;

    expect(scoreCandidates(value, [blocking])).toEqual([]);
  });

  it('never proposes a person’s name for an organisation', () => {
    const out = scoreCandidates(indexed('person', 'Jon Smith'), [
      alias('org', 'organization', 'John Smith'),
    ]);

    expect(out).toEqual([]);
  });

  it('is not a candidate when the value is the alias itself', () => {
    // An identical value is an exact mention through the join, not a proposal.
    const out = scoreCandidates(indexed('person', 'John Smith'), [
      alias('john', 'person', 'john smith'),
    ]);

    expect(out).toEqual([]);
  });

  it('proposes at most three entities for one value, best first', () => {
    const value = indexed('person', 'Jon Smith');
    const blocking = ['a', 'b', 'c', 'd'].map((id, i) => {
      const row = alias(id, 'person', `John Smith${'e'.repeat(i)}`);
      row.phoneticHash = value.phoneticHash;
      return row;
    });

    const out = scoreCandidates(value, blocking);

    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.map((c) => c.score)).toEqual(
      [...out.map((c) => c.score)].sort((x, y) => y - x),
    );
  });

  it('ignores values too short to mean anything', () => {
    const value = indexed('organization', 'AG');
    const blocking = alias('ag', 'organization', 'A.G.');
    blocking.phoneticHash = value.phoneticHash;

    expect(scoreCandidates(value, [blocking])).toEqual([]);
  });
});
