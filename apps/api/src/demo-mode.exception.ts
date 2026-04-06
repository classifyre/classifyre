import { ForbiddenException } from '@nestjs/common';

export class DemoModeException extends ForbiddenException {
  constructor(
    message = 'This instance is in read-only demo mode. Create, update, and delete operations are disabled.',
  ) {
    super({
      statusCode: 403,
      error: 'Forbidden',
      code: 'DEMO_MODE_READ_ONLY',
      message,
      demoMode: true,
    });
  }
}
