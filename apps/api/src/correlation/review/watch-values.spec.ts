import { valuePattern, valuesToWatch } from './watch-values';

describe('valuesToWatch', () => {
  it('keeps the values of the strongest labels, not the dates', () => {
    const picked = valuesToWatch([
      { label: 'date_time', value: 'nine days', weight: 1 },
      { label: 'iban_code', value: 'gb53qxhb40221971830264', weight: 6 },
      { label: 'phone_number', value: '02079460588', weight: 4 },
    ]);
    expect(picked.map((p) => p.label)).toEqual(['iban_code', 'phone_number']);
  });

  it('watches nothing when every shared label is weighted 0', () => {
    expect(valuesToWatch([{ label: 'x', value: 'y', weight: 0 }])).toEqual([]);
  });

  it('drops repeats across pairs', () => {
    const v = { label: 'iban_code', value: 'gb53', weight: 6 };
    expect(valuesToWatch([v, { ...v }])).toHaveLength(1);
  });
});

describe('valuePattern', () => {
  it('finds a normalised IBAN as printed, spaced or not, in any case', () => {
    const re = new RegExp(valuePattern('gb53qxhb40221971830264'));
    expect(re.test('Our bank account: GB53QXHB40221971830264.')).toBe(true);
    expect(re.test('GB53 QXHB 4022 1971 8302 64')).toBe(true);
    expect(re.test('GB53QXHB40221971830265')).toBe(false);
  });

  it('finds a normalised phone number as printed', () => {
    const re = new RegExp(valuePattern('02079460588'));
    expect(re.test('telephone 020 7946 0588')).toBe(true);
    expect(re.test('020 7946 0589')).toBe(false);
  });
});
