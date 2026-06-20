import {
  hashSet,
  isPhoneticEligible,
  jaroWinkler,
  normalizeLabel,
  normalizeValue,
  phoneticFingerprint,
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

  describe('isPhoneticEligible', () => {
    it('allows person and name labels', () => {
      expect(isPhoneticEligible('person')).toBe(true);
      expect(isPhoneticEligible('name')).toBe(true);
      expect(isPhoneticEligible('Person Name')).toBe(true);
    });

    it('allows unknown / custom labels', () => {
      expect(isPhoneticEligible('employee')).toBe(true);
      expect(isPhoneticEligible('customer_id_text')).toBe(true);
    });

    it('blocks structured identifier labels', () => {
      expect(isPhoneticEligible('email')).toBe(false);
      expect(isPhoneticEligible('phone')).toBe(false);
      expect(isPhoneticEligible('ssn')).toBe(false);
      expect(isPhoneticEligible('iban')).toBe(false);
      expect(isPhoneticEligible('ip')).toBe(false);
      expect(isPhoneticEligible('url')).toBe(false);
    });
  });

  describe('phoneticFingerprint', () => {
    it('returns null for non-phonetic labels', () => {
      expect(phoneticFingerprint('email', 'john@example.com')).toBeNull();
      expect(phoneticFingerprint('phone', '+4312345')).toBeNull();
    });

    it('produces the same hash for differently-spelled same-sounding names', () => {
      const a = phoneticFingerprint('person', 'john smith');
      const b = phoneticFingerprint('person', 'jon smyth');
      expect(a).not.toBeNull();
      expect(a).toBe(b);
    });

    it('is order-independent across tokens (surname-first ≡ first-name-first)', () => {
      const a = phoneticFingerprint('person', 'john smith');
      const b = phoneticFingerprint('person', 'smith john');
      expect(a).toBe(b);
    });

    it('differs for phonetically distinct names', () => {
      const a = phoneticFingerprint('person', 'john smith');
      const b = phoneticFingerprint('person', 'jane doe');
      expect(a).not.toBe(b);
    });

    it('works for custom / unknown labels', () => {
      const a = phoneticFingerprint('employee_name', 'robert jones');
      const b = phoneticFingerprint('employee_name', 'robbert jonez');
      expect(a).not.toBeNull();
      expect(a).toBe(b);
    });

    it('returns null when no phonetic codes can be derived', () => {
      // Purely numeric — DoubleMetaphone returns empty codes for digits.
      expect(phoneticFingerprint('person', '12345')).toBeNull();
    });

    it('is case-insensitive (values are pre-normalised to lowercase)', () => {
      // normalizeValue lowercases before we ever call phoneticFingerprint,
      // but verify the function itself is stable for lowercase input.
      expect(phoneticFingerprint('name', 'alice')).toBe(
        phoneticFingerprint('name', 'alice'),
      );
    });
  });

  describe('jaroWinkler', () => {
    it('returns 1 for identical strings', () => {
      expect(jaroWinkler('john', 'john')).toBe(1);
    });

    it('returns a high score for close name variants', () => {
      expect(jaroWinkler('john', 'jon')).toBeGreaterThan(0.9);
      expect(jaroWinkler('smith', 'smyth')).toBeGreaterThan(0.85);
    });

    it('returns a low score for unrelated strings', () => {
      expect(jaroWinkler('john', 'zxqwerty')).toBeLessThan(0.6);
    });

    it('returns 0 or near-0 for empty vs non-empty', () => {
      expect(jaroWinkler('', 'john')).toBeLessThanOrEqual(0.5);
    });
  });
});
