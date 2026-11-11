import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SavedQuery } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ActorContextService } from '../identity/actor-context.service';
import type { SavedQueryDto } from './data-query.dto';

/**
 * A person's saved SQL (docs/prd/DQ-data-query.md phase 3, "Scripts" in the
 * Dremio tour). Kept per user by IAM actor reference, like query runs:
 * nobody ever sees, changes or deletes another's — a missing or foreign id
 * answers 404, so ids are not enumerable.
 */
@Injectable()
export class SavedQueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ActorContextService,
  ) {}

  async list(): Promise<SavedQueryDto[]> {
    const rows = await this.prisma.savedQuery.findMany({
      where: { actorRef: this.actors.current().ref ?? null },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return rows.map(toDto);
  }

  async get(id: string): Promise<SavedQueryDto> {
    return toDto(await this.own(id));
  }

  async create(name: string, sql: string): Promise<SavedQueryDto> {
    const cleanName = (name ?? '').trim();
    const text = (sql ?? '').trim();
    if (!cleanName) {
      throw new BadRequestException('A saved query needs a name.');
    }
    if (!text) {
      throw new BadRequestException('A saved query needs its SQL.');
    }
    if (text.length > 100_000) {
      throw new BadRequestException(
        'The SQL is longer than 100,000 characters.',
      );
    }
    const row = await this.prisma.savedQuery.create({
      data: {
        name: cleanName.slice(0, 120),
        sql: text,
        actorRef: this.actors.current().ref ?? null,
      },
    });
    return toDto(row);
  }

  async update(id: string, name?: string, sql?: string): Promise<SavedQueryDto> {
    await this.own(id);
    if (name !== undefined && !name.trim()) {
      throw new BadRequestException('A saved query needs a name.');
    }
    if (sql !== undefined) {
      if (!sql.trim()) {
        throw new BadRequestException('A saved query needs its SQL.');
      }
      if (sql.length > 100_000) {
        throw new BadRequestException(
          'The SQL is longer than 100,000 characters.',
        );
      }
    }
    const row = await this.prisma.savedQuery.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim().slice(0, 120) } : {}),
        ...(sql !== undefined ? { sql: sql.trim() } : {}),
      },
    });
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    await this.own(id);
    await this.prisma.savedQuery.delete({ where: { id } });
  }

  /** A saved query of the current actor; anything else answers 404. */
  private async own(id: string): Promise<SavedQuery> {
    const row = await this.prisma.savedQuery.findUnique({ where: { id } });
    if (!row || row.actorRef !== (this.actors.current().ref ?? null)) {
      throw new NotFoundException('No such saved query.');
    }
    return row;
  }
}

function toDto(row: SavedQuery): SavedQueryDto {
  return {
    id: row.id,
    name: row.name,
    sql: row.sql,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
