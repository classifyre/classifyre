import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class TrainCustomDetectorDto {
  @ApiPropertyOptional({
    description:
      'Optional source ID to train using only feedback/examples from one source',
  })
  @IsOptional()
  @IsString()
  sourceId?: string;
}
