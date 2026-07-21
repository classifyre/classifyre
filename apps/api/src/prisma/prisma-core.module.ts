import { Global, Module } from '@nestjs/common';
import { PrismaClientManager } from './prisma-client-manager';

/**
 * Makes the shared {@link PrismaClientManager} available in every module.
 *
 * `PrismaService` is (still) provided locally by ~9 feature modules; each of
 * those instances is a thin CLS-resolving Proxy that delegates to this single
 * global manager, so the per-schema client cache is shared process-wide.
 */
@Global()
@Module({
  providers: [PrismaClientManager],
  exports: [PrismaClientManager],
})
export class PrismaCoreModule {}
