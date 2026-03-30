import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import { CreateMetricDefinitionDto } from './dto/create-metric-definition.dto';
import { UpdateMetricDefinitionDto } from './dto/update-metric-definition.dto';

@ApiTags('Semantic Layer - Metrics')
@Controller('semantic/metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new metric definition' })
  async create(@Body() dto: CreateMetricDefinitionDto) {
    return this.metricsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all metric definitions' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  async findAll(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.metricsService.findAll({
      type,
      status,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a metric definition by id' })
  async findById(@Param('id') id: string) {
    return this.metricsService.findById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a metric definition' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMetricDefinitionDto,
  ) {
    return this.metricsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a metric definition' })
  async delete(@Param('id') id: string) {
    return this.metricsService.delete(id);
  }

  @Post(':id/certify')
  @ApiOperation({ summary: 'Certify a metric (DRAFT → ACTIVE)' })
  async certify(
    @Param('id') id: string,
    @Body() body: { certifiedBy: string },
  ) {
    return this.metricsService.certify(id, body.certifiedBy);
  }
}
