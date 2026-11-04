import { Global, Module } from '@nestjs/common';
import { ACCESS_POLICY, LocalAccessPolicy } from './access-policy';
import { ActorContextService } from './actor-context.service';
import { ActorDirectoryService } from './actor-directory.service';
import { AuditController } from './audit.controller';
import { AuditTrailService } from './audit-trail.service';
import { MeController } from './me.controller';
import { PrismaService } from '../prisma.service';

/**
 * Who is acting, what they may do, and what they changed
 * (docs/prd/IAM-access-management.md). Without IAM the policy is
 * {@link LocalAccessPolicy}: everything is allowed.
 */
@Global()
@Module({
  controllers: [MeController, AuditController],
  providers: [
    PrismaService,
    ActorContextService,
    ActorDirectoryService,
    AuditTrailService,
    { provide: ACCESS_POLICY, useClass: LocalAccessPolicy },
  ],
  exports: [ActorContextService, AuditTrailService, ACCESS_POLICY],
})
export class IdentityModule {}
