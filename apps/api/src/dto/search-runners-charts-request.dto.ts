import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SearchRunnersFiltersInputDto } from './search-runners-request.dto';

export class SearchRunnersChartsOptionsDto {
  @ApiPropertyOptional({
    description: 'Max rows for top sources chart',
    minimum: 1,
    maximum: 50,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topSourcesLimit?: number = 10;
}

export class SearchRunnersChartsRequestDto {
  @ApiPropertyOptional({ type: SearchRunnersFiltersInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchRunnersFiltersInputDto)
  filters?: SearchRunnersFiltersInputDto;

  @ApiPropertyOptional({
    description: 'Timeline window in days',
    enum: [7, 30, 90],
    default: 30,
  })
  @IsOptional()
  @IsIn([7, 30, 90])
  @Type(() => Number)
  windowDays?: number = 30;

  @ApiPropertyOptional({ type: SearchRunnersChartsOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchRunnersChartsOptionsDto)
  options?: SearchRunnersChartsOptionsDto;
}
