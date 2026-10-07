import {
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
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActorName } from '../actor-name.decorator';
import { CaseHypothesisRulesService } from '../cases/case-hypothesis-rules.service';
import {
  AddCaseHypothesisRuleDto,
  CaseHypothesisRuleDto,
  CaseHypothesisRuleRemovalResponseDto,
  CaseHypothesisRulesChangeResponseDto,
  UpdateCaseHypothesisRuleDto,
} from '../dto/case-hypothesis-rules.dto';

/** No global ValidationPipe: a form or MCP "true" arrives as text. */
function flag(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * What a case does, by itself, with the answers of one of its watches: link
 * them to a hypothesis with a stance and land them beside it on the board.
 * Case-level like the finding filters; the watch itself is untouched.
 */
@ApiTags('cases')
@Controller('cases/:id/hypothesis-rules')
export class CaseHypothesisRulesController {
  constructor(private readonly rules: CaseHypothesisRulesService) {}

  @Get()
  @ApiOperation({
    summary: "The case's hypothesis rules, per watch",
  })
  @ApiResponse({ status: 200, type: [CaseHypothesisRuleDto] })
  list(@Param('id') id: string): Promise<CaseHypothesisRuleDto[]> {
    return this.rules.list(id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Add a rule: answers of a watch are linked to a hypothesis with a stance (supports, contradicts, neutral) as they arrive, and their evidence lands beside the hypothesis on the board. With applyToExisting, what the case already holds from the watch is linked too.',
  })
  @ApiResponse({ status: 200, type: CaseHypothesisRulesChangeResponseDto })
  add(
    @Param('id') id: string,
    @Body() dto: AddCaseHypothesisRuleDto,
    @ActorName() actor: string | undefined,
  ): Promise<CaseHypothesisRulesChangeResponseDto> {
    return this.rules.add(
      id,
      { ...dto, applyToExisting: flag(dto?.applyToExisting) },
      actor,
    );
  }

  @Patch(':ruleId')
  @ApiOperation({
    summary:
      "Change a rule's hypothesis, stance, matcher or description. A new stance or hypothesis carries the links the rule already made (unless updateLinks is false).",
  })
  @ApiResponse({ status: 200, type: CaseHypothesisRulesChangeResponseDto })
  update(
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateCaseHypothesisRuleDto,
    @ActorName() actor: string | undefined,
  ): Promise<CaseHypothesisRulesChangeResponseDto> {
    return this.rules.update(
      id,
      ruleId,
      {
        ...dto,
        ...(dto?.updateLinks === undefined
          ? {}
          : { updateLinks: flag(dto.updateLinks) }),
      },
      actor,
    );
  }

  @Delete(':ruleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Remove a rule. The links it made stay (they become the hypothesis' own links) unless removeLinks is true.",
  })
  @ApiQuery({ name: 'removeLinks', required: false, type: Boolean })
  @ApiResponse({ status: 200, type: CaseHypothesisRuleRemovalResponseDto })
  remove(
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
    @Query('removeLinks') removeLinks: string | undefined,
    @ActorName() actor: string | undefined,
  ): Promise<CaseHypothesisRuleRemovalResponseDto> {
    return this.rules.remove(
      id,
      ruleId,
      { removeLinks: flag(removeLinks) },
      actor,
    );
  }
}
