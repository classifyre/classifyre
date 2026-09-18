import { Reflector } from '@nestjs/core';
import { NamespacePausedGuard } from './namespace-paused.guard';
import { NamespacePausedException } from './namespace-pause.service';
import { ALLOW_WHEN_PAUSED_KEY } from './allow-when-paused.decorator';
import { BLOCK_WHEN_PAUSED_KEY } from './block-when-paused.decorator';
import type { ExecutionContext } from '@nestjs/common';

/**
 * A paused workspace stays workable: reads of any method, CRUD, sync
 * recomputation and diagnostics pass. Only @BlockWhenPaused handlers — the
 * ones that start scans, jobs, schedules or AI runs — get a 409.
 */
describe('NamespacePausedGuard', () => {
  const build = (over: {
    namespaceId?: string;
    paused?: boolean;
    allowWhenPaused?: boolean;
    blockWhenPaused?: boolean;
    internal?: boolean;
  }) => {
    const pause = {
      namespaceId: () => over.namespaceId,
      isPaused: jest.fn().mockResolvedValue(over.paused ?? false),
    };
    const internalApiKey = {
      isInternalRequest: jest.fn().mockReturnValue(over.internal ?? false),
    };
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) => {
        if (key === BLOCK_WHEN_PAUSED_KEY) return over.blockWhenPaused ?? false;
        if (key === ALLOW_WHEN_PAUSED_KEY) return over.allowWhenPaused ?? false;
        return false;
      });
    const guard = new NamespacePausedGuard(
      pause as never,
      internalApiKey as never,
      reflector,
    );
    return { guard, pause };
  };

  const ctxFor = (method: string, url = '/sources'): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ method, url, headers: {} }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  it('lets reads through while paused', async () => {
    const { guard, pause } = build({ namespaceId: 'n1', paused: true });
    await expect(guard.canActivate(ctxFor('GET'))).resolves.toBe(true);
    expect(pause.isPaused).not.toHaveBeenCalled();
  });

  it('lets unmarked mutations (CRUD, read-POSTs) through while paused', async () => {
    const { guard, pause } = build({ namespaceId: 'n1', paused: true });
    // Search, findings and charts queries are POSTs — still reads.
    await expect(
      guard.canActivate(ctxFor('POST', '/assets/findings')),
    ).resolves.toBe(true);
    await expect(guard.canActivate(ctxFor('POST', '/sources'))).resolves.toBe(
      true,
    );
    // Default-allow does not even consult the pause registry.
    expect(pause.isPaused).not.toHaveBeenCalled();
  });

  it('rejects @BlockWhenPaused while paused with a 409 naming resume', async () => {
    const { guard, pause } = build({
      namespaceId: 'n1',
      paused: true,
      blockWhenPaused: true,
    });
    const failure = await guard
      .canActivate(ctxFor('POST', '/sources/s1/runs'))
      .catch((e) => e);
    expect(failure).toBeInstanceOf(NamespacePausedException);
    expect(failure.getStatus()).toBe(409);
    expect(failure.message).toMatch(/paused/i);
    expect(pause.isPaused).toHaveBeenCalled();
  });

  it('lets @BlockWhenPaused through while running', async () => {
    const { guard } = build({
      namespaceId: 'n1',
      paused: false,
      blockWhenPaused: true,
    });
    await expect(
      guard.canActivate(ctxFor('POST', '/sources/s1/runs')),
    ).resolves.toBe(true);
  });

  it('ignores requests outside any namespace (registry pause/resume itself)', async () => {
    const { guard, pause } = build({ namespaceId: undefined });
    await expect(
      guard.canActivate(ctxFor('PATCH', '/namespaces/n1')),
    ).resolves.toBe(true);
    expect(pause.isPaused).not.toHaveBeenCalled();
  });

  it('honours @AllowWhenPaused (stop/cancel wind-down endpoints)', async () => {
    const { guard } = build({
      namespaceId: 'n1',
      paused: true,
      allowWhenPaused: true,
    });
    await expect(
      guard.canActivate(ctxFor('PATCH', '/runners/r1/stop')),
    ).resolves.toBe(true);
  });

  it('lets CLI result callbacks through while paused', async () => {
    const { guard } = build({
      namespaceId: 'n1',
      paused: true,
      internal: true,
    });
    await expect(
      guard.canActivate(ctxFor('PATCH', '/runners/r1/status')),
    ).resolves.toBe(true);
  });

  it('still blocks runner creation even with the internal key', async () => {
    const { guard } = build({
      namespaceId: 'n1',
      paused: true,
      internal: true,
    });
    await expect(
      guard.canActivate(ctxFor('POST', '/sources/s1/runners/external')),
    ).rejects.toBeInstanceOf(NamespacePausedException);
  });

  it('registers its metadata under the documented keys', () => {
    expect(ALLOW_WHEN_PAUSED_KEY).toBe('allowWhenPaused');
    expect(BLOCK_WHEN_PAUSED_KEY).toBe('blockWhenPaused');
  });
});
