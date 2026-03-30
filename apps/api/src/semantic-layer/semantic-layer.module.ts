import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { GlossaryService } from './glossary.service';
import { MetricsService } from './metrics.service';
import { MetricEngineService } from './metric-engine.service';
import { GlossaryController } from './glossary.controller';
import { MetricsController } from './metrics.controller';
import { MetricQueryController } from './metric-query.controller';

@Module({
  controllers: [GlossaryController, MetricsController, MetricQueryController],
  providers: [
    PrismaService,
    GlossaryService,
    MetricsService,
    MetricEngineService,
  ],
  exports: [GlossaryService, MetricsService, MetricEngineService],
})
export class SemanticLayerModule {}
