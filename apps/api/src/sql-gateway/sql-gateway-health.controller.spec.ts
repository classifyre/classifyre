import { NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { SqlGatewayHealthController } from './sql-gateway-health.controller';
import type {
  SqlGatewayReadiness,
  SqlGatewayService,
} from './sql-gateway.service';

describe('SqlGatewayHealthController', () => {
  const originalRole = process.env.SERVICE_ROLE;

  afterEach(() => {
    if (originalRole === undefined) delete process.env.SERVICE_ROLE;
    else process.env.SERVICE_ROLE = originalRole;
  });

  const makeReply = () => {
    const code = jest.fn();
    return { reply: { code } as unknown as FastifyReply, code };
  };

  const makeGateway = (
    status: SqlGatewayReadiness,
    metrics = 'classifyre_sql_gateway_sessions_active 1\n',
  ) =>
    ({
      readiness: jest.fn().mockResolvedValue(status),
      metricsPrometheus: jest.fn().mockReturnValue(metrics),
    }) as unknown as SqlGatewayService;

  it('returns 200 and readiness payload when ready on sql role', async () => {
    process.env.SERVICE_ROLE = 'sql';
    const status: SqlGatewayReadiness = {
      ready: true,
      listener: true,
      catalogSidecar: true,
      activeSessions: 4,
      catalogDbs: 2,
    };
    const controller = new SqlGatewayHealthController(makeGateway(status));
    const { reply, code } = makeReply();

    const result = await controller.readiness(reply);
    expect(code).toHaveBeenCalledWith(200);
    expect(result).toEqual(status);
  });

  it('returns 503 and readiness payload when sidecar is unavailable', async () => {
    process.env.SERVICE_ROLE = 'all';
    const status: SqlGatewayReadiness = {
      ready: false,
      listener: true,
      catalogSidecar: false,
      activeSessions: 0,
      catalogDbs: 0,
    };
    const controller = new SqlGatewayHealthController(makeGateway(status));
    const { reply, code } = makeReply();

    const result = await controller.readiness(reply);
    expect(code).toHaveBeenCalledWith(503);
    expect(result).toEqual(status);
  });

  it('exposes metrics on sql role and hides endpoints with 404 on api/worker roles', async () => {
    process.env.SERVICE_ROLE = 'sql';
    const gateway = makeGateway({
      ready: true,
      listener: true,
      catalogSidecar: true,
      activeSessions: 1,
      catalogDbs: 1,
    });
    const controller = new SqlGatewayHealthController(gateway);
    expect(controller.metrics()).toContain(
      'classifyre_sql_gateway_sessions_active 1',
    );

    for (const role of ['api', 'worker']) {
      process.env.SERVICE_ROLE = role;
      const { reply } = makeReply();
      await expect(controller.readiness(reply)).rejects.toThrow(
        NotFoundException,
      );
      expect(() => controller.metrics()).toThrow(NotFoundException);
    }
  });
});
