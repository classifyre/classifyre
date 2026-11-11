import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SavedQuery } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ActorContextService } from '../identity/actor-context.service';
import { AuthenticationError } from '../identity/identity.service';
import { throwAuthenticationError } from '../identity/signed-in-request';
import type { SavedQueryDto } from './data-query.dto';

/**
 * A person's saved SQL (docs/prd/DQ-data-query.md phase 3, the explorer's
 * Saved tab). Kept per user by IAM actor reference, like query runs:
 * nobody ever sees, changes or deletes another's — a missing or foreign id
 * answers 404, so ids are not enumerable.
 */
@Injectable()
export class SavedQueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ActorContextService,
  ) {}

  /** Nobody signed in has none: visitors of a public workspace save nothing. */
  async list(): Promise<SavedQueryDto[]> {
    const actorRef = this.actors.current().ref;
    if (!actorRef) return [];
    const rows = await this.prisma.savedQuery.findMany({
      where: { actorRef },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return rows.map(toDto);
  }

  async get(id: string): Promise<SavedQueryDto> {
    return toDto(await this.own(id));
  }

  async create(name: string, sql: string): Promise<SavedQueryDto> {
    const actorRef = this.person();
    const row = await this.prisma.savedQuery.create({
      data: { name: cleanName(name), sql: cleanSql(sql), actorRef },
    });
    return toDto(row);
  }

  async update(
    id: string,
    name?: string,
    sql?: string,
  ): Promise<SavedQueryDto> {
    await this.own(id);
    const row = await this.prisma.savedQuery.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: cleanName(name) } : {}),
        ...(sql !== undefined ? { sql: cleanSql(sql) } : {}),
      },
    });
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    await this.own(id);
    await this.prisma.savedQuery.delete({ where: { id } });
  }

  /**
   * Who owns what is saved: a signed-in person. A visitor of a public
   * workspace has no reference — saving would put every visitor's SQL in one
   * shared pool — so they are asked to sign in, like any other change.
   */
  private person(): string {
    const actorRef = this.actors.current().ref;
    if (!actorRef) {
      throwAuthenticationError(
        new AuthenticationError('Sign in to save queries.', 'SIGN_IN_REQUIRED'),
      );
    }
    return actorRef;
  }

  /** A saved query of the current person; anything else answers 404. */
  private async own(id: string): Promise<SavedQuery> {
    const actorRef = this.person();
    const row = await this.prisma.savedQuery.findUnique({ where: { id } });
    if (!row || row.actorRef !== actorRef) {
      throw new NotFoundException('No such saved query.');
    }
    return row;
  }
}

const MAX_NAME = 120;
const MAX_SQL = 100_000;

function cleanName(name: string | undefined): string {
  const text = (name ?? '').trim();
  if (!text) throw new BadRequestException('A saved query needs a name.');
  return text.slice(0, MAX_NAME);
}

function cleanSql(sql: string | undefined): string {
  const text = (sql ?? '').trim();
  if (!text) throw new BadRequestException('A saved query needs its SQL.');
  if (text.length > MAX_SQL) {
    throw new BadRequestException('The SQL is longer than 100,000 characters.');
  }
  return text;
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
