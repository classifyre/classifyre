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
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ActorName } from '../actor-name.decorator';
import { parseStatuses } from '../glossary/glossary.controller';
import { EntitiesService, type CreateEntityInput } from './entities.service';
import { EntityCandidatesService } from './entity-candidates.service';
import { EntityMentionsService, mentionsCsv } from './entity-mentions.service';
import { EntityResolutionService } from './entity-resolution.service';
import { EntitySwitchService } from './entity-switch.service';
import { EntityValuesService } from './entity-values.service';
import { SHIPPED_IDENTIFIER_LABELS } from './entity-labels';

/**
 * Entities (docs/prd/G5-entities.md). An entity is an ENTITY-kind glossary
 * term, so creating, renaming, approving and deprecating one is the glossary's
 * API; these routes are what only entities have — values, mentions, the
 * candidate review queue and merging.
 *
 * Reads stay available while the Entities feature is off (its data is kept or
 * gone, and the page says which); writes that would start resolution work are
 * refused with the same 409 the other feature switches use.
 */
@ApiTags('entities')
@Controller('entities')
export class EntitiesController {
  constructor(
    private readonly entities: EntitiesService,
    private readonly values: EntityValuesService,
    private readonly mentions: EntityMentionsService,
    private readonly candidates: EntityCandidatesService,
    private readonly resolution: EntityResolutionService,
    private readonly switchService: EntitySwitchService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Search entities by name, alias or identifier value, with mention counters',
  })
  search(
    @Query('query') query?: string,
    @Query('entityType') entityType?: string,
    @Query('status') status?: string,
    @Query('sort') sort?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.entities.search({
      query,
      entityType,
      status: parseStatuses(status),
      sort:
        sort === 'name' || sort === 'lastSeen' || sort === 'mentions'
          ? sort
          : undefined,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Post()
  @ApiOperation({
    summary:
      'Create an entity, optionally from a finding or an indexed value ("Make entity")',
  })
  async create(@Body() body: CreateEntityInput, @ActorName() actor?: string) {
    await this.switchService.assertEnabled();
    return this.entities.create(body ?? {}, { name: actor ?? 'operator' });
  }

  @Get('config')
  @ApiOperation({
    summary:
      'The Entities switch and which labels take part in resolution (names, identifiers)',
  })
  async config() {
    const [state, labels, observed] = await Promise.all([
      this.switchService.state(0),
      this.switchService.labels(),
      this.values.observedLabels().catch(() => [] as string[]),
    ]);
    return {
      enabled: state.enabled,
      disabledMode: state.disabledMode,
      nameLabels: labels.nameLabels,
      identifierLabels: labels.identifierLabels,
      shippedIdentifierLabels: SHIPPED_IDENTIFIER_LABELS,
      activeNameLabels: await this.values
        .activeNameLabels(labels)
        .catch(() => [] as string[]),
      observedLabels: observed,
    };
  }

  @Put('config')
  @ApiOperation({
    summary:
      'Declare custom labels as names or identifiers; alias values are regenerated',
  })
  async saveConfig(
    @Body()
    body: {
      nameLabels?: Record<string, string>;
      identifierLabels?: string[];
    },
  ) {
    if (
      body?.nameLabels !== undefined &&
      (typeof body.nameLabels !== 'object' || Array.isArray(body.nameLabels))
    ) {
      throw new BadRequestException('nameLabels is an object of label → type');
    }
    if (
      body?.identifierLabels !== undefined &&
      !Array.isArray(body.identifierLabels)
    ) {
      throw new BadRequestException('identifierLabels is a list of labels');
    }
    await this.switchService.saveLabels(body ?? {});
    await this.resolution.scheduleResolveAll('entity labels changed');
    return this.config();
  }

  @Get('candidates')
  @ApiOperation({
    summary:
      'The entity review queue: proposed values with scores and up to 3 occurrences each',
  })
  listCandidates(
    @Query('termId') termId?: string,
    @Query('kind') kind?: string,
    @Query('minScore') minScore?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.candidates.list({
      termId,
      kind: kind === 'conflict' || kind === 'mention' ? kind : undefined,
      minScore: minScore ? Number(minScore) : undefined,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Post('candidates/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Accept or reject candidates (batch). A rejection is remembered; a conflict can also be moved',
  })
  review(
    @Body()
    body: {
      decisions?: Array<{ id: string; decision: 'accept' | 'reject' | 'move' }>;
    },
    @ActorName() actor?: string,
  ) {
    const decisions = Array.isArray(body?.decisions) ? body.decisions : [];
    if (!decisions.length || decisions.length > 500) {
      throw new BadRequestException('decisions holds 1 to 500 items');
    }
    for (const item of decisions) {
      if (
        typeof item?.id !== 'string' ||
        !['accept', 'reject', 'move'].includes(item?.decision)
      ) {
        throw new BadRequestException(
          'Each decision is { id, decision: accept | reject | move }',
        );
      }
    }
    return this.values.review(decisions, { name: actor ?? 'operator' });
  }

  @Post('resolve')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Queue a full resolution pass: alias values, candidates over the whole index, counters',
  })
  async resolve() {
    await this.switchService.assertEnabled();
    await this.resolution.scheduleResolveAll('requested');
    return { queued: true };
  }

  @Delete('values/:valueId')
  @ApiOperation({ summary: 'Remove an identifier or a confirmed value' })
  removeValue(@Param('valueId') valueId: string, @ActorName() actor?: string) {
    return this.values.removeValue(valueId, { name: actor ?? 'operator' });
  }

  @Get(':idOrKey')
  @ApiOperation({
    summary:
      'An entity: values and identifiers, live counters, anchor record, pending candidates',
  })
  get(@Param('idOrKey') idOrKey: string) {
    return this.entities.get(idOrKey);
  }

  @Patch(':idOrKey')
  @ApiOperation({ summary: "Set an entity's anchor URN or attributes" })
  update(
    @Param('idOrKey') idOrKey: string,
    @Body()
    body: {
      anchorUrn?: string | null;
      attributes?: Record<string, unknown> | null;
    },
    @ActorName() actor?: string,
  ) {
    return this.entities.update(idOrKey, body ?? {}, {
      name: actor ?? 'operator',
    });
  }

  @Get(':idOrKey/mentions')
  @ApiOperation({
    summary: 'Mentions of an entity across all sources (keyset-paged)',
  })
  async listMentions(
    @Param('idOrKey') idOrKey: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
    @Query('sourceId') sourceId?: string,
  ) {
    const term = await this.entities.resolveEntity(idOrKey);
    return this.mentions.mentions(term.id, {
      after,
      limit: limit ? Number(limit) : undefined,
      sourceId,
    });
  }

  @Get(':idOrKey/overview')
  @ApiOperation({
    summary:
      'Mentions over time, sources, and the entities most often mentioned with this one',
  })
  async overview(@Param('idOrKey') idOrKey: string) {
    const term = await this.entities.resolveEntity(idOrKey);
    const [timeline, sources, coMentions] = await Promise.all([
      this.mentions.timeline(term.id),
      this.mentions.sources(term.id),
      this.mentions.coMentions(term.id),
    ]);
    return { timeline, sources, coMentions };
  }

  @Get(':idOrKey/co-mentions')
  @ApiOperation({ summary: 'Entities that appear in the same assets' })
  async coMentions(
    @Param('idOrKey') idOrKey: string,
    @Query('limit') limit?: string,
  ) {
    const term = await this.entities.resolveEntity(idOrKey);
    return this.mentions.coMentions(term.id, limit ? Number(limit) : 20);
  }

  @Get(':idOrKey/export')
  @ApiOperation({
    summary:
      'Export mentions as CSV or JSON: "what do we hold about this person" (access request)',
  })
  async export(
    @Param('idOrKey') idOrKey: string,
    @Query('format') format: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const term = await this.entities.resolveEntity(idOrKey);
    const { rows, truncated } = await this.mentions.exportRows(term.id);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="${term.key}-mentions-${stamp}.json"`,
        )
        .send(
          JSON.stringify(
            {
              entity: { id: term.id, key: term.key, name: term.term },
              exportedAt: new Date().toISOString(),
              truncated,
              mentions: rows,
            },
            null,
            2,
          ),
        );
    }
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="${term.key}-mentions-${stamp}.csv"`,
      )
      .header('X-Truncated', String(truncated))
      .send(mentionsCsv(rows));
  }

  @Post(':idOrKey/values')
  @ApiOperation({
    summary:
      'Add an identifier (or promote an indexed value). A value another entity holds becomes a conflict to review',
  })
  async addValue(
    @Param('idOrKey') idOrKey: string,
    @Body() body: { label?: string; value?: string },
    @ActorName() actor?: string,
  ) {
    const term = await this.entities.resolveEntity(idOrKey);
    if (typeof body?.label !== 'string' || typeof body?.value !== 'string') {
      throw new BadRequestException('label and value are required');
    }
    const result = await this.values.confirmValue(
      term.id,
      { label: body.label, value: body.value },
      { name: actor ?? 'operator' },
    );
    await this.mentions.recount([term.id]);
    return result;
  }

  @Post(':idOrKey/merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Merge this entity into another: values, references and watches move, and it redirects',
  })
  async merge(
    @Param('idOrKey') idOrKey: string,
    @Body() body: { into?: string },
    @ActorName() actor?: string,
  ) {
    if (typeof body?.into !== 'string' || !body.into.trim()) {
      throw new BadRequestException('into (an entity id or key) is required');
    }
    const result = await this.values.merge(idOrKey, body.into, {
      name: actor ?? 'operator',
    });
    await this.mentions.recount([result.from.id, result.into.id]);
    return result;
  }
}
