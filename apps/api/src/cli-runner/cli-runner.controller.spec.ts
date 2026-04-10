import { CliRunnerController } from './cli-runner.controller';
import { ALLOW_IN_DEMO_MODE_KEY } from '../demo-mode.decorator';

describe('CliRunnerController demo mode metadata', () => {
  it('allows internal runner status updates in demo mode', () => {
    const updateRunnerStatus = Object.getOwnPropertyDescriptor(
      CliRunnerController.prototype,
      'updateRunnerStatus',
    )?.value;

    expect(
      Reflect.getMetadata(ALLOW_IN_DEMO_MODE_KEY, updateRunnerStatus),
    ).toBe(true);
  });

  it('keeps runner creation endpoints blocked in demo mode', () => {
    const startRunner = Object.getOwnPropertyDescriptor(
      CliRunnerController.prototype,
      'startRunner',
    )?.value;
    const createExternalRunner = Object.getOwnPropertyDescriptor(
      CliRunnerController.prototype,
      'createExternalRunner',
    )?.value;

    expect(
      Reflect.getMetadata(ALLOW_IN_DEMO_MODE_KEY, startRunner),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(ALLOW_IN_DEMO_MODE_KEY, createExternalRunner),
    ).toBeUndefined();
  });
});
