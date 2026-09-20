import { CorrelationController } from './correlation.controller';

jest.mock('@kubernetes/client-node', () => ({}));

// GENESIS field report P6: new weights and exclusions were saved but never
// recomputed, although every one of these endpoints promised a recompute.
describe('CorrelationController config changes', () => {
  const correlation = {
    saveConfig: jest.fn().mockResolvedValue({ labels: [] }),
    addExclusion: jest.fn().mockResolvedValue({ labels: [] }),
    removeExclusion: jest.fn().mockResolvedValue({ labels: [] }),
    scheduleFullRecompute: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new CorrelationController(correlation as any, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('schedules a full recompute after saving weights', async () => {
    await controller.updateConfig({ labelWeights: { tag_x: 0 } });
    expect(correlation.saveConfig).toHaveBeenCalled();
    expect(correlation.scheduleFullRecompute).toHaveBeenCalledTimes(1);
  });

  it('schedules a full recompute after adding or removing an exclusion', async () => {
    await controller.addExclusion({ mode: 'label', label: 'tag_x' } as any);
    await controller.removeExclusion('rule-1');
    expect(correlation.scheduleFullRecompute).toHaveBeenCalledTimes(2);
  });
});
