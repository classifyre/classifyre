import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateGlossaryTermDto } from './dto/create-glossary-term.dto';
import { UpdateGlossaryTermDto } from './dto/update-glossary-term.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class GlossaryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateGlossaryTermDto) {
    return this.prisma.glossaryTerm.create({
      data: {
        displayName: dto.displayName,
        description: dto.description,
        category: dto.category,
        filterMapping: dto.filterMapping as unknown as Prisma.InputJsonValue,
        color: dto.color,
        icon: dto.icon,
      },
      include: { metrics: true },
    });
  }

  async findAll(params?: { category?: string; isActive?: boolean }) {
    const where: Prisma.GlossaryTermWhereInput = {};
    if (params?.category) where.category = params.category;
    if (params?.isActive !== undefined) where.isActive = params.isActive;

    const items = await this.prisma.glossaryTerm.findMany({
      where,
      include: { metrics: { select: { id: true, displayName: true } } },
      orderBy: [{ category: 'asc' }, { displayName: 'asc' }],
    });

    return { items, total: items.length };
  }

  async findById(id: string) {
    const term = await this.prisma.glossaryTerm.findUnique({
      where: { id },
      include: { metrics: true },
    });
    if (!term) throw new NotFoundException(`Glossary term '${id}' not found`);
    return term;
  }

  async update(id: string, dto: UpdateGlossaryTermDto) {
    await this.findById(id);
    return this.prisma.glossaryTerm.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.filterMapping !== undefined && {
          filterMapping: dto.filterMapping as unknown as Prisma.InputJsonValue,
        }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { metrics: true },
    });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.glossaryTerm.delete({ where: { id } });
  }

  /**
   * Resolve a glossary term's filterMapping into a Prisma WHERE clause
   * for the Finding model.
   */
  resolveToFindingFilter(
    filterMapping: Record<string, any>,
  ): Prisma.FindingWhereInput {
    const where: Prisma.FindingWhereInput = {};

    if (filterMapping.detectorTypes?.length) {
      where.detectorType = { in: filterMapping.detectorTypes };
    }
    if (filterMapping.severities?.length) {
      where.severity = { in: filterMapping.severities };
    }
    if (filterMapping.findingTypes?.length) {
      where.findingType = { in: filterMapping.findingTypes };
    }
    if (filterMapping.customDetectorKeys?.length) {
      where.customDetectorKey = { in: filterMapping.customDetectorKeys };
    }
    if (filterMapping.statuses?.length) {
      where.status = { in: filterMapping.statuses };
    }

    return where;
  }

  /**
   * Preview how many findings match a glossary term's filter.
   */
  async previewFindingCount(id: string): Promise<number> {
    const term = await this.findById(id);
    const where = this.resolveToFindingFilter(
      term.filterMapping as Record<string, any>,
    );
    return this.prisma.finding.count({ where });
  }
}
