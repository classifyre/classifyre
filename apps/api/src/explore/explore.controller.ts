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
import {
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AllowInDemoMode } from '../demo-mode.decorator';
import { ReadOnlyEndpoint } from '../db/read-only-endpoint.decorator';
import {
  ExploreNeighbourhoodRequestDto,
  ExploreNeighbourhoodResponseDto,
  ExplorePositionDto,
  ExploreStartersResponseDto,
  ExploreViewDto,
  SaveExploreViewDto,
  ExploreFindRequestDto,
  ExploreFindResponseDto,
} from './explore.dto';
import { ExploreService } from './explore.service';
import { ExploreViewsService } from './explore-views.service';

@ApiTags('explore')
@ApiExtraModels(ExplorePositionDto)
@Controller('explore')
export class ExploreController {
  constructor(
    private readonly explore: ExploreService,
    private readonly views: ExploreViewsService,
  ) {}

  @AllowInDemoMode()
  @ReadOnlyEndpoint()
  @Post('neighbourhood')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'What these assets are connected to, and why',
    description:
      'Starts from up to ten assets and returns their neighbourhood by kind of connection: ' +
      'lineage and links (traced as far as asked, upstream, downstream or both), duplicates, ' +
      'shared values, shared glossary terms (drawn as the term itself), and likeness by ' +
      'meaning. Every link carries its reason; every asset says which cases hold it and ' +
      'which watches it answers. Each kind is read with its own bound, and assets deleted ' +
      'at their source are left out.',
  })
  @ApiResponse({ status: 200, type: ExploreNeighbourhoodResponseDto })
  neighbourhood(
    @Body() body: ExploreNeighbourhoodRequestDto,
  ): Promise<ExploreNeighbourhoodResponseDto> {
    return this.explore.neighbourhood(body);
  }

  @AllowInDemoMode()
  @ReadOnlyEndpoint()
  @Post('find')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Which of the assets on a canvas answer a question',
    description:
      'Reads only the assets given (what an Explore canvas shows): those whose name or a ' +
      'passage holds the words, then the rest by meaning, closest first. The few that stand ' +
      'out are marked lit.',
  })
  @ApiResponse({ status: 200, type: ExploreFindResponseDto })
  find(@Body() body: ExploreFindRequestDto): Promise<ExploreFindResponseDto> {
    return this.explore.find(body);
  }

  @AllowInDemoMode()
  @ReadOnlyEndpoint()
  @Get('starters')
  @ApiOperation({
    summary: 'Where to start exploring',
    description:
      'The assets with the most lineage, the duplicate patterns with the most pairs (each ' +
      'with its strongest pair), and the links people drew last.',
  })
  @ApiResponse({ status: 200, type: ExploreStartersResponseDto })
  starters(): Promise<ExploreStartersResponseDto> {
    return this.explore.starters();
  }

  @AllowInDemoMode()
  @ReadOnlyEndpoint()
  @Get('views')
  @ApiOperation({
    summary: 'Saved Explore views, the last changed first',
    description:
      'Each with its starting points that still exist, by name: an asset deleted at its ' +
      'source is left out, and comes back if the asset does.',
  })
  @ApiResponse({ status: 200, type: [ExploreViewDto] })
  listViews(): Promise<ExploreViewDto[]> {
    return this.views.list();
  }

  @AllowInDemoMode()
  @ReadOnlyEndpoint()
  @Get('views/:id')
  @ApiOperation({ summary: 'One saved Explore view' })
  @ApiResponse({ status: 200, type: ExploreViewDto })
  getView(@Param('id') id: string): Promise<ExploreViewDto> {
    return this.views.get(id);
  }

  @Post('views')
  @ApiOperation({
    summary: 'Save an Explore view',
    description:
      'A name, the assets it starts from, how it is traced, and where people put things.',
  })
  @ApiResponse({ status: 201, type: ExploreViewDto })
  createView(@Body() body: SaveExploreViewDto): Promise<ExploreViewDto> {
    return this.views.create(body);
  }

  @Patch('views/:id')
  @ApiOperation({
    summary: 'Change a saved Explore view; what is left out stays',
  })
  @ApiResponse({ status: 200, type: ExploreViewDto })
  updateView(
    @Param('id') id: string,
    @Body() body: SaveExploreViewDto,
  ): Promise<ExploreViewDto> {
    return this.views.update(id, body);
  }

  @Delete('views/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved Explore view' })
  async deleteView(@Param('id') id: string): Promise<void> {
    await this.views.remove(id);
  }
}
