import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Requires } from './access.decorators';
import {
  AddedPersonDto,
  AddPersonDto,
  CreateGroupDto,
  PersonDto,
  RemovedPersonDto,
  RenameGroupDto,
  TemporaryPasswordDto,
  TenantGroupDto,
} from './access.dto';
import { AccessManagementService } from './access-management.service';
import type { Principal } from './identity.service';
import { PeopleService } from './people.service';

/**
 * The tenant's people and groups (docs/prd/IAM-access-management.md, step
 * 8c). Tenant admins only (`tenant.people.manage`); every id is checked
 * against the caller's own organization in {@link PeopleService}. Listing the
 * groups stays on `GET /tenant/groups`.
 */
@ApiTags('Access')
@Controller('tenant')
export class TenantPeopleController {
  constructor(
    private readonly access: AccessManagementService,
    private readonly people: PeopleService,
  ) {}

  private principal(request: FastifyRequest): Promise<Principal> {
    return this.access.requireSignIn().authenticate(request.raw);
  }

  @Get('people')
  @Requires('tenant.people.manage')
  @ApiOperation({ summary: 'Everyone in the tenant, with their groups' })
  @ApiOkResponse({ type: [PersonDto] })
  async list(@Req() request: FastifyRequest): Promise<PersonDto[]> {
    return this.people.people(await this.principal(request));
  }

  @Post('people')
  @Requires('tenant.people.manage')
  @ApiOperation({
    summary: 'Add a person by email',
    description:
      'Creates an account with a temporary password (shown once), or adds an existing account that is in no tenant.',
  })
  @ApiOkResponse({ type: AddedPersonDto })
  async add(
    @Req() request: FastifyRequest,
    @Body() body: AddPersonDto,
  ): Promise<AddedPersonDto> {
    return this.people.addPerson(await this.principal(request), body ?? {});
  }

  @Delete('people/:userId')
  @Requires('tenant.people.manage')
  @ApiOperation({
    summary: 'Remove a person from the tenant, its groups and their grants',
  })
  @ApiOkResponse({ type: RemovedPersonDto })
  async remove(
    @Req() request: FastifyRequest,
    @Param('userId') userId: string,
  ): Promise<RemovedPersonDto> {
    return this.people.removePerson(await this.principal(request), userId);
  }

  @Post('people/:userId/password')
  @Requires('tenant.people.manage')
  @ApiOperation({
    summary: 'Give an account made here a new temporary password',
  })
  @ApiOkResponse({ type: TemporaryPasswordDto })
  async resetPassword(
    @Req() request: FastifyRequest,
    @Param('userId') userId: string,
  ): Promise<TemporaryPasswordDto> {
    return this.people.resetPassword(await this.principal(request), userId);
  }

  @Post('groups')
  @Requires('tenant.people.manage')
  @ApiOperation({ summary: 'Create a group, at the top or inside another' })
  @ApiOkResponse({ type: TenantGroupDto })
  async createGroup(
    @Req() request: FastifyRequest,
    @Body() body: CreateGroupDto,
  ): Promise<TenantGroupDto> {
    return this.people.createGroup(await this.principal(request), body ?? {});
  }

  @Patch('groups/:groupId')
  @Requires('tenant.people.manage')
  @ApiOperation({ summary: 'Rename a group' })
  @ApiOkResponse({ type: TenantGroupDto })
  async renameGroup(
    @Req() request: FastifyRequest,
    @Param('groupId') groupId: string,
    @Body() body: RenameGroupDto,
  ): Promise<TenantGroupDto> {
    return this.people.renameGroup(
      await this.principal(request),
      groupId,
      body ?? {},
    );
  }

  @Delete('groups/:groupId')
  @Requires('tenant.people.manage')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete a group and the groups below it, with their grants (refused while they own workspaces)',
  })
  async deleteGroup(
    @Req() request: FastifyRequest,
    @Param('groupId') groupId: string,
  ): Promise<void> {
    await this.people.deleteGroup(await this.principal(request), groupId);
  }

  @Put('groups/:groupId/members/:userId')
  @Requires('tenant.people.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Put a person of the tenant into a group' })
  async addMember(
    @Req() request: FastifyRequest,
    @Param('groupId') groupId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.people.addToGroup(
      await this.principal(request),
      groupId,
      userId,
    );
  }

  @Delete('groups/:groupId/members/:userId')
  @Requires('tenant.people.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Take a person out of a group' })
  async removeMember(
    @Req() request: FastifyRequest,
    @Param('groupId') groupId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.people.removeFromGroup(
      await this.principal(request),
      groupId,
      userId,
    );
  }
}
