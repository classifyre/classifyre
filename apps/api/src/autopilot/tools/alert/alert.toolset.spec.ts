import { AiManagementMode, Severity } from '@prisma/client';
import { AlertToolset } from './alert.toolset';
import type { PrismaService } from '../../../prisma.service';
import type { NotificationsService } from '../../../notifications.service';
import type { Tool, ToolContext } from '../tool.types';

describe('AlertToolset — operator.notify', () => {
  const mockPrisma = {
    case: { findUnique: jest.fn() },
    notification: { findMany: jest.fn() },
  };
  const mockNotifications = { create: jest.fn() };

  const toolset = new AlertToolset(
    mockPrisma as unknown as PrismaService,
    mockNotifications as unknown as NotificationsService,
  );
  const notify = toolset
    .list()
    .find((t) => t.name === 'operator.notify') as Tool;

  const ctxWith = (escalationEnabled: boolean): ToolContext =>
    ({
      ctx: {
        run: { id: 'r1' },
        settings: { autopilotEscalationEnabled: escalationEnabled },
      },
    }) as unknown as ToolContext;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.case.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'Leaked credentials',
      severity: Severity.CRITICAL,
      status: 'OPEN',
    });
    mockNotifications.create.mockResolvedValue({ id: 'n1' });
  });

  it('gates MANAGED only when the escalation switch is on', async () => {
    const on = await notify.resolveGate!({}, ctxWith(true));
    const off = await notify.resolveGate!({}, ctxWith(false));
    expect(on.mode).toBe(AiManagementMode.MANAGED);
    expect(off.mode).toBe(AiManagementMode.OBSERVE_ONLY);
  });

  it('creates a case.escalated notification linked to the case', async () => {
    const res = (await notify.handler(
      {
        caseId: 'c1',
        title: 'Critical case needs review',
        message: 'A critical case is open with strong evidence.',
        severity: Severity.CRITICAL,
      },
      ctxWith(true),
    )) as { notificationId: string; caseId: string };

    expect(mockNotifications.create).toHaveBeenCalledTimes(1);
    const arg = mockNotifications.create.mock.calls[0]![0];
    expect(arg.event).toBe('case.escalated');
    expect(arg.severity).toBe(Severity.CRITICAL);
    expect(arg.actionUrl).toBe('/cases/c1');
    expect(arg.isImportant).toBe(true); // CRITICAL defaults to important
    expect(arg.metadata.caseId).toBe('c1');
    expect(res.notificationId).toBe('n1');
    expect(res.caseId).toBe('c1');
  });

  it('defaults isImportant to false for a low-severity alert', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'Minor',
      severity: Severity.LOW,
      status: 'OPEN',
    });
    await notify.handler(
      {
        caseId: 'c1',
        title: 'Minor case',
        message: 'Low severity heads-up.',
        severity: Severity.LOW,
      },
      ctxWith(true),
    );
    expect(mockNotifications.create.mock.calls[0]![0].isImportant).toBe(false);
  });

  it('throws (recorded FAILED by the dispatcher) when the case is gone', async () => {
    mockPrisma.case.findUnique.mockResolvedValue(null);
    await expect(
      notify.handler(
        {
          caseId: 'ghost',
          title: 't',
          message: 'm',
          severity: Severity.HIGH,
        },
        ctxWith(true),
      ),
    ).rejects.toThrow(/not found/i);
    expect(mockNotifications.create).not.toHaveBeenCalled();
  });
});

describe('AlertToolset — alerts.recent', () => {
  const mockPrisma = {
    case: { findUnique: jest.fn() },
    notification: { findMany: jest.fn() },
  };
  const toolset = new AlertToolset(
    mockPrisma as unknown as PrismaService,
    { create: jest.fn() } as unknown as NotificationsService,
  );
  const recent = toolset.list().find((t) => t.name === 'alerts.recent') as Tool;
  const tc = {} as ToolContext;

  beforeEach(() => jest.clearAllMocks());

  it('surfaces the caseId from each escalation notification metadata', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      {
        id: 'n1',
        severity: Severity.CRITICAL,
        title: 'A',
        isRead: false,
        createdAt: new Date(0),
        metadata: { caseId: 'c1' },
      },
      {
        id: 'n2',
        severity: Severity.HIGH,
        title: 'B',
        isRead: true,
        createdAt: new Date(0),
        metadata: null,
      },
    ]);

    const rows = (await recent.handler({}, tc)) as Array<{
      caseId: string | null;
      read: boolean;
    }>;

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { event: 'case.escalated' } }),
    );
    expect(rows[0].caseId).toBe('c1');
    expect(rows[1].caseId).toBeNull();
    expect(rows[1].read).toBe(true);
  });
});
