import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InternalApiKeyService } from '../internal-api-key.service';
import { ACCESS_POLICY, type AccessPolicy } from './access-policy';
import { SYSTEM_ACTOR, type Actor } from './actor';
import { ActorContextService } from './actor-context.service';
import type { Capability } from './capabilities';
import { resolveRouteAccess } from './route-access';
import type { IdentityService, Operator, Principal } from './identity.service';
import { IDENTITY } from './identity.tokens';
import {
  assertSameOrigin,
  stampAuthorFields,
  throwAuthenticationError,
} from './signed-in-request';

/** Where the guard leaves the resolved actor for `@ActorRef()`. */
export interface ActorRequest {
  classifyreActor?: Actor;
}

export class CapabilityRequiredException extends ForbiddenException {
  constructor(capability: Capability | null) {
    super({
      statusCode: 403,
      error: 'Forbidden',
      code: capability ? 'CAPABILITY_REQUIRED' : 'ACCESS_UNDECLARED',
      capability,
      message: capability
        ? `This action needs the ${capability} capability.`
        : 'This route declares no capability and is refused.',
    });
  }
}

/**
 * Resolves the actor of every HTTP request and checks the capability its
 * route declares (docs/prd/S1 R6) against the access policy. Registered after
 * the internal-key, demo-mode and paused guards, which answer other
 * questions.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly actors: ActorContextService,
    private readonly internalApiKey: InternalApiKeyService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
    @Inject(IDENTITY) private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<
      ActorRequest & {
        method: string;
        headers?: Record<string, unknown>;
        body?: unknown;
        raw?: ActorRequest & {
          classifyrePrincipal?: Principal | null;
          classifyreOperator?: Operator | null;
        };
      }
    >();
    const access = resolveRouteAccess(
      (key, target) => this.reflector.get(key, target as never),
      context.getHandler(),
      context.getClass(),
      request.method,
    );
    if (!access) throw new CapabilityRequiredException(null);

    // The actor is whoever the token says, never a header.
    if (this.internalApiKey.isInternalRequest(request.headers)) {
      this.remember(request, SYSTEM_ACTOR);
      return true;
    }
    if (access.kind === 'public') return true;
    if (access.kind === 'internal') {
      // Internal routes without the key: the internal-key guard has already
      // refused them wherever the key is enforced.
      return true;
    }

    if (access.capability.startsWith('platform.')) {
      // Operators belong to no tenant: the Platform routes ask only whether
      // the person holds the operator role (docs/prd/TEN §4.7).
      const operator = await this.authenticateOperator(request);
      if (!operator) throw new CapabilityRequiredException(access.capability);
      assertSameOrigin(
        operator,
        { method: request.method, headers: request.headers },
        this.identity.config.appOrigin,
      );
      this.remember(request, operator.actor);
      return true;
    }

    const principal = await this.authenticate(request);
    assertSameOrigin(
      principal,
      { method: request.method, headers: request.headers },
      this.identity.config.appOrigin,
    );
    this.remember(request, principal.actor);
    // Visitors name nobody; they cannot write either.
    if (principal.actor.ref) {
      stampAuthorFields(request.body, principal.actor.ref);
    }

    if (this.inWorkspace()) {
      // The namespace hook computed what the principal may do here.
      const decision = await this.policy.check(
        principal.actor,
        access.capability,
      );
      if (!decision.allow) {
        throw new CapabilityRequiredException(access.capability);
      }
      return true;
    }

    // Outside a workspace (the registry): tenant-wide capabilities are checked
    // here; the controller checks per-workspace ones against the workspace it
    // touches, and creating a workspace against its owning group.
    if (
      access.capability.startsWith('tenant.') &&
      access.capability !== 'tenant.workspace.create' &&
      !this.identity.tenantCapabilities(principal).has(access.capability)
    ) {
      throw new CapabilityRequiredException(access.capability);
    }
    return true;
  }

  private remember(request: ActorRequest, actor: Actor): void {
    request.classifyreActor = actor;
    this.actors.set(actor);
  }

  private inWorkspace(): boolean {
    return Boolean(this.actors.workspaceId());
  }

  private async authenticateOperator(request: {
    headers?: Record<string, unknown>;
    raw?: { classifyreOperator?: Operator | null };
  }): Promise<Operator | null> {
    try {
      return await this.identity.authenticateOperator(request.raw ?? request);
    } catch (error) {
      throwAuthenticationError(error);
    }
  }

  private async authenticate(request: {
    headers?: Record<string, unknown>;
    raw?: { classifyrePrincipal?: Principal | null };
  }): Promise<Principal> {
    try {
      return await this.identity.authenticate(request.raw ?? request);
    } catch (error) {
      throwAuthenticationError(error);
    }
  }
}
