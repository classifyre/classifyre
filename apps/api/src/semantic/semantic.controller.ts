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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  DetectorType,
  GlossaryBindingStatus,
  GlossaryOrigin,
  SemanticLinkMethod,
} from '@prisma/client';
import { ActorName } from '../actor-name.decorator';
import { AllowInDemoMode } from '../demo-mode.decorator';
import { GlossaryService } from '../glossary/glossary.service';
import { BindingsService } from './bindings/bindings.service';
import type { BindingSpec } from './bindings/binding-spec';
import { VocabularyService } from './vocabulary/vocabulary.service';
import { SemanticJobsScheduler } from './semantic-jobs.scheduler';
import { SemanticLinkerService } from './linker/semantic-linker.service';
import { MeaningService } from './links/meaning.service';
import { GlossaryPacksService } from './packs/glossary-packs.service';
import { SemanticSuggestionsService } from './suggestions/semantic-suggestions.service';
import { SemanticMapService } from './map/semantic-map.service';
import { unknownTermRefs } from './term-refs';
import { PrismaService } from '../prisma.service';

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function list(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return undefined;
}

const SPEC_KEYS = new Set([
  'mode',
  'output',
  'field',
  'values',
  'splitDelimiter',
  'lookup',
  'termKey',
  'termId',
  'noMeaning',
  'sourceIds',
  'confidence',
]);

/** Fail closed on unknown keys (integration rule 4): a typo is a 400, not a no-op. */
export function parseBindingSpec(
  body: unknown,
  extra: string[] = [],
): BindingSpec {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('A binding spec is a JSON object');
  }
  const allowed = new Set([...SPEC_KEYS, ...extra]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new BadRequestException(`Unknown field(s): ${unknown.join(', ')}`);
  }
  return body as BindingSpec;
}

/**
 * The semantic layer's REST surface (SL2–SL5): vocabulary, bindings, meaning,
 * links, packs, suggestions, the linker and the semantic map.
 */
@ApiTags('semantic')
@Controller('semantic')
export class SemanticController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly glossary: GlossaryService,
    private readonly bindings: BindingsService,
    private readonly vocabulary: VocabularyService,
    private readonly jobs: SemanticJobsScheduler,
    private readonly linker: SemanticLinkerService,
    private readonly meaning: MeaningService,
    private readonly packs: GlossaryPacksService,
    private readonly suggestions: SemanticSuggestionsService,
    private readonly map: SemanticMapService,
  ) {}

  private async termId(idOrKey: string): Promise<string> {
    return (await this.glossary.resolveOrThrow(idOrKey)).id;
  }

  // ── Vocabulary (SL2 F8) ──────────────────────────────────────────────────

  @Get('vocabulary')
  @ApiOperation({
    summary:
      'The observed vocabulary: detector outputs and metadata fields, with counts and bindings',
  })
  vocabularyList(
    @Query('kind') kind?: string,
    @Query('sourceId') sourceId?: string,
    @Query('detectorType') detectorType?: string,
    @Query('customDetectorKey') customDetectorKey?: string,
    @Query('bound') bound?: string,
    @Query('q') q?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    if (kind && !['outputs', 'fields', 'all'].includes(kind)) {
      throw new BadRequestException('kind is outputs, fields or all');
    }
    if (bound && !['true', 'false', 'any'].includes(bound)) {
      throw new BadRequestException('bound is true, false or any');
    }
    return this.vocabulary.list({
      kind: kind as 'outputs' | 'fields' | 'all' | undefined,
      sourceId,
      detectorType,
      customDetectorKey,
      bound: bound as 'true' | 'false' | 'any' | undefined,
      q,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Post('vocabulary/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue a vocabulary refresh (one source, or all)' })
  async vocabularyRefresh(@Body() body: { sourceId?: string } = {}) {
    await this.jobs.scheduleVocabularyRefresh(
      body?.sourceId ?? null,
      'on demand',
    );
    return { queued: true };
  }

  @Get('vocabulary/values')
  @ApiOperation({
    summary: 'Top observed values with counts, for the binding dialog',
  })
  vocabularyValues(
    @Query('detectorType') detectorType?: string,
    @Query('customDetectorKey') customDetectorKey?: string,
    @Query('findingType') findingType?: string,
    @Query('field') field?: string,
    @Query('sourceIds') sourceIds?: string,
    @Query('limit') limit?: string,
  ) {
    if (detectorType && !(detectorType in DetectorType)) {
      throw new BadRequestException(`Unknown detectorType ${detectorType}`);
    }
    return this.vocabulary.values({
      detectorType: detectorType as DetectorType | undefined,
      customDetectorKey: customDetectorKey || null,
      findingType,
      field,
      sourceIds: list(sourceIds),
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('coverage')
  @ApiOperation({
    summary:
      'Semantic coverage: the share of open findings that carry a meaning',
  })
  async coverage(@Query('days') days?: string) {
    return {
      ...(await this.vocabulary.coverage()),
      history: await this.vocabulary.coverageHistory(days ? Number(days) : 90),
    };
  }

  // ── Bindings (SL2) ───────────────────────────────────────────────────────

  @Post('bindings/preview')
  @HttpCode(HttpStatus.OK)
  @AllowInDemoMode()
  @ApiOperation({
    summary: 'Preview a binding: counts, samples, the lookup table, warnings',
  })
  preview(@Body() body: unknown) {
    return this.bindings.preview(parseBindingSpec(body));
  }

  @Get('bindings')
  @ApiOperation({ summary: 'List bindings' })
  async listBindings(
    @Query('termId') termId?: string,
    @Query('status') status?: string,
    @Query('origin') origin?: string,
    @Query('detectorType') detectorType?: string,
    @Query('customDetectorKey') customDetectorKey?: string,
    @Query('findingType') findingType?: string,
    @Query('schemeId') schemeId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    if (status && !(status in GlossaryBindingStatus)) {
      throw new BadRequestException(`Unknown status ${status}`);
    }
    if (origin && !(origin in GlossaryOrigin)) {
      throw new BadRequestException(`Unknown origin ${origin}`);
    }
    return this.bindings.list({
      termId: termId ? await this.termId(termId) : undefined,
      status: status as GlossaryBindingStatus | undefined,
      origin: origin as GlossaryOrigin | undefined,
      detectorType,
      customDetectorKey,
      findingType,
      schemeId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Post('bindings')
  @ApiOperation({
    summary: 'Create a binding (APPROVED for operators unless status DRAFT)',
  })
  createBinding(
    @Body() body: Record<string, unknown>,
    @ActorName() actor?: string,
  ) {
    const { status, note, ...rest } = body ?? {};
    if (status !== undefined && status !== 'APPROVED' && status !== 'DRAFT') {
      throw new BadRequestException('status is APPROVED or DRAFT');
    }
    return this.bindings.create(parseBindingSpec(rest), {
      origin: 'OPERATOR',
      status: status ?? 'APPROVED',
      actor: actor ?? 'operator',
      note: typeof note === 'string' ? note : null,
    });
  }

  @Get('bindings/:id')
  getBinding(@Param('id') id: string) {
    return this.bindings.get(id);
  }

  @Patch('bindings/:id')
  @ApiOperation({ summary: 'Edit a DRAFT binding' })
  updateBinding(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @ActorName() actor?: string,
  ) {
    const { note, ...rest } = body ?? {};
    return this.bindings.update(id, parseBindingSpec(rest), {
      actor,
      note: typeof note === 'string' ? note : undefined,
    });
  }

  @Post('bindings/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveBinding(@Param('id') id: string, @ActorName() actor?: string) {
    return this.bindings.approve(id, actor ?? 'operator');
  }

  @Post('bindings/:id/disable')
  @HttpCode(HttpStatus.OK)
  disableBinding(@Param('id') id: string, @ActorName() actor?: string) {
    return this.bindings.disable(id, actor ?? 'operator');
  }

  @Post('bindings/:id/enable')
  @HttpCode(HttpStatus.OK)
  enableBinding(@Param('id') id: string, @ActorName() actor?: string) {
    return this.bindings.enable(id, actor ?? 'operator');
  }

  @Post('bindings/:id/retarget')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Aim a binding at its deprecated concept's successor",
  })
  retargetBinding(@Param('id') id: string, @ActorName() actor?: string) {
    return this.bindings.retarget(id, actor ?? 'operator');
  }

  @Delete('bindings/:id')
  @ApiOperation({ summary: 'Delete a DRAFT or DISABLED binding' })
  deleteBinding(@Param('id') id: string, @ActorName() actor?: string) {
    return this.bindings.remove(id, actor ?? 'operator');
  }

  // ── Packs (SL2 §8) ───────────────────────────────────────────────────────

  @Get('packs')
  @ApiOperation({ summary: 'Installed packs and the bundled starter packs' })
  listPacks() {
    return this.packs.list();
  }

  @Post('packs/install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Install a pack (dry run by default)' })
  installPack(
    @Body()
    body: {
      pack?: unknown;
      key?: string;
      dryRun?: boolean;
      resolutions?: Record<string, 'skip' | 'overwrite'>;
    },
    @ActorName() actor?: string,
  ) {
    return this.packs.install({ ...body, actor });
  }

  @Post('packs/:key/upgrade')
  @HttpCode(HttpStatus.OK)
  upgradePack(
    @Param('key') key: string,
    @Body() body: { pack?: unknown; dryRun?: boolean } = {},
    @ActorName() actor?: string,
  ) {
    return this.packs.upgrade(key, { ...body, actor });
  }

  @Delete('packs/:key')
  @ApiOperation({
    summary: 'Uninstall a pack: untouched items go, edited ones are detached',
  })
  uninstallPack(
    @Param('key') key: string,
    @Query('dryRun') dryRun?: string,
    @ActorName() actor?: string,
  ) {
    return this.packs.uninstall(key, {
      dryRun: dryRun === undefined ? false : bool(dryRun),
      actor,
    });
  }

  // ── Meaning (SL3 R4) ─────────────────────────────────────────────────────

  @Get('findings/:findingId/meaning')
  @ApiOperation({
    summary:
      'What a finding means: bindings evaluated, manual links, broader concepts (C11)',
  })
  findingMeaning(@Param('findingId') findingId: string) {
    return this.meaning.findingMeaning(findingId);
  }

  @Get('assets/:assetId/meaning')
  @ApiOperation({
    summary:
      "An asset's current links, grouped by term; GONE links with history=true",
  })
  assetMeaning(
    @Param('assetId') assetId: string,
    @Query('history') history?: string,
  ) {
    return this.meaning.assetMeaning(assetId, bool(history));
  }

  @Get('assets/:assetId/terms/:termId/evidence')
  @ApiOperation({ summary: 'Why this asset is about this term' })
  async assetTermEvidence(
    @Param('assetId') assetId: string,
    @Param('termId') termId: string,
    @Query('page') page?: string,
  ) {
    return this.meaning.assetTermEvidence(
      assetId,
      await this.termId(termId),
      Number(page ?? 0) || 0,
    );
  }

  @Get('terms/:termId/evidence')
  @ApiOperation({
    summary: 'Assets linked to a term, by severity then support',
  })
  async termEvidence(
    @Param('termId') termId: string,
    @Query('includeNarrower') includeNarrower?: string,
    @Query('sourceId') sourceId?: string,
    @Query('method') method?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (method && !(method in SemanticLinkMethod)) {
      throw new BadRequestException(`Unknown method ${method}`);
    }
    if (status && !['current', 'gone', 'all'].includes(status)) {
      throw new BadRequestException('status is current, gone or all');
    }
    return this.meaning.termEvidence(await this.termId(termId), {
      includeNarrower: bool(includeNarrower),
      sourceId,
      method: method as SemanticLinkMethod | undefined,
      status: status as 'current' | 'gone' | 'all' | undefined,
      page: Number(page ?? 0) || 0,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('terms/:termId/summary')
  @ApiOperation({
    summary: 'Counts by method, source and severity, and a weekly trend',
  })
  async termSummary(
    @Param('termId') termId: string,
    @Query('includeNarrower') includeNarrower?: string,
  ) {
    return this.meaning.termSummary(
      await this.termId(termId),
      bool(includeNarrower),
    );
  }

  @Get('terms/:termId/usage')
  @ApiOperation({ summary: 'Cases and watches that use a term' })
  async termUsage(@Param('termId') termId: string) {
    return this.meaning.termCasesAndWatches(await this.termId(termId));
  }

  @Get('cases/:caseId/links')
  @ApiOperation({ summary: 'Terms a case is about (case ABOUT links)' })
  caseLinks(@Param('caseId') caseId: string) {
    return this.meaning.caseLinks(caseId);
  }

  // ── Manual links (SL3 R5) ────────────────────────────────────────────────

  @Post('links')
  @ApiOperation({ summary: 'Link a finding, asset or case to a term (MANUAL)' })
  async link(
    @Body()
    body: {
      termId?: string;
      termKey?: string;
      target?: { type: string; id: string };
      note?: string;
    },
    @ActorName() actor?: string,
  ) {
    const ref = body?.termId ?? body?.termKey;
    if (!ref) throw new BadRequestException('termId or termKey is required');
    if (!body.target?.type || !body.target?.id) {
      throw new BadRequestException('target { type, id } is required');
    }
    return this.meaning.link({
      termId: await this.termId(ref),
      target: body.target,
      note: body.note ?? null,
      actor: actor ?? 'operator',
    });
  }

  @Delete('links/:referenceId')
  unlink(
    @Param('referenceId') referenceId: string,
    @ActorName() actor?: string,
  ) {
    return this.meaning.unlink(referenceId, actor ?? 'operator');
  }

  @Get('term-refs')
  @ApiOperation({ summary: 'Unknown term references declared by connectors' })
  termRefs(@Query('limit') limit?: string) {
    return unknownTermRefs(this.prisma, limit ? Number(limit) : 200);
  }

  // ── Linker (SL3 R2) ──────────────────────────────────────────────────────

  @Get('linker/jobs')
  @ApiOperation({ summary: 'Recent linker jobs with progress' })
  linkerJobs(@Query('limit') limit?: string) {
    return this.linker.jobs(limit ? Number(limit) : 20);
  }

  @Post('linker/rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Rebuild every semantic link (backfill over all bindings)',
  })
  async rebuild() {
    return {
      jobId: await this.jobs.scheduleBackfill({ all: true, reason: 'rebuild' }),
    };
  }

  @Post('linker/reconcile')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Compare a sample of the rollup with a recomputation and repair drift',
  })
  async reconcile() {
    return { jobId: await this.jobs.scheduleReconcile('on demand') };
  }

  // ── Suggestions (SL4) ────────────────────────────────────────────────────

  @Post('suggestions/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Run the suggestion generators (queued)' })
  async refreshSuggestions(
    @Body() body: { generators?: string[]; termIds?: string[] } = {},
  ) {
    await this.jobs.scheduleSuggestions({
      generators: body?.generators,
      termIds: body?.termIds,
      reason: 'on demand',
    });
    return { queued: true };
  }

  @Get('suggestions/stats')
  @ApiOperation({ summary: 'Acceptance rate per generator and score band' })
  suggestionStats(@Query('days') days?: string) {
    return this.suggestions.stats(days ? Number(days) : 90);
  }

  @Get('suggestions/settings')
  suggestionSettings() {
    return this.suggestions.settings();
  }

  @Patch('suggestions/settings')
  updateSuggestionSettings(
    @Body()
    body: {
      generators?: Record<string, boolean>;
      minScore?: Record<string, number>;
      linkCapPerConcept?: number;
      cooccurrenceMinSupport?: number;
      cooccurrenceMinLift?: number;
    },
  ) {
    return this.suggestions.updateSettings(body ?? {});
  }

  // ── Semantic map (SL5 Part B) ────────────────────────────────────────────

  @Get('map')
  @ApiOperation({
    summary: 'The semantic map: concepts, relations, co-occurrence, overlay',
  })
  semanticMap(
    @Query('schemeIds') schemeIds?: string,
    @Query('sourceIds') sourceIds?: string,
    @Query('minAssets') minAssets?: string,
    @Query('cooccurrence') cooccurrence?: string,
    @Query('caseId') caseId?: string,
    @Query('entities') entities?: string,
  ) {
    return this.map.map({
      schemeIds: list(schemeIds),
      sourceIds: list(sourceIds),
      minAssets: minAssets !== undefined ? Number(minAssets) : undefined,
      cooccurrence: bool(cooccurrence),
      caseId: caseId || undefined,
      includeEntities: bool(entities),
    });
  }

  @Get('map/terms/:termId')
  @ApiOperation({ summary: 'The map rail for one concept' })
  async mapTerm(@Param('termId') termId: string) {
    return this.map.termRail(await this.termId(termId));
  }

  @Post('map/rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  async rebuildMap() {
    await this.jobs.scheduleMapRebuild('on demand', true);
    return { queued: true };
  }
}
