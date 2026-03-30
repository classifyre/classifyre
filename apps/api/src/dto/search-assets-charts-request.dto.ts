import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import {
  SearchAssetsFiltersDto,
  SearchFindingsFiltersDto,
} from './search-assets-request.dto';

export class SearchAssetsChartsOptionsDto {
  @ApiPropertyOptional({
    description: 'Max rows for top assets by findings chart',
    default: 15,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topAssetsLimit?: number = 15;

  @ApiPropertyOptional({
    description: 'Max rows for top sources by asset volume chart',
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topSourcesLimit?: number = 10;
}

export class SearchAssetsChartsRequestDto {
  @ApiPropertyOptional({
    type: SearchAssetsFiltersDto,
    description: 'Optional asset-level filters applied to metrics and charts',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchAssetsFiltersDto)
  assets?: SearchAssetsFiltersDto;

  @ApiPropertyOptional({
    type: SearchFindingsFiltersDto,
    description:
      'Optional findings filters applied to "top assets by findings" chart',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFindingsFiltersDto)
  findings?: SearchFindingsFiltersDto;

  @ApiPropertyOptional({ type: SearchAssetsChartsOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchAssetsChartsOptionsDto)
  options?: SearchAssetsChartsOptionsDto;
}
