import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GlossaryFilterMappingDto {
  @ApiProperty({
    description: 'Detector types to include',
    example: ['SECRETS', 'PII'],
    required: false,
  })
  detectorTypes?: string[];

  @ApiProperty({
    description: 'Severity levels to include',
    example: ['CRITICAL', 'HIGH'],
    required: false,
  })
  severities?: string[];

  @ApiProperty({
    description: 'Finding types to include',
    example: ['aws_key', 'ssn'],
    required: false,
  })
  findingTypes?: string[];

  @ApiProperty({
    description: 'Custom detector keys to include',
    example: ['gdpr-scanner'],
    required: false,
  })
  customDetectorKeys?: string[];

  @ApiProperty({
    description: 'Finding statuses to include',
    example: ['OPEN'],
    required: false,
  })
  statuses?: string[];
}

export class CreateGlossaryTermDto {
  @ApiProperty({
    description: 'Human-readable display name',
    example: 'Security Threats',
  })
  @IsNotEmpty()
  @IsString()
  displayName: string;

  @ApiProperty({
    description: 'Plain-language explanation of what this term means',
    example:
      'All findings related to security vulnerabilities including exposed secrets and malware signatures',
    required: false,
  })
  description?: string;

  @ApiProperty({
    description: 'Grouping category',
    example: 'Security',
    required: false,
  })
  category?: string;

  @ApiProperty({
    description: 'Mapping to technical detection filters',
    type: GlossaryFilterMappingDto,
  })
  filterMapping: GlossaryFilterMappingDto;

  @ApiProperty({
    description: 'Hex color for UI display',
    example: '#ff2b2b',
    required: false,
  })
  color?: string;

  @ApiProperty({
    description: 'Lucide icon name',
    example: 'shield-alert',
    required: false,
  })
  icon?: string;
}
