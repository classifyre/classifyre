/**
 * Actor references: what authored rows store as `createdBy`, `decidedBy`, …
 * and audit events as `actor` (docs/prd/IAM-access-management.md §11.1).
 *
 * - `user:<sub>`     a signed-in person (IAM on)
 * - `mcp:<tokenId>`  an MCP token; `user:<sub>@mcp:<tokenId>` when it acts for its owner
 * - `agent:<kind>`   an agent, e.g. `agent:autopilot`
 * - `system:<job>`   the platform itself, e.g. `system:scheduler`
 * - `group:<id>`     a Keycloak group of the tenant; never an actor, only a
 *                    principal something is given to (an asset's steward)
 * - anything else    a self-declared name (IAM off), stored as typed
 */
export type ActorRefKind =
  | 'user'
  | 'group'
  | 'mcp'
  | 'agent'
  | 'system'
  | 'name';

export interface ParsedActorRef {
  kind: ActorRefKind;
  /** The id after the prefix; the name itself for a self-declared name. */
  id: string;
  /** The channel a delegated action came through (`@mcp:<tokenId>`). */
  via?: { kind: 'mcp'; id: string };
}

const TYPED_REF =
  /^(user|group|mcp|agent|system):([A-Za-z0-9._:-]+?)(?:@mcp:([A-Za-z0-9-]+))?$/;

export const AUTOPILOT_ACTOR_REF = 'agent:autopilot';

export function isTypedActorRef(value: string): boolean {
  return TYPED_REF.test(value);
}

export function parseActorRef(value: string): ParsedActorRef {
  const match = TYPED_REF.exec(value);
  if (!match) return { kind: 'name', id: value };
  const [, kind, id, viaToken] = match;
  return {
    kind: kind as ActorRefKind,
    id,
    ...(viaToken ? { via: { kind: 'mcp' as const, id: viaToken } } : {}),
  };
}

export const mcpTokenRef = (tokenId: string) => `mcp:${tokenId}`;
export const systemRef = (job: string) => `system:${job}`;
export const agentRef = (kind: string) => `agent:${kind}`;
export const userRef = (sub: string) => `user:${sub}`;
export const groupRef = (groupId: string) => `group:${groupId}`;
