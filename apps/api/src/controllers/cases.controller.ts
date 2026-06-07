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
  CaseEvidenceDto,
  CaseListResponseDto,
  CaseResponseDto,
  CreateCaseDto,
  QueryCasesDto,
  UpdateCaseDto,
} from '../dto/case.dto';
import { GraphResponseDto } from '../dto/graph.dto';

@ApiTags('cases')
@Controller('cases')
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an investigation case' })
  @ApiResponse({ status: 201, type: CaseResponseDto })
  async create(@Body() dto: CreateCaseDto): Promise<CaseResponseDto> {
    return this.casesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List investigation cases' })
  @ApiResponse({ status: 200, type: CaseListResponseDto })
  async list(@Query() query: QueryCasesDto): Promise<CaseListResponseDto> {
    return this.casesService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a case with hydrated evidence' })
  @ApiResponse({ status: 200, type: CaseResponseDto })
  @ApiResponse({ status: 404, description: 'Case not found' })
  async findOne(@Param('id') id: string): Promise<CaseResponseDto> {
    const found = await this.casesService.findOne(id);
    if (!found) throw new NotFoundException(`Case with ID ${id} not found`);
    return found;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a case' })
  @ApiResponse({ status: 200, type: CaseResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCaseDto,
  ): Promise<CaseResponseDto> {
    return this.casesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a case' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.casesService.remove(id);
  }

  @Post(':id/evidence')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Attach an asset or finding to the case as evidence' })
  @ApiResponse({ status: 201, type: CaseEvidenceDto })
  async addEvidence(
    @Param('id') id: string,
    @Body() dto: AddEvidenceDto,
  ): Promise<CaseEvidenceDto> {
    return this.casesService.addEvidence(id, dto);
  }

  @Delete(':id/evidence/:evidenceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove evidence from the case' })
  async removeEvidence(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
  ): Promise<void> {
    await this.casesService.removeEvidence(id, evidenceId);
  }

  @Get(':id/graph')
  @ApiOperation({ summary: 'Get the evidence neighbourhood graph for a case' })
  @ApiQuery({ name: 'depth', required: false, type: Number })
  @ApiResponse({ status: 200, type: GraphResponseDto })
  async graph(
    @Param('id') id: string,
    @Query('depth') depth?: string,
  ): Promise<GraphResponseDto> {
    const parsed = depth ? Number.parseInt(depth, 10) : 1;
    return this.casesService.getGraph(id, Number.isNaN(parsed) ? 1 : parsed);
  }
}
