import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Requires } from './access.decorators';
import type { IdentityService, Operator } from './identity.service';
import { IDENTITY } from './identity.tokens';
import {
  AddedTenantAdminDto,
  AddTenantAdminDto,
  CreatedTenantDto,
  CreateTenantDto,
  ImportedWorkspacesDto,
  ImportWorkspacesDto,
  LocalWorkspaceDto,
  PlatformMeDto,
  PlatformTenantDto,
} from './platform.dto';
import { PlatformService } from './platform.service';

/**
 * The Platform page (docs/prd/TEN §4.7): operators manage tenants. Every
 * route needs `platform.tenants.manage`, which the access guard checks
 * against the operator role, not a tenant. Nothing here reads workspace
 * content.
 */
@ApiTags('Platform')
@Controller('platform')
export class PlatformController {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityService | null,
    private readonly platform: PlatformService,
  ) {}

  private async operator(request: FastifyRequest): Promise<Operator> {
    if (!this.identity) {
      throw new ConflictException(
        'Sign-in is off: there are no tenants to manage.',
      );
    }
    const operator = await this.identity.authenticateOperator(request.raw);
    // The guard already refused anyone else; this only narrows the type.
    if (!operator) throw new ForbiddenException();
    return operator;
  }

  @Get('me')
  @Requires('platform.tenants.manage')
  @ApiOperation({
    summary: 'Whether the caller is an operator (403 when not)',
  })
  @ApiOkResponse({ type: PlatformMeDto })
  async me(@Req() request: FastifyRequest): Promise<PlatformMeDto> {
    const operator = await this.operator(request);
    return { operator: true, name: operator.actor.displayName ?? null };
  }

  @Get('tenants')
  @Requires('platform.tenants.manage')
  @ApiOperation({ summary: 'Every tenant, with counts and its admins' })
  @ApiOkResponse({ type: [PlatformTenantDto] })
  async tenants(@Req() request: FastifyRequest): Promise<PlatformTenantDto[]> {
    await this.operator(request);
    return this.platform.tenants();
  }

  @Post('tenants')
  @Requires('platform.tenants.manage')
  @ApiOperation({
    summary: 'Create a tenant with its first admin',
    description:
      'Creates the organization, its `admins` group and the first admin: an account in no tenant, or a new one with a temporary password (shown once).',
  })
  @ApiOkResponse({ type: CreatedTenantDto })
  async create(
    @Req() request: FastifyRequest,
    @Body() body: CreateTenantDto,
  ): Promise<CreatedTenantDto> {
    return this.platform.createTenant(await this.operator(request), body ?? {});
  }

  @Post('tenants/:tenantId/suspend')
  @HttpCode(200)
  @Requires('platform.tenants.manage')
  @ApiOperation({
    summary: 'Suspend a tenant: its people are refused, its data is kept',
  })
  @ApiOkResponse({ type: PlatformTenantDto })
  async suspend(
    @Req() request: FastifyRequest,
    @Param('tenantId') tenantId: string,
  ): Promise<PlatformTenantDto> {
    return this.platform.setSuspended(
      await this.operator(request),
      tenantId,
      true,
    );
  }

  @Post('tenants/:tenantId/resume')
  @HttpCode(200)
  @Requires('platform.tenants.manage')
  @ApiOperation({ summary: 'Resume a suspended tenant' })
  @ApiOkResponse({ type: PlatformTenantDto })
  async resume(
    @Req() request: FastifyRequest,
    @Param('tenantId') tenantId: string,
  ): Promise<PlatformTenantDto> {
    return this.platform.setSuspended(
      await this.operator(request),
      tenantId,
      false,
    );
  }

  @Delete('tenants/:tenantId')
  @HttpCode(204)
  @Requires('platform.tenants.manage')
  @ApiOperation({
    summary: 'Delete a tenant that has no workspaces left',
    description:
      'Pass the alias as `confirm`. The organization and the accounts made for it go; the alias stays reserved.',
  })
  async remove(
    @Req() request: FastifyRequest,
    @Param('tenantId') tenantId: string,
    @Query('confirm') confirm: string,
  ): Promise<void> {
    await this.platform.deleteTenant(
      await this.operator(request),
      tenantId,
      confirm,
    );
  }

  @Post('tenants/:tenantId/admins')
  @Requires('platform.tenants.manage')
  @ApiOperation({
    summary: 'Make someone a tenant admin, by email',
    description:
      'A member of the tenant, an account in no tenant, or a new account with a temporary password (shown once).',
  })
  @ApiOkResponse({ type: AddedTenantAdminDto })
  async addAdmin(
    @Req() request: FastifyRequest,
    @Param('tenantId') tenantId: string,
    @Body() body: AddTenantAdminDto,
  ): Promise<AddedTenantAdminDto> {
    return this.platform.addAdmin(
      await this.operator(request),
      tenantId,
      body ?? {},
    );
  }

  @Delete('tenants/:tenantId/admins/:userId')
  @HttpCode(204)
  @Requires('platform.tenants.manage')
  @ApiOperation({ summary: "Take someone out of the tenant's admins" })
  async removeAdmin(
    @Req() request: FastifyRequest,
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.platform.removeAdmin(
      await this.operator(request),
      tenantId,
      userId,
    );
  }

  @Get('workspaces/local')
  @Requires('platform.tenants.manage')
  @ApiOperation({
    summary:
      'Workspaces made without sign-in, which can be brought into a tenant',
  })
  @ApiOkResponse({ type: [LocalWorkspaceDto] })
  async localWorkspaces(
    @Req() request: FastifyRequest,
  ): Promise<LocalWorkspaceDto[]> {
    await this.operator(request);
    return this.platform.localWorkspaces();
  }

  @Post('tenants/:tenantId/workspaces')
  @HttpCode(200)
  @Requires('platform.tenants.manage')
  @ApiOperation({
    summary: 'Copy workspaces made without sign-in into a tenant',
  })
  @ApiOkResponse({ type: ImportedWorkspacesDto })
  async importWorkspaces(
    @Req() request: FastifyRequest,
    @Param('tenantId') tenantId: string,
    @Body() body: ImportWorkspacesDto,
  ): Promise<ImportedWorkspacesDto> {
    return this.platform.importWorkspaces(
      await this.operator(request),
      tenantId,
      body?.slugs,
    );
  }
}
