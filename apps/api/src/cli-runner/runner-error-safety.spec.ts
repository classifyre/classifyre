/**
 * Stored scan errors must stay actionable without carrying credentials.
 *
 * Regression coverage for the production incident where a failed scan stored
 * a 4 MB job log in `error_details.output` with a live credential echoed in
 * it: every write path now redacts (exact values + credential shapes) and
 * bounds (sentences sliced, long blobs tail-kept, log snapshots windowed).
 */
import {
  boundDetailString,
  boundLongDetailStrings,
  redactDeepWithSecrets,
  redactEncodedSecrets,
  redactSecretsForStorage,
  redactWithSecrets,
  sanitizeStoredErrorMessage,
  sanitizeStoredLogLine,
  sanitizeWithSecrets,
  splitPersistWindow,
  tailBound,
} from './runner-error-safety';

const SECRET = 'live-credential-7190272603554-MM';
const PASSWORD = 'db-pw-9x8z';

const encodedBlob = (rawId: string): string =>
  Buffer.from(`custom_#_${rawId}`, 'utf8')
    .toString('base64url')
    .replace(/=+$/, '');

describe('redactSecretsForStorage', () => {
  it('hides user:password@host URLs', () => {
    expect(
      redactSecretsForStorage(`postgres://analyst:${PASSWORD}@db:5432/app`),
    ).toBe('postgres://analyst:••••@db:5432/app');
  });

  it('hides Bearer tokens and password=/api_key assignments', () => {
    expect(redactSecretsForStorage(`Bearer ${SECRET}`)).toBe('Bearer ••••');
    expect(redactSecretsForStorage(`password=${PASSWORD}`)).toBe(
      'password=••••',
    );
    expect(redactSecretsForStorage(`{"api_key": "${SECRET}"}`)).toBe(
      '{"api_key": "••••"}',
    );
  });

  it('leaves ordinary failure text intact', () => {
    const text = 'Job exited with an error (exit code 1): connection refused';
    expect(redactSecretsForStorage(text)).toBe(text);
  });
});

describe('redactWithSecrets / redactEncodedSecrets', () => {
  it('hides exact secret values', () => {
    expect(redactWithSecrets(`using key ${SECRET} now`, [SECRET])).toBe(
      'using key •••• now',
    );
  });

  it('hides base64 blobs whose decoded form carries the secret', () => {
    const blob = encodedBlob(`doc-9_${SECRET}`);
    expect(blob).not.toContain(SECRET);
    const line = `trying candidates ['https://host/api', '${blob}']`;
    const cleaned = redactEncodedSecrets(line, [SECRET]);
    expect(cleaned).not.toContain(blob);
    expect(cleaned).toContain('https://host/api');
  });

  it('keeps benign hashes that decode clean', () => {
    const benign = encodedBlob('rec-1');
    const line = `fetch_text_pages(${benign}): returned None`;
    expect(redactEncodedSecrets(line, [SECRET])).toBe(line);
  });
});

describe('sanitizeStoredErrorMessage', () => {
  it('redacts then bounds', () => {
    const long = `error password=${PASSWORD} ` + 'x'.repeat(5000);
    const cleaned = sanitizeStoredErrorMessage(long, 100);
    expect(cleaned).not.toContain(PASSWORD);
    expect(cleaned.length).toBeLessThanOrEqual(100);
  });
});

describe('boundDetailString / boundLongDetailStrings', () => {
  it('keeps the tail of a huge job log with a marker', () => {
    const output = 'head-line\n' + 'y'.repeat(20000) + '\nfinal traceback here';
    const cleaned = boundDetailString(output, 100);
    expect(cleaned).toContain('final traceback here');
    expect(cleaned).toContain('omitted');
    expect(cleaned.length).toBeLessThan(output.length);
  });

  it('bounds long strings inside details objects', () => {
    const cleaned = boundLongDetailStrings(
      { exitCode: 1, output: 'z'.repeat(20000) },
      100,
    ) as Record<string, unknown>;
    expect(String(cleaned['output']).length).toBeLessThan(1000);
    expect(cleaned['exitCode']).toBe(1);
  });
});

describe('redactDeepWithSecrets', () => {
  it('scrubs nested strings with values and shapes', () => {
    const cleaned = redactDeepWithSecrets(
      {
        output: `token=${SECRET}`,
        nested: { url: `https://u:${PASSWORD}@h` },
        exitCode: 1,
      },
      [SECRET],
    ) as Record<string, unknown>;
    expect(JSON.stringify(cleaned)).not.toContain(SECRET);
    expect(JSON.stringify(cleaned)).not.toContain(PASSWORD);
    expect(cleaned['exitCode']).toBe(1);
  });
});

describe('sanitizeStoredLogLine', () => {
  it('redacts and cuts pathological lines with a marker', () => {
    const cleaned = sanitizeStoredLogLine(
      `ok password=${PASSWORD} ` + 'w'.repeat(20000),
      100,
    );
    expect(cleaned).not.toContain(PASSWORD);
    expect(cleaned).toContain('truncated');
    expect(cleaned.length).toBeLessThan(1000);
  });
});

describe('splitPersistWindow', () => {
  it('passes small buffers through untouched', () => {
    expect(splitPersistWindow([1, 2, 3], 1000, 9000)).toEqual({
      head: [1, 2, 3],
      tail: [],
      omitted: 0,
    });
  });

  it('keeps head and tail with the omitted count', () => {
    const entries = Array.from({ length: 20 }, (_, i) => i);
    expect(splitPersistWindow(entries, 2, 3)).toEqual({
      head: [0, 1],
      tail: [17, 18, 19],
      omitted: 15,
    });
  });
});

describe('tailBound', () => {
  it('keeps short text as-is', () => {
    expect(tailBound('boom', 100)).toBe('boom');
  });
});

describe('sanitizeWithSecrets', () => {
  it('combines values, encoded variants and shapes', () => {
    const blob = encodedBlob(`doc_${SECRET}`);
    const text = `key ${SECRET} then ${blob} at postgres://u:${PASSWORD}@h/db`;
    const cleaned = sanitizeWithSecrets(text, [SECRET]);
    expect(cleaned).not.toContain(SECRET);
    expect(cleaned).not.toContain(blob);
    expect(cleaned).not.toContain(PASSWORD);
  });
});
