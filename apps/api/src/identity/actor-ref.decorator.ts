import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ACTOR_NAME_HEADER, personFromHeader } from './actor';
import type { ActorRequest } from './access.guard';

/**
 * `@ActorRef() actor: string | undefined` — what this request's authored rows
 * record as their author (`createdBy`, `decidedBy`, …). Read from the actor
 * {@link AccessGuard} resolved, so every route attributes the same way.
 */
export const ActorRef = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<ActorRequest & { headers?: Record<string, unknown> }>();
    const actor =
      request.classifyreActor ??
      personFromHeader(request.headers?.[ACTOR_NAME_HEADER]);
    return actor.ref;
  },
);
