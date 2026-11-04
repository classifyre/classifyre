import { Injectable } from '@nestjs/common';
import type { Actor } from './actor';
import { CAPABILITY_IDS, type Capability } from './capabilities';

export const ACCESS_POLICY = Symbol('ACCESS_POLICY');

/** What an access check is about, when the route or service knows it. */
export type ResourceRef =
  | { type: 'namespace'; id: string }
  | {
      type:
        | 'source'
        | 'finding'
        | 'asset'
        | 'case'
        | 'inquiry'
        | 'detector'
        | 'entity'
        | 'mcp-token';
      id: string;
    };

export interface AccessDecision {
  allow: boolean;
  reason?: string;
}

/**
 * Decides whether an actor holds a capability (docs/prd/S1 R5). The REST guard
 * and the MCP server both ask the same policy, so a capability means the same
 * thing on every surface.
 */
export interface AccessPolicy {
  check(
    actor: Actor,
    capability: Capability,
    resource?: ResourceRef,
  ): AccessDecision | Promise<AccessDecision>;
  /** Every capability the actor holds in the current workspace, for `/me` and MCP tool filtering. */
  capabilities(
    actor: Actor,
  ): ReadonlySet<Capability> | Promise<ReadonlySet<Capability>>;
}

const ALL_CAPABILITIES: ReadonlySet<Capability> = new Set(CAPABILITY_IDS);

/**
 * The policy without IAM: everyone may do everything, exactly as before
 * access control existed.
 */
@Injectable()
export class LocalAccessPolicy implements AccessPolicy {
  check(): AccessDecision {
    return { allow: true };
  }

  capabilities(): ReadonlySet<Capability> {
    return ALL_CAPABILITIES;
  }
}
