import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryFindingsDiscoveryDto {
  @ApiPropertyOptional({
    description: 'Number of days to include in the discovery window.',
    enum: [7, 30, 90],
    default: 30,
  })
  @IsOptional()
  @IsIn([7, 30, 90])
  @Type(() => Number)
  windowDays?: number = 30;

  @ApiPropertyOptional({
    description: 'Include resolved and non-open findings.',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeResolved?: boolean = false;
}
