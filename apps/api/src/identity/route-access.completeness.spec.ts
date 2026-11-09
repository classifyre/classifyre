import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { resolveRouteAccess, type RouteAccess } from './route-access';
import { CAPABILITY_IDS } from './capabilities';
import { BUILT_IN_ROLES } from './roles';

interface DiscoveredRoute {
  controller: string;
  handler: string;
  method: string;
  path: string;
  access: RouteAccess | null;
}

const SRC = path.resolve(__dirname, '..');

function controllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts'))
      return [];
    return fs.readFileSync(full, 'utf8').includes('@Controller(') ? [full] : [];
  });
}

/**
 * Every route the API serves, read from the real controller classes, with the
 * access their decorators resolve to.
 */
function discoverRoutes(): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const file of controllerFiles(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(file) as Record<string, unknown>;
    for (const candidate of Object.values(exported)) {
      if (typeof candidate !== 'function') continue;
      const prefix = Reflect.getMetadata(PATH_METADATA, candidate) as
        | string
        | undefined;
      if (prefix === undefined) continue;
      const proto = (candidate as { prototype: Record<string, unknown> })
        .prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
          | RequestMethod
          | undefined;
        if (verb === undefined) continue;
        const method = RequestMethod[verb];
        routes.push({
          controller: candidate.name,
          handler: name,
          method,
          path: `/${[prefix, Reflect.getMetadata(PATH_METADATA, handler)]
            .filter((part) => part && part !== '/')
            .join('/')}`,
          access: resolveRouteAccess(
            (key, target) => Reflect.getMetadata(key, target) as never,
            handler,
            candidate,
            method,
          ),
        });
      }
    }
  }
  return routes;
}

describe('route access completeness', () => {
  const routes = discoverRoutes();

  it('finds the controllers', () => {
    expect(routes.length).toBeGreaterThan(400);
  });

  it('gives every route a capability, or marks it public or internal', () => {
    const undeclared = routes
      .filter((route) => route.access === null)
      .map(
        (route) =>
          `${route.controller}.${route.handler} ${route.method} ${route.path}`,
      );
    expect(undeclared).toEqual([]);
  });

  it('only declares capabilities from the catalogue', () => {
    const unknown = routes.filter(
      (route) =>
        route.access?.kind === 'capability' &&
        !(CAPABILITY_IDS as readonly string[]).includes(
          route.access.capability,
        ),
    );
    expect(unknown).toEqual([]);
  });

  it('keeps public routes to health, crawler files and the query callback', () => {
    const publicRoutes = routes
      .filter((route) => route.access?.kind === 'public')
      .map((route) => `${route.controller}.${route.handler}`)
      .sort();
    expect(publicRoutes).toEqual([
      // A query job's result: checked against the run's own token instead.
      'DataQueryController.receive',
      'HealthController.getHealth',
      'HealthController.ping',
      'SitemapController.getEntries',
      'SitemapController.getIndex',
    ]);
  });

  const printTo = process.env.PRINT_ROUTE_ACCESS;
  if (printTo) {
    it('prints the route table', () => {
      const lines = routes
        .map((route) => {
          const access =
            route.access?.kind === 'capability'
              ? route.access.capability
              : (route.access?.kind ?? 'UNDECLARED');
          return `${access.padEnd(24)} ${route.method.padEnd(6)} ${route.path}  (${route.controller}.${route.handler})`;
        })
        .sort();
      fs.writeFileSync(printTo, lines.join('\n') + '\n');
    });
  }
});

describe('built-in roles', () => {
  it('give Workspace admin every workspace capability except writing code', () => {
    const admin = BUILT_IN_ROLES.find((role) => role.key === 'workspace-admin');
    const workspaceCapabilities = CAPABILITY_IDS.filter(
      (id) =>
        !id.startsWith('tenant.') &&
        !id.startsWith('platform.') &&
        id !== 'code.author',
    );
    expect([...(admin?.capabilities ?? [])].sort()).toEqual(
      [...workspaceCapabilities].sort(),
    );
  });

  it('only use capabilities from the catalogue', () => {
    for (const role of BUILT_IN_ROLES) {
      for (const capability of role.capabilities) {
        expect(CAPABILITY_IDS).toContain(capability);
      }
    }
  });

  it('give every capability to at least one role', () => {
    const granted = new Set<string>(
      BUILT_IN_ROLES.flatMap((role) => [...role.capabilities]),
    );
    expect(CAPABILITY_IDS.filter((id) => !granted.has(id))).toEqual([]);
  });
});
