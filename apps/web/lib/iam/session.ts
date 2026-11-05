import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { safeReturnTo as sameAppPath } from "@/lib/return-to";

/**
 * Sign-in for the web app (docs/prd/IAM-access-management.md §12.1). The Next
 * server is the OIDC client: it runs the authorization code flow with PKCE
 * against the identity server and keeps the tokens in HttpOnly cookies, so no
 * token ever reaches JavaScript. The access token rides to the API as the
 * `cf_session` cookie (the API reads it the same way as a bearer token); the
 * refresh token stays encrypted in `cf_refresh`.
 *
 * Server-only: reads the client secret.
 */

export const SESSION_COOKIE = "cf_session";
export const REFRESH_COOKIE = "cf_refresh";
export const ID_COOKIE = "cf_id";
export const FLOW_COOKIE = "cf_auth_flow";

/** Renew this long before the access token expires. */
const RENEW_BEFORE_S = 60;

export interface IamWebConfig {
  /** Issuer at the public URL: browsers are sent here to sign in. */
  issuerUrl: string;
  /** The same realm reached from this server (token and logout calls). */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Where people open Classifyre; callbacks and logout return here. */
  appUrl: string;
  secureCookies: boolean;
}

export function iamWebConfig(
  env: Record<string, string | undefined> = process.env,
): IamWebConfig | null {
  if (env.IAM_ENABLED !== "true") return null;
  const need = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`IAM_ENABLED=true needs ${name}`);
    return value.replace(/\/+$/, "");
  };
  const issuerUrl = need("IAM_ISSUER_URL");
  const realm = need("IAM_REALM");
  const internal = env.IAM_INTERNAL_URL?.trim().replace(/\/+$/, "");
  const appUrl = need("IAM_APP_URL");
  return {
    issuerUrl,
    tokenUrl: `${internal ? `${internal}/realms/${realm}` : issuerUrl}/protocol/openid-connect/token`,
    clientId: need("IAM_WEB_CLIENT_ID"),
    clientSecret: need("IAM_WEB_CLIENT_SECRET"),
    appUrl,
    secureCookies: appUrl.startsWith("https://"),
  };
}

export function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/** PKCE verifier and its S256 challenge, plus the state guarding the callback. */
export function newFlow(): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = base64url(randomBytes(32));
  return {
    verifier,
    challenge: base64url(createHash("sha256").update(verifier).digest()),
    state: base64url(randomBytes(16)),
  };
}

function key(config: IamWebConfig): Buffer {
  return createHash("sha256")
    .update(`classifyre-web-session:${config.clientSecret}`)
    .digest();
}

/** AES-256-GCM, keyed from the client secret: only this server can read it. */
export function seal(config: IamWebConfig, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(config), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return base64url(Buffer.concat([iv, cipher.getAuthTag(), body]));
}

export function unseal(config: IamWebConfig, sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(config),
      raw.subarray(0, 12),
    );
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Seconds until a JWT expires (negative once expired); null if unreadable. */
export function secondsLeft(token: string | undefined): number | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { exp?: number };
    return typeof payload.exp === "number"
      ? payload.exp - Math.floor(Date.now() / 1000)
      : null;
  } catch {
    return null;
  }
}

export function needsRenewal(token: string | undefined): boolean {
  const left = secondsLeft(token);
  return left === null || left < RENEW_BEFORE_S;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  refresh_expires_in?: number;
}

export async function tokenRequest(
  config: IamWebConfig,
  params: Record<string, string>,
): Promise<TokenSet | null> {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...params,
    }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as TokenSet;
}

export interface CookieWrite {
  name: string;
  value: string;
  maxAge: number;
}

/** The cookies a token set becomes. */
export function sessionCookies(
  config: IamWebConfig,
  tokens: TokenSet,
): CookieWrite[] {
  const refreshAge = tokens.refresh_expires_in || 30 * 60;
  const cookies: CookieWrite[] = [
    { name: SESSION_COOKIE, value: tokens.access_token, maxAge: refreshAge },
  ];
  if (tokens.refresh_token) {
    cookies.push({
      name: REFRESH_COOKIE,
      value: seal(config, tokens.refresh_token),
      maxAge: refreshAge,
    });
  }
  if (tokens.id_token) {
    cookies.push({ name: ID_COOKIE, value: tokens.id_token, maxAge: refreshAge });
  }
  return cookies;
}

export function cookieOptions(config: IamWebConfig, maxAge: number) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/** A new token set from the sealed refresh token, or null when sign-in has ended. */
export async function renew(
  config: IamWebConfig,
  sealedRefresh: string | undefined,
): Promise<TokenSet | null> {
  const refreshToken = sealedRefresh ? unseal(config, sealedRefresh) : null;
  if (!refreshToken) return null;
  return tokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/** Only same-app paths: a sign-in must never bounce to another site. */
export function safeReturnTo(value: string | null | undefined): string {
  return sameAppPath(value) ?? "/";
}
