import {
  hashSet,
  normalizeLabel,
  normalizeValue,
  valueHash,
  weightForLabel,
} from './value-normalizer';

describe('value-normalizer', () => {
  describe('normalizeLabel', () => {
    it('lowercases and collapses non-alnum to underscore', () => {
      expect(normalizeLabel('Credit Card')).toBe('credit_card');
      expect(normalizeLabel('  EMAIL  ')).toBe('email');
      expect(normalizeLabel('Customer-ID #')).toBe('customer_id');
    });
  });

  describe('weightForLabel', () => {
    it('uses the configured weight for known identifier labels', () => {
      expect(weightForLabel('email')).toBe(5);
      expect(weightForLabel('Phone')).toBe(4);
      expect(weightForLabel('credit card')).toBe(6);
    });

    it('defaults to 1 for unknown/custom labels (label-agnostic)', () => {
      expect(weightForLabel('customer_id')).toBe(1);
      expect(weightForLabel('sentiment')).toBe(1);
    });
  });

  describe('normalizeValue', () => {
    it('lowercases and trims emails', () => {
      expect(normalizeValue('email', '  John@Example.COM ')).toBe(
        'john@example.com',
      );
    });

    it('keeps only digits (and a leading +) for phones', () => {
      expect(normalizeValue('phone', '+43 (1) 234-567')).toBe('+431234567');
      expect(normalizeValue('phone', '01 234 567')).toBe('01234567');
    });

    it('casefolds and collapses whitespace for person names', () => {
      expect(normalizeValue('person', '  John   Doe ')).toBe('john doe');
    });

    it('generically trims + collapses unknown labels', () => {
      expect(normalizeValue('customer_id', '  AB  12 ')).toBe('ab 12');
    });

    it('returns null for empty or oversized values', () => {
      expect(normalizeValue('email', '   ')).toBeNull();
      expect(normalizeValue('generic', 'x'.repeat(1000))).toBeNull();
    });

    it('produces equal hashes for values that normalize the same', () => {
      const a = normalizeValue('email', 'A@B.com')!;
      const b = normalizeValue('email', 'a@b.COM')!;
      expect(valueHash('email', a)).toBe(valueHash('email', b));
    });

    it('produces different hashes across labels for the same string', () => {
      expect(valueHash('email', 'x')).not.toBe(valueHash('phone', 'x'));
    });
  });

  describe('hashSet', () => {
    it('is order-independent and dedupes', () => {
      expect(hashSet(['a', 'b', 'c'])).toBe(hashSet(['c', 'a', 'b', 'a']));
    });

    it('differs for different sets', () => {
      expect(hashSet(['a', 'b'])).not.toBe(hashSet(['a', 'c']));
    });
  });
});
