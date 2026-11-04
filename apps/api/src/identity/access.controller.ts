import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { ACCESS_POLICY, type AccessPolicy } from './access-policy';
import { Requires } from './access.decorators';
import {
  CreateGrantDto,
  GrantDto,
  RoleDto,
  TenantDto,
  TenantEventDto,
  TenantGroupDto,
} from './access.dto';
import { AccessManagementService } from './access-management.service';
import { ActorDirectoryService } from './actor-directory.service';
import { ResolvedActorDto } from './audit.dto';
import { ActorContextService } from './actor-context.service';
import { isCapability } from './capabilities';
import type { IdentityService, Principal } from './identity.service';
import { IDENTITY } from './identity.tokens';

/** The signed-in principal; a 409 when sign-in is off (nothing to manage). */
function principalOf(
  access: AccessManagementService,
  request: FastifyRequest,
): Promise<Principal> {
  return access.requireSignIn().authenticate(request.raw);
}

/** Who has access to this workspace, and why (docs/prd §12.4). */
@ApiTags('Access')
@Controller('access')
export class WorkspaceAccessController {
  constructor(
    private readonly access: AccessManagementService,
    private readonly actors: ActorContextService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
  ) {}

  private principal(request: FastifyRequest): Promise<Principal> {
    return principalOf(this.access, request);
  }

  @Get('roles')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'The built-in roles and what each one allows' })
  @ApiOkResponse({ type: [RoleDto] })
  roles(): RoleDto[] {
    return this.access.roles();
  }

  @Get('groups')
  @Requires('access.view')
  @ApiOperation({ summary: 'Groups of this tenant, to grant access to' })
  @ApiOkResponse({ type: [TenantGroupDto] })
  async groups(@Req() request: FastifyRequest): Promise<TenantGroupDto[]> {
    return this.access.groups(await this.principal(request));
  }

  @Get('grants')
  @Requires('access.view')
  @ApiOperation({
    summary: 'Grants that reach this workspace, including inherited ones',
  })
  @ApiOkResponse({ type: [GrantDto] })
  async grants(@Req() request: FastifyRequest): Promise<GrantDto[]> {
    return this.access.workspaceGrants(
      await this.principal(request),
      this.actors.workspaceId()!,
    );
  }

  @Post('grants')
  @Requires('access.manage')
  @ApiOperation({
    summary: 'Give a group or a person a role on this workspace',
    description:
      'You can only give a role whose capabilities you all hold here (no escalation).',
  })
  @ApiOkResponse({ type: GrantDto })
  async addGrant(
    @Req() request: FastifyRequest,
    @Body() body: CreateGrantDto,
  ): Promise<GrantDto> {
    const principal = await this.principal(request);
    return this.access.addGrant(
      principal,
      {
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        roleKey: body.roleKey,
        scopeType: 'workspace',
        scopeId: this.actors.workspaceId()!,
        expiresAt: body.expiresAt,
      },
      await this.policy.capabilities(principal.actor),
    );
  }

  @Delete('grants/:id')
  @Requires('access.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a grant made on this workspace' })
  async removeGrant(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
  ): Promise<void> {
    await this.access.removeGrant(
      await this.principal(request),
      id,
      this.actors.workspaceId(),
    );
  }

  @Get('explain')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Why can I do this? The grants that give you a capability here',
  })
  @ApiOkResponse({ type: [GrantDto] })
  async explain(
    @Req() request: FastifyRequest,
    @Query('capability') capability: string,
  ): Promise<GrantDto[]> {
    if (!capability || !isCapability(capability)) {
      throw new BadRequestException(`Unknown capability '${capability}'`);
    }
    return this.access.explain(
      await this.principal(request),
      this.actors.workspaceId()!,
      capability,
    );
  }
}

/**
 * The caller's tenant: its grants, groups and audit trail. `tenant` is a
 * reserved first path segment: these routes are not workspace-scoped.
 */
@ApiTags('Access')
@Controller('tenant')
export class TenantAccessController {
  constructor(
    private readonly access: AccessManagementService,
    private readonly actors: ActorDirectoryService,
    @Inject(IDENTITY) private readonly identity: IdentityService | null,
  ) {}

  private principal(request: FastifyRequest): Promise<Principal> {
    return principalOf(this.access, request);
  }

  @Get()
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'The caller’s tenant and what they may do across it',
  })
  @ApiOkResponse({ type: TenantDto })
  async tenant(@Req() request: FastifyRequest): Promise<TenantDto> {
    const principal = await this.principal(request);
    return {
      id: principal.tenant.id,
      alias: principal.tenant.alias,
      name: principal.tenant.name,
      capabilities: [...this.identity!.tenantCapabilities(principal)].sort(),
    };
  }

  @Get('roles')
  @Requires('tenant.access.manage')
  @ApiOperation({ summary: 'The built-in roles and where each can be granted' })
  @ApiOkResponse({ type: [RoleDto] })
  roles(): RoleDto[] {
    return this.access.roles();
  }

  @Get('groups')
  @Requires('tenant.access.manage')
  @ApiOkResponse({ type: [TenantGroupDto] })
  async groups(@Req() request: FastifyRequest): Promise<TenantGroupDto[]> {
    return this.access.groups(await this.principal(request));
  }

  @Get('grants')
  @Requires('tenant.access.manage')
  @ApiOperation({ summary: 'Every grant of the tenant' })
  @ApiOkResponse({ type: [GrantDto] })
  async grants(@Req() request: FastifyRequest): Promise<GrantDto[]> {
    return this.access.tenantGrants(await this.principal(request));
  }

  @Post('grants')
  @Requires('tenant.access.manage')
  @ApiOperation({
    summary:
      'Give a group or a person a role on the tenant, a group’s workspaces or one workspace',
  })
  @ApiOkResponse({ type: GrantDto })
  async addGrant(
    @Req() request: FastifyRequest,
    @Body() body: CreateGrantDto,
  ): Promise<GrantDto> {
    const principal = await this.principal(request);
    if (!body.scopeType || !body.scopeId) {
      throw new BadRequestException('scopeType and scopeId are required here.');
    }
    return this.access.addGrant(
      principal,
      {
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        roleKey: body.roleKey,
        scopeType: body.scopeType,
        scopeId: body.scopeId,
        expiresAt: body.expiresAt,
      },
      this.identity!.tenantCapabilities(principal),
    );
  }

  @Delete('grants/:id')
  @Requires('tenant.access.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove any grant of the tenant' })
  async removeGrant(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
  ): Promise<void> {
    await this.access.removeGrant(await this.principal(request), id);
  }

  @Get('actors/resolve')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Display names for actor references, outside any workspace',
    description:
      'People and agents resolve as in a workspace; MCP tokens belong to workspaces, so here they show as tokens.',
  })
  @ApiQuery({ name: 'refs', required: true, type: [String] })
  @ApiOkResponse({ type: [ResolvedActorDto] })
  async resolve(
    @Req() request: FastifyRequest,
    @Query('refs') refs: string | string[] = [],
  ): Promise<ResolvedActorDto[]> {
    await this.principal(request);
    return this.actors.resolve(Array.isArray(refs) ? refs : [refs], {
      withTokens: false,
    });
  }

  @Get('audit-events')
  @Requires('tenant.audit.view')
  @ApiOperation({
    summary: 'Tenant-level changes: grants, workspaces created or deleted',
  })
  @ApiOkResponse({ type: [TenantEventDto] })
  async events(@Req() request: FastifyRequest): Promise<TenantEventDto[]> {
    const principal = await this.principal(request);
    return this.access.tenantEvents(principal);
  }
}
