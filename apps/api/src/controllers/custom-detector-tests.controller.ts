import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CustomDetectorTestsService } from '../custom-detector-tests.service';
import type { TestTrigger } from '../dto/custom-detector-tests.dto';

@Controller('custom-detectors/:detectorId/test-scenarios')
export class CustomDetectorTestsController {
  constructor(private readonly tests: CustomDetectorTestsService) {}

  @Get()
  list(@Param('detectorId') detectorId: string) {
    return this.tests.listScenarios(detectorId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Param('detectorId') detectorId: string, @Body() body: unknown) {
    return this.tests.createScenario(detectorId, body);
  }

  @Delete(':scenarioId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('detectorId') detectorId: string,
    @Param('scenarioId') scenarioId: string,
  ) {
    return this.tests.deleteScenario(detectorId, scenarioId);
  }

  @Get(':scenarioId/input')
  async input(
    @Param('detectorId') detectorId: string,
    @Param('scenarioId') scenarioId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const input = await this.tests.getScenarioInput(detectorId, scenarioId);
    const data = Buffer.from(input, 'utf8');
    await reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Length', String(data.length))
      .send(data);
  }

  @Post('run')
  run(
    @Param('detectorId') detectorId: string,
    @Query('triggeredBy') triggeredBy?: string,
  ) {
    const trigger: TestTrigger =
      triggeredBy === 'CI'
        ? 'CI'
        : triggeredBy === 'ASSISTANT'
          ? 'ASSISTANT'
          : 'MANUAL';
    return this.tests.runScenarios(detectorId, trigger);
  }
}
