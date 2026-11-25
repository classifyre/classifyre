import { DataRequestState, Severity } from '@prisma/client';
import {
  NotificationEvent,
  NotificationType,
} from '../types/notification.types';
import { DataRequestNotifier } from './data-request.notifier';

describe('DataRequestNotifier', () => {
  function setup(opts: {
    hasNotifications?: boolean;
    createForReject?: Error;
    dataset?: { domain: string; name: string } | null;
    linkedRequests?: Array<{
      caseId: string;
      requesterRef: string;
      case: { title: string };
    }>;
  } = {}) {
    let unavailableCb:
      | ((event: { assetId: string; reason: string }) => Promise<void> | void)
      | null = null;

    const notifications = {
      createFor: opts.createForReject
        ? jest.fn(() => Promise.reject(opts.createForReject))
        : jest.fn(() => Promise.resolve()),
    };

    const moduleRef = {
      get: jest.fn(() => {
        if (opts.hasNotifications === false) {
          throw new Error('not registered');
        }
        return notifications;
      }),
    };

    const prisma = {
      sharedDataset: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            opts.dataset === undefined
              ? { domain: 'finance', name: 'monthly_orders' }
              : opts.dataset,
          ),
        ),
      },
      dataRequest: {
        findMany: jest.fn(() => Promise.resolve(opts.linkedRequests ?? [])),
      },
    };

    const resolver = {
      onUnavailable: jest.fn(
        (cb: (event: { assetId: string; reason: string }) => Promise<void>) => {
          unavailableCb = cb;
        },
      ),
    };

    const notifier = new DataRequestNotifier(
      moduleRef as never,
      prisma as never,
      resolver as never,
    );

    return {
      notifier,
      notifications,
      prisma,
      resolver,
      triggerUnavailable: async (event: { assetId: string; reason: string }) => {
        if (!unavailableCb) throw new Error('onModuleInit not called');
        await unavailableCb(event);
      },
    };
  }

  it('registers an onUnavailable listener onModuleInit and fans out to non-closed linked requests', async () => {
    const ctx = setup({
      linkedRequests: [
        {
          caseId: 'case-1',
          requesterRef: 'user:alice',
          case: { title: 'Monthly orders' },
        },
        {
          caseId: 'case-2',
          requesterRef: 'user:bob',
          case: { title: 'Q4 rollup' },
        },
      ],
    });

    ctx.notifier.onModuleInit();
    expect(ctx.resolver.onUnavailable).toHaveBeenCalledTimes(1);

    await ctx.triggerUnavailable({
      assetId: 'ds-1',
      reason: 'upstream table removed',
    });

    expect(ctx.prisma.dataRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          datasetAssetId: 'ds-1',
          state: {
            notIn: [DataRequestState.DECLINED, DataRequestState.WITHDRAWN],
          },
        },
      }),
    );
    expect(ctx.notifications.createFor).toHaveBeenCalledTimes(2);
    expect(ctx.notifications.createFor).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: NotificationType.GOVERNANCE,
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_DATASET_UNAVAILABLE,
        severity: Severity.HIGH,
        actionUrl: '/cases/case-1',
        metadata: {
          caseId: 'case-1',
          datasetName: 'shared.finance.monthly_orders',
        },
      }),
      { personRefs: ['user:alice'] },
    );
    expect(ctx.notifications.createFor).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actionUrl: '/cases/case-2',
      }),
      { personRefs: ['user:bob'] },
    );
  });

  it('skips fan-out when the dataset or linked requests are missing', async () => {
    const missingDs = setup({ dataset: null, linkedRequests: [] });
    missingDs.notifier.onModuleInit();
    await missingDs.triggerUnavailable({ assetId: 'ds-gone', reason: 'gone' });
    expect(missingDs.notifications.createFor).not.toHaveBeenCalled();

    const noLinked = setup({ linkedRequests: [] });
    noLinked.notifier.onModuleInit();
    await noLinked.triggerUnavailable({ assetId: 'ds-1', reason: 'broken' });
    expect(noLinked.notifications.createFor).not.toHaveBeenCalled();
  });

  it('sends governance notifications for submitted, assigned, delivered, changesRequested, declined, and withdrawn', async () => {
    const { notifier, notifications } = setup();

    await notifier.submitted({
      caseId: 'c1',
      title: 'Revenue',
      routeGroupId: 'grp-data',
      requesterName: 'Alice',
      triggeredBy: 'user:alice',
    });
    expect(notifications.createFor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_SUBMITTED,
        actionUrl: '/cases/c1',
      }),
      { groupIds: ['grp-data'] },
    );

    await notifier.assigned({
      caseId: 'c1',
      title: 'Revenue',
      to: { personRefs: ['user:alice'] },
      summary: 'Bob claimed this request.',
      triggeredBy: 'user:bob',
    });
    expect(notifications.createFor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_ASSIGNED,
      }),
      { personRefs: ['user:alice'] },
    );

    await notifier.delivered({
      caseId: 'c1',
      title: 'Revenue',
      requesterRef: 'user:alice',
      datasetName: 'shared.finance.revenue',
      version: 2,
      triggeredBy: 'user:bob',
    });
    expect(notifications.createFor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_DELIVERED,
        metadata: {
          caseId: 'c1',
          datasetName: 'shared.finance.revenue',
          version: 2,
        },
      }),
      { personRefs: ['user:alice'] },
    );

    await notifier.changesRequested({
      caseId: 'c1',
      title: 'Revenue',
      routeGroupId: 'grp-data',
      requesterName: 'Alice',
      reason: 'Add currency',
      triggeredBy: 'user:alice',
    });
    expect(notifications.createFor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_CHANGES_REQUESTED,
      }),
      { groupIds: ['grp-data'] },
    );

    await notifier.declined({
      caseId: 'c1',
      title: 'Revenue',
      requesterRef: 'user:alice',
      reason: 'PII not approved',
      triggeredBy: 'user:bob',
    });
    expect(notifications.createFor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_DECLINED,
      }),
      { personRefs: ['user:alice'] },
    );

    await notifier.withdrawn({
      caseId: 'c1',
      title: 'Revenue',
      routeGroupId: 'grp-data',
      requesterName: 'Alice',
      triggeredBy: 'user:alice',
    });
    expect(notifications.createFor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_WITHDRAWN,
      }),
      { groupIds: ['grp-data'] },
    );
  });

  it('does not throw when NotificationsService is unavailable or createFor fails', async () => {
    const noSvc = setup({ hasNotifications: false });
    await expect(
      noSvc.notifier.submitted({
        caseId: 'c1',
        title: 'Revenue',
        routeGroupId: 'grp-data',
        requesterName: 'Alice',
      }),
    ).resolves.toBeUndefined();

    const failing = setup({ createForReject: new Error('db down') });
    await expect(
      failing.notifier.declined({
        caseId: 'c1',
        title: 'Revenue',
        requesterRef: 'user:alice',
        reason: 'no',
      }),
    ).resolves.toBeUndefined();
  });
});
