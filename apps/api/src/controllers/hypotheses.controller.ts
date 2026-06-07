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
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HypothesesService } from '../hypotheses.service';
import {
  CreateHypothesisDto,
  HypothesisResponseDto,
  LinkEvidenceDto,
  UpdateHypothesisDto,
} from '../dto/hypothesis.dto';

@ApiTags('hypotheses')
@Controller()
export class HypothesesController {
  constructor(private readonly hypothesesService: HypothesesService) {}

  @Get('cases/:caseId/hypotheses')
  @ApiOperation({ summary: 'List hypotheses for a case' })
  @ApiResponse({ status: 200, type: [HypothesisResponseDto] })
  async list(@Param('caseId') caseId: string): Promise<HypothesisResponseDto[]> {
    return this.hypothesesService.list(caseId);
  }

  @Post('cases/:caseId/hypotheses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a hypothesis in a case' })
  @ApiResponse({ status: 201, type: HypothesisResponseDto })
  async create(
    @Param('caseId') caseId: string,
    @Body() dto: CreateHypothesisDto,
  ): Promise<HypothesisResponseDto> {
    return this.hypothesesService.create(caseId, dto);
  }

  @Patch('hypotheses/:id')
  @ApiOperation({ summary: 'Update a hypothesis' })
  @ApiResponse({ status: 200, type: HypothesisResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHypothesisDto,
  ): Promise<HypothesisResponseDto> {
    return this.hypothesesService.update(id, dto);
  }

  @Delete('hypotheses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a hypothesis' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.hypothesesService.remove(id);
  }

  @Post('hypotheses/:id/evidence')
  @ApiOperation({ summary: 'Link case evidence to a hypothesis with a stance' })
  @ApiResponse({ status: 200, type: HypothesisResponseDto })
  async linkEvidence(
    @Param('id') id: string,
    @Body() dto: LinkEvidenceDto,
  ): Promise<HypothesisResponseDto> {
    return this.hypothesesService.linkEvidence(id, dto);
  }

  @Delete('hypotheses/:id/evidence/:linkId')
  @ApiOperation({ summary: 'Unlink evidence from a hypothesis' })
  @ApiResponse({ status: 200, type: HypothesisResponseDto })
  async unlinkEvidence(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ): Promise<HypothesisResponseDto> {
    return this.hypothesesService.unlinkEvidence(id, linkId);
  }
}
