import { ApiProperty } from '@nestjs/swagger';
import { CustomDetectorMethod } from '@prisma/client';

export class CustomDetectorExampleDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ enum: CustomDetectorMethod })
  method: CustomDetectorMethod;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  config: Record<string, unknown>;
}
