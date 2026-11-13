import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Requires, SignedInOnly } from '../identity/access.decorators';
import { DataConnectionService } from './data-connection.service';
import {
  BlockDataConnectionDto,
  CreateDataConnectionDto,
  DataConnectionDto,
  DataConnectionEndpointDto,
  DataConnectionListDto,
  DataConnectionSecretDto,
  IssueDataConnectionDto,
  RevokeDataConnectionDto,
} from './data-connection.dto';

/**
 * SQL connections (docs/prd/DQ-data-query.md §5.7). Routes declare
 * `workspace.view` and are for signed-in people only; the service decides the
 * rest (its person, `data.connect`, `data.connection.manage`, or governing the
 * table or source), and writes its own audit events.
 */
@ApiTags('SQL connections')
@SignedInOnly()
@Controller()
export class DataConnectionController {
  constructor(private readonly connections: DataConnectionService) {}

  @Get('data-connections')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Your SQL connections' })
  @ApiOkResponse({ type: DataConnectionListDto })
  mine(): Promise<DataConnectionListDto> {
    return this.connections.listMine();
  }

  @Get('data-connections/all')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Everyone’s SQL connections (data.connection.manage)',
  })
  @ApiOkResponse({ type: DataConnectionListDto })
  all(): Promise<DataConnectionListDto> {
    return this.connections.listAll();
  }

  @Get('data-connections/endpoint')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Where tools connect: host, port, database, TLS' })
  @ApiOkResponse({ type: DataConnectionEndpointDto })
  endpoint(): DataConnectionEndpointDto {
    return this.connections.endpoint();
  }

  @Get('assets/:id/data-connections')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'SQL connections that read, name or are blocked on a table',
  })
  @ApiOkResponse({ type: DataConnectionListDto })
  forAsset(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DataConnectionListDto> {
    return this.connections.listFor({ type: 'asset', id });
  }

  @Get('sources/:id/data-connections')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'SQL connections that read, name or are blocked on a source',
  })
  @ApiOkResponse({ type: DataConnectionListDto })
  forSource(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DataConnectionListDto> {
    return this.connections.listFor({ type: 'source', id });
  }

  @Post('data-connections')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Create a SQL connection of your own; the password is shown once',
  })
  @ApiOkResponse({ type: DataConnectionSecretDto })
  create(
    @Body() body: CreateDataConnectionDto,
  ): Promise<DataConnectionSecretDto> {
    return this.connections.create(body);
  }

  @Post('data-connections/issue')
  @Requires('workspace.view')
  @ApiOperation({
    summary:
      'Give someone a SQL connection; they reveal its password themselves',
  })
  @ApiOkResponse({ type: DataConnectionDto })
  issue(@Body() body: IssueDataConnectionDto): Promise<DataConnectionDto> {
    return this.connections.issue(body);
  }

  @Post('data-connections/:id/password')
  @Requires('workspace.view')
  @ApiOperation({
    summary:
      'Reveal (first time) or replace the password of your own connection',
  })
  @ApiOkResponse({ type: DataConnectionSecretDto })
  password(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DataConnectionSecretDto> {
    return this.connections.newPasswordFor(id);
  }

  @Post('data-connections/:id/revoke')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Revoke a SQL connection (its person or a manager)',
  })
  @ApiOkResponse({ type: DataConnectionDto })
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RevokeDataConnectionDto,
  ): Promise<DataConnectionDto> {
    return this.connections.revoke(id, body?.reason);
  }

  @Post('data-connections/:id/blocks')
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Close a table or source you govern to this connection',
  })
  @ApiOkResponse({ type: DataConnectionDto })
  block(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BlockDataConnectionDto,
  ): Promise<DataConnectionDto> {
    return this.connections.block(id, body);
  }

  @Delete('data-connections/:id/blocks/:blockId')
  @Requires('workspace.view')
  @ApiOperation({ summary: 'Lift a block' })
  @ApiOkResponse({ type: DataConnectionDto })
  unblock(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ): Promise<DataConnectionDto> {
    return this.connections.unblock(id, blockId);
  }
}
