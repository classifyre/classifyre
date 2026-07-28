import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InternalApiKeyService } from './internal-api-key.service';
import { INTERNAL_ONLY_KEY } from './internal-only.decorator';

export class InternalOnlyException extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      error: 'Forbidden',
      code: 'INTERNAL_ENDPOINT',
      message:
        'This endpoint is reserved for internal callers and requires the internal API key.',
    });
  }
}

/**
 * Rejects public traffic on @InternalOnly() endpoints. Unlike DemoModeGuard
 * this applies in every mode: the CLI's write-back endpoints are internal
 * regardless of whether the instance is a demo.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(
    private readonly internalApiKey: InternalApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const internalOnly = this.reflector.getAllAndOverride<boolean>(
      INTERNAL_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!internalOnly || !this.internalApiKey.isEnforced) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, unknown>;
    }>();

    if (!this.internalApiKey.isInternalRequest(request.headers)) {
      throw new InternalOnlyException();
    }

    return true;
  }
}
