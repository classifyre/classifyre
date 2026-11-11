import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Requires } from './access.decorators';
import { ActorDirectoryService } from './actor-directory.service';
import {
  AuditEventSortBy,
  AuditEventSortOrder,
  AuditEventsResponseDto,
  QueryAuditEventsDto,
  ResolvedActorDto,
} from './audit.dto';
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
      'Filter by entity (e.g. entityType=sources&entityId=…), by what it touched (resource=data, source:<id> or asset:<id>), actor, capability, operation or free text. Sort any column; page with `skip`/`limit` or, for "load more", with `before`, the id of the last event received.',
  })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'actor', required: false })
  @ApiQuery({ name: 'capability', required: false })
  @ApiQuery({ name: 'operation', required: false })
  @ApiQuery({
    name: 'resource',
    required: false,
    description:
      'Only events that touched this: `data` (SQL reads and data-reader grants), `source:<id>` or `asset:<id>`.',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'before', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: AuditEventSortBy })
  @ApiQuery({ name: 'sortOrder', required: false, enum: AuditEventSortOrder })
  @ApiOkResponse({ type: AuditEventsResponseDto })
  async list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actor') actor?: string,
    @Query('capability') capability?: string,
    @Query('operation') operation?: string,
    @Query('resource') resource?: string,
    @Query('search') search?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ): Promise<AuditEventsResponseDto> {
    const page = Math.min(
      Math.max(skip ? Number(skip) : 0, 0),
      Number.MAX_SAFE_INTEGER,
    );
    const dto: QueryAuditEventsDto = {
      entityType,
      entityId,
      actor,
      capability,
      operation,
      search,
      before,
      page: {
        skip: Number.isFinite(page) ? page : 0,
        limit: limit ? Number(limit) : undefined,
        sortBy: (Object.values(AuditEventSortBy) as string[]).includes(
          sortBy ?? '',
        )
          ? (sortBy as AuditEventSortBy)
          : undefined,
        sortOrder: (Object.values(AuditEventSortOrder) as string[]).includes(
          sortOrder ?? '',
        )
          ? (sortOrder as AuditEventSortOrder)
          : undefined,
      },
    };
    const {
      items,
      total,
      skip: usedSkip,
      limit: usedLimit,
    } = await this.audit.list({
      entityType: dto.entityType,
      entityId: dto.entityId,
      actor: dto.actor,
      capability: dto.capability,
      operation: dto.operation,
      resource: resource || undefined,
      search: dto.search,
      before: dto.before,
      limit: dto.page?.limit,
      skip: dto.page?.skip,
      sortBy: dto.page?.sortBy,
      sortOrder: dto.page?.sortOrder,
    });
    return { items, total, skip: usedSkip, limit: usedLimit };
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
