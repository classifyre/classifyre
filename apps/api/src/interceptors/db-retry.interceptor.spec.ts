import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { defer, firstValueFrom, of, throwError } from 'rxjs';
import { DbRetryInterceptor } from './db-retry.interceptor';
import { READ_ONLY_ENDPOINT } from '../db/read-only-endpoint.decorator';

function transientError(code = 'P2028'): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError(
    'Transaction API error: Unable to start a transaction in the given time.',
    { code, clientVersion: '7.8.0' },
  );
}

function context(
  method: string,
  { readOnly = false, sent = false } = {},
): { ctx: ExecutionContext; reflector: Reflector } {
  const ctx = {
    getType: () => 'http',
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ method, url: '/search/runners' }),
      getResponse: () => ({ sent }),
    }),
  } as unknown as ExecutionContext;

  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key: unknown) =>
      key === READ_ONLY_ENDPOINT ? readOnly : undefined,
    );

  return { ctx, reflector };
}

/** Handler that fails `failures` times before returning `value`. */
function flakyHandler(failures: number, value = 'ok', code = 'P2028') {
  let calls = 0;
  const handler: CallHandler = {
    handle: () =>
      defer(() => {
        calls += 1;
        return calls <= failures
          ? throwError(() => transientError(code))
          : of(value);
      }),
  };
  return { handler, calls: () => calls };
}

describe('DbRetryInterceptor', () => {
  const interceptorFor = (reflector: Reflector) =>
    new DbRetryInterceptor(reflector);

  it('retries a GET that fails with a transient error and returns the eventual result', async () => {
    const { ctx, reflector } = context('GET');
    const { handler, calls } = flakyHandler(2);

    const result = await firstValueFrom(
      interceptorFor(reflector).intercept(ctx, handler),
    );

    expect(result).toBe('ok');
    expect(calls()).toBe(3);
  });

  it('retries a POST handler marked read-only', async () => {
    const { ctx, reflector } = context('POST', { readOnly: true });
    const { handler, calls } = flakyHandler(1);

    await expect(
      firstValueFrom(interceptorFor(reflector).intercept(ctx, handler)),
    ).resolves.toBe('ok');
    expect(calls()).toBe(2);
  });

  it('does not retry a mutating POST', async () => {
    const { ctx, reflector } = context('POST');
    const { handler, calls } = flakyHandler(1);

    await expect(
      firstValueFrom(interceptorFor(reflector).intercept(ctx, handler)),
    ).rejects.toThrow('Unable to start a transaction');
    expect(calls()).toBe(1);
  });

  it('gives up after the attempt budget and rethrows the original error', async () => {
    const { ctx, reflector } = context('GET');
    const { handler, calls } = flakyHandler(10);

    await expect(
      firstValueFrom(interceptorFor(reflector).intercept(ctx, handler)),
    ).rejects.toThrow('Unable to start a transaction');
    expect(calls()).toBe(3);
  });

  it('does not retry a non-transient error', async () => {
    const { ctx, reflector } = context('GET');
    // P2002 = unique constraint violation: a real error, not a blip.
    const { handler, calls } = flakyHandler(1, 'ok', 'P2002');

    await expect(
      firstValueFrom(interceptorFor(reflector).intercept(ctx, handler)),
    ).rejects.toBeInstanceOf(PrismaClientKnownRequestError);
    expect(calls()).toBe(1);
  });

  it('does not retry once the response has started streaming', async () => {
    const { ctx, reflector } = context('GET', { sent: true });
    const { handler, calls } = flakyHandler(1);

    await expect(
      firstValueFrom(interceptorFor(reflector).intercept(ctx, handler)),
    ).rejects.toThrow('Unable to start a transaction');
    expect(calls()).toBe(1);
  });
});
