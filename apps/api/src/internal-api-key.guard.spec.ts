import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { InternalApiKeyService } from './internal-api-key.service';
import {
  InternalApiKeyGuard,
  InternalOnlyException,
} from './internal-api-key.guard';
import { INTERNAL_ONLY_KEY } from './internal-only.decorator';
import { DemoModeGuard } from './demo-mode.guard';
import { DemoModeService } from './demo-mode.service';
import { DemoModeException } from './demo-mode.exception';
import { ALLOW_IN_DEMO_MODE_KEY } from './demo-mode.decorator';

const KEY = 'test-internal-key-0123456789';

function contextFor(
  request: { method: string; headers?: Record<string, unknown> },
  metadata: Record<string, boolean> = {},
): ExecutionContext {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key: unknown) => metadata[key as string]);
  return {
    reflector,
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext & { reflector: Reflector };
}

function guards(env: { key?: string; demo?: boolean; bypass?: string }) {
  const previousKey = process.env.CLASSIFYRE_INTERNAL_KEY;
  const previousDemo = process.env.DEMO_MODE;
  const previousBypass = process.env.DEMO_MODE_BYPASS_KEY;
  process.env.CLASSIFYRE_INTERNAL_KEY = env.key ?? '';
  process.env.DEMO_MODE = env.demo ? 'true' : 'false';
  process.env.DEMO_MODE_BYPASS_KEY = env.bypass ?? '';
  const internalApiKey = new InternalApiKeyService();
  const demoMode = new DemoModeService();
  process.env.CLASSIFYRE_INTERNAL_KEY = previousKey;
  process.env.DEMO_MODE = previousDemo;
  process.env.DEMO_MODE_BYPASS_KEY = previousBypass;
  return { internalApiKey, demoMode };
}

describe('InternalApiKeyGuard', () => {
  it('rejects an @InternalOnly() call without the key', () => {
    const { internalApiKey } = guards({ key: KEY });
    const ctx = contextFor(
      { method: 'POST', headers: {} },
      { [INTERNAL_ONLY_KEY]: true },
    );
    const guard = new InternalApiKeyGuard(
      internalApiKey,
      (ctx as unknown as { reflector: Reflector }).reflector,
    );

    expect(() => guard.canActivate(ctx)).toThrow(InternalOnlyException);
  });

  it('rejects a wrong key', () => {
    const { internalApiKey } = guards({ key: KEY });
    const ctx = contextFor(
      { method: 'POST', headers: { 'x-classifyre-internal-key': 'nope' } },
      { [INTERNAL_ONLY_KEY]: true },
    );
    const guard = new InternalApiKeyGuard(
      internalApiKey,
      (ctx as unknown as { reflector: Reflector }).reflector,
    );

    expect(() => guard.canActivate(ctx)).toThrow(InternalOnlyException);
  });

  it('accepts the configured key', () => {
    const { internalApiKey } = guards({ key: KEY });
    const ctx = contextFor(
      { method: 'POST', headers: { 'x-classifyre-internal-key': KEY } },
      { [INTERNAL_ONLY_KEY]: true },
    );
    const guard = new InternalApiKeyGuard(
      internalApiKey,
      (ctx as unknown as { reflector: Reflector }).reflector,
    );

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('is inert when no key is configured, so local dev is unaffected', () => {
    const { internalApiKey } = guards({});
    const ctx = contextFor(
      { method: 'POST', headers: {} },
      { [INTERNAL_ONLY_KEY]: true },
    );
    const guard = new InternalApiKeyGuard(
      internalApiKey,
      (ctx as unknown as { reflector: Reflector }).reflector,
    );

    expect(guard.canActivate(ctx)).toBe(true);
  });
});

describe('DemoModeGuard with an internal key', () => {
  it('lets CLI jobs write back on a demo instance', () => {
    const { internalApiKey, demoMode } = guards({ key: KEY, demo: true });
    const ctx = contextFor({
      method: 'POST',
      headers: { 'x-classifyre-internal-key': KEY },
    });
    const guard = new DemoModeGuard(
      demoMode,
      internalApiKey,
      (ctx as unknown as { reflector: Reflector }).reflector,
    );

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('still blocks public writes on a demo instance', () => {
    const { internalApiKey, demoMode } = guards({ key: KEY, demo: true });
    const ctx = contextFor({ method: 'POST', headers: {} });
    const guard = new DemoModeGuard(
      demoMode,
      internalApiKey,
      (ctx as unknown as { reflector: Reflector }).reflector,
    );

    expect(() => guard.canActivate(ctx)).toThrow(DemoModeException);
  });

  it('still allows explicitly demo-safe read POSTs', () => {
    const { internalApiKey, demoMode } = guards({ key: KEY, demo: true });
    const ctx = contextFor(
      { method: 'POST', headers: {} },
      { [ALLOW_IN_DEMO_MODE_KEY]: true },
    );
    const guard = new DemoModeGuard(
      demoMode,
      internalApiKey,
      (ctx as unknown as { reflector: Reflector }).reflector,
    );

    expect(guard.canActivate(ctx)).toBe(true);
  });
});

describe('DemoModeGuard with the bypass header', () => {
  const BYPASS = 'test-bypass-key-0123456789';

  function demoGuard(ctx: ExecutionContext, bypass?: string) {
    const { internalApiKey, demoMode } = guards({ demo: true, bypass });
    return new DemoModeGuard(
      demoMode,
      internalApiKey,
      (ctx as unknown as { reflector: Reflector }).reflector,
    );
  }

  it('lets an operator write to a demo instance', () => {
    const ctx = contextFor({
      method: 'DELETE',
      headers: { 'x-bypass-demo': BYPASS },
    });

    expect(demoGuard(ctx, BYPASS).canActivate(ctx)).toBe(true);
  });

  it('rejects a wrong bypass key', () => {
    const ctx = contextFor({
      method: 'POST',
      headers: { 'x-bypass-demo': 'nope' },
    });

    expect(() => demoGuard(ctx, BYPASS).canActivate(ctx)).toThrow(
      DemoModeException,
    );
  });

  it('ignores the header when no bypass key is configured', () => {
    const ctx = contextFor({
      method: 'POST',
      headers: { 'x-bypass-demo': '' },
    });

    expect(() => demoGuard(ctx).canActivate(ctx)).toThrow(DemoModeException);
  });
});
