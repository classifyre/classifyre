import { ConflictException } from '@nestjs/common';
import { ConfigToolset } from './config.toolset';
import type { PrismaService } from '../../../prisma.service';
import type { ValidationService } from '../../../validation.service';
import type { MaskedConfigCryptoService } from '../../../masked-config-crypto.service';
import type { CliRunnerService } from '../../../cli-runner/cli-runner.service';
import type { NotificationsService } from '../../../notifications.service';
import type { DecisionApplierService } from '../../decision-applier.service';
import type { Tool, ToolContext } from '../tool.types';

describe('ConfigToolset — config.tune_source', () => {
  const baseConfig = {
    required: { host: 'h', workspace: 'w' },
    masked: { token: 'secret' },
    detectors: [{ type: 'PII', enabled: true }],
    sampling: { strategy: 'RANDOM' },
  };
  const UPDATED_AT = new Date('2026-07-20T12:00:00.000Z');
  const VERSION = UPDATED_AT.toISOString();

  const mockPrisma = {
    source: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    runner: { findUnique: jest.fn() },
  };
  const mockValidation = { validate: jest.fn((_t: string, c: unknown) => c) };
  const mockMasked = {
    decryptMaskedConfig: jest.fn((c: unknown) => c),
    encryptMaskedConfig: jest.fn((c: unknown) => c),
  };
  const mockApplier = { sourceGate: jest.fn() };
  const mockCliRunner = { startRun: jest.fn() };
  const mockNotifications = { create: jest.fn() };

  const toolset = new ConfigToolset(
    mockPrisma as unknown as PrismaService,
    mockValidation as unknown as ValidationService,
    mockMasked as unknown as MaskedConfigCryptoService,
    mockApplier as unknown as DecisionApplierService,
    mockCliRunner as unknown as CliRunnerService,
    mockNotifications as unknown as NotificationsService,
  );
  const tune = toolset
    .list()
    .find((t) => t.name === 'config.tune_source') as Tool;
  const tc = { ctx: { run: { id: 'r1' } } } as unknown as ToolContext;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.source.findUnique.mockResolvedValue({
      name: 'Guzman mailbox',
      type: 'SLACK',
      config: baseConfig,
      updatedAt: UPDATED_AT,
    });
    mockPrisma.source.updateMany.mockResolvedValue({ count: 1 });
    mockValidation.validate.mockImplementation((_t, c) => c);
    mockMasked.decryptMaskedConfig.mockImplementation((c) => c);
    mockMasked.encryptMaskedConfig.mockImplementation((c) => c);
  });

  it('rejects a patch that targets the base connection (masked/required)', async () => {
    await expect(
      tune.handler(
        {
          sourceId: 's1',
          patch: { masked: { token: 'x' } },
          expectedVersion: VERSION,
        },
        tc,
      ),
    ).rejects.toThrow(/base connection/i);
    expect(mockPrisma.source.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a patch with a non-editable key', async () => {
    await expect(
      tune.handler(
        { sourceId: 's1', patch: { name: 'x' }, expectedVersion: VERSION },
        tc,
      ),
    ).rejects.toThrow(/not editable/i);
    expect(mockPrisma.source.updateMany).not.toHaveBeenCalled();
  });

  it('applies an editable change while leaving base connection byte-identical', async () => {
    await tune.handler(
      {
        sourceId: 's1',
        patch: { detectors: [{ type: 'SECRETS', enabled: true }] },
        expectedVersion: VERSION,
      },
      tc,
    );
    expect(mockValidation.validate).toHaveBeenCalled();
    const call = mockPrisma.source.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ id: 's1', updatedAt: UPDATED_AT });
    const written = call.data.config;
    expect(written.required).toEqual(baseConfig.required);
    expect(written.masked).toEqual(baseConfig.masked);
    expect(written.detectors).toEqual([{ type: 'SECRETS', enabled: true }]);
  });

  it('raises an operator notification when it changes the config', async () => {
    await tune.handler(
      {
        sourceId: 's1',
        patch: { detectors: [{ type: 'SECRETS', enabled: true }] },
        expectedVersion: VERSION,
      },
      tc,
    );
    expect(mockNotifications.create).toHaveBeenCalledTimes(1);
    const arg = mockNotifications.create.mock.calls[0]![0];
    expect(arg.sourceId).toBe('s1');
    expect(arg.event).toBe('source.config_changed');
    expect(arg.metadata.changedKeys).toEqual(['detectors']);
  });

  it('refuses (and does not clobber) when the source changed since it was read', async () => {
    // Operator saved a new config after the agent read version VERSION.
    await expect(
      tune.handler(
        {
          sourceId: 's1',
          patch: { detectors: [] },
          expectedVersion: '2026-07-20T11:59:00.000Z',
        },
        tc,
      ),
    ).rejects.toThrow(/changed since you read it/i);
    expect(mockPrisma.source.updateMany).not.toHaveBeenCalled();
    expect(mockNotifications.create).not.toHaveBeenCalled();
  });

  it('requires expectedVersion', async () => {
    await expect(
      tune.handler({ sourceId: 's1', patch: { detectors: [] } }, tc),
    ).rejects.toThrow(/expectedVersion is required/i);
    expect(mockPrisma.source.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when a concurrent write wins the update race (count 0)', async () => {
    mockPrisma.source.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      tune.handler(
        {
          sourceId: 's1',
          patch: { detectors: [] },
          expectedVersion: VERSION,
        },
        tc,
      ),
    ).rejects.toThrow(/modified concurrently/i);
    expect(mockNotifications.create).not.toHaveBeenCalled();
  });

  it('refuses to write when validation would alter the base connection', async () => {
    mockValidation.validate.mockImplementation((_t, c) => ({
      ...(c as object),
      masked: { token: 'tampered' },
    }));
    await expect(
      tune.handler(
        {
          sourceId: 's1',
          patch: { sampling: { strategy: 'LATEST' } },
          expectedVersion: VERSION,
        },
        tc,
      ),
    ).rejects.toThrow(/base connection/i);
    expect(mockPrisma.source.updateMany).not.toHaveBeenCalled();
  });

  it('throws on unknown sourceId', async () => {
    mockPrisma.source.findUnique.mockResolvedValue(null);
    await expect(
      tune.handler(
        {
          sourceId: 'ghost',
          patch: { sampling: {} },
          expectedVersion: VERSION,
        },
        tc,
      ),
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
  const mockNotifications = { create: jest.fn() };

  const toolset = new ConfigToolset(
    mockPrisma as unknown as PrismaService,
    { validate: jest.fn() } as unknown as ValidationService,
    {} as unknown as MaskedConfigCryptoService,
    mockApplier as unknown as DecisionApplierService,
    mockCliRunner as unknown as CliRunnerService,
    mockNotifications as unknown as NotificationsService,
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
    // The rescan is surfaced so a config-change + auto-rescan is never silent.
    expect(mockNotifications.create).toHaveBeenCalledTimes(1);
    const arg = mockNotifications.create.mock.calls[0]![0];
    expect(arg.event).toBe('source.autopilot_rescan');
    expect(arg.sourceId).toBe('s1');
    expect(arg.runnerId).toBe('run-new');
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

  it('returns a graceful skip when a scan is already running (ConflictException)', async () => {
    mockPrisma.runner.findUnique.mockResolvedValue({ triggerType: 'MANUAL' });
    mockCliRunner.startRun.mockRejectedValue(
      new ConflictException('Source s1 already has a running scan'),
    );

    const res = (await rescan.handler(
      { sourceId: 's1' },
      ctxWith('run-1'),
    )) as {
      skipped?: string;
    };

    expect(res.skipped).toMatch(/already has a running scan/i);
  });

  it('propagates infrastructure errors so the dispatcher records FAILED', async () => {
    mockPrisma.runner.findUnique.mockResolvedValue({ triggerType: 'MANUAL' });
    const prismaError = new Error(
      'Invalid input value for enum "TriggerType": "AUTOPILOT"',
    );
    prismaError.name = 'PrismaClientValidationError';
    mockCliRunner.startRun.mockRejectedValue(prismaError);

    await expect(
      rescan.handler({ sourceId: 's1' }, ctxWith('run-1')),
    ).rejects.toThrow(/TriggerType/);
  });
});
