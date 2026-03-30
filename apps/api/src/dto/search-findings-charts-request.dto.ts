import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SearchFindingsFiltersInputDto } from './search-findings-request.dto';

export class SearchFindingsChartsOptionsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topAssetsLimit?: number = 10;
}

export class SearchFindingsChartsRequestDto {
  @ApiPropertyOptional({ type: SearchFindingsFiltersInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFindingsFiltersInputDto)
  filters?: SearchFindingsFiltersInputDto;

  @ApiPropertyOptional({
    description: 'Timeline window in days',
    enum: [7, 30, 90],
    default: 7,
  })
  @IsOptional()
  @IsIn([7, 30, 90])
  @Type(() => Number)
  windowDays?: number = 7;

  @ApiPropertyOptional({ type: SearchFindingsChartsOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFindingsChartsOptionsDto)
  options?: SearchFindingsChartsOptionsDto;
}
