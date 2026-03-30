import { ApiProperty } from '@nestjs/swagger';

export class UpdateMetricDefinitionDto {
  @ApiProperty({ required: false })
  displayName?: string;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty({ required: false })
  definition?: Record<string, any>;

  @ApiProperty({ required: false })
  allowedDimensions?: string[];

  @ApiProperty({ required: false })
  glossaryTermId?: string;

  @ApiProperty({ required: false })
  format?: string;

  @ApiProperty({ required: false })
  unit?: string;

  @ApiProperty({ required: false })
  color?: string;

  @ApiProperty({ required: false })
  owner?: string;

  @ApiProperty({ required: false })
  isActive?: boolean;
}
