import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { GlossaryService } from './glossary.service';
import { CreateGlossaryTermDto } from './dto/create-glossary-term.dto';
import { UpdateGlossaryTermDto } from './dto/update-glossary-term.dto';

@ApiTags('Semantic Layer - Glossary')
@Controller('semantic/glossary')
export class GlossaryController {
  constructor(private readonly glossaryService: GlossaryService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new glossary term' })
  async create(@Body() dto: CreateGlossaryTermDto) {
    return this.glossaryService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all glossary terms' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  async findAll(
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.glossaryService.findAll({
      category,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a glossary term by id' })
  async findById(@Param('id') id: string) {
    return this.glossaryService.findById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a glossary term' })
  async update(@Param('id') id: string, @Body() dto: UpdateGlossaryTermDto) {
    return this.glossaryService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a glossary term' })
  async delete(@Param('id') id: string) {
    return this.glossaryService.delete(id);
  }

  @Post(':id/preview')
  @ApiOperation({
    summary: 'Preview the number of findings matching this glossary term',
  })
  async preview(@Param('id') id: string) {
    const count = await this.glossaryService.previewFindingCount(id);
    return { id, findingCount: count };
  }
}
