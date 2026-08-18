import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AssetType, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';

/**
 * Notebook revisions for CUSTOM sources.
 *
 * Saving is append-only: a change writes a new revision rather than updating
 * the current one. That is what makes a run reproducible (the run pins the
 * revision it executed) and a bad edit recoverable.
 *
 * The notebook deliberately does not live in `Source.config`. Source configs
 * are validated against a schema that sets `additionalProperties: false`, and
 * they are shipped to jobs through an environment variable — neither of which
 * suits an arbitrarily long piece of source code.
 */
@Injectable()
export class CustomSourceNotebookService {
  private readonly logger = new Logger(CustomSourceNotebookService.name);

  constructor(private readonly prisma: PrismaService) {}

  private static hash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  async assertCustomSource(sourceId: string): Promise<void> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true, type: true },
    });
    if (!source) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }
    if (source.type !== AssetType.CUSTOM) {
      throw new BadRequestException(
        `Source ${sourceId} is not a custom source; it has no notebook.`,
      );
    }
  }

  /**
   * The revision a new run should execute, or null when nothing is saved yet.
   *
   * Callers pin this onto the run rather than resolving "latest" inside the
   * job, so an edit made while a scan is in flight cannot change what that scan
   * meant.
   */
  async currentRevision(sourceId: string): Promise<number | null> {
    const latest = await this.prisma.customSourceNotebook.findFirst({
      where: { sourceId },
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });
    return latest?.revision ?? null;
  }

  /**
   * Read one revision, or the newest when `revision` is omitted.
   *
   * A source that has never been saved resolves to empty content rather than a
   * 404 — "no notebook yet" is the normal state of a source that was just
   * created, not an error. The starter template lives in the CLI, which
   * materializes it when a session opens against an empty source; keeping a
   * second copy here would guarantee the two drift apart.
   */
  async get(
    sourceId: string,
    revision?: number,
  ): Promise<{ revision: number; content: string; isStarter: boolean }> {
    await this.assertCustomSource(sourceId);

    const record =
      revision === undefined
        ? await this.prisma.customSourceNotebook.findFirst({
            where: { sourceId },
            orderBy: { revision: 'desc' },
          })
        : await this.prisma.customSourceNotebook.findUnique({
            where: { sourceId_revision: { sourceId, revision } },
          });

    if (!record) {
      if (revision !== undefined) {
        throw new NotFoundException(
          `Source ${sourceId} has no notebook revision ${revision}`,
        );
      }
      return { revision: 0, content: '', isStarter: true };
    }

    return {
      revision: record.revision,
      content: record.content,
      isStarter: false,
    };
  }

  async listRevisions(sourceId: string, limit = 50) {
    await this.assertCustomSource(sourceId);
    return this.prisma.customSourceNotebook.findMany({
      where: { sourceId },
      orderBy: { revision: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      // Never select `content` here: a revision list is rendered in a dropdown
      // and pulling every version's full source would be unbounded.
      select: {
        id: true,
        revision: true,
        contentHash: true,
        message: true,
        createdAt: true,
      },
    });
  }

  /**
   * Append a revision. Returns `unchanged` when the content matches the current
   * revision, so an editing session that autosaves on every keystroke does not
   * fill the table with identical rows.
   */
  async save(
    sourceId: string,
    content: string,
    message = '',
    attempt = 0,
  ): Promise<{ revision: number; unchanged: boolean }> {
    await this.assertCustomSource(sourceId);

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new BadRequestException('Notebook content cannot be empty');
    }

    const contentHash = CustomSourceNotebookService.hash(content);
    const latest = await this.prisma.customSourceNotebook.findFirst({
      where: { sourceId },
      orderBy: { revision: 'desc' },
      select: { revision: true, contentHash: true },
    });

    if (latest?.contentHash === contentHash) {
      return { revision: latest.revision, unchanged: true };
    }

    const revision = (latest?.revision ?? 0) + 1;
    try {
      await this.prisma.customSourceNotebook.create({
        data: { sourceId, revision, content, contentHash, message },
      });
    } catch (error) {
      // Two writers raced for the same revision number (an editing session
      // saving while someone saves from the UI). Re-read and retry with the
      // number that is now free; bounded, so a genuine constraint bug surfaces
      // instead of spinning.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        attempt < 3
      ) {
        this.logger.warn(
          `Revision ${revision} for source ${sourceId} was taken; retrying`,
        );
        return this.save(sourceId, content, message, attempt + 1);
      }
      throw error;
    }

    return { revision, unchanged: false };
  }
}
