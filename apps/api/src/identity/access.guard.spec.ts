import 'reflect-metadata';
import { Controller, Get, Post, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AllowInDemoMode } from '../demo-mode.decorator';
import { InternalOnly } from '../internal-only.decorator';
import { AccessArea, PublicRoute, Requires } from './access.decorators';
import { AccessGuard, CapabilityRequiredException } from './access.guard';
import type { AccessPolicy } from './access-policy';
import type { Actor } from './actor';
import type { ActorContextService } from './actor-context.service';
import type { Capability } from './capabilities';

@AccessArea({ view: 'source.view', change: 'source.manage' })
@Controller('sources')
class SampleController {
  @Get()
  list() {}

  @Post()
  create() {}

  @AllowInDemoMode()
  @Post('search')
  search() {}

  @Requires('source.run')
  @Post(':id/run')
  run() {}

  @InternalOnly()
  @Post(':id/assets')
  ingest() {}
}

@Controller()
class UndeclaredController {
  @Get('anything')
  anything() {}
}

@PublicRoute()
@Controller()
class OpenController {
  @Get('ping')
  ping() {}
}

function contextFor(
  controller: new () => object,
  handler: string,
  method: string,
  headers: Record<string, unknown> = {},
) {
  const request: Record<string, unknown> = { method, headers };
  const context = {
    getType: () => 'http',
    getHandler: () =>
      (controller.prototype as Record<string, unknown>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('AccessGuard', () => {
  let checked: Capability[];
  let allow: boolean;
  let current: Actor | undefined;

  const policy: AccessPolicy = {
    check: (_actor, capability) => {
      checked.push(capability);
      return { allow };
    },
    capabilities: () => new Set(),
  };
  const actors = {
    set: (actor: Actor) => {
      current = actor;
    },
  } as unknown as ActorContextService;
  const internalKey = {
    isInternalRequest: (headers?: Record<string, unknown>) =>
      headers?.['x-internal'] === 'yes',
  };
  const guard = new AccessGuard(
    new Reflector(),
    actors,
    internalKey as never,
    policy,
    null,
  );

  beforeEach(() => {
    checked = [];
    allow = true;
    current = undefined;
  });

  it.each([
    ['list', 'GET', 'source.view'],
    ['create', 'POST', 'source.manage'],
    ['search', 'POST', 'source.view'],
    ['run', 'POST', 'source.run'],
  ])(
    'asks the policy for the capability of %s',
    async (handler, method, capability) => {
      const { context } = contextFor(SampleController, handler, method);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(checked).toEqual([capability]);
    },
  );

  it('refuses with the missing capability when the policy denies', async () => {
    allow = false;
    const { context } = contextFor(SampleController, 'create', 'POST');
    await expect(guard.canActivate(context)).rejects.toThrow(
      CapabilityRequiredException,
    );
  });

  it('leaves internal routes to the internal key guard', async () => {
    allow = false;
    const { context } = contextFor(SampleController, 'ingest', 'POST');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(checked).toEqual([]);
  });

  it('lets public routes through without a check', async () => {
    allow = false;
    const { context } = contextFor(OpenController, 'ping', 'GET');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('refuses a route that declares nothing', async () => {
    const { context } = contextFor(UndeclaredController, 'anything', 'GET');
    await expect(guard.canActivate(context)).rejects.toThrow(
      CapabilityRequiredException,
    );
  });

  it('resolves the actor from X-Actor-Name and leaves it on the request', async () => {
    const { context, request } = contextFor(SampleController, 'list', 'GET', {
      'x-actor-name': encodeURIComponent('Jordan Reyes'),
    });
    await guard.canActivate(context);
    expect(current).toMatchObject({
      kind: 'person',
      via: 'header',
      displayName: 'Jordan Reyes',
      ref: 'Jordan Reyes',
    });
    expect(request.classifyreActor).toBe(current);
  });

  it('marks internal-key callers as the system actor', async () => {
    const { context } = contextFor(SampleController, 'list', 'GET', {
      'x-internal': 'yes',
    });
    await guard.canActivate(context);
    expect(current).toMatchObject({ kind: 'system', via: 'internal-key' });
  });
});
