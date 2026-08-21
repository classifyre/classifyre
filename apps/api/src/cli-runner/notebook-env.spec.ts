import {
  FORBIDDEN_NOTEBOOK_ENV_KEYS,
  buildNotebookEnvironment,
  isEnvKeyAllowedForNotebooks,
} from './notebook-env';
import { parseNotebookResult, NOTEBOOK_RESULT_PREFIX } from './notebook-result';

describe('notebook execution environment', () => {
  const hostile: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/home/app',
    VENV_PATH: '/app/.venv',
    // Everything below is what a notebook must never be handed.
    DATABASE_URL: 'postgres://user:pw@host/ns_deadbeef',
    CLASSIFYRE_INTERNAL_KEY: 'internal-key',
    CLASSIFYRE_MASKED_CONFIG_KEY: 'base64:AAAA',
    CLASSIFYRE_MASKED_CONFIG_PASSPHRASE: 'passphrase',
    CLASSIFYRE_MASKED_CONFIG_SALT: 'salt',
    OPENAI_API_KEY: 'sk-nope',
    ANTHROPIC_API_KEY: 'sk-ant-nope',
    AWS_SECRET_ACCESS_KEY: 'aws-nope',
    GITHUB_TOKEN: 'ghp-nope',
  };

  it('never passes credentials to a notebook execution', () => {
    const env = buildNotebookEnvironment(hostile);
    for (const key of [
      'DATABASE_URL',
      'CLASSIFYRE_INTERNAL_KEY',
      'CLASSIFYRE_MASKED_CONFIG_KEY',
      'CLASSIFYRE_MASKED_CONFIG_PASSPHRASE',
      'CLASSIFYRE_MASKED_CONFIG_SALT',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'GITHUB_TOKEN',
    ]) {
      expect(env[key]).toBeUndefined();
    }
  });

  it('is an allowlist, so a new credential is excluded by default', () => {
    // The point of this test: adding SOME_NEW_INTEGRATION_TOKEN to the API's
    // environment must not require anyone to remember to deny it here.
    const env = buildNotebookEnvironment({
      ...hostile,
      SOME_NEW_INTEGRATION_TOKEN: 'future-secret',
    });
    expect(env.SOME_NEW_INTEGRATION_TOKEN).toBeUndefined();
  });

  it('keeps what the process needs to run at all', () => {
    const env = buildNotebookEnvironment(hostile);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/app');
    expect(env.VENV_PATH).toBe('/app/.venv');
  });

  it('keeps TLS trust and proxy settings', () => {
    // Dropping these reads to a connector author as a broken connector rather
    // than as a security decision.
    for (const key of [
      'SSL_CERT_FILE',
      'REQUESTS_CA_BUNDLE',
      'NODE_EXTRA_CA_CERTS',
      'HTTPS_PROXY',
      'NO_PROXY',
    ]) {
      expect(isEnvKeyAllowedForNotebooks(key)).toBe(true);
    }
  });

  it('strips forbidden keys even when passed explicitly as extras', () => {
    const env = buildNotebookEnvironment(
      { PATH: '/usr/bin' },
      { DATABASE_URL: 'postgres://sneaky', CLASSIFYRE_INTERNAL_KEY: 'k' },
    );
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.CLASSIFYRE_INTERNAL_KEY).toBeUndefined();
  });

  it('excludes every forbidden key from the allowlist', () => {
    for (const key of FORBIDDEN_NOTEBOOK_ENV_KEYS) {
      expect(isEnvKeyAllowedForNotebooks(key)).toBe(false);
    }
  });

  it('passes through the directory holding the source uploaded files', () => {
    // ctx.files is a path, not a credential: it is how a notebook reaches its
    // uploads without holding the means to fetch anything from the API.
    const env = buildNotebookEnvironment(hostile, {
      CLASSIFYRE_NOTEBOOK_FILES_DIR: '/tmp/notebook-files-abc',
    });
    expect(env.CLASSIFYRE_NOTEBOOK_FILES_DIR).toBe('/tmp/notebook-files-abc');
    expect(isEnvKeyAllowedForNotebooks('CLASSIFYRE_NOTEBOOK_FILES_DIR')).toBe(
      true,
    );
    // Still nothing to authenticate with.
    expect(env.CLASSIFYRE_INTERNAL_KEY).toBeUndefined();
  });
});

describe('parseNotebookResult', () => {
  const result = { status: 'success', mode: 'all', cells: [] };

  it('finds the marked line among unrelated log output', () => {
    const podLog = [
      'INFO installing dependencies',
      'warning: something',
      'loading data',
      `${NOTEBOOK_RESULT_PREFIX}${JSON.stringify(result)}`,
      'INFO container exiting',
    ].join('\n');
    expect(parseNotebookResult(podLog)).toEqual(result);
  });

  it('takes the last marked line when a container restarted', () => {
    const podLog = [
      `${NOTEBOOK_RESULT_PREFIX}${JSON.stringify({ status: 'error' })}`,
      `${NOTEBOOK_RESULT_PREFIX}${JSON.stringify(result)}`,
    ].join('\n');
    expect(parseNotebookResult(podLog)).toEqual(result);
  });

  it('skips a truncated result rather than failing', () => {
    const podLog = [
      `${NOTEBOOK_RESULT_PREFIX}${JSON.stringify(result)}`,
      `${NOTEBOOK_RESULT_PREFIX}{"status": "succ`,
    ].join('\n');
    expect(parseNotebookResult(podLog)).toEqual(result);
  });

  it('returns null when there is no result at all', () => {
    expect(parseNotebookResult('just logs\nand more logs')).toBeNull();
    expect(parseNotebookResult('')).toBeNull();
  });
});
