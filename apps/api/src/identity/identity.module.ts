import { Global, Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { ACCESS_POLICY } from './access-policy';
import {
  TenantAccessController,
  WorkspaceAccessController,
} from './access.controller';
import { AccessManagementService } from './access-management.service';
import { ActorContextService } from './actor-context.service';
import { ActorDirectoryService } from './actor-directory.service';
import { AuditController } from './audit.controller';
import { AuditTrailService } from './audit-trail.service';
import { IamAccessPolicy } from './iam-access-policy';
import { IamBootstrapService } from './iam-bootstrap.service';
import { readIamConfig, type IamConfig } from './iam-config';
import { IDENTITY, IAM_CONFIG } from './identity.tokens';
import { IdentityService } from './identity.service';
import { MeController } from './me.controller';
import { MembershipService } from './membership.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { TenancyService } from './tenancy.service';
import { SocketAccessService } from './socket-access.service';

/**
 * Who is acting, what they may do, and what they changed
 * (docs/prd/IAM-access-management.md). Sign-in is always on:
 * {@link IamAccessPolicy} reads what the namespace hook computed from the
 * principal's grants.
 */
@Global()
@Module({
  controllers: [
    MeController,
    AuditController,
    WorkspaceAccessController,
    TenantAccessController,
    PlatformController,
  ],
  providers: [
    PrismaService,
    ActorContextService,
    ActorDirectoryService,
    AuditTrailService,
    TenancyService,
    { provide: IAM_CONFIG, useFactory: () => readIamConfig() },
    {
      provide: IDENTITY,
      inject: [IAM_CONFIG, TenancyService],
      useFactory: (config: IamConfig, tenancy: TenancyService) =>
        new IdentityService(config, new MembershipService(config), tenancy),
    },
    {
      provide: ACCESS_POLICY,
      inject: [ClsService],
      useFactory: (cls: ClsService) => new IamAccessPolicy(cls),
    },
    IamBootstrapService,
    AccessManagementService,
    PlatformService,
    SocketAccessService,
  ],
  exports: [
    SocketAccessService,
    ActorContextService,
    AuditTrailService,
    TenancyService,
    ACCESS_POLICY,
    IDENTITY,
    IAM_CONFIG,
  ],
})
export class IdentityModule {}
