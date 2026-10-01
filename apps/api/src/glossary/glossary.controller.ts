import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  GlossaryRelationType,
  GlossaryStatus,
  GlossaryTermKind,
} from '@prisma/client';
import { GlossaryService } from './glossary.service';
import { GlossaryRelationsService } from './glossary-relations.service';
import { GlossaryImportExportService } from './glossary-import-export.service';
import { ActorName } from '../actor-name.decorator';
import { AllowInDemoMode } from '../demo-mode.decorator';
import {
  BulkUpdateGlossaryTermsDto,
  BulkUpdateGlossaryTermsResponseDto,
  CreateGlossaryRelationDto,
  DeleteGlossaryTermResponseDto,
  DeprecateGlossaryTermDto,
  GlossaryImportDto,
  GlossaryListResponseDto,
  GlossaryLookupHitDto,
  GlossarySchemeDto,
  GlossaryTermDto,
  ListGlossaryQueryDto,
  LookupGlossaryQueryDto,
  UpsertGlossarySchemeDto,
  UpsertGlossaryTermDto,
  UpsertGlossaryTermResponseDto,
  VerifyGlossaryTermDto,
} from './dto/glossary.dto';

const STATUSES = new Set<string>(Object.values(GlossaryStatus));

/** Comma-separated statuses from a query string, unknown values refused. */
export function parseStatuses(raw?: string): GlossaryStatus[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const unknown = values.filter((value) => !STATUSES.has(value));
  if (unknown.length) {
    throw new BadRequestException(`Unknown status: ${unknown.join(', ')}`);
  }
  return values as GlossaryStatus[];
}

@ApiTags('glossary')
@Controller('glossary')
export class GlossaryController {
  constructor(
    private readonly glossary: GlossaryService,
    private readonly relations: GlossaryRelationsService,
    private readonly transfer: GlossaryImportExportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List glossary terms' })
  @ApiOkResponse({ type: GlossaryListResponseDto })
  list(@Query() query: ListGlossaryQueryDto) {
    return this.glossary.list({
      query: query.query,
      entityType: query.entityType,
      kind: query.kind,
      schemeId: query.schemeId,
      schemeKey: query.schemeKey,
      status: parseStatuses(query.status),
      steward: query.steward,
      take: query.take,
      skip: query.skip,
    });
  }

  @Get('lookup')
  @ApiOperation({
    summary:
      'Resolve a name, alias, code or hidden alias to glossary terms (exact, prefix, substring, semantic)',
  })
  @ApiOkResponse({ type: [GlossaryLookupHitDto] })
  lookup(@Query() query: LookupGlossaryQueryDto) {
    return this.glossary.lookup(query.query, query.limit, {
      kind: query.kind,
      schemeId: query.schemeId,
      schemeKey: query.schemeKey,
      status: parseStatuses(query.status),
      includeDeprecated: query.includeDeprecated === 'true',
    });
  }

  @Get('banner')
  @ApiOperation({
    summary: 'The one-time "we classified your terms" banner (SL1 R8)',
  })
  banner() {
    return this.glossary.migrationBanner();
  }

  @Post('banner/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dismiss the classification banner' })
  dismissBanner() {
    return this.glossary.dismissMigrationBanner();
  }

  @Get('terms/:idOrKey')
  @ApiOperation({
    summary:
      'A term by id or key (old keys resolve): scheme, relations, broader chain, narrower list',
  })
  getTerm(@Param('idOrKey') idOrKey: string) {
    return this.glossary.getTerm(idOrKey);
  }

  @Get('terms/:idOrKey/activity')
  @ApiOperation({ summary: "A term's history (paged)" })
  activity(
    @Param('idOrKey') idOrKey: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.glossary.activity(
      idOrKey,
      Number(take ?? 50),
      Number(skip ?? 0),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create or update a glossary term (operator)' })
  @ApiOkResponse({ type: UpsertGlossaryTermResponseDto })
  upsert(@Body() dto: UpsertGlossaryTermDto, @ActorName() actor?: string) {
    return this.glossary.upsert({
      id: dto.id,
      term: dto.term,
      kind: dto.kind,
      key: dto.key,
      aliases: dto.aliases,
      codes: dto.codes,
      hiddenAliases: dto.hiddenAliases,
      definition: dto.definition,
      schemeId: dto.schemeId,
      schemeKey: dto.schemeKey,
      steward: dto.steward,
      status: dto.status,
      entityType: dto.entityType,
      notes: dto.notes ?? undefined,
      createNew: dto.createNew,
      refType: dto.refType,
      refId: dto.refId,
      origin: 'OPERATOR',
      author: dto.author ?? actor,
    });
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Bulk approve/unapprove/deprecate, retype, move scheme or change kind (operator)',
  })
  @ApiOkResponse({ type: BulkUpdateGlossaryTermsResponseDto })
  bulkUpdate(
    @Body() dto: BulkUpdateGlossaryTermsDto,
    @ActorName() actor?: string,
  ) {
    return this.glossary.bulkUpdate({
      ids: dto.ids,
      filters: dto.filters,
      verified: dto.verified,
      status: dto.status,
      entityType: dto.entityType,
      schemeId: dto.schemeId,
      kind: dto.kind,
      verifiedBy: dto.verifiedBy ?? actor,
    });
  }

  @Patch(':id/verify')
  @ApiOperation({ summary: 'Approve a term (alias of /approve)' })
  @ApiOkResponse({ type: GlossaryTermDto })
  verify(
    @Param('id') id: string,
    @Body() dto: VerifyGlossaryTermDto,
    @ActorName() actor?: string,
  ) {
    return this.glossary.verify(id, dto?.verifiedBy ?? actor);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DRAFT → APPROVED' })
  @ApiOkResponse({ type: GlossaryTermDto })
  approve(@Param('id') id: string, @ActorName() actor?: string) {
    return this.glossary.approve(id, actor ?? 'operator');
  }

  @Post(':id/unapprove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'APPROVED → DRAFT' })
  @ApiOkResponse({ type: GlossaryTermDto })
  unapprove(@Param('id') id: string, @ActorName() actor?: string) {
    return this.glossary.unapprove(id, actor ?? 'operator');
  }

  @Post(':id/deprecate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'APPROVED → DEPRECATED, optionally with a successor' })
  @ApiOkResponse({ type: GlossaryTermDto })
  deprecate(
    @Param('id') id: string,
    @Body() dto: DeprecateGlossaryTermDto,
    @ActorName() actor?: string,
  ) {
    return this.glossary.deprecate(
      id,
      dto?.replacedById ?? null,
      actor ?? 'operator',
    );
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DEPRECATED → APPROVED' })
  @ApiOkResponse({ type: GlossaryTermDto })
  reinstate(@Param('id') id: string, @ActorName() actor?: string) {
    return this.glossary.reinstate(id, actor ?? 'operator');
  }

  // ── Schemes ─────────────────────────────────────────────────────────────

  @Get('schemes')
  @ApiOperation({ summary: 'List schemes with term counts' })
  @ApiOkResponse({ type: [GlossarySchemeDto] })
  listSchemes() {
    return this.glossary.listSchemes();
  }

  @Post('schemes')
  @ApiOperation({ summary: 'Create a scheme' })
  @ApiOkResponse({ type: GlossarySchemeDto })
  createScheme(
    @Body() dto: UpsertGlossarySchemeDto,
    @ActorName() actor?: string,
  ) {
    return this.glossary.upsertScheme({ ...dto, actor });
  }

  @Get('schemes/:id')
  @ApiOkResponse({ type: GlossarySchemeDto })
  getScheme(@Param('id') id: string) {
    return this.glossary.getScheme(id);
  }

  @Patch('schemes/:id')
  @ApiOperation({ summary: 'Edit a scheme' })
  @ApiOkResponse({ type: GlossarySchemeDto })
  updateScheme(
    @Param('id') id: string,
    @Body() dto: UpsertGlossarySchemeDto,
    @ActorName() actor?: string,
  ) {
    return this.glossary.upsertScheme({ ...dto, id, actor });
  }

  @Delete('schemes/:id')
  @ApiOperation({ summary: 'Delete an empty scheme' })
  deleteScheme(@Param('id') id: string, @ActorName() actor?: string) {
    return this.glossary.deleteScheme(id, actor ?? 'operator');
  }

  @Get('schemes/:id/tree')
  @ApiOperation({
    summary:
      'One level of a scheme taxonomy: roots, or the narrower concepts of parentId',
  })
  tree(@Param('id') id: string, @Query('parentId') parentId?: string) {
    return this.glossary.schemeTree(id, parentId || undefined);
  }

  // ── Relations ───────────────────────────────────────────────────────────

  @Get('relations')
  @ApiOperation({ summary: 'List relations' })
  listRelations(
    @Query('termId') termId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    if (type && !(type in GlossaryRelationType)) {
      throw new BadRequestException(`Unknown relation type ${type}`);
    }
    return this.relations.list({
      termId,
      type: type as GlossaryRelationType | undefined,
      status: parseStatuses(status)?.[0],
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Post('relations')
  @ApiOperation({ summary: 'Create a relation (APPROVED for operators)' })
  async createRelation(
    @Body() dto: CreateGlossaryRelationDto,
    @ActorName() actor?: string,
  ) {
    const [from, to] = await Promise.all([
      this.glossary.resolveOrThrow(dto.from),
      this.glossary.resolveOrThrow(dto.to),
    ]);
    return this.relations.create({
      fromTermId: from.id,
      toTermId: to.id,
      type: dto.type,
      label: dto.label,
      note: dto.note,
      origin: 'OPERATOR',
      actor: actor ?? 'operator',
    });
  }

  @Post('relations/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveRelation(@Param('id') id: string, @ActorName() actor?: string) {
    return this.relations.approve(id, actor ?? 'operator');
  }

  @Delete('relations/:id')
  removeRelation(@Param('id') id: string, @ActorName() actor?: string) {
    return this.relations.remove(id, actor ?? 'operator');
  }

  // ── Import / export ─────────────────────────────────────────────────────

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Import CSV or SKOS JSON-LD. Defaults to a dry run that reports creates, updates, skips, conflicts and refusals.',
  })
  import(@Body() dto: GlossaryImportDto, @ActorName() actor?: string) {
    if (!dto?.content) throw new BadRequestException('content is required');
    return this.transfer.importFile(dto.format, dto.content, {
      dryRun: dto.dryRun ?? true,
      conflict: dto.conflict ?? 'skip',
      asDraft: dto.asDraft,
      language: dto.language,
      schemeKey: dto.schemeKey,
      actor: actor ?? 'operator',
    });
  }

  @Get('import/:jobId')
  @ApiOperation({ summary: 'An import report' })
  importJob(@Param('jobId') jobId: string) {
    return this.transfer.importJob(jobId);
  }

  @Get('export')
  @AllowInDemoMode()
  @ApiOperation({ summary: 'Export as CSV or SKOS JSON-LD' })
  async export(
    @Res() reply: FastifyReply,
    @Query('format') format = 'csv',
    @Query('schemeId') schemeId?: string,
    @Query('kinds') kinds?: string,
    @Query('baseUrl') baseUrl?: string,
  ) {
    if (format !== 'csv' && format !== 'skos') {
      throw new BadRequestException('format is csv or skos');
    }
    const parsedKinds = kinds
      ?.split(',')
      .map((kind) => kind.trim().toUpperCase())
      .filter((kind): kind is GlossaryTermKind => kind in GlossaryTermKind);
    const file = await this.transfer.exportFile({
      format,
      schemeId: schemeId || undefined,
      kinds: parsedKinds,
      baseUrl,
    });
    void reply
      .header('Content-Type', file.contentType)
      .header(
        'Content-Disposition',
        `attachment; filename="${file.fileName}"`,
      )
      .send(file.body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a glossary term (deletion is remembered)' })
  @ApiOkResponse({ type: DeleteGlossaryTermResponseDto })
  remove(@Param('id') id: string, @ActorName() actor?: string) {
    return this.glossary.remove(id, actor ?? 'operator');
  }
}
