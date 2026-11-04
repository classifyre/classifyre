import { Global, Module } from '@nestjs/common';
import { ACCESS_POLICY, LocalAccessPolicy } from './access-policy';
import { ActorContextService } from './actor-context.service';
import { MeController } from './me.controller';

/**
 * Who is acting and what they may do (docs/prd/IAM-access-management.md).
 * Without IAM the policy is {@link LocalAccessPolicy}: everything is allowed.
 */
@Global()
@Module({
  controllers: [MeController],
  providers: [
    ActorContextService,
    { provide: ACCESS_POLICY, useClass: LocalAccessPolicy },
  ],
  exports: [ActorContextService, ACCESS_POLICY],
})
export class IdentityModule {}
