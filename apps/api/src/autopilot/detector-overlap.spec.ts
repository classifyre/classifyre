import {
  coveredByBuiltIn,
  detectorSimilarity,
  extractPatterns,
  DETECTOR_DUPLICATE_OVERLAP,
} from './detector-overlap';

/**
 * The regression corpus is a live instance: ten custom detectors authored in
 * under three hours, seven of them one idea re-approached from a slightly
 * different angle, plus one duplicating a built-in pattern that was enabled on
 * the source at the time.
 */
describe('detector overlap', () => {
  const d = (key: string, patterns: string[] = []) => ({
    key,
    name: key.replace(/_/g, ' '),
    pipelineSchema: {
      type: 'REGEX',
      config: { patterns: patterns.map((p) => ({ pattern: p })) },
    },
  });

  describe('the real duplicate family', () => {
    // Authored four minutes apart, both about intel handling markings.
    it('catches two names for the same idea', () => {
      expect(
        detectorSimilarity(
          d('intel_handling_caveats'),
          d('intel_dissemination_caveats'),
        ),
      ).toBeGreaterThanOrEqual(DETECTOR_DUPLICATE_OVERLAP);
    });

    it('catches identical regexes under different names', () => {
      const a = d('classified_markers', ['\\bSECRET\\b', '\\bCONFIDENTIAL\\b']);
      const b = d('totally_unrelated_name', [
        '\\bSECRET\\b',
        '\\bCONFIDENTIAL\\b',
      ]);

      expect(detectorSimilarity(a, b)).toBe(1);
    });

    it('lets a genuinely different detector through', () => {
      expect(
        detectorSimilarity(
          d('intel_handling_caveats', ['NOFORN']),
          d('bank_account_numbers', ['\\d{8,}']),
        ),
      ).toBeLessThan(DETECTOR_DUPLICATE_OVERLAP);
    });

    // "detector", "markers", "references" identify nothing on their own; if
    // they counted, every detector would look like every other one.
    it('is not fooled by boilerplate words in every name', () => {
      expect(
        detectorSimilarity(
          d('phone_number_detector'),
          d('passport_number_detector'),
        ),
      ).toBeLessThan(DETECTOR_DUPLICATE_OVERLAP);
    });
  });

  describe('built-in coverage', () => {
    // The live case: PII PHONE_NUMBER was enabled on the source, and the agent
    // authored `phone_number_detector` anyway — scanning the corpus twice for
    // the same thing and splitting its findings across two detectors.
    it('refuses a detector duplicating an enabled built-in pattern', () => {
      expect(
        coveredByBuiltIn(d('phone_number_detector'), [
          'IP_ADDRESS',
          'PHONE_NUMBER',
        ]),
      ).toBe('PHONE_NUMBER');
    });

    it('allows it when the operator has that pattern switched off', () => {
      expect(coveredByBuiltIn(d('phone_number_detector'), ['IP_ADDRESS'])).toBe(
        null,
      );
    });

    it('does not block a concept no built-in covers', () => {
      expect(
        coveredByBuiltIn(d('diplomatic_cable_references'), [
          'EMAIL_ADDRESS',
          'PHONE_NUMBER',
        ]),
      ).toBe(null);
    });
  });

  describe('pattern extraction', () => {
    it('finds regexes wherever they are nested', () => {
      const schema = {
        type: 'REGEX',
        config: {
          groups: [{ rules: [{ pattern: 'a+' }, { regex: 'b+' }] }],
        },
      };

      expect(extractPatterns(schema).sort()).toEqual(['a+', 'b+']);
    });

    it('returns nothing for a schema with no patterns', () => {
      expect(extractPatterns({ type: 'GLINER2', labels: ['PERSON'] })).toEqual(
        [],
      );
    });
  });
});
