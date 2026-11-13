import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * SCRAM-SHA-256 (RFC 5802, RFC 7677) as PostgreSQL speaks it, server side.
 * A SQL connection keeps only the verifier — salt, iterations, StoredKey and
 * ServerKey — so a leaked table cannot sign anyone in, and the password never
 * crosses the network even when TLS ends at a proxy before the gateway.
 */
export const SCRAM_ITERATIONS = 4096;

export interface ScramVerifier {
  salt: string; // base64
  iterations: number;
  storedKey: string; // base64
  serverKey: string; // base64
}

const hmac = (key: Buffer, text: string) =>
  createHmac('sha256', key).update(text, 'utf8').digest();
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest();

/** The verifier for a password; the password itself is dropped by the caller. */
export function scramVerifier(
  password: string,
  iterations = SCRAM_ITERATIONS,
  salt: Buffer = randomBytes(16),
): ScramVerifier {
  // Our passwords are base64url: SASLprep leaves ASCII as it is.
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = hmac(salted, 'Client Key');
  return {
    salt: salt.toString('base64'),
    iterations,
    storedKey: sha256(clientKey).toString('base64'),
    serverKey: hmac(salted, 'Server Key').toString('base64'),
  };
}

/** `a=1,b=2` → {a: '1', b: '2'}; values may themselves contain `=`. */
function attributes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of text.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) out.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return out;
}

export class ScramError extends Error {}

/**
 * One SCRAM exchange. `start` takes the client-first message (from
 * SASLInitialResponse) and returns server-first; `finish` takes client-final
 * and returns server-final (`v=…`), or throws when the proof is wrong.
 */
export class ScramExchange {
  private clientFirstBare = '';
  private serverFirst = '';
  private nonce = '';
  private gs2Header = '';

  constructor(private readonly verifier: ScramVerifier) {}

  start(clientFirst: string): string {
    // gs2-header: "n,," (no channel binding) or "y,," (client could, we don't
    // offer it). "p=…" asks for channel binding we never advertised.
    const match = /^([ny]),[^,]*,(.*)$/.exec(clientFirst);
    if (!match) throw new ScramError('Unsupported SCRAM channel binding.');
    this.gs2Header = clientFirst.slice(0, clientFirst.length - match[2].length);
    this.clientFirstBare = match[2];
    const clientNonce = attributes(this.clientFirstBare).get('r');
    if (!clientNonce) throw new ScramError('SCRAM client nonce missing.');
    this.nonce = clientNonce + randomBytes(18).toString('base64');
    this.serverFirst = `r=${this.nonce},s=${this.verifier.salt},i=${this.verifier.iterations}`;
    return this.serverFirst;
  }

  finish(clientFinal: string): string {
    const proofAt = clientFinal.lastIndexOf(',p=');
    if (proofAt < 0) throw new ScramError('SCRAM proof missing.');
    const withoutProof = clientFinal.slice(0, proofAt);
    const attrs = attributes(withoutProof);
    if (attrs.get('r') !== this.nonce) {
      throw new ScramError('SCRAM nonce mismatch.');
    }
    if (attrs.get('c') !== Buffer.from(this.gs2Header).toString('base64')) {
      throw new ScramError('SCRAM channel binding mismatch.');
    }
    const proof = Buffer.from(clientFinal.slice(proofAt + 3), 'base64');
    const authMessage = `${this.clientFirstBare},${this.serverFirst},${withoutProof}`;
    const storedKey = Buffer.from(this.verifier.storedKey, 'base64');
    const signature = hmac(storedKey, authMessage);
    if (proof.length !== signature.length) {
      throw new ScramError('Wrong password.');
    }
    const clientKey = Buffer.alloc(proof.length);
    for (let i = 0; i < proof.length; i++) {
      clientKey[i] = proof[i] ^ signature[i];
    }
    if (!timingSafeEqual(sha256(clientKey), storedKey)) {
      throw new ScramError('Wrong password.');
    }
    const serverKey = Buffer.from(this.verifier.serverKey, 'base64');
    return `v=${hmac(serverKey, authMessage).toString('base64')}`;
  }
}

/**
 * The client side, for tests and the gateway's own probes: what libpq,
 * pgJDBC and Npgsql do.
 */
export function scramClient(username: string, password: string) {
  const clientNonce = randomBytes(18).toString('base64');
  const clientFirstBare = `n=${username},r=${clientNonce}`;
  return {
    first: `n,,${clientFirstBare}`,
    final(serverFirst: string): { message: string; serverSignature: string } {
      const attrs = attributes(serverFirst);
      const salt = Buffer.from(attrs.get('s') ?? '', 'base64');
      const iterations = Number(attrs.get('i'));
      const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
      const clientKey = hmac(salted, 'Client Key');
      const withoutProof = `c=biws,r=${attrs.get('r')}`;
      const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
      const signature = hmac(sha256(clientKey), authMessage);
      const proof = Buffer.alloc(clientKey.length);
      for (let i = 0; i < proof.length; i++) {
        proof[i] = clientKey[i] ^ signature[i];
      }
      return {
        message: `${withoutProof},p=${proof.toString('base64')}`,
        serverSignature: hmac(hmac(salted, 'Server Key'), authMessage).toString(
          'base64',
        ),
      };
    },
  };
}
