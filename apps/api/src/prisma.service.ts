import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { PrismaClientManager } from './prisma/prisma-client-manager';
import { CLS_SCHEMA } from './namespace/namespace.constants';

/**
 * Property names accessed by frameworks/language probes, never by tenant data
 * access: the promise protocol (`await` / `Promise.resolve` test for a thenable)
 * and Nest's lifecycle-hook detection. PrismaService is a facade that
 * implements none of these, so returning `undefined` is correct in and out of a
 * namespace context — and prevents a spurious "outside namespace" throw during
 * DI / shutdown.
 */
const FRAMEWORK_PROBES = new Set<string>([
  'then',
  'catch',
  'finally',
  'onModuleInit',
  'onModuleDestroy',
  'onApplicationBootstrap',
  'onApplicationShutdown',
  'beforeApplicationShutdown',
]);

/**
 * Namespace-aware Prisma facade.
 *
 * Every service still injects `PrismaService` and calls it exactly as before
 * (`this.prisma.source.findMany()`, `this.prisma.$transaction(...)`, …). At
 * runtime this object is a Proxy: any Prisma member access is forwarded to the
 * {@link PrismaClient} for the schema in the current CLS context, so the same
 * call resolves to `ns_acme` or `ns_globex` depending on the request/worker
 * that is running.
 *
 * The `interface PrismaService extends PrismaClient` declaration below merges
 * PrismaClient's typed members onto this class so all existing call sites keep
 * full type-safety without the class actually extending (and constructing) a
 * real PrismaClient.
 *
 * Accessing Prisma outside any namespace context (no schema in CLS) throws —
 * this deliberately surfaces bugs where tenant data is touched from a
 * non-namespaced code path. Non-tenant code (health, the namespace registry)
 * must not use this service.
 */
@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class PrismaService {
  constructor(
    private readonly cls: ClsService,
    private readonly manager: PrismaClientManager,
  ) {
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        if (typeof prop === 'string' && FRAMEWORK_PROBES.has(prop)) {
          return undefined;
        }
        const schema = target.cls.get<string>(CLS_SCHEMA);
        if (!schema) {
          // Symbols (inspection, promise unwrapping, etc.) must not throw.
          if (typeof prop === 'symbol') return undefined;
          throw new Error(
            `PrismaService accessed outside a namespace context (prop=${String(
              prop,
            )}). Tenant data can only be read within a resolved namespace.`,
          );
        }
        const client = target.manager.get(schema);
        const value = Reflect.get(client, prop, client);
        return typeof value === 'function' ? value.bind(client) : value;
      },
    });
  }
}

// Declaration merge: give the class PrismaClient's typed surface (delegates,
// $transaction, $queryRaw, …) so existing call sites type-check unchanged.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface PrismaService extends PrismaClient {}
