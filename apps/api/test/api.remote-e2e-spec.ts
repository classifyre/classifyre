import fetch from 'node-fetch';

function resolveApiBaseUrl(): string {
  const raw = process.env.TEST_API_URL?.trim();
  if (!raw) throw new Error('TEST_API_URL is required for remote e2e tests');
  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

describe('API Remote E2E', () => {
  const baseUrl = resolveApiBaseUrl();

  it('responds to /ping', async () => {
    const res = await fetch(`${baseUrl}/ping`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('pong');
  });
});
