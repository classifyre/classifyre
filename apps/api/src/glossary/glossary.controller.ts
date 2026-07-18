import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GlossaryService } from './glossary.service';
import {
  DeleteGlossaryTermResponseDto,
  GlossaryListResponseDto,
  GlossaryLookupHitDto,
  GlossaryTermDto,
  ListGlossaryQueryDto,
  LookupGlossaryQueryDto,
  UpsertGlossaryTermDto,
  UpsertGlossaryTermResponseDto,
  VerifyGlossaryTermDto,
} from './dto/glossary.dto';

@ApiTags('glossary')
@Controller('glossary')
export class GlossaryController {
  constructor(private readonly glossary: GlossaryService) {}

  @Get()
  @ApiOperation({ summary: 'List glossary terms' })
  @ApiOkResponse({ type: GlossaryListResponseDto })
  list(@Query() query: ListGlossaryQueryDto) {
    return this.glossary.list({
      query: query.query,
      entityType: query.entityType,
      take: query.take,
      skip: query.skip,
    });
  }

  @Get('lookup')
  @ApiOperation({
    summary: 'Resolve a name or alias to glossary terms (exact + semantic)',
  })
  @ApiOkResponse({ type: [GlossaryLookupHitDto] })
  lookup(@Query() query: LookupGlossaryQueryDto) {
    return this.glossary.lookup(query.query, query.limit);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update a glossary term (operator)' })
  @ApiOkResponse({ type: UpsertGlossaryTermResponseDto })
  upsert(@Body() dto: UpsertGlossaryTermDto) {
    return this.glossary.upsert({
      id: dto.id,
      term: dto.term,
      aliases: dto.aliases,
      entityType: dto.entityType,
      notes: dto.notes,
      refType: dto.refType,
      refId: dto.refId,
      origin: 'OPERATOR',
      author: dto.author,
    });
  }

  @Patch(':id/verify')
  @ApiOperation({ summary: 'Mark an agent-proposed term as verified' })
  @ApiOkResponse({ type: GlossaryTermDto })
  verify(@Param('id') id: string, @Body() dto: VerifyGlossaryTermDto) {
    return this.glossary.verify(id, dto.verifiedBy);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a glossary term' })
  @ApiOkResponse({ type: DeleteGlossaryTermResponseDto })
  remove(@Param('id') id: string) {
    return this.glossary.remove(id);
  }
}
