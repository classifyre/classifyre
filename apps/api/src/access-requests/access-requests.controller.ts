import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { Requires, SignedInOnly } from '../identity/access.decorators';
import { AccessManagementService } from '../identity/access-management.service';
import {
  AccessRequestDto,
  AccessRequestOptionsDto,
  ApproveAccessRequestDto,
  CreateAccessRequestDto,
  DenyAccessRequestDto,
} from './access-requests.dto';
import { AccessRequestsService } from './access-requests.service';

/**
 * Asking for data access and deciding on it (docs/prd/DQ-data-query.md
 * §5.9). Routes need only `workspace.view`; the service decides who may
 * decide (the owner, else the stewards, or `access.manage`).
 */
@ApiTags('Access requests')
@SignedInOnly()
@Controller('data-access-requests')
export class AccessRequestsController {
  constructor(
    private readonly requests: AccessRequestsService,
    private readonly access: AccessManagementService,
  ) {}

  @Get()
  @Requires('workspace.view')
  @ApiOperation({
    summary:
      'Access requests: yours (view=mine), waiting for you (view=decide), or on one table or source you decide',
  })
  @ApiQuery({ name: 'view', required: false, enum: ['mine', 'decide'] })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'scopeType', required: false, enum: ['asset', 'source'] })
  @ApiQuery({ name: 'scopeId', required: false })
  @ApiOkResponse({ type: [AccessRequestDto] })
  list(
    @Query('view') view?: string,
    @Query('status') status?: string,
    @Query('scopeType') scopeType?: string,
    @Query('scopeId') scopeId?: string,
  ): Promise<AccessRequestDto[]> {
    return this.requests.list({ view, status, scopeType, scopeId });
  }

  @Get('options')
  @Requires('workspace.view')
  @ApiOperation({
    summary:
      'Asking for one table or source: your groups, who decides, a request of yours still waiting',
  })
  @ApiQuery({ name: 'scopeType', enum: ['asset', 'source'] })
  @ApiQuery({ name: 'scopeId' })
  @ApiOkResponse({ type: AccessRequestOptionsDto })
  options(
    @Query('scopeType') scopeType: string,
    @Query('scopeId') scopeId: string,
  ): Promise<AccessRequestOptionsDto> {
    return this.requests.options(scopeType, scopeId);
  }

  @Post()
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Ask to query a table or source, for a group of yours',
  })
  @ApiOkResponse({ type: AccessRequestDto })
  create(@Body() body: CreateAccessRequestDto): Promise<AccessRequestDto> {
    return this.requests.create(body ?? {});
  }

  @Post(':id/approve')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Approve: the group gets an expiring Data reader grant on it',
    description:
      'Its owner, else a steward, or someone with access.manage; never more than you hold on it, never your own request.',
  })
  @ApiOkResponse({ type: AccessRequestDto })
  async approve(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApproveAccessRequestDto,
  ): Promise<AccessRequestDto> {
    const principal = await this.access.identity.authenticate(request.raw);
    return this.requests.approve(principal, id, body ?? {});
  }

  @Post(':id/deny')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Decline a request, saying why' })
  @ApiOkResponse({ type: AccessRequestDto })
  deny(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DenyAccessRequestDto,
  ): Promise<AccessRequestDto> {
    return this.requests.deny(id, body ?? {});
  }

  @Post(':id/withdraw')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Take back a request of yours still waiting' })
  @ApiOkResponse({ type: AccessRequestDto })
  withdraw(@Param('id', ParseUUIDPipe) id: string): Promise<AccessRequestDto> {
    return this.requests.withdraw(id);
  }
}
