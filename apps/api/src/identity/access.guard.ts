import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InternalApiKeyService } from '../internal-api-key.service';
import { ACCESS_POLICY, type AccessPolicy } from './access-policy';
import { resolveLocalRequestActor, SYSTEM_ACTOR, type Actor } from './actor';
import { ActorContextService } from './actor-context.service';
import type { Capability } from './capabilities';
import { resolveRouteAccess } from './route-access';
import {
  AuthenticationError,
  type IdentityService,
  type Principal,
} from './identity.service';
import { IDENTITY } from './identity.tokens';

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
    @Inject(IDENTITY) private readonly identity: IdentityService | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<
      ActorRequest & {
        method: string;
        headers?: Record<string, unknown>;
        raw?: ActorRequest & { classifyrePrincipal?: Principal | null };
      }
    >();
    const access = resolveRouteAccess(
      (key, target) => this.reflector.get(key, target as never),
      context.getHandler(),
      context.getClass(),
      request.method,
    );
    if (!access) throw new CapabilityRequiredException(null);

    if (!this.identity) {
      const actor = resolveLocalRequestActor(
        request.headers,
        this.internalApiKey,
      );
      this.remember(request, actor);
      if (access.kind !== 'capability') return true;
      const decision = await this.policy.check(actor, access.capability);
      if (!decision.allow) {
        throw new CapabilityRequiredException(access.capability);
      }
      return true;
    }

    // Sign-in on: the actor is whoever the token says, never a header.
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

    const principal = await this.authenticate(request);
    this.remember(request, principal.actor);

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

  private async authenticate(request: {
    headers?: Record<string, unknown>;
    raw?: { classifyrePrincipal?: Principal | null };
  }): Promise<Principal> {
    try {
      return await this.identity!.authenticate(request.raw ?? request);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: 'Unauthorized',
          code: error.chooseTenant ? 'CHOOSE_TENANT' : 'SIGN_IN_REQUIRED',
          message: error.message,
        });
      }
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'IDENTITY_UNAVAILABLE',
        message: 'Sign-in cannot be checked right now. Try again in a moment.',
      });
    }
  }
}
