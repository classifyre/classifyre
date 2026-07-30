import { createIdRemapper, isUuid, uuidv5 } from './id-remap';

const SEED = '8f14e45f-ce0a-4e0a-9c6b-2b8d3f7a1c22';

describe('uuidv5', () => {
  it('matches RFC 4122 for the published DNS namespace vector', () => {
    // The canonical test vector, so a hand-written implementation cannot drift
    // from what every other uuid library produces.
    expect(
      uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
    ).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('sets the version and variant bits', () => {
    const id = uuidv5('anything', SEED);
    expect(id[14]).toBe('5');
    expect('89ab').toContain(id[19]);
    expect(isUuid(id)).toBe(true);
  });
});

describe('createIdRemapper', () => {
  const remap = createIdRemapper(SEED);

  it('maps a uuid to a different, stable uuid', () => {
    const original = '11111111-1111-4111-8111-111111111111';
    const mapped = remap(original);

    expect(mapped).not.toBe(original);
    expect(isUuid(mapped)).toBe(true);
    expect(remap(original)).toBe(mapped);
  });

  it('maps distinct ids to distinct results', () => {
    const ids = Array.from(
      { length: 500 },
      (_, i) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
    );
    const mapped = ids.map((id) => remap(id));
    expect(new Set(mapped).size).toBe(ids.length);
  });

  it('survives more ids than the internal cache holds', () => {
    // The cache is a speed-up, not state: eviction must not change results.
    const big = createIdRemapper(SEED);
    const first = '55555555-5555-4555-8555-555555555555';
    const before = big(first);
    for (let i = 0; i < 11_000; i += 1) {
      big(`66666666-6666-4666-8666-${String(i).padStart(12, '0')}`);
    }
    expect(big(first)).toBe(before);
  });

  it('leaves natural keys untouched', () => {
    // Content hashes, enum keys and singleton integer ids identify a thing by
    // what it is; rewriting them would break the correspondence they encode.
    const hash = 'a'.repeat(64);
    expect(remap(hash)).toBe(hash);
    expect(remap('INQUIRY')).toBe('INQUIRY');
    expect(remap(1)).toBe(1);
    expect(remap(null)).toBeNull();
    expect(remap(undefined)).toBeUndefined();
    expect(remap(true)).toBe(true);
    expect(remap('not-a-uuid')).toBe('not-a-uuid');
  });

  it('gives different seeds different mappings', () => {
    const other = createIdRemapper('99999999-9999-4999-8999-999999999999');
    const id = '77777777-7777-4777-8777-777777777777';
    expect(remap(id)).not.toBe(other(id));
  });

  it('refuses a seed that is not a uuid', () => {
    expect(() => createIdRemapper('job-1')).toThrow(/must be a UUID/);
  });
});
