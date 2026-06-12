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
  LinkSupportDto,
  UpdateHypothesisDto,
} from '../dto/hypothesis.dto';

@ApiTags('hypotheses')
@Controller()
export class HypothesesController {
  constructor(private readonly hypothesesService: HypothesesService) {}

  @Get('cases/:caseId/hypotheses')
  @ApiOperation({ summary: 'List hypotheses for a case' })
  @ApiResponse({ status: 200, type: [HypothesisResponseDto] })
  async list(
    @Param('caseId') caseId: string,
  ): Promise<HypothesisResponseDto[]> {
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

  @Post('hypotheses/:id/support')
  @ApiOperation({
    summary: 'Link evidence or a finding to a hypothesis with a stance',
  })
  @ApiResponse({ status: 200, type: HypothesisResponseDto })
  async linkSupport(
    @Param('id') id: string,
    @Body() dto: LinkSupportDto,
  ): Promise<HypothesisResponseDto> {
    return this.hypothesesService.linkSupport(id, dto);
  }

  @Delete('hypotheses/:id/support/:linkId')
  @ApiOperation({ summary: 'Remove a support link from a hypothesis' })
  @ApiResponse({ status: 200, type: HypothesisResponseDto })
  async unlinkSupport(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ): Promise<HypothesisResponseDto> {
    return this.hypothesesService.unlinkSupport(id, linkId);
  }
}
