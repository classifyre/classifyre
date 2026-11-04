import { createPublicKey, verify, webcrypto, type KeyObject } from 'crypto';

type JsonWebKey = webcrypto.JsonWebKey;

export interface VerifiedClaims {
  sub: string;
  iss: string;
  exp: number;
  /** Organization aliases the token is for (`organization` scope). */
  organization?: string[] | Record<string, unknown>;
  name?: string;
  preferred_username?: string;
  email?: string;
  [claim: string]: unknown;
}

export class InvalidTokenError extends Error {}

const ALGORITHMS: Record<string, { hash: string; ec?: boolean }> = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  PS256: { hash: 'sha256' },
  ES256: { hash: 'sha256', ec: true },
  ES384: { hash: 'sha384', ec: true },
};

/** Keys are fetched again at most this often when an unknown key id shows up. */
const REFETCH_INTERVAL_MS = 30_000;
const CLOCK_SKEW_S = 30;

function decodeSegment<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
}

/**
 * Verifies the identity server's access tokens against its published keys
 * (JWKS), with Node's own crypto: no dependency to keep in step. Keys are
 * cached by key id and refetched when a token names one we have not seen,
 * which is how key rotation shows up.
 */
export class JwtVerifier {
  private keys = new Map<string, { key: KeyObject; alg?: string }>();
  private lastFetch = 0;

  constructor(
    private readonly options: {
      jwksUrl: string;
      issuer: string;
      audience: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async verify(token: string): Promise<VerifiedClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new InvalidTokenError('Malformed token');
    const [headerPart, payloadPart, signaturePart] = parts;
    let header: { alg?: string; kid?: string; typ?: string };
    let claims: VerifiedClaims;
    try {
      header = decodeSegment(headerPart);
      claims = decodeSegment(payloadPart);
    } catch {
      throw new InvalidTokenError('Malformed token');
    }

    const algorithm = header.alg ? ALGORITHMS[header.alg] : undefined;
    if (!algorithm)
      throw new InvalidTokenError(`Unsupported algorithm ${header.alg}`);
    const key = await this.keyFor(header.kid);
    const signed = verify(
      algorithm.hash,
      Buffer.from(`${headerPart}.${payloadPart}`),
      algorithm.ec
        ? { key, dsaEncoding: 'ieee-p1363' }
        : header.alg?.startsWith('PS')
          ? { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */ }
          : key,
      Buffer.from(signaturePart, 'base64url'),
    );
    if (!signed) throw new InvalidTokenError('Bad signature');

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) {
      throw new InvalidTokenError('Token expired');
    }
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > now) {
      throw new InvalidTokenError('Token not yet valid');
    }
    if (claims.iss !== this.options.issuer) {
      throw new InvalidTokenError('Token from another issuer');
    }
    const audience = claims.aud;
    const audiences = Array.isArray(audience) ? audience : [audience];
    if (!audiences.includes(this.options.audience)) {
      throw new InvalidTokenError('Token meant for another audience');
    }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new InvalidTokenError('Token has no subject');
    }
    return claims;
  }

  private async keyFor(kid: string | undefined): Promise<KeyObject> {
    if (!kid) throw new InvalidTokenError('Token names no key');
    let entry = this.keys.get(kid);
    if (!entry && Date.now() - this.lastFetch > REFETCH_INTERVAL_MS) {
      await this.refresh();
      entry = this.keys.get(kid);
    }
    if (!entry) throw new InvalidTokenError('Unknown signing key');
    return entry.key;
  }

  private async refresh(): Promise<void> {
    this.lastFetch = Date.now();
    const response = await (this.options.fetchImpl ?? fetch)(
      this.options.jwksUrl,
    );
    if (!response.ok) {
      throw new InvalidTokenError(
        `Signing keys unavailable (${response.status})`,
      );
    }
    const body = (await response.json()) as {
      keys?: (JsonWebKey & { kid?: string; use?: string; alg?: string })[];
    };
    const keys = new Map<string, { key: KeyObject; alg?: string }>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || (jwk.use && jwk.use !== 'sig')) continue;
      try {
        keys.set(jwk.kid, {
          key: createPublicKey({ key: jwk, format: 'jwk' }),
          alg: jwk.alg,
        });
      } catch {
        // A key type this verifier cannot use (e.g. encryption keys): skip it.
      }
    }
    this.keys = keys;
  }
}
