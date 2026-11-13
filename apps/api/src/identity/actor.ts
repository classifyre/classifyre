import { systemRef } from './actor-ref';

/** `visitor`: someone browsing the public tenant without signing in. */
export type ActorKind =
  | 'person'
  | 'agent'
  | 'integration'
  | 'system'
  | 'visitor';
export type ActorVia =
  | 'oidc'
  | 'mcp-token'
  | 'sql-connection'
  | 'internal-key'
  | 'autopilot'
  | 'none';

/**
 * Who is acting, resolved once per request (docs/prd/S1 R1): whoever the
 * token says, never a header.
 */
export interface Actor {
  /** Stable id of the principal; null for nobody in particular. */
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
