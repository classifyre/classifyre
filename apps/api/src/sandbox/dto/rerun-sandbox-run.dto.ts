import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RerunSandboxRunDto {
  @ApiProperty({
    description: 'Array of detector config objects to use for the new run',
    type: 'array',
    example: [{ type: 'SECRETS', enabled: true, config: {} }],
  })
  detectors: unknown[];

  @ApiPropertyOptional({
    description:
      'When true, skip the duplicate-file check and create a new run even if an identical file exists',
    default: false,
  })
  skipDuplicateCheck?: boolean;
}
