import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SitemapEntriesDto, SitemapIndexDto } from './sitemap.dto';
import {
  SITEMAP_ENTITY_TYPES,
  isSitemapEntityType,
  type SitemapEntityType,
} from './sitemap.entities';
import { SitemapService } from './sitemap.service';

/**
 * Namespace-scoped sitemap coordinates (`GET /<namespace>/sitemap/...`).
 *
 * Consumed server-side by the web app's `/sitemap.xml` routes, which own the
 * URL shapes and the XML rendering. Read-only and cheap by design so a crawler
 * walking a large tenant cannot turn into a load problem.
 */
@ApiTags('Sitemap')
@Controller('sitemap')
export class SitemapController {
  constructor(private readonly sitemapService: SitemapService) {}

  @Get()
  @ApiOperation({
    summary: 'Sitemap index: per-entity chunk counts and last-modified dates',
  })
  @ApiQuery({
    name: 'chunkSize',
    required: false,
    description: 'URLs per child sitemap (100–50000, default 10000).',
  })
  @ApiResponse({ status: 200, type: SitemapIndexDto })
  getIndex(@Query('chunkSize') chunkSize?: string): Promise<SitemapIndexDto> {
    return this.sitemapService.getIndex(parseIntOrUndefined(chunkSize));
  }

  @Get('entries')
  @ApiOperation({
    summary: 'One chunk of detail-page ids + last-modified dates',
  })
  @ApiQuery({ name: 'type', enum: SITEMAP_ENTITY_TYPES })
  @ApiQuery({
    name: 'chunk',
    required: false,
    description: 'Zero-based chunk.',
  })
  @ApiQuery({ name: 'chunkSize', required: false })
  @ApiResponse({ status: 200, type: SitemapEntriesDto })
  getEntries(
    @Query('type') type: string,
    @Query('chunk') chunk?: string,
    @Query('chunkSize') chunkSize?: string,
  ): Promise<SitemapEntriesDto> {
    return this.sitemapService.getEntries(
      parseEntityType(type),
      parseIntOrUndefined(chunk) ?? 0,
      parseIntOrUndefined(chunkSize),
    );
  }
}

/**
 * Query params arrive as raw strings — this app registers no global
 * ValidationPipe, so every controller normalizes its own input.
 */
function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseEntityType(value: string): SitemapEntityType {
  if (typeof value === 'string' && isSitemapEntityType(value)) return value;
  throw new BadRequestException(
    `Unknown sitemap entity type '${String(value)}'. Expected one of: ${SITEMAP_ENTITY_TYPES.join(', ')}.`,
  );
}
