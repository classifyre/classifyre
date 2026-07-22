import { net } from 'electron';
import { assertValidRemoteUrl } from './namespace-manager.js';

export interface VerifiedRemoteInstance {
  normalizedUrl: string;
  namespaceCount: number;
}

function endpointUrl(baseUrl: string, path: string): string {
  return new URL(`/${path.replace(/^\/+/, '')}`, baseUrl).toString();
}

/**
 * Proves that a URL is a namespace-aware Classifyre web installation, not
 * merely an arbitrary HTTPS page. Requests run in Electron's main process so
 * browser CORS cannot block a legitimate cross-origin verification.
 */
export async function verifyClassifyreRemote(
  inputUrl: string,
): Promise<VerifiedRemoteInstance> {
  const candidateUrl = inputUrl.trim().replace(/\/+$/, '');
  assertValidRemoteUrl(candidateUrl);
  // The Classifyre web client deliberately uses the origin-relative `/api`
  // proxy, so a remote installation is rooted at its origin as well.
  const normalizedUrl = new URL(candidateUrl).origin;

  const signal = AbortSignal.timeout(10_000);
  let pingResponse: Response;
  let namespacesResponse: Response;

  try {
    pingResponse = await net.fetch(endpointUrl(normalizedUrl, 'api/ping'), {
      headers: { accept: 'text/plain, application/json' },
      redirect: 'follow',
      signal,
    });
    if (!pingResponse.ok) {
      throw new Error(`/api/ping returned HTTP ${pingResponse.status}`);
    }
    const ping = (await pingResponse.text()).trim().replace(/^"|"$/g, '');
    if (ping.toLowerCase() !== 'pong') {
      throw new Error('/api/ping did not return pong');
    }

    namespacesResponse = await net.fetch(
      endpointUrl(normalizedUrl, 'api/namespaces'),
      {
        headers: { accept: 'application/json' },
        redirect: 'follow',
        signal,
      },
    );
    if (!namespacesResponse.ok) {
      throw new Error(
        `/api/namespaces returned HTTP ${namespacesResponse.status}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not verify the Classifyre instance: ${message}`);
  }

  let namespaces: unknown;
  try {
    namespaces = await namespacesResponse.json();
  } catch {
    throw new Error(
      'Could not verify the Classifyre instance: /api/namespaces did not return JSON',
    );
  }

  if (
    !Array.isArray(namespaces) ||
    !namespaces.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>)['id'] === 'string' &&
        typeof (item as Record<string, unknown>)['name'] === 'string' &&
        typeof (item as Record<string, unknown>)['slug'] === 'string',
    )
  ) {
    throw new Error(
      'Could not verify the Classifyre instance: /api/namespaces returned an unexpected response',
    );
  }

  return { normalizedUrl, namespaceCount: namespaces.length };
}
