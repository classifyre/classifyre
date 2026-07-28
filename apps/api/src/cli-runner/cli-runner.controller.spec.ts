import { CliRunnerController } from './cli-runner.controller';
import { ALLOW_IN_DEMO_MODE_KEY } from '../demo-mode.decorator';
import { INTERNAL_ONLY_KEY } from '../internal-only.decorator';

const handler = (name: string) =>
  Object.getOwnPropertyDescriptor(CliRunnerController.prototype, name)?.value;

describe('CliRunnerController endpoint access metadata', () => {
  it('reserves the CLI write-back endpoints for internal callers', () => {
    // These accept ingestion payloads at face value and the API has no user
    // auth, so they must never be reachable from the public web proxy — in
    // demo mode or otherwise.
    for (const name of [
      'createExternalRunner',
      'updateRunnerStatus',
      'registerDiscoveredAssets',
      'updateRunnerAssetStatuses',
    ]) {
      expect(Reflect.getMetadata(INTERNAL_ONLY_KEY, handler(name))).toBe(true);
    }
  });

  it('does not mark internal endpoints as demo-mode safe', () => {
    // The internal key is what lets a CLI job through DemoModeGuard; the
    // demo allow-list must not also open them to the public.
    expect(
      Reflect.getMetadata(
        ALLOW_IN_DEMO_MODE_KEY,
        handler('updateRunnerStatus'),
      ),
    ).toBeUndefined();
  });

  it('keeps operator-triggered runner endpoints blocked in demo mode', () => {
    for (const name of ['startRunner', 'stopRunner', 'deleteRunner']) {
      expect(
        Reflect.getMetadata(ALLOW_IN_DEMO_MODE_KEY, handler(name)),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(INTERNAL_ONLY_KEY, handler(name)),
      ).toBeUndefined();
    }
  });

  it('keeps log search readable in demo mode', () => {
    // POST only because the filter set does not fit a query string.
    expect(
      Reflect.getMetadata(ALLOW_IN_DEMO_MODE_KEY, handler('searchRunnerLogs')),
    ).toBe(true);
  });
});
