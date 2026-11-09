import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import type { ActorRequest } from './access.guard';
import { ANONYMOUS_ACTOR } from './actor';
import { AuditTrailService, inputFields } from './audit-trail.service';
import { resolveRouteAccess } from './route-access';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * What a route path addresses: the static part before its first parameter,
 * and that parameter's value. `/cases/:id/evidence/:evidenceId` with id `c1`
 * is entity `cases` / `c1`; `POST /sources` is `sources`, with the id taken
 * from the created object.
 */
export function routeEntity(
  routePath: string,
  params: Record<string, string | undefined>,
  responseBody: unknown,
): { entityType: string | null; entityId: string | null } {
  const segments = routePath.split('/').filter(Boolean);
  const paramAt = segments.findIndex((segment) => segment.startsWith(':'));
  const staticPart = (
    paramAt === -1 ? segments : segments.slice(0, paramAt)
  ).join('/');
  if (paramAt !== -1) {
    const value = params[segments[paramAt].slice(1)];
    return { entityType: staticPart || null, entityId: value ?? null };
  }
  const createdId =
    responseBody &&
    typeof responseBody === 'object' &&
    typeof (responseBody as { id?: unknown }).id === 'string'
      ? (responseBody as { id: string }).id
      : null;
  return { entityType: staticPart || null, entityId: createdId };
}

/**
 * Records every successful change made over REST in the workspace audit
 * trail. Reads (GET, and routes whose capability is a `.view`) are not
 * recorded, nor are internal-key callbacks from scan jobs.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditTrailService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<
      ActorRequest & {
        method: string;
        body?: unknown;
        params?: Record<string, string | undefined>;
        routeOptions?: { url?: string };
      }
    >();
    if (READ_METHODS.has(request.method.toUpperCase())) return next.handle();

    const access = resolveRouteAccess(
      (key, target) => this.reflector.get(key, target as never),
      context.getHandler(),
      context.getClass(),
      request.method,
    );
    if (access?.kind !== 'capability') return next.handle();
    if (access.capability.endsWith('.view')) return next.handle();
    if (!this.audit.inWorkspace()) return next.handle();

    const routePath = request.routeOptions?.url ?? '';
    const status =
      this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler()) ??
      (request.method.toUpperCase() === 'POST'
        ? HttpStatus.CREATED
        : HttpStatus.OK);

    return next.handle().pipe(
      tap((responseBody) => {
        void this.audit.record({
          actor: request.classifyreActor ?? ANONYMOUS_ACTOR,
          channel: 'rest',
          capability: access.capability,
          operation: `${request.method.toUpperCase()} ${routePath}`,
          ...routeEntity(routePath, request.params ?? {}, responseBody),
          fields: inputFields(request.body),
          status,
        });
      }),
    );
  }
}
