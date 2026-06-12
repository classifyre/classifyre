import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CasesService } from '../cases.service';
import {
  AddEvidenceDto,
  AddFindingDto,
  AttachFindingsDto,
  AttachFindingsResponseDto,
  CaseEvidenceDto,
  CaseFindingDto,
  CaseListResponseDto,
  CaseResponseDto,
  CloseCaseDto,
  CloseCaseResponseDto,
  CreateCaseDto,
  LinkInquiriesDto,
  PullFromInquiryDto,
  PullFromInquiryResponseDto,
  QueryCasesDto,
  UpdateCaseDto,
  UpdateCaseFindingNoteDto,
  UpdateEvidenceNoteDto,
} from '../dto/case.dto';
import { GraphResponseDto } from '../dto/graph.dto';

@ApiTags('cases')
@Controller('cases')
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a case (optionally linking questions)' })
  @ApiResponse({ status: 201, type: CaseResponseDto })
  create(@Body() dto: CreateCaseDto): Promise<CaseResponseDto> {
    return this.casesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List cases' })
  @ApiResponse({ status: 200, type: CaseListResponseDto })
  list(@Query() query: QueryCasesDto): Promise<CaseListResponseDto> {
    return this.casesService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a case with evidence, findings and linked questions' })
  @ApiResponse({ status: 200, type: CaseResponseDto })
  async findOne(@Param('id') id: string): Promise<CaseResponseDto> {
    const found = await this.casesService.findOne(id);
    if (!found) throw new NotFoundException(`Case with ID ${id} not found`);
    return found;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a case' })
  @ApiResponse({ status: 200, type: CaseResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateCaseDto): Promise<CaseResponseDto> {
    return this.casesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a case (its questions become standalone)' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.casesService.remove(id);
  }

  @Post(':id/evidence')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Attach an asset as evidence' })
  @ApiResponse({ status: 201, type: CaseEvidenceDto })
  addEvidence(@Param('id') id: string, @Body() dto: AddEvidenceDto): Promise<CaseEvidenceDto> {
    return this.casesService.addEvidence(id, dto);
  }

  @Patch(':id/evidence/:evidenceId')
  @ApiOperation({ summary: 'Update the note on an evidence row' })
  @ApiResponse({ status: 200, type: CaseEvidenceDto })
  patchEvidenceNote(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @Body() dto: UpdateEvidenceNoteDto,
  ): Promise<CaseEvidenceDto> {
    return this.casesService.patchEvidenceNote(id, evidenceId, dto);
  }

  @Delete(':id/evidence/:evidenceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove evidence from the case' })
  async removeEvidence(@Param('id') id: string, @Param('evidenceId') evidenceId: string): Promise<void> {
    await this.casesService.removeEvidence(id, evidenceId);
  }

  @Post(':id/evidence/:evidenceId/findings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Attach a finding to a piece of evidence' })
  @ApiResponse({ status: 201, type: CaseFindingDto })
  addFinding(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @Body() dto: AddFindingDto,
  ): Promise<CaseFindingDto> {
    return this.casesService.addFinding(id, evidenceId, dto);
  }

  @Post(':id/findings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch-attach findings (asset evidence rows are created as needed)' })
  @ApiResponse({ status: 200, type: AttachFindingsResponseDto })
  attachFindings(
    @Param('id') id: string,
    @Body() dto: AttachFindingsDto,
  ): Promise<AttachFindingsResponseDto> {
    return this.casesService.attachFindings(id, dto);
  }

  @Patch(':id/findings/:caseFindingId')
  @ApiOperation({ summary: 'Update the note on a case finding' })
  @ApiResponse({ status: 200, type: CaseFindingDto })
  patchFindingNote(
    @Param('id') id: string,
    @Param('caseFindingId') caseFindingId: string,
    @Body() dto: UpdateCaseFindingNoteDto,
  ): Promise<CaseFindingDto> {
    return this.casesService.patchFindingNote(id, caseFindingId, dto);
  }

  @Delete(':id/findings/:caseFindingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a finding from the case' })
  async removeFinding(@Param('id') id: string, @Param('caseFindingId') caseFindingId: string): Promise<void> {
    await this.casesService.removeFinding(id, caseFindingId);
  }

  @Post(':id/inquiries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Link inquiries to a case (already-linked ones are ignored)' })
  @ApiResponse({ status: 200, type: CaseResponseDto })
  linkInquiries(@Param('id') id: string, @Body() dto: LinkInquiriesDto): Promise<CaseResponseDto> {
    return this.casesService.linkInquiries(id, dto);
  }

  @Delete(':id/inquiries/:inquiryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink an inquiry from a case (the inquiry is untouched)' })
  @ApiResponse({ status: 200, type: CaseResponseDto })
  unlinkInquiry(
    @Param('id') id: string,
    @Param('inquiryId') inquiryId: string,
  ): Promise<CaseResponseDto> {
    return this.casesService.unlinkInquiry(id, inquiryId);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a case with a conclusion (archives linked inquiries)' })
  @ApiResponse({ status: 200, type: CloseCaseResponseDto })
  close(@Param('id') id: string, @Body() dto: CloseCaseDto): Promise<CloseCaseResponseDto> {
    return this.casesService.close(id, dto);
  }

  @Post(':id/pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Pull a question's matches into the case as evidence" })
  @ApiResponse({ status: 200, type: PullFromInquiryResponseDto })
  pull(@Param('id') id: string, @Body() dto: PullFromInquiryDto): Promise<PullFromInquiryResponseDto> {
    return this.casesService.pullFromInquiry(id, dto);
  }

  @Get(':id/graph')
  @ApiOperation({ summary: 'Get the evidence neighbourhood graph for a case' })
  @ApiQuery({ name: 'depth', required: false, type: Number })
  @ApiResponse({ status: 200, type: GraphResponseDto })
  graph(@Param('id') id: string, @Query('depth') depth?: string): Promise<GraphResponseDto> {
    const parsed = depth ? Number.parseInt(depth, 10) : 1;
    return this.casesService.getGraph(id, Number.isNaN(parsed) ? 1 : parsed);
  }
}
