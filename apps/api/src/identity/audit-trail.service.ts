import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { PrismaService } from '../prisma.service';
import type { Actor } from './actor';
import type { Capability } from './capabilities';

export interface AuditEventInput {
  actor: Actor;
  channel: 'rest' | 'mcp';
  capability: Capability;
  operation: string;
  entityType: string | null;
  entityId: string | null;
  fields: string[];
  status?: number;
}

export interface AuditEventQuery {
  entityType?: string;
  entityId?: string;
  actor?: string;
  /** Return events older than this id's event (keyset paging). */
  before?: string;
  limit?: number;
}

const MAX_FIELDS = 50;
const MAX_LIMIT = 200;

/** Top-level keys of an input object, never its values. */
export function inputFields(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  return Object.keys(input).sort().slice(0, MAX_FIELDS);
}

/**
 * The workspace audit trail (docs/prd/IAM-access-management.md §11.1).
 * Recording never fails the change it records: a lost audit row is logged,
 * the user's request still succeeds.
 */
@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  /** Only workspace requests have an audit trail; registry routes do not (yet). */
  inWorkspace(): boolean {
    return this.cls.isActive() && Boolean(this.cls.get<string>(CLS_SCHEMA));
  }

  async record(event: AuditEventInput): Promise<void> {
    if (!this.inWorkspace()) return;
    try {
      await this.prisma.auditEvent.create({
        data: {
          actor: event.actor.ref ?? null,
          via: event.actor.via,
          channel: event.channel,
          capability: event.capability,
          operation: event.operation,
          entityType: event.entityType,
          entityId: event.entityId,
          fields: event.fields,
          status: event.status ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Audit event for ${event.operation} not recorded: ${String(error)}`,
      );
    }
  }

  async list(query: AuditEventQuery) {
    const take = Math.min(Math.max(query.limit ?? 50, 1), MAX_LIMIT);
    const cursor = query.before
      ? await this.prisma.auditEvent.findUnique({
          where: { id: query.before },
          select: { occurredAt: true },
        })
      : null;
    return this.prisma.auditEvent.findMany({
      where: {
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.actor ? { actor: query.actor } : {}),
        ...(cursor ? { occurredAt: { lt: cursor.occurredAt } } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }
}
