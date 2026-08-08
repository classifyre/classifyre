import { assertDetectionSurvives } from './config.toolset';

/**
 * The config agent can only ever reduce.
 *
 * Every decision it makes is a subtraction — "this pattern is noise", "this
 * detector is a prose-noise generator", "raise the confidence threshold" — and
 * each one in isolation is defensible. Nothing pushed back, so on a live
 * instance the ratchet ran to its end across two days:
 *
 *   disable DATE_TIME, NRP           "pure noise"
 *   disable CRYPTO, CREDIT_CARD, …
 *   raise PII confidence 0.8 → 0.9
 *   disable EMAIL_ADDRESS, PERSON, LOCATION, URL
 *   disable SECRETS
 *   disable the noisiest custom detector
 *
 * All five built-in detectors ended up disabled. The source then swept its
 * entire 9600-object corpus every three hours producing zero findings, and with
 * no findings there was nothing for any inquiry, case or glossary term to be
 * built from. A source that detects nothing is not quiet, it is blind.
 */
describe('detection floor', () => {
  const builtIn = (type: string, enabled: boolean) => ({ type, enabled });

  it('refuses a config that disables the last detector', () => {
    expect(() =>
      assertDetectionSurvives({
        detectors: [
          builtIn('SECRETS', false),
          builtIn('PII', false),
          builtIn('YARA', false),
        ],
        custom_detectors: [],
      }),
    ).toThrow(/no detection at all/);
  });

  it('tells the agent what to do instead of switching the last one off', () => {
    expect(() =>
      assertDetectionSurvives({ detectors: [builtIn('PII', false)] }),
    ).toThrow(/narrow its patterns or raise its confidence/);
  });

  it('allows disabling one detector while another stays on', () => {
    expect(() =>
      assertDetectionSurvives({
        detectors: [builtIn('SECRETS', false), builtIn('PII', true)],
        custom_detectors: [],
      }),
    ).not.toThrow();
  });

  // The floor is about detection surviving, not about which kind of detector
  // provides it: a source carried entirely by authored detectors is fine.
  it('accepts custom detectors as the surviving detection', () => {
    expect(() =>
      assertDetectionSurvives({
        detectors: [builtIn('PII', false)],
        custom_detectors: ['detector-1'],
      }),
    ).not.toThrow();
  });

  // `enabled` is optional in the source schemas; absent means on.
  it('treats a detector with no explicit enabled flag as enabled', () => {
    expect(() =>
      assertDetectionSurvives({ detectors: [{ type: 'PII' }] }),
    ).not.toThrow();
  });

  it('refuses a config with no detector keys at all', () => {
    expect(() => assertDetectionSurvives({})).toThrow(/no detection at all/);
  });
});
