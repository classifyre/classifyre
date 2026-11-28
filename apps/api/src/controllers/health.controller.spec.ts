import { HealthController } from './health.controller';
import type { IamBootstrapService } from '../identity/iam-bootstrap.service';

describe('HealthController', () => {
  it('reports tenantReady from IamBootstrapService', () => {
    let ready = false;
    const bootstrap = {
      isReady: () => ready,
    } as unknown as IamBootstrapService;
    const controller = new HealthController(bootstrap);

    expect(controller.getHealth()).toMatchObject({
      status: 'ok',
      tenantReady: false,
      service: 'Classifyre API',
    });

    ready = true;
    expect(controller.getHealth()).toMatchObject({
      status: 'ok',
      tenantReady: true,
    });
    expect(controller.ping()).toBe('pong');
  });
});
