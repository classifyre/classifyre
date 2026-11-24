import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataRequestState, Severity } from '@prisma/client';
import { NotificationsService } from '../notifications.service';
import {
  NotificationEvent,
  NotificationType,
} from '../types/notification.types';
import { PrismaService } from '../prisma.service';
import { SharedDatasetResolver } from '../data-query/shared-dataset-resolver';

/**
 * Notifications for data requests (docs/prd/DR-data-requests.md §4.4).
 *
 * Uses `NotificationType.GOVERNANCE` via `NotificationsService.createFor` with
 * links to `/cases/<id>`, mirroring `GovernanceNotifier`. Never fails the
 * caller if delivery throws.
 */
@Injectable()
export class DataRequestNotifier implements OnModuleInit {
  private readonly logger = new Logger(DataRequestNotifier.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaService,
    private readonly resolver: SharedDatasetResolver,
  ) {}

  onModuleInit(): void {
    this.resolver.onUnavailable(async ({ assetId, reason }) => {
      const [dataset, requests] = await Promise.all([
        this.prisma.sharedDataset.findUnique({
          where: { assetId },
          select: { domain: true, name: true },
        }),
        this.prisma.dataRequest.findMany({
          where: {
            datasetAssetId: assetId,
            state: {
              notIn: [DataRequestState.DECLINED, DataRequestState.WITHDRAWN],
            },
          },
          select: {
            caseId: true,
            requesterRef: true,
            case: { select: { title: true } },
          },
        }),
      ]);
      if (!dataset || !requests.length) return;
      const datasetName = `shared.${dataset.domain}.${dataset.name}`;
      for (const req of requests) {
        await this.datasetUnavailable({
          caseId: req.caseId,
          title: req.case.title,
          requesterRef: req.requesterRef,
          datasetName,
          reason,
        });
      }
    });
  }

  private notifications(): NotificationsService | null {
    try {
      return this.moduleRef.get(NotificationsService, { strict: false });
    } catch {
      return null;
    }
  }

  private async send(
    to: { personRefs?: string[]; groupIds?: string[] },
    note: {
      event: NotificationEvent;
      severity: Severity;
      title: string;
      message: string;
      caseId: string;
      metadata?: Record<string, unknown>;
      triggeredBy?: string;
    },
  ): Promise<void> {
    const notifications = this.notifications();
    if (!notifications) return;
    if (!to.personRefs?.length && !to.groupIds?.length) return;
    try {
      await notifications.createFor(
        {
          type: NotificationType.GOVERNANCE,
          event: note.event,
          severity: note.severity,
          title: note.title,
          message: note.message,
          actionUrl: `/cases/${note.caseId}`,
          metadata: { caseId: note.caseId, ...note.metadata },
          triggeredBy: note.triggeredBy,
        },
        to,
      );
    } catch (error) {
      this.logger.warn(
        `Could not send data-request notification ${note.event}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async submitted(input: {
    caseId: string;
    title: string;
    routeGroupId: string;
    requesterName: string;
    triggeredBy?: string;
  }): Promise<void> {
    await this.send(
      { groupIds: [input.routeGroupId] },
      {
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_SUBMITTED,
        severity: Severity.MEDIUM,
        title: `New data request: ${input.title}`,
        message: `${input.requesterName} requested a shared dataset routed to your group.`,
        caseId: input.caseId,
        metadata: { routeGroupId: input.routeGroupId },
        triggeredBy: input.triggeredBy,
      },
    );
  }

  async assigned(input: {
    caseId: string;
    title: string;
    to: { personRefs?: string[]; groupIds?: string[] };
    summary: string;
    metadata?: Record<string, unknown>;
    triggeredBy?: string;
  }): Promise<void> {
    await this.send(input.to, {
      event: NotificationEvent.GOVERNANCE_DATA_REQUEST_ASSIGNED,
      severity: Severity.INFO,
      title: `Data request updated: ${input.title}`,
      message: input.summary,
      caseId: input.caseId,
      metadata: input.metadata,
      triggeredBy: input.triggeredBy,
    });
  }

  async delivered(input: {
    caseId: string;
    title: string;
    requesterRef: string;
    datasetName: string;
    version: number;
    triggeredBy?: string;
  }): Promise<void> {
    await this.send(
      { personRefs: [input.requesterRef] },
      {
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_DELIVERED,
        severity: Severity.INFO,
        title: `Dataset delivered: ${input.title}`,
        message: `${input.datasetName} (v${input.version}) is ready to use.`,
        caseId: input.caseId,
        metadata: { datasetName: input.datasetName, version: input.version },
        triggeredBy: input.triggeredBy,
      },
    );
  }

  async changesRequested(input: {
    caseId: string;
    title: string;
    routeGroupId: string;
    requesterName: string;
    reason: string;
    triggeredBy?: string;
  }): Promise<void> {
    await this.send(
      { groupIds: [input.routeGroupId] },
      {
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_CHANGES_REQUESTED,
        severity: Severity.MEDIUM,
        title: `Changes requested: ${input.title}`,
        message: `${input.requesterName} asked for changes: ${input.reason}`,
        caseId: input.caseId,
        metadata: { routeGroupId: input.routeGroupId },
        triggeredBy: input.triggeredBy,
      },
    );
  }

  async declined(input: {
    caseId: string;
    title: string;
    requesterRef: string;
    reason: string;
    triggeredBy?: string;
  }): Promise<void> {
    await this.send(
      { personRefs: [input.requesterRef] },
      {
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_DECLINED,
        severity: Severity.LOW,
        title: `Data request declined: ${input.title}`,
        message: input.reason,
        caseId: input.caseId,
        triggeredBy: input.triggeredBy,
      },
    );
  }

  async withdrawn(input: {
    caseId: string;
    title: string;
    routeGroupId: string;
    requesterName: string;
    triggeredBy?: string;
  }): Promise<void> {
    await this.send(
      { groupIds: [input.routeGroupId] },
      {
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_WITHDRAWN,
        severity: Severity.INFO,
        title: `Data request withdrawn: ${input.title}`,
        message: `${input.requesterName} withdrew this request.`,
        caseId: input.caseId,
        metadata: { routeGroupId: input.routeGroupId },
        triggeredBy: input.triggeredBy,
      },
    );
  }

  async datasetUnavailable(input: {
    caseId: string;
    title: string;
    requesterRef: string;
    datasetName: string;
    reason: string;
  }): Promise<void> {
    await this.send(
      { personRefs: [input.requesterRef] },
      {
        event: NotificationEvent.GOVERNANCE_DATA_REQUEST_DATASET_UNAVAILABLE,
        severity: Severity.HIGH,
        title: `Dataset unavailable: ${input.title}`,
        message: `${input.datasetName} can no longer be read: ${input.reason}`,
        caseId: input.caseId,
        metadata: { datasetName: input.datasetName },
      },
    );
  }
}
