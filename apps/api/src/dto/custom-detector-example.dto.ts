import { ApiProperty } from '@nestjs/swagger';

export class CustomDetectorExampleDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  pipelineSchema: Record<string, unknown>;
}
