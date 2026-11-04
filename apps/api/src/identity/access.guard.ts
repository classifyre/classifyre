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
import { resolveLocalRequestActor, type Actor } from './actor';
import { ActorContextService } from './actor-context.service';
import type { Capability } from './capabilities';
import { resolveRouteAccess } from './route-access';

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context
      .switchToHttp()
      .getRequest<
        ActorRequest & { method: string; headers?: Record<string, unknown> }
      >();
    const actor = resolveLocalRequestActor(
      request.headers,
      this.internalApiKey,
    );
    request.classifyreActor = actor;
    this.actors.set(actor);

    const access = resolveRouteAccess(
      (key, target) => this.reflector.get(key, target as never),
      context.getHandler(),
      context.getClass(),
      request.method,
    );
    if (!access) throw new CapabilityRequiredException(null);
    if (access.kind !== 'capability') return true;

    const decision = await this.policy.check(actor, access.capability);
    if (!decision.allow)
      throw new CapabilityRequiredException(access.capability);
    return true;
  }
}
