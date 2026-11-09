import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { IdentityService } from './identity.service';
import { IDENTITY } from './identity.tokens';

const RETRY_MS = 15_000;
const MAX_ATTEMPTS = 40;

/**
 * Runs the first-tenant setup ({@link IdentityService.bootstrap}) once the
 * identity server answers. In the background: the API must not wait for the
 * identity server to boot, which on a first install takes a minute or two.
 */
@Injectable()
export class IamBootstrapService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(IamBootstrapService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(@Inject(IDENTITY) private readonly identity: IdentityService) {}

  onApplicationBootstrap(): void {
    this.attempt(1);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private attempt(n: number): void {
    void this.identity
      .bootstrap()
      .then(() => this.logger.log('Sign-in tenants are set up'))
      .catch((error: unknown) => {
        if (n >= MAX_ATTEMPTS) {
          this.logger.error(`Sign-in tenant setup gave up: ${String(error)}`);
          return;
        }
        this.logger.warn(
          `Sign-in tenant setup not done yet (attempt ${n}): ${String(error)}`,
        );
        this.timer = setTimeout(() => this.attempt(n + 1), RETRY_MS);
      });
  }
}
