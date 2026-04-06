import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DemoModeService } from './demo-mode.service';
import { DemoModeException } from './demo-mode.exception';
import { ALLOW_IN_DEMO_MODE_KEY } from './demo-mode.decorator';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class DemoModeGuard implements CanActivate {
  constructor(
    private readonly demoMode: DemoModeService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.demoMode.isDemoMode) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ method: string }>();
    if (SAFE_HTTP_METHODS.has(request.method.toUpperCase())) {
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
