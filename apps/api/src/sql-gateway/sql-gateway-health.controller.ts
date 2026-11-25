import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { PublicRoute } from '../identity/access.decorators';
import { runsSqlGateway } from '../service-role';
import {
  type SqlGatewayReadiness,
  SqlGatewayService,
} from './sql-gateway.service';

/**
 * Pod-local readiness and Prometheus metrics endpoints for the SQL gateway
 * and its native Postgres catalog sidecar (SG §4.4–§4.5).
 *
 * Mounted under `/health/sql-gateway*` (`health` is in `RESERVED_PREFIXES`,
 * bypassing namespace resolution). Active only on pods running the SQL gateway
 * (`SERVICE_ROLE=sql` or `all`); non-gateway API/worker pods answer 404.
 */
@ApiExcludeController()
@PublicRoute()
@Controller('health/sql-gateway')
export class SqlGatewayHealthController {
  constructor(private readonly gateway: SqlGatewayService) {}

  @Get()
  async readiness(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SqlGatewayReadiness> {
    if (!runsSqlGateway()) {
      throw new NotFoundException('SQL gateway does not run on this pod.');
    }
    const status = await this.gateway.readiness();
    reply.code(status.ready ? 200 : 503);
    return status;
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): string {
    if (!runsSqlGateway()) {
      throw new NotFoundException('SQL gateway does not run on this pod.');
    }
    return this.gateway.metricsPrometheus();
  }
}
