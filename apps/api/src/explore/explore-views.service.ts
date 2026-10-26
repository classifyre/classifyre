import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ExploreView } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type {
  ExplorePositionDto,
  ExploreViewDto,
  SaveExploreViewDto,
} from './explore.dto';
import type { ExploreKind } from './explore-kinds';

/** Positions kept per view: enough for any canvas, small enough to stay cheap. */
const MAX_POSITIONS = 500;

/**
 * Saved Explore views: a name, the assets a view starts from, how it is
 * traced, and where people put things. They are kept by asset id, so a
 * re-scan leaves them whole; an asset deleted at its source is left out of
 * `seeds` (and so off the canvas) but stays in `seedIds`, and comes back if
 * the asset does.
 */
@Injectable()
export class ExploreViewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ExploreViewDto[]> {
    const rows = await this.prisma.exploreView.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return this.toDtos(rows);
  }

  async get(id: string): Promise<ExploreViewDto> {
    const row = await this.prisma.exploreView.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Explore view ${id} not found`);
    return (await this.toDtos([row]))[0];
  }

  async create(dto: SaveExploreViewDto): Promise<ExploreViewDto> {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('A view needs a name');
    if (!dto.seedIds?.length) {
      throw new BadRequestException('A view needs at least one asset');
    }
    const row = await this.prisma.exploreView.create({
      data: {
        name,
        description: dto.description?.trim() || null,
        seedIds: dto.seedIds,
        view: dto.view ?? null,
        kinds: dto.kinds ?? [],
        depth: dto.depth ?? 2,
        direction: dto.direction ?? 'both',
        positions: cleanPositions(
          dto.positions,
        ) as unknown as Prisma.InputJsonValue,
        createdBy: dto.createdBy ?? null,
      },
    });
    return (await this.toDtos([row]))[0];
  }

  async update(id: string, dto: SaveExploreViewDto): Promise<ExploreViewDto> {
    const existing = await this.prisma.exploreView.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException(`Explore view ${id} not found`);
    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('A view needs a name');
    }
    if (dto.seedIds !== undefined && !dto.seedIds.length) {
      throw new BadRequestException('A view needs at least one asset');
    }
    const row = await this.prisma.exploreView.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.seedIds !== undefined ? { seedIds: dto.seedIds } : {}),
        ...(dto.view !== undefined ? { view: dto.view } : {}),
        ...(dto.kinds !== undefined ? { kinds: dto.kinds } : {}),
        ...(dto.depth !== undefined ? { depth: dto.depth } : {}),
        ...(dto.direction !== undefined ? { direction: dto.direction } : {}),
        ...(dto.positions !== undefined
          ? {
              positions: cleanPositions(
                dto.positions,
              ) as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    return (await this.toDtos([row]))[0];
  }

  async remove(id: string): Promise<void> {
    const removed = await this.prisma.exploreView.deleteMany({
      where: { id },
    });
    if (!removed.count) {
      throw new NotFoundException(`Explore view ${id} not found`);
    }
  }

  /** Name the starting points that still exist, in one read for every view. */
  private async toDtos(rows: ExploreView[]): Promise<ExploreViewDto[]> {
    const ids = [...new Set(rows.flatMap((r) => r.seedIds))];
    const assets = ids.length
      ? await this.prisma.asset.findMany({
          where: { id: { in: ids }, status: { not: 'DELETED' } },
          select: { id: true, name: true, source: { select: { name: true } } },
        })
      : [];
    const byId = new Map(
      assets.map((a) => [
        a.id,
        { id: a.id, name: a.name, sourceName: a.source?.name ?? null },
      ]),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      seedIds: r.seedIds,
      seeds: r.seedIds.flatMap((id) => byId.get(id) ?? []),
      view: r.view,
      kinds: r.kinds as ExploreKind[],
      depth: r.depth,
      direction: r.direction,
      positions: (r.positions ?? {}) as unknown as Record<
        string,
        ExplorePositionDto
      >,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }
}

/** Only finite coordinates, rounded, and only so many. */
export function cleanPositions(
  input: Record<string, unknown> | undefined,
): Record<string, ExplorePositionDto> {
  const out: Record<string, ExplorePositionDto> = {};
  for (const [id, value] of Object.entries(input ?? {})) {
    if (Object.keys(out).length >= MAX_POSITIONS) break;
    const p = value as { x?: unknown; y?: unknown } | null;
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out[id] = { x: Math.round(x), y: Math.round(y) };
  }
  return out;
}
