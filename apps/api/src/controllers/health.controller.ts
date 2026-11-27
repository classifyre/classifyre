import { Controller, Get, Optional } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PublicRoute } from '../identity/access.decorators';
import { IamBootstrapService } from '../identity/iam-bootstrap.service';

@PublicRoute()
@Controller()
@ApiTags('Health')
export class HealthController {
  constructor(
    @Optional() private readonly iamBootstrap?: IamBootstrapService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Health check',
    description: 'Check if the API is running and healthy',
  })
  @ApiResponse({
    status: 200,
    description: 'API is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        iamReady: { type: 'boolean', example: true },
        timestamp: { type: 'string', example: '2026-01-31T10:00:00.000Z' },
        service: { type: 'string', example: 'Classifyre API' },
        version: { type: 'string', example: '1.0.0' },
      },
    },
  })
  getHealth() {
    return {
      status: 'ok',
      iamReady: this.iamBootstrap ? this.iamBootstrap.isReady() : true,
      timestamp: new Date().toISOString(),
      service: 'Classifyre API',
      version: '1.0.0',
    };
  }

  @Get('ping')
  @ApiOperation({
    summary: 'Ping endpoint',
    description: 'Simple ping to check API responsiveness',
  })
  @ApiResponse({
    status: 200,
    description: 'Pong response',
    schema: {
      type: 'string',
      example: 'pong',
    },
  })
  ping(): string {
    return 'pong';
  }
}
