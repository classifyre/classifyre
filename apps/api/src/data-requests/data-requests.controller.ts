import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Requires, SignedInOnly } from '../identity/access.decorators';
import {
  ThreadEntriesResponseDto,
  ThreadResponseDto,
} from '../dto/case-thread.dto';
import { DataRequestsService } from './data-requests.service';
import {
  AddDataRequestCommentDto,
  AddDataRequestCommentReplyDto,
  AddDataRequestCommentResponseDto,
  ClaimDataRequestDto,
  CreateDataRequestDto,
  DataRequestCheckResultDto,
  DataRequestDescribeResultDto,
  DataRequestDetailDto,
  DataRequestListResponseDto,
  DataRequestOptionsDto,
  DeclineDataRequestDto,
  DeliverDataRequestDto,
  RequestChangesDto,
  RerouteDataRequestDto,
  ResolveDataRequestCommentDto,
  ResolveDataRequestCommentResponseDto,
  UpdateDataRequestSpecDto,
  UpdateDataRequestSqlDto,
} from './dto/data-request.dto';

@ApiTags('Data requests')
@SignedInOnly()
@Controller('data-requests')
export class DataRequestsController {
  constructor(private readonly service: DataRequestsService) {}

  @Get('options')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'List eligible route groups, caller audience groups, and self-serve hint',
  })
  @ApiResponse({ status: 200, type: DataRequestOptionsDto })
  options(): Promise<DataRequestOptionsDto> {
    return this.service.options();
  }

  @Get()
  @Requires('workspace.view')
  @ApiOperation({ summary: 'List data requests (mine, team, or all)' })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['mine', 'team', 'all'],
  })
  @ApiResponse({ status: 200, type: DataRequestListResponseDto })
  list(
    @Query('scope') scope?: 'mine' | 'team' | 'all',
  ): Promise<DataRequestListResponseDto> {
    return this.service.list(scope ?? 'mine');
  }

  @Post()
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Create a new draft data request case' })
  @ApiResponse({ status: 201, type: DataRequestDetailDto })
  create(@Body() dto: CreateDataRequestDto): Promise<DataRequestDetailDto> {
    return this.service.create(dto);
  }

  @Get(':id')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Get a data request with spec, deliveries, and live dataset status' })
  @ApiResponse({ status: 200, type: DataRequestDetailDto })
  get(@Param('id') id: string): Promise<DataRequestDetailDto> {
    return this.service.get(id);
  }

  @Put(':id/spec')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Update the visual join canvas spec (optimistic concurrency)' })
  @ApiResponse({ status: 200, type: DataRequestDetailDto })
  updateSpec(
    @Param('id') id: string,
    @Body() dto: UpdateDataRequestSpecDto,
  ): Promise<DataRequestDetailDto> {
    return this.service.updateSpec(id, dto);
  }

  @Put(':id/sql')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Hand-edit or regenerate the request SQL (data team only)' })
  @ApiResponse({ status: 200, type: DataRequestDetailDto })
  updateSql(
    @Param('id') id: string,
    @Body() dto: UpdateDataRequestSqlDto,
  ): Promise<DataRequestDetailDto> {
    return this.service.updateSql(id, dto);
  }

  @Post(':id/check')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Fast static check of the request SQL against the routed group catalog' })
  @ApiResponse({ status: 201, type: DataRequestCheckResultDto })
  check(@Param('id') id: string): Promise<DataRequestCheckResultDto> {
    return this.service.check(id);
  }

  @Post(':id/describe')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Describe SQL lineage and floors as the routed group (cached by SQL hash)' })
  @ApiResponse({ status: 201, type: DataRequestDescribeResultDto })
  describe(@Param('id') id: string): Promise<DataRequestDescribeResultDto> {
    return this.service.describe(id);
  }

  @Post(':id/submit')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Submit a draft data request to the routed group' })
  @ApiResponse({ status: 201, type: DataRequestDetailDto })
  submit(@Param('id') id: string): Promise<DataRequestDetailDto> {
    return this.service.submit(id);
  }

  @Post(':id/withdraw')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Withdraw an open data request' })
  @ApiResponse({ status: 201, type: DataRequestDetailDto })
  withdraw(@Param('id') id: string): Promise<DataRequestDetailDto> {
    return this.service.withdraw(id);
  }

  @Post(':id/claim')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Claim a data request for a team member' })
  @ApiResponse({ status: 201, type: DataRequestDetailDto })
  claim(
    @Param('id') id: string,
    @Body() dto: ClaimDataRequestDto,
  ): Promise<DataRequestDetailDto> {
    return this.service.claim(id, dto ?? {});
  }

  @Post(':id/reroute')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Reroute a data request to another data-team group' })
  @ApiResponse({ status: 201, type: DataRequestDetailDto })
  reroute(
    @Param('id') id: string,
    @Body() dto: RerouteDataRequestDto,
  ): Promise<DataRequestDetailDto> {
    return this.service.reroute(id, dto);
  }

  @Post(':id/deliver')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Deliver a shared dataset to fulfil the data request' })
  @ApiResponse({ status: 201, type: DataRequestDetailDto })
  deliver(
    @Param('id') id: string,
    @Body() dto: DeliverDataRequestDto,
  ): Promise<DataRequestDetailDto> {
    return this.service.deliver(id, dto);
  }

  @Post(':id/request-changes')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Request changes on a delivered data request' })
  @ApiResponse({ status: 201, type: DataRequestDetailDto })
  requestChanges(
    @Param('id') id: string,
    @Body() dto: RequestChangesDto,
  ): Promise<DataRequestDetailDto> {
    return this.service.requestChanges(id, dto);
  }

  @Post(':id/decline')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Decline a data request with a reason' })
  @ApiResponse({ status: 201, type: DataRequestDetailDto })
  decline(
    @Param('id') id: string,
    @Body() dto: DeclineDataRequestDto,
  ): Promise<DataRequestDetailDto> {
    return this.service.decline(id, dto);
  }

  @Post(':id/comments')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Pin a discussion comment onto the request canvas' })
  @ApiResponse({ status: 201, type: AddDataRequestCommentResponseDto })
  addComment(
    @Param('id') id: string,
    @Body() dto: AddDataRequestCommentDto,
  ): Promise<AddDataRequestCommentResponseDto> {
    return this.service.addComment(id, dto);
  }

  @Get(':id/comments/:threadId/entries')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'List entries on a data request comment pin' })
  @ApiResponse({ status: 200, type: ThreadEntriesResponseDto })
  getCommentEntries(
    @Param('id') id: string,
    @Param('threadId') threadId: string,
  ): Promise<ThreadEntriesResponseDto> {
    return this.service.getCommentEntries(id, threadId);
  }

  @Post(':id/comments/:threadId/entries')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Reply to a data request comment pin' })
  @ApiResponse({ status: 201, type: ThreadResponseDto })
  replyComment(
    @Param('id') id: string,
    @Param('threadId') threadId: string,
    @Body() dto: AddDataRequestCommentReplyDto,
  ): Promise<ThreadResponseDto> {
    return this.service.replyComment(id, threadId, dto.body);
  }

  @Patch(':id/comments/:threadId/resolve')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Resolve or reopen a data request comment pin' })
  @ApiResponse({ status: 200, type: ResolveDataRequestCommentResponseDto })
  resolveComment(
    @Param('id') id: string,
    @Param('threadId') threadId: string,
    @Body() dto: ResolveDataRequestCommentDto,
  ): Promise<ResolveDataRequestCommentResponseDto> {
    return this.service.resolveComment(id, threadId, dto.resolved);
  }
}
