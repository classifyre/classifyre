import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { AccessDecision, AccessPolicy } from './access-policy';
import type { Capability } from './capabilities';

/** Capabilities of the current request's principal in its workspace (set by the namespace hook). */
export const CLS_CAPABILITIES = 'classifyre:capabilities';

/**
 * The policy with sign-in on: a capability is allowed when the principal's
 * grants give it in the current workspace. The namespace hook computes the
 * set once per request; this only reads it.
 */
@Injectable()
export class IamAccessPolicy implements AccessPolicy {
  constructor(private readonly cls: ClsService) {}

  private current(): ReadonlySet<Capability> {
    if (!this.cls.isActive()) return new Set();
    return this.cls.get<ReadonlySet<Capability>>(CLS_CAPABILITIES) ?? new Set();
  }

  check(_actor: unknown, capability: Capability): AccessDecision {
    return this.current().has(capability)
      ? { allow: true }
      : { allow: false, reason: `needs ${capability}` };
  }

  capabilities(): ReadonlySet<Capability> {
    return this.current();
  }
}
