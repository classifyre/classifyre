import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { InternalApiKeyService } from './internal-api-key.service';
import {
  InternalApiKeyGuard,
  InternalOnlyException,
} from './internal-api-key.guard';
import { INTERNAL_ONLY_KEY } from './internal-only.decorator';

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

function guards(env: { key?: string }) {
  const previousKey = process.env.CLASSIFYRE_INTERNAL_KEY;
  process.env.CLASSIFYRE_INTERNAL_KEY = env.key ?? '';
  const internalApiKey = new InternalApiKeyService();
  process.env.CLASSIFYRE_INTERNAL_KEY = previousKey;
  return { internalApiKey };
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
