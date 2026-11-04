import type { InternalApiKeyService } from '../internal-api-key.service';
import { isTypedActorRef, mcpTokenRef, systemRef } from './actor-ref';

export const ACTOR_NAME_HEADER = 'x-actor-name';
const MAX_ACTOR_CHARS = 64;

export type ActorKind = 'person' | 'agent' | 'integration' | 'system';
export type ActorVia =
  | 'header'
  | 'mcp-token'
  | 'internal-key'
  | 'autopilot'
  | 'none';

/**
 * Who is acting, resolved once per request (docs/prd/S1 R1). Without IAM a
 * person is whoever the `X-Actor-Name` header says: attribution, not
 * authorisation.
 */
export interface Actor {
  /** Stable id of the principal; null while identity is self-declared. */
  id: string | null;
  displayName: string | null;
  kind: ActorKind;
  via: ActorVia;
  /**
   * What authored rows record as `createdBy`, `decidedBy`, … for this actor.
   * Undefined when nobody can be named, so columns stay NULL as before.
   */
  ref: string | undefined;
}

export const ANONYMOUS_ACTOR: Actor = {
  id: null,
  displayName: null,
  kind: 'person',
  via: 'none',
  ref: undefined,
};

/** Callers holding the internal key: the CLI jobs the API launches. */
export const SYSTEM_ACTOR: Actor = {
  id: systemRef('runner'),
  displayName: 'system',
  kind: 'system',
  via: 'internal-key',
  ref: systemRef('runner'),
};

/**
 * Parse the self-declared display name a browser sends as `X-Actor-Name`.
 * The web client percent-encodes the value because header values must be
 * Latin-1 and names are not.
 */
export function parseActorName(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? (raw[0] as unknown) : raw;
  if (typeof value !== 'string') return undefined;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Not percent-encoded (curl, scripts): take it as typed.
  }
  // Control characters would corrupt the timeline rendering; blank them.
  const printable = Array.from(decoded, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? ' ' : ch;
  }).join('');
  const cleaned = printable
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ACTOR_CHARS)
    .trim();
  if (cleaned.length === 0) return undefined;
  // A typed name would pass as a token, agent or system in the audit trail.
  if (isTypedActorRef(cleaned)) return undefined;
  return cleaned;
}

export function personFromHeader(raw: unknown): Actor {
  const name = parseActorName(raw);
  if (!name) return ANONYMOUS_ACTOR;
  return {
    id: null,
    displayName: name,
    kind: 'person',
    via: 'header',
    ref: name,
  };
}

export function integrationFromMcpToken(token: {
  id: string;
  name: string;
}): Actor {
  return {
    id: mcpTokenRef(token.id),
    displayName: token.name,
    kind: 'integration',
    via: 'mcp-token',
    ref: mcpTokenRef(token.id),
  };
}

/** Resolve the actor of an HTTP request without IAM. */
export function resolveLocalRequestActor(
  headers: Record<string, unknown> | undefined,
  internalApiKey: Pick<InternalApiKeyService, 'isInternalRequest'>,
): Actor {
  if (internalApiKey.isInternalRequest(headers)) return SYSTEM_ACTOR;
  return personFromHeader(headers?.[ACTOR_NAME_HEADER]);
}
