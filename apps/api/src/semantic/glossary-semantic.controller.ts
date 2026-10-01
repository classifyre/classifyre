import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorName } from '../actor-name.decorator';
import { AllowInDemoMode } from '../demo-mode.decorator';
import {
  GlossaryProposalsService,
  PROPOSAL_KINDS,
} from './suggestions/glossary-proposals.service';
import type {
  ProposalDecision,
  ProposalKind,
} from './suggestions/glossary-proposals.service';
import { FindInTextService } from './find-in-text/find-in-text.service';
import type { FindInTextInput } from './find-in-text/find-in-text.service';

/**
 * Glossary routes that belong to the semantic layer: the review queue (SL4)
 * and "Find in text" (SL2 §7).
 */
@ApiTags('glossary')
@Controller('glossary')
export class GlossarySemanticController {
  constructor(
    private readonly proposals: GlossaryProposalsService,
    private readonly findInText: FindInTextService,
  ) {}

  @Get('proposals')
  @ApiOperation({ summary: 'The review queue: every proposal, one paged list' })
  list(
    @Query('kind') kind?: string,
    @Query('origin') origin?: string,
    @Query('schemeId') schemeId?: string,
    @Query('termId') termId?: string,
    @Query('minScore') minScore?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    if (kind && !PROPOSAL_KINDS.includes(kind as ProposalKind)) {
      throw new BadRequestException(
        `kind is one of ${PROPOSAL_KINDS.join(', ')}`,
      );
    }
    return this.proposals.list({
      kind: kind as ProposalKind | undefined,
      origin,
      schemeId,
      termId,
      minScore: minScore !== undefined ? Number(minScore) : undefined,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get('proposals/counts')
  @ApiOperation({ summary: 'Pending proposals by kind, for the badge' })
  counts() {
    return this.proposals.counts();
  }

  @Get('proposals/link-groups')
  @ApiOperation({
    summary: 'Document suggestions grouped per concept, with a score histogram',
  })
  linkGroups() {
    return this.proposals.linkGroups();
  }

  @Post('proposals/decide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Accept, edit and accept, dismiss, dismiss forever or skip one proposal',
  })
  decide(
    @Body()
    body: {
      kind: ProposalKind;
      id: string;
      decision: ProposalDecision;
      edit?: Record<string, unknown>;
      reason?: string;
    },
    @ActorName() actor?: string,
  ) {
    if (!body?.kind || !body?.id || !body?.decision) {
      throw new BadRequestException('kind, id and decision are required');
    }
    const allowed = new Set(['kind', 'id', 'decision', 'edit', 'reason']);
    const unknown = Object.keys(body).filter((key) => !allowed.has(key));
    if (unknown.length)
      throw new BadRequestException(`Unknown field(s): ${unknown.join(', ')}`);
    return this.proposals.decide({
      ...body,
      actor: { name: actor ?? 'operator' },
    });
  }

  @Post('proposals/decide-bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk accept or dismiss a group of document (LINK) suggestions',
  })
  decideBulk(
    @Body()
    body: {
      kind: 'LINK';
      termId: string;
      ids?: string[];
      minScore?: number;
      decision: 'accept' | 'dismiss';
      reason?: string;
    },
    @ActorName() actor?: string,
  ) {
    if (body?.decision !== 'accept' && body?.decision !== 'dismiss') {
      throw new BadRequestException('decision is accept or dismiss');
    }
    return this.proposals.decideBulk({
      ...body,
      actor: { name: actor ?? 'operator' },
    });
  }

  @Get('terms/:idOrKey/find-in-text')
  @ApiOperation({
    summary:
      '"Find in text": the labels, pattern and tests a detector would get',
  })
  findInTextPreview(@Param('idOrKey') idOrKey: string) {
    return this.findInText.preview(idOrKey);
  }

  @Post('terms/:idOrKey/find-in-text/preview')
  @HttpCode(HttpStatus.OK)
  @AllowInDemoMode()
  findInTextPreviewWith(
    @Param('idOrKey') idOrKey: string,
    @Body() body: FindInTextInput,
  ) {
    return this.findInText.preview(idOrKey, body ?? {});
  }

  @Post('terms/:idOrKey/find-in-text')
  @ApiOperation({
    summary: '"Find in text": create a tested REGEX detector bound to the term',
  })
  findInTextCreate(
    @Param('idOrKey') idOrKey: string,
    @Body() body: FindInTextInput,
    @ActorName() actor?: string,
  ) {
    return this.findInText.create(idOrKey, {
      ...(body ?? {}),
      actor: actor ?? 'operator',
    });
  }

  @Get('terms/:idOrKey/find-in-text/detectors')
  @ApiOperation({
    summary: 'Detectors generated from a term, with out-of-date flags',
  })
  findInTextStatus(@Param('idOrKey') idOrKey: string) {
    return this.findInText.status(idOrKey);
  }
}
