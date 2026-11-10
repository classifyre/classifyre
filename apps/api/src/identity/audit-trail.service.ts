import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
} from '../namespace/namespace.constants';
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
  capability?: string;
  operation?: string;
  search?: string;
  /** Return events older than this id's event (keyset paging). */
  before?: string;
  limit?: number;
  skip?: number;
  sortBy?: 'OCCURRED_AT' | 'ACTOR' | 'OPERATION' | 'ENTITY_TYPE' | 'CAPABILITY';
  sortOrder?: 'ASC' | 'DESC';
}

export interface AuditEventsPage {
  items: Awaited<ReturnType<PrismaService['auditEvent']['findMany']>>;
  total: number;
  skip: number;
  limit: number;
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

  /** The workspace the current request runs in, for access-grant entities. */
  workspaceId(): string | null {
    if (!this.cls.isActive()) return null;
    return this.cls.get<string>(CLS_NAMESPACE_ID) ?? null;
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

  async list(query: AuditEventQuery): Promise<AuditEventsPage> {
    const take = Math.min(Math.max(query.limit ?? 50, 1), MAX_LIMIT);
    const skip = Math.max(query.skip ?? 0, 0);
    const cursor = query.before
      ? await this.prisma.auditEvent.findUnique({
          where: { id: query.before },
          select: { occurredAt: true },
        })
      : null;
    const needle = query.search?.trim() ?? '';
    const where = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actor ? { actor: query.actor } : {}),
      ...(query.capability ? { capability: query.capability } : {}),
      ...(query.operation ? { operation: query.operation } : {}),
      ...(needle
        ? {
            OR: [
              { operation: { contains: needle, mode: 'insensitive' as const } },
              {
                capability: { contains: needle, mode: 'insensitive' as const },
              },
              {
                entityType: { contains: needle, mode: 'insensitive' as const },
              },
              { actor: { contains: needle, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(cursor ? { occurredAt: { lt: cursor.occurredAt } } : {}),
    };
    // Sorting on the occurred-at primary path stays index-served; every other
    // column sorts client-visible values only (dense table, bounded pages).
    // Prisma validates `orderBy` strictly at runtime: one object per key, in an
    // array, even for the tie-break. A single combined object 500s (field
    // report: the deployed build refused `{ occurredAt, id }` as one value).
    const sortDir: 'asc' | 'desc' = query.sortOrder === 'ASC' ? 'asc' : 'desc';
    const tie: { occurredAt: 'asc' | 'desc' }[] =
      query.sortBy && query.sortBy !== 'OCCURRED_AT'
        ? [{ occurredAt: 'desc' }]
        : [{ occurredAt: sortDir }];
    const primary: { actor: 'asc' | 'desc' }[] =
      query.sortBy === 'ACTOR' ? [{ actor: sortDir }] : [];
    const byOperation: { operation: 'asc' | 'desc' }[] =
      query.sortBy === 'OPERATION' ? [{ operation: sortDir }] : [];
    const byEntity: { entityType: 'asc' | 'desc' }[] =
      query.sortBy === 'ENTITY_TYPE' ? [{ entityType: sortDir }] : [];
    const byCapability: { capability: 'asc' | 'desc' }[] =
      query.sortBy === 'CAPABILITY' ? [{ capability: sortDir }] : [];
    const orderBy = [
      ...primary,
      ...byOperation,
      ...byEntity,
      ...byCapability,
      ...tie,
      { id: sortDir } as const,
    ];
    const [items, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy,
        skip,
        take,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return { items, total, skip, limit: take };
  }
}
