import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Requires } from './access.decorators';
import { ActorDirectoryService } from './actor-directory.service';
import { AuditEventDto, ResolvedActorDto } from './audit.dto';
import { AuditTrailService } from './audit-trail.service';

@ApiTags('Identity')
@Requires('workspace.view')
@Controller()
export class AuditController {
  constructor(
    private readonly audit: AuditTrailService,
    private readonly actors: ActorDirectoryService,
  ) {}

  @Get('audit-events')
  @ApiOperation({
    summary: 'Changes made in this workspace, newest first',
    description:
      'Filter by entity (e.g. entityType=sources&entityId=…) or by actor reference. Page with `before`, the id of the last event received.',
  })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'actor', required: false })
  @ApiQuery({ name: 'before', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ type: [AuditEventDto] })
  list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actor') actor?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<AuditEventDto[]> {
    return this.audit.list({
      entityType,
      entityId,
      actor,
      before,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('actors/resolve')
  @ApiOperation({
    summary: 'Display names for actor references',
    description:
      'Repeat `refs` once per reference (`?refs=a&refs=b`), at most 200. Names may contain commas, so the list is never comma-separated.',
  })
  @ApiQuery({ name: 'refs', required: true, type: [String] })
  @ApiOkResponse({ type: [ResolvedActorDto] })
  resolve(
    @Query('refs') refs: string | string[] = [],
  ): Promise<ResolvedActorDto[]> {
    return this.actors.resolve(Array.isArray(refs) ? refs : [refs]);
  }
}
