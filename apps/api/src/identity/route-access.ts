import { ALLOW_IN_DEMO_MODE_KEY } from '../demo-mode.decorator';
import { INTERNAL_ONLY_KEY } from '../internal-only.decorator';
import {
  ACCESS_AREA_KEY,
  PUBLIC_ROUTE_KEY,
  REQUIRES_KEY,
  type AccessAreaOptions,
} from './access.decorators';
import type { Capability } from './capabilities';

export type RouteAccess =
  | { kind: 'public' }
  /** `@InternalOnly()`: the internal key guard decides, not the access policy. */
  | { kind: 'internal' }
  | { kind: 'capability'; capability: Capability };

/** Reads metadata the way `Reflector.get` does; injectable for specs. */
export type MetadataReader = <T>(key: string, target: object) => T | undefined;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The access a route needs, from its decorators. Handler metadata wins over
 * controller metadata. Returns null when the route declares nothing, which
 * the guard refuses and a spec forbids.
 */
export function resolveRouteAccess(
  read: MetadataReader,
  handler: object,
  controller: object,
  httpMethod: string,
): RouteAccess | null {
  const onHandler = <T>(key: string) => read<T>(key, handler);
  const onEither = <T>(key: string) =>
    read<T>(key, handler) ?? read<T>(key, controller);

  const handlerCapability = onHandler<Capability>(REQUIRES_KEY);
  if (handlerCapability)
    return { kind: 'capability', capability: handlerCapability };
  if (onEither<boolean>(PUBLIC_ROUTE_KEY)) return { kind: 'public' };
  if (onEither<boolean>(INTERNAL_ONLY_KEY)) return { kind: 'internal' };

  const controllerCapability = read<Capability>(REQUIRES_KEY, controller);
  if (controllerCapability) {
    return { kind: 'capability', capability: controllerCapability };
  }

  const area = read<AccessAreaOptions>(ACCESS_AREA_KEY, controller);
  if (!area) return null;
  const isRead =
    READ_METHODS.has(httpMethod.toUpperCase()) ||
    onEither<boolean>(ALLOW_IN_DEMO_MODE_KEY) === true;
  return { kind: 'capability', capability: isRead ? area.view : area.change };
}
