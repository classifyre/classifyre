import { IamBootstrapService } from './iam-bootstrap.service';
import type { IdentityService } from './identity.service';

describe('IamBootstrapService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stays not ready until identity.bootstrap() succeeds after retries', async () => {
    const bootstrap = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('identity server starting'))
      .mockResolvedValueOnce(undefined);
    const service = new IamBootstrapService({
      bootstrap,
    } as unknown as IdentityService);

    expect(service.isReady()).toBe(false);

    service.onApplicationBootstrap();
    await Promise.resolve();
    await Promise.resolve();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(service.isReady()).toBe(false);

    await jest.advanceTimersByTimeAsync(5_000);
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(service.isReady()).toBe(true);

    service.onApplicationShutdown();
  });

  it('cancels pending retries on application shutdown', async () => {
    const bootstrap = jest
      .fn<Promise<void>, []>()
      .mockRejectedValue(new Error('still booting'));
    const service = new IamBootstrapService({
      bootstrap,
    } as unknown as IdentityService);

    service.onApplicationBootstrap();
    await Promise.resolve();
    await Promise.resolve();
    expect(bootstrap).toHaveBeenCalledTimes(1);

    service.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(15_000);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(service.isReady()).toBe(false);
  });
});
