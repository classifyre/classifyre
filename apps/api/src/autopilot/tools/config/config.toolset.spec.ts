import { ConfigToolset } from './config.toolset';
import type { PrismaService } from '../../../prisma.service';
import type { ValidationService } from '../../../validation.service';
import type { MaskedConfigCryptoService } from '../../../masked-config-crypto.service';
import type { CliRunnerService } from '../../../cli-runner/cli-runner.service';
import type { DecisionApplierService } from '../../decision-applier.service';
import type { Tool, ToolContext } from '../tool.types';

describe('ConfigToolset — config.tune_source', () => {
  const baseConfig = {
    required: { host: 'h', workspace: 'w' },
    masked: { token: 'secret' },
    detectors: [{ type: 'PII', enabled: true }],
    sampling: { strategy: 'RANDOM' },
  };

  const mockPrisma = {
    source: { findUnique: jest.fn(), update: jest.fn() },
    runner: { findUnique: jest.fn() },
  };
  const mockValidation = { validate: jest.fn((_t: string, c: unknown) => c) };
  const mockMasked = {
    decryptMaskedConfig: jest.fn((c: unknown) => c),
    encryptMaskedConfig: jest.fn((c: unknown) => c),
  };
  const mockApplier = { sourceGate: jest.fn() };
  const mockCliRunner = { startRun: jest.fn() };

  const toolset = new ConfigToolset(
    mockPrisma as unknown as PrismaService,
    mockValidation as unknown as ValidationService,
    mockMasked as unknown as MaskedConfigCryptoService,
    mockApplier as unknown as DecisionApplierService,
    mockCliRunner as unknown as CliRunnerService,
  );
  const tune = toolset
    .list()
    .find((t) => t.name === 'config.tune_source') as Tool;
  const tc = { ctx: { run: { id: 'r1' } } } as unknown as ToolContext;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.source.findUnique.mockResolvedValue({
      type: 'SLACK',
      config: baseConfig,
    });
    mockValidation.validate.mockImplementation((_t, c) => c);
    mockMasked.decryptMaskedConfig.mockImplementation((c) => c);
    mockMasked.encryptMaskedConfig.mockImplementation((c) => c);
  });

  it('rejects a patch that targets the base connection (masked/required)', async () => {
    await expect(
      tune.handler({ sourceId: 's1', patch: { masked: { token: 'x' } } }, tc),
    ).rejects.toThrow(/base connection/i);
    expect(mockPrisma.source.update).not.toHaveBeenCalled();
  });

  it('rejects a patch with a non-editable key', async () => {
    await expect(
      tune.handler({ sourceId: 's1', patch: { name: 'x' } }, tc),
    ).rejects.toThrow(/not editable/i);
    expect(mockPrisma.source.update).not.toHaveBeenCalled();
  });

  it('applies an editable change while leaving base connection byte-identical', async () => {
    await tune.handler(
      {
        sourceId: 's1',
        patch: { detectors: [{ type: 'SECRETS', enabled: true }] },
      },
      tc,
    );
    expect(mockValidation.validate).toHaveBeenCalled();
    const written = mockPrisma.source.update.mock.calls[0]![0].data.config;
    expect(written.required).toEqual(baseConfig.required);
    expect(written.masked).toEqual(baseConfig.masked);
    expect(written.detectors).toEqual([{ type: 'SECRETS', enabled: true }]);
  });

  it('refuses to write when validation would alter the base connection', async () => {
    mockValidation.validate.mockImplementation((_t, c) => ({
      ...(c as object),
      masked: { token: 'tampered' },
    }));
    await expect(
      tune.handler(
        { sourceId: 's1', patch: { sampling: { strategy: 'LATEST' } } },
        tc,
      ),
    ).rejects.toThrow(/base connection/i);
    expect(mockPrisma.source.update).not.toHaveBeenCalled();
  });

  it('throws on unknown sourceId', async () => {
    mockPrisma.source.findUnique.mockResolvedValue(null);
    await expect(
      tune.handler({ sourceId: 'ghost', patch: { sampling: {} } }, tc),
    ).rejects.toThrow(/Unknown sourceId/);
  });
});

describe('ConfigToolset — sources.rescan', () => {
  const mockPrisma = {
    source: { findUnique: jest.fn(), update: jest.fn() },
    runner: { findUnique: jest.fn() },
  };
  const mockCliRunner = { startRun: jest.fn() };
  const mockApplier = { sourceGate: jest.fn() };

  const toolset = new ConfigToolset(
    mockPrisma as unknown as PrismaService,
    { validate: jest.fn() } as unknown as ValidationService,
    {} as unknown as MaskedConfigCryptoService,
    mockApplier as unknown as DecisionApplierService,
    mockCliRunner as unknown as CliRunnerService,
  );
  const rescan = toolset
    .list()
    .find((t) => t.name === 'sources.rescan') as Tool;

  const ctxWith = (runnerId: string | null): ToolContext =>
    ({ ctx: { runnerId, run: { id: 'r1' } } }) as unknown as ToolContext;

  beforeEach(() => jest.clearAllMocks());

  it('starts an AUTOPILOT-tagged run when not a verification cycle', async () => {
    mockPrisma.runner.findUnique.mockResolvedValue({ triggerType: 'MANUAL' });
    mockCliRunner.startRun.mockResolvedValue({ id: 'run-new' });

    const res = (await rescan.handler(
      { sourceId: 's1' },
      ctxWith('run-1'),
    )) as {
      ok?: boolean;
      runnerId?: string;
    };

    expect(mockCliRunner.startRun).toHaveBeenCalledWith(
      's1',
      'AUTOPILOT',
      expect.any(String),
    );
    expect(res.ok).toBe(true);
    expect(res.runnerId).toBe('run-new');
  });

  it('suppresses the rescan when the current cycle is itself a verification run', async () => {
    mockPrisma.runner.findUnique.mockResolvedValue({
      triggerType: 'AUTOPILOT',
    });

    const res = (await rescan.handler(
      { sourceId: 's1' },
      ctxWith('run-ai'),
    )) as {
      skipped?: string;
    };

    expect(mockCliRunner.startRun).not.toHaveBeenCalled();
    expect(res.skipped).toMatch(/verification/i);
  });

  it('returns a graceful skip when a scan is already running', async () => {
    mockPrisma.runner.findUnique.mockResolvedValue({ triggerType: 'MANUAL' });
    mockCliRunner.startRun.mockRejectedValue(
      new Error('scan already in progress'),
    );

    const res = (await rescan.handler(
      { sourceId: 's1' },
      ctxWith('run-1'),
    )) as {
      skipped?: string;
    };

    expect(res.skipped).toMatch(/already in progress/i);
  });
});
