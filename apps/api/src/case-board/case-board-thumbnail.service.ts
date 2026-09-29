import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  BOARD_SKETCH_MAX_BYTES,
  BoardSketchSchema,
} from '@workspace/schemas/case-board';
import { PrismaService } from '../prisma.service';
import { BoardThumbnailStateDto } from '../dto/case-board.dto';

/** Body of PUT /cases/:id/board/thumbnail (PutBoardThumbnailDto). */
export const PutBoardThumbnailSchema = z.strictObject({
  sketch: BoardSketchSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  version: z.number().int().nonnegative(),
});
export type PutBoardThumbnail = z.infer<typeof PutBoardThumbnailSchema>;

export function parseBoardThumbnail(body: unknown): PutBoardThumbnail {
  const parsed = PutBoardThumbnailSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Invalid board thumbnail',
      issues: parsed.error.issues.slice(0, 20).map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      })),
    });
  }
  if (JSON.stringify(parsed.data.sketch).length > BOARD_SKETCH_MAX_BYTES) {
    throw new PayloadTooLargeException(
      `A board thumbnail must serialize to ${BOARD_SKETCH_MAX_BYTES} bytes or fewer`,
    );
  }
  return parsed.data;
}

/**
 * The case card's thumbnail: the board drawn small (BoardSketch), built by the
 * web board from its own state and sent here once an edit settles.
 *
 * A cache, not a record. It takes no part in the board's version, timeline or
 * snapshots, and a closed case's read-only board still refreshes it. Two tabs
 * may both send one; the sketch drawn at the later board version wins, and an
 * identical sketch is not written again.
 */
@Injectable()
export class CaseBoardThumbnailService {
  constructor(private readonly prisma: PrismaService) {}

  async save(caseId: string, body: unknown): Promise<BoardThumbnailStateDto> {
    const input = parseBoardThumbnail(body);
    const board = await this.prisma.caseBoard.findUnique({
      where: { caseId },
      select: {
        id: true,
        version: true,
        thumbnail: {
          select: { signature: true, version: true, updatedAt: true },
        },
      },
    });
    // The board's first read creates it, and a client draws one only after that.
    if (!board) {
      throw new NotFoundException(`Case ${caseId} has no board yet`);
    }
    // Never ahead of the board: a later honest sketch must still win.
    const version = Math.min(input.version, board.version);
    const current = board.thumbnail;
    if (
      current &&
      (current.signature === input.signature || current.version > version)
    ) {
      return { ...current, written: false };
    }
    const sketch = input.sketch as Prisma.InputJsonValue;
    const row = await this.prisma.caseBoardThumbnail.upsert({
      where: { boardId: board.id },
      create: {
        boardId: board.id,
        sketch,
        version,
        signature: input.signature,
      },
      update: { sketch, version, signature: input.signature },
      select: { signature: true, version: true, updatedAt: true },
    });
    return { ...row, written: true };
  }
}
