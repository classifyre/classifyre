import { Injectable } from '@nestjs/common';
import {
  AgentDecisionAction,
  AiManagementMode,
  Severity,
} from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { NotificationsService } from '../../../notifications.service';
import {
  NotificationType,
  NotificationEvent,
} from '../../../types/notification.types';
import { AI_ACTOR } from '../../autopilot.constants';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

/** Severities the operator can be alerted about (highest-signal first). */
const ALERT_SEVERITIES = [
  Severity.CRITICAL,
  Severity.HIGH,
  Severity.MEDIUM,
  Severity.LOW,
  Severity.INFO,
] as const;

/** How many recent escalations the agent may inspect to avoid re-alerting. */
const RECENT_ALERTS_LIMIT = 30;

/**
 * Alerting/escalation tools. The escalation agent reviews open cases and, when a
 * high-severity one appears, raises an operator notification through the same
 * NotificationsService the rest of the system uses — so it lands in the operator
 * inbox and is pushed over the notifications websocket in real time.
 *
 * The agent mutates nothing in the investigation graph; `operator.notify` is its
 * only write, gated by the instance escalation switch (system-level, like the
 * memory/brief tools). `alerts.recent` lets it dedupe so the same case is not
 * alerted twice.
 */
@Injectable()
export class AlertToolset {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Escalation is a system-level action. It is MANAGED (allowed) whenever the
   * instance escalation switch is on — which the worker guarantees is true for
   * any cycle that runs the ESCALATION mission (scan cycles gate on the flag;
   * manual/targeted runs force it on). Off ⇒ OBSERVE_ONLY, so a stray call is
   * recorded but not delivered.
   */
  private escalationGate = (
    _input: unknown,
    tc: ToolContext,
  ): Promise<ToolGate> =>
    Promise.resolve({
      mode: tc.ctx.settings.autopilotEscalationEnabled
        ? AiManagementMode.MANAGED
        : AiManagementMode.OBSERVE_ONLY,
      entityType: 'system',
    });

  list(): Tool[] {
    return [
      {
        name: 'alerts.recent',
        description:
          'List the operator notifications the escalation agent has already raised about cases (most recent first), each with its caseId, severity and read state. Check this BEFORE notifying so you never alert the same case twice.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async () => {
          const rows = await this.prisma.notification.findMany({
            where: { event: NotificationEvent.CASE_ESCALATED },
            orderBy: { createdAt: 'desc' },
            take: RECENT_ALERTS_LIMIT,
          });
          return rows.map((n) => {
            const meta = (n.metadata ?? {}) as Record<string, unknown>;
            return {
              notificationId: n.id,
              caseId: typeof meta.caseId === 'string' ? meta.caseId : null,
              severity: n.severity,
              title: n.title,
              read: n.isRead,
              createdAt: n.createdAt,
            };
          });
        },
      },
      {
        name: 'operator.notify',
        description:
          'Raise an operator notification about a high-severity case that needs a human. Lands in the operator inbox and is pushed live over the notifications channel. Use it for cases that genuinely warrant attention (typically CRITICAL/HIGH severity); do not alert the same case twice (check alerts.recent first). Provide the caseId it concerns, a concise title, a message explaining why it needs an operator, and the severity.',
        inputSchema: {
          type: 'object',
          properties: {
            caseId: {
              type: 'string',
              description: 'The case this alert concerns.',
            },
            title: {
              type: 'string',
              description: 'Short headline shown in the operator inbox.',
            },
            message: {
              type: 'string',
              description:
                'Why this case needs a human, in one or two sentences.',
            },
            severity: {
              type: 'string',
              enum: [...ALERT_SEVERITIES],
              description: 'Alert severity; usually the case severity.',
            },
            important: {
              type: 'boolean',
              description:
                'Flag the notification as important (pinned). Defaults to true for CRITICAL/HIGH.',
            },
          },
          required: ['caseId', 'title', 'message', 'severity'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.NOTIFY_OPERATOR,
        resolveGate: this.escalationGate,
        handler: async (input) => {
          const caseId = String(input.caseId);
          const severity = input.severity as Severity;
          // Snapshot the case so a stale/deleted id fails loudly rather than
          // raising an alert that points nowhere.
          const found = await this.prisma.case.findUnique({
            where: { id: caseId },
            select: { id: true, title: true, severity: true, status: true },
          });
          if (!found) {
            throw new Error(`Case ${caseId} not found`);
          }
          const important =
            typeof input.important === 'boolean'
              ? input.important
              : severity === Severity.CRITICAL || severity === Severity.HIGH;
          const notification = await this.notifications.create({
            type: NotificationType.SYSTEM,
            event: NotificationEvent.CASE_ESCALATED,
            severity,
            title: String(input.title),
            message: String(input.message),
            actionUrl: `/investigations/${caseId}`,
            triggeredBy: AI_ACTOR,
            isImportant: important,
            metadata: {
              caseId,
              caseTitle: found.title,
              caseSeverity: found.severity,
              caseStatus: found.status,
            },
          });
          return { notificationId: notification.id, caseId };
        },
      },
    ];
  }
}
