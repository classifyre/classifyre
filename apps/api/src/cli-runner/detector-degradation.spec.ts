import {
  describeDegradation,
  summarizeOutcomeFailures,
} from './detector-degradation';

const refusal =
  "LLM provider refused detector 'fb_solvency_outlook' (model=openrouter/free, " +
  'quota exhausted): Rate limit exceeded: free-models-per-day';

const skipped = (reason: string) =>
  `breaker_open[provider_refused]: fb_solvency_outlook was disabled for the rest ` +
  `of this run and did not evaluate this asset — the provider refused the request ` +
  `and retrying cannot help: ${reason}`;

const outcome = (error?: string, key = 'fb_solvency_outlook') => ({
  detector_type: 'CUSTOM',
  custom_detector_key: key,
  status: error ? 'ERROR' : 'OK',
  ...(error ? { error } : {}),
});

describe('summarizeOutcomeFailures', () => {
  it('separates the asset that tripped the breaker from the assets it skipped', () => {
    const rows = [
      { assetHash: 'a1', detectorOutcomes: [outcome(refusal)] },
      { assetHash: 'a2', detectorOutcomes: [outcome(skipped(refusal))] },
      { assetHash: 'a3', detectorOutcomes: [outcome(skipped(refusal))] },
    ];

    const summary = summarizeOutcomeFailures(rows);

    // The one real failure is still reported as a failure...
    expect(summary.assetCount).toBe(1);
    expect(summary.detectorLabels).toEqual(['fb_solvency_outlook']);
    // ...and the skips are reported as what they are.
    expect(summary.degraded).toEqual([
      {
        detector: 'fb_solvency_outlook',
        cause: 'provider_refused',
        reason: expect.stringContaining('free-models-per-day'),
        assetsSkipped: 2,
      },
    ]);
  });

  it('leaves ordinary failures and OK outcomes as they were', () => {
    const summary = summarizeOutcomeFailures([
      { assetHash: 'a1', detectorOutcomes: [outcome('parse error', 'k1')] },
      { assetHash: 'a2', detectorOutcomes: [outcome(undefined, 'k1')] },
      { assetHash: 'a3', detectorOutcomes: null },
    ]);

    expect(summary).toEqual({
      assetCount: 1,
      detectorLabels: ['k1'],
      degraded: [],
    });
  });

  it('labels a built-in detector by its type', () => {
    const summary = summarizeOutcomeFailures([
      {
        assetHash: 'a1',
        detectorOutcomes: [
          {
            detector_type: 'PII',
            custom_detector_key: null,
            status: 'ERROR',
            error:
              'breaker_open[consecutive_failures]: pii was disabled for the rest of ' +
              'this run and did not evaluate this asset — 10 consecutive failures',
          },
        ],
      },
    ]);

    expect(summary.degraded).toEqual([
      {
        detector: 'PII',
        cause: 'consecutive_failures',
        reason: '10 consecutive failures',
        assetsSkipped: 1,
      },
    ]);
  });
});

describe('describeDegradation', () => {
  it('says the detector stopped on purpose and the assets come back', () => {
    const [sentence] = describeDegradation(
      [
        {
          detector: 'fb_solvency_outlook',
          cause: 'provider_refused',
          reason: 'quota exhausted',
          assetsSkipped: 450,
        },
      ],
      451,
    );

    expect(sentence).toContain('fb_solvency_outlook was disabled mid-run');
    expect(sentence).toContain('the AI provider refused the request');
    expect(sentence).toContain('skipped 450 of 451 assets');
    expect(sentence).toContain('retried next run');
  });
});
