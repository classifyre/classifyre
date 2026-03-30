import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateMetricDefinitionDto } from './dto/create-metric-definition.dto';
import { UpdateMetricDefinitionDto } from './dto/update-metric-definition.dto';
import { Prisma, MetricStatus } from '@prisma/client';

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMetricDefinitionDto) {
    let glossaryTermId: string | undefined;

    if (dto.glossaryTermId) {
      const term = await this.prisma.glossaryTerm.findUnique({
        where: { id: dto.glossaryTermId },
      });
      if (!term) {
        throw new BadRequestException(
          `Glossary term '${dto.glossaryTermId}' not found`,
        );
      }
      glossaryTermId = term.id;
    }

    return this.prisma.metricDefinition.create({
      data: {
        displayName: dto.displayName,
        description: dto.description,
        type: dto.type,
        definition: dto.definition as unknown as Prisma.InputJsonValue,
        allowedDimensions: dto.allowedDimensions ?? [],
        glossaryTermId,
        format: dto.format,
        unit: dto.unit,
        color: dto.color,
        owner: dto.owner,
      },
      include: { glossaryTerm: true, dashboardPlacements: true },
    });
  }

  async findAll(params?: {
    type?: string;
    status?: string;
    isActive?: boolean;
  }) {
    const where: Prisma.MetricDefinitionWhereInput = {};
    if (params?.type) where.type = params.type as any;
    if (params?.status) where.status = params.status as any;
    if (params?.isActive !== undefined) where.isActive = params.isActive;

    const items = await this.prisma.metricDefinition.findMany({
      where,
      include: {
        glossaryTerm: { select: { id: true, displayName: true } },
        dashboardPlacements: true,
      },
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
    });

    return { items, total: items.length };
  }

  async findById(id: string) {
    const metric = await this.prisma.metricDefinition.findUnique({
      where: { id },
      include: {
        glossaryTerm: true,
        dashboardPlacements: true,
      },
    });
    if (!metric) {
      throw new NotFoundException(`Metric definition '${id}' not found`);
    }
    return metric;
  }

  async update(id: string, dto: UpdateMetricDefinitionDto) {
    await this.findById(id);

    let glossaryTermId: string | null | undefined;
    if (dto.glossaryTermId !== undefined) {
      if (dto.glossaryTermId === null || dto.glossaryTermId === '') {
        glossaryTermId = null;
      } else {
        const term = await this.prisma.glossaryTerm.findUnique({
          where: { id: dto.glossaryTermId },
        });
        if (!term) {
          throw new BadRequestException(
            `Glossary term '${dto.glossaryTermId}' not found`,
          );
        }
        glossaryTermId = term.id;
      }
    }

    return this.prisma.metricDefinition.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined && {
          displayName: dto.displayName,
        }),
        ...(dto.description !== undefined && {
          description: dto.description,
        }),
        ...(dto.definition !== undefined && {
          definition: dto.definition as unknown as Prisma.InputJsonValue,
        }),
        ...(dto.allowedDimensions !== undefined && {
          allowedDimensions: dto.allowedDimensions,
        }),
        ...(glossaryTermId !== undefined && { glossaryTermId }),
        ...(dto.format !== undefined && { format: dto.format }),
        ...(dto.unit !== undefined && { unit: dto.unit }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.owner !== undefined && { owner: dto.owner }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { glossaryTerm: true, dashboardPlacements: true },
    });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.metricDefinition.delete({ where: { id } });
  }

  async certify(id: string, certifiedBy: string) {
    await this.findById(id);
    return this.prisma.metricDefinition.update({
      where: { id },
      data: {
        status: MetricStatus.ACTIVE,
        certifiedAt: new Date(),
        certifiedBy,
      },
      include: { glossaryTerm: true, dashboardPlacements: true },
    });
  }

  async findByDashboard(dashboard: string) {
    const placements = await this.prisma.metricDashboardPlacement.findMany({
      where: { dashboard, isVisible: true },
      include: {
        metricDefinition: {
          include: { glossaryTerm: true },
        },
      },
      orderBy: { position: 'asc' },
    });
    return placements;
  }

  async upsertDashboardPlacement(
    metricId: string,
    dashboard: string,
    data: {
      position?: number;
      size?: string;
      chartType?: string;
      pinnedFilters?: any;
      isVisible?: boolean;
    },
  ) {
    const metric = await this.findById(metricId);
    return this.prisma.metricDashboardPlacement.upsert({
      where: {
        metricDefinitionId_dashboard: {
          metricDefinitionId: metric.id,
          dashboard,
        },
      },
      create: {
        metricDefinitionId: metric.id,
        dashboard,
        position: data.position ?? 0,
        size: data.size ?? 'md',
        chartType: data.chartType,
        pinnedFilters: data.pinnedFilters as unknown as Prisma.InputJsonValue,
        isVisible: data.isVisible ?? true,
      },
      update: {
        ...(data.position !== undefined && { position: data.position }),
        ...(data.size !== undefined && { size: data.size }),
        ...(data.chartType !== undefined && { chartType: data.chartType }),
        ...(data.pinnedFilters !== undefined && {
          pinnedFilters: data.pinnedFilters as unknown as Prisma.InputJsonValue,
        }),
        ...(data.isVisible !== undefined && { isVisible: data.isVisible }),
      },
    });
  }
}
