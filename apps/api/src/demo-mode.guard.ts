import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DemoModeService } from './demo-mode.service';
import { DemoModeException } from './demo-mode.exception';
import { ALLOW_IN_DEMO_MODE_KEY } from './demo-mode.decorator';
import { InternalApiKeyService } from './internal-api-key.service';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class DemoModeGuard implements CanActivate {
  constructor(
    private readonly demoMode: DemoModeService,
    private readonly internalApiKey: InternalApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.demoMode.isDemoMode) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      method: string;
      headers?: Record<string, unknown>;
    }>();
    if (SAFE_HTTP_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    // Scans, detector training and autopilot-driven work still run on a demo
    // instance — only the public surface is read-only. The CLI jobs the API
    // launches write their results back through these same HTTP endpoints and
    // prove they are internal with the shared key.
    if (this.internalApiKey.isInternalRequest(request.headers)) {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_IN_DEMO_MODE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (allowed) {
      return true;
    }

    throw new DemoModeException();
  }
}
