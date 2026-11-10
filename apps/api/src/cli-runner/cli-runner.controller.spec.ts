import { CliRunnerController } from './cli-runner.controller';
import { READS_ONLY_KEY } from '../reads-only.decorator';
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
      // Reads the namespace on a connector's behalf; the notebook never
      // gets credentials, so neither may the public proxy.
      'queryAssets',
    ]) {
      expect(Reflect.getMetadata(INTERNAL_ONLY_KEY, handler(name))).toBe(true);
    }
  });

  it('does not mark internal endpoints as read-only', () => {
    // The internal key is what lets a CLI job write back; marking them as
    // reads would open them to read-only people.
    expect(
      Reflect.getMetadata(READS_ONLY_KEY, handler('updateRunnerStatus')),
    ).toBeUndefined();
  });

  it('keeps operator-triggered runner endpoints blocked in demo mode', () => {
    for (const name of [
      'startRunner',
      'stopRunner',
      'deleteRunner',
      'bulkStopRunners',
      'bulkDeleteRunners',
      'bulkRerunScans',
    ]) {
      expect(
        Reflect.getMetadata(READS_ONLY_KEY, handler(name)),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(INTERNAL_ONLY_KEY, handler(name)),
      ).toBeUndefined();
    }
  });

  it('keeps log search readable in demo mode', () => {
    // POST only because the filter set does not fit a query string.
    expect(
      Reflect.getMetadata(READS_ONLY_KEY, handler('searchRunnerLogs')),
    ).toBe(true);
  });
});
