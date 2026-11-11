import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ActorRequest } from './access.guard';

/**
 * `@ActorRef() actor: string | undefined` — what this request's authored rows
 * record as their author (`createdBy`, `decidedBy`, …). Read from the actor
 * {@link AccessGuard} resolved, so every route attributes the same way.
 */
export const ActorRef = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<ActorRequest>().classifyreActor?.ref,
);
