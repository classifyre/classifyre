import { Global, Module } from '@nestjs/common';
import { NamespacePauseService } from './namespace-pause.service';

/**
 * Makes {@link NamespacePauseService} injectable in every feature module
 * without wiring imports (same role as PrismaCoreModule for the registry).
 * Depends only on the registry + CLS, so it cannot create DI cycles.
 */
@Global()
@Module({
  providers: [NamespacePauseService],
  exports: [NamespacePauseService],
})
export class NamespacePauseModule {}
