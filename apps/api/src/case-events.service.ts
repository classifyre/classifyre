import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CaseActivityType,
  CaseEvent,
  CaseEventPrecision,
} from '@prisma/client';
import { PrismaService } from './prisma.service';
import { CaseActivityService } from './case-activity.service';

export type CaseEventInput = {
  occurredAt: Date;
  precision?: CaseEventPrecision;
  title: string;
  description?: string;
  confidence?: number;
  findingIds?: string[];
  evidenceIds?: string[];
};

/**
 * The case chronology: dated real-world events reconstructed from evidence,
 * distinct from CaseActivity (the audit trail of what happened in the app).
 * Operator entries are verified by definition; agent-extracted events stay
 * unverified until a human confirms them against the underlying evidence.
 */
@Injectable()
export class CaseEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CaseActivityService,
  ) {}

  async list(caseId: string) {
    await this.ensureCase(caseId);
    const events = await this.prisma.caseEvent.findMany({
      where: { caseId },
      orderBy: { occurredAt: 'asc' },
    });
    return events.map((event) => this.toDto(event));
  }

  async create(
    caseId: string,
    input: CaseEventInput,
    createdBy = 'user',
    origin: 'AGENT' | 'OPERATOR' = 'OPERATOR',
  ) {
    await this.ensureCase(caseId);
    const verified = origin === 'OPERATOR';
    const event = await this.prisma.caseEvent.create({
      data: {
        caseId,
        occurredAt: input.occurredAt,
        precision: input.precision ?? 'DAY',
        title: input.title,
        description: input.description ?? null,
        confidence: input.confidence ?? null,
        origin,
        verifiedAt: verified ? new Date() : null,
        verifiedBy: verified ? createdBy : null,
        findingIds: input.findingIds ?? [],
        evidenceIds: input.evidenceIds ?? [],
        createdBy,
      },
    });
    await this.activity.record(
      caseId,
      CaseActivityType.EVENT_ADDED,
      { eventId: event.id, label: event.title, occurredAt: event.occurredAt },
      createdBy,
    );
    return this.toDto(event);
  }

  async update(
    caseId: string,
    eventId: string,
    input: Partial<CaseEventInput> & { verified?: boolean },
    updatedBy = 'user',
  ) {
    const existing = await this.getOwned(caseId, eventId);
    const event = await this.prisma.caseEvent.update({
      where: { id: existing.id },
      data: {
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        ...(input.precision ? { precision: input.precision } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.confidence !== undefined
          ? { confidence: input.confidence }
          : {}),
        ...(input.findingIds ? { findingIds: input.findingIds } : {}),
        ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
        // An operator touching an event (or explicitly verifying it) confirms it.
        ...(input.verified === true || existing.verifiedAt === null
          ? { verifiedAt: new Date(), verifiedBy: updatedBy }
          : {}),
      },
    });
    await this.activity.record(
      caseId,
      CaseActivityType.EVENT_UPDATED,
      { eventId, label: event.title },
      updatedBy,
    );
    return this.toDto(event);
  }

  async remove(caseId: string, eventId: string, removedBy = 'user') {
    const existing = await this.getOwned(caseId, eventId);
    await this.prisma.caseEvent.delete({ where: { id: existing.id } });
    await this.activity.record(
      caseId,
      CaseActivityType.EVENT_REMOVED,
      { eventId, label: existing.title },
      removedBy,
    );
    return { deleted: true, id: eventId };
  }

  private async getOwned(caseId: string, eventId: string): Promise<CaseEvent> {
    const event = await this.prisma.caseEvent.findUnique({
      where: { id: eventId },
    });
    if (!event || event.caseId !== caseId) {
      throw new NotFoundException(
        `Event ${eventId} not found in case ${caseId}`,
      );
    }
    return event;
  }

  private async ensureCase(caseId: string) {
    const exists = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Case ${caseId} not found`);
  }

  private toDto(event: CaseEvent) {
    return {
      id: event.id,
      caseId: event.caseId,
      occurredAt: event.occurredAt,
      precision: String(event.precision),
      title: event.title,
      description: event.description,
      confidence: event.confidence,
      origin: String(event.origin),
      verified: event.verifiedAt !== null,
      verifiedBy: event.verifiedBy,
      findingIds: event.findingIds,
      evidenceIds: event.evidenceIds,
      createdBy: event.createdBy,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }
}
