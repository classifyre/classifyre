import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Severity } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications.service';
import {
  NotificationEvent,
  NotificationType,
} from '../types/notification.types';
import { parseActorRef } from '../identity/actor-ref';
import {
  effectiveRoles,
  type GovernanceRoleKind,
  type RoleRow,
} from './governance-rules';

const ROLE_WORD: Record<GovernanceRoleKind, string> = {
  OWNER: 'owner',
  STEWARD: 'steward',
  CUSTODIAN: 'custodian',
};

/** Split principal refs into people (`user:`) and groups (`group:<id>` → id). */
export function audienceOf(refs: readonly string[], except?: string | null) {
  const personRefs: string[] = [];
  const groupIds: string[] = [];
  for (const ref of new Set(refs)) {
    if (ref === except) continue;
    const parsed = parseActorRef(ref);
    if (parsed.kind === 'user') personRefs.push(ref);
    if (parsed.kind === 'group') groupIds.push(parsed.id);
  }
  return { personRefs, groupIds };
}

/**
 * Tells the people who answer for data what concerns them (GOV G-5): that
 * they were named owner, steward or custodian; that a quality rule of their
 * asset started failing; that someone else changed its lifecycle. Sent to
 * people by name and to groups, never to the workspace at large. Never fails
 * the change it reports.
 */
@Injectable()
export class GovernanceNotifier {
  private readonly logger = new Logger(GovernanceNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Provided by the app module; looked up so this module need not own it. */
  private notifications(): NotificationsService | null {
    try {
      return this.moduleRef.get(NotificationsService, { strict: false });
    } catch {
      return null;
    }
  }

  private async send(
    to: { personRefs: string[]; groupIds: string[] },
    note: {
      event: NotificationEvent;
      title: string;
      message: string;
      actionUrl: string;
      severity?: Severity;
      findingId?: string;
      sourceId?: string;
      triggeredBy?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.notifications()?.createFor(
        {
          type: NotificationType.GOVERNANCE,
          event: note.event,
          severity: note.severity ?? 'INFO',
          title: note.title,
          message: note.message,
          actionUrl: note.actionUrl,
          ...(note.findingId ? { findingId: note.findingId } : {}),
          ...(note.sourceId ? { sourceId: note.sourceId } : {}),
          ...(note.triggeredBy ? { triggeredBy: note.triggeredBy } : {}),
          ...(note.metadata ? { metadata: note.metadata } : {}),
        },
        to,
      );
    } catch (error) {
      this.logger.warn(`Governance notification not sent: ${String(error)}`);
    }
  }

  /** Owners and stewards of an asset (its own, else its source's). */
  async answerFor(assetId: string): Promise<string[]> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { sourceId: true },
    });
    if (!asset) return [];
    const [own, source] = await Promise.all([
      this.prisma.governanceRole.findMany({
        where: { scopeType: 'ASSET', scopeId: assetId },
      }),
      this.prisma.governanceRole.findMany({
        where: { scopeType: 'SOURCE', scopeId: asset.sourceId },
      }),
    ]);
    return effectiveRoles(own as RoleRow[], source as RoleRow[])
      .filter((role) => role.role === 'OWNER' || role.role === 'STEWARD')
      .map((role) => role.principalRef);
  }

  async roleAssigned(input: {
    scope: 'asset' | 'source';
    id: string;
    name: string;
    role: GovernanceRoleKind;
    principalRef: string;
    actorRef: string | null;
  }): Promise<void> {
    const to = audienceOf([input.principalRef], input.actorRef);
    const word = ROLE_WORD[input.role];
    const isGroup = to.groupIds.length > 0;
    await this.send(to, {
      event: NotificationEvent.GOVERNANCE_ROLE_ASSIGNED,
      title: isGroup
        ? `Your group is now ${word} of ${input.name}`
        : `You are now ${word} of ${input.name}`,
      message:
        input.role === 'OWNER'
          ? `You answer for this ${input.scope}: you can describe and certify it, query its tables, and decide who else may read them.`
          : input.role === 'STEWARD'
            ? `You keep this ${input.scope}'s description, meaning, columns and quality up to date.`
            : `You are the technical contact for this ${input.scope}.`,
      actionUrl: `/${input.scope === 'asset' ? 'assets' : 'sources'}/${input.id}?tab=governance`,
      ...(input.scope === 'source' ? { sourceId: input.id } : {}),
      triggeredBy: input.actorRef,
      metadata: { [`${input.scope}Id`]: input.id, role: input.role },
    });
  }

  /** A rule that was passing (or never measured) now fails. */
  async qualityFailing(input: {
    assetId: string;
    assetName: string;
    sourceId: string;
    ruleKey: string;
    ruleName: string;
    severity: Severity;
    text: string;
    findingId: string;
  }): Promise<void> {
    await this.send(audienceOf(await this.answerFor(input.assetId)), {
      event: NotificationEvent.GOVERNANCE_QUALITY_FAILING,
      severity: input.severity,
      title: `Quality rule failing on ${input.assetName}`,
      message: input.text,
      actionUrl: `/assets/${input.assetId}?tab=governance`,
      findingId: input.findingId,
      sourceId: input.sourceId,
      metadata: { assetId: input.assetId, ruleKey: input.ruleKey },
    });
  }

  /**
   * A SQL connection of someone's changed by someone else (DQ §5.7): given to
   * them, revoked, or blocked on a table or source. Only its person hears.
   */
  async connectionChanged(input: {
    kind: 'issued' | 'revoked' | 'blocked' | 'unblocked';
    connectionId: string;
    connectionName: string;
    personRef: string;
    actorRef: string | null;
    scopeName?: string;
    reason?: string | null;
  }): Promise<void> {
    if (input.personRef === input.actorRef) return;
    const text = {
      issued: {
        event: NotificationEvent.GOVERNANCE_CONNECTION_ISSUED,
        title: `You were given the SQL connection ${input.connectionName}`,
        message:
          'Open it to get its password, once. It reads what you may query, nothing more.',
      },
      revoked: {
        event: NotificationEvent.GOVERNANCE_CONNECTION_REVOKED,
        title: `Your SQL connection ${input.connectionName} was revoked`,
        message: input.reason ?? 'Tools using it can no longer sign in.',
      },
      blocked: {
        event: NotificationEvent.GOVERNANCE_CONNECTION_BLOCKED,
        title: `${input.scopeName ?? 'A table'} is closed to your SQL connection ${input.connectionName}`,
        message:
          input.reason ??
          'Its owner closed it to this connection; the rest of the connection still works.',
      },
      unblocked: {
        event: NotificationEvent.GOVERNANCE_CONNECTION_BLOCKED,
        title: `${input.scopeName ?? 'A table'} is open again to your SQL connection ${input.connectionName}`,
        message: 'Its owner lifted the block.',
      },
    }[input.kind];
    await this.send(audienceOf([input.personRef]), {
      ...text,
      actionUrl: `/settings?tab=sql-connections&connection=${input.connectionId}`,
      triggeredBy: input.actorRef,
      metadata: { connectionId: input.connectionId, kind: input.kind },
    });
  }

  /** Someone changed the lifecycle: the others who answer for it hear of it. */
  async statusChanged(input: {
    assetId: string;
    assetName: string;
    status: string;
    actorRef: string | null;
  }): Promise<void> {
    const word: Record<string, string> = {
      ACTIVE: 'certified',
      DRAFT: 'set back to draft',
      DEPRECATED: 'deprecated',
      RETIRED: 'retired',
    };
    await this.send(
      audienceOf(await this.answerFor(input.assetId), input.actorRef),
      {
        event: NotificationEvent.GOVERNANCE_STATUS_CHANGED,
        title: `${input.assetName} was ${word[input.status] ?? input.status.toLowerCase()}`,
        message:
          input.status === 'DEPRECATED' || input.status === 'RETIRED'
            ? 'Work built on it should move elsewhere.'
            : 'Its governance changed.',
        actionUrl: `/assets/${input.assetId}?tab=governance`,
        triggeredBy: input.actorRef,
        metadata: { assetId: input.assetId, status: input.status },
      },
    );
  }
}
