import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateCustomDetectorDto {
  @ApiProperty({
    description: 'Human-friendly detector name',
    example: 'Support Ticket Extractor',
  })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({
    description: 'Stable key override. If omitted, generated from name.',
    example: 'cust_support_ticket_extractor',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]+$/, {
    message:
      'key must contain lowercase letters, numbers, underscores, or dashes',
  })
  key?: string;

  @ApiPropertyOptional({
    description: 'Optional detector description',
    example: 'Extracts order IDs, amounts, and intent from support tickets',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether this detector can be selected in sources',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'AI provider credential ID. Required for LLM (AI) detectors; the API resolves and injects the decrypted provider config at scan time.',
    example: '3f1c2b6e-1d4a-4c7e-9c2a-7b6d5e4f3a21',
  })
  @IsOptional()
  @IsUUID()
  aiProviderConfigId?: string;

  @ApiProperty({
    description:
      'Pipeline schema defining the detector behaviour (type: GLINER2 | REGEX | LLM | TEXT_CLASSIFICATION | IMAGE_CLASSIFICATION | FEATURE_EXTRACTION | OBJECT_DETECTION)',
  })
  @IsObject()
  pipelineSchema: Record<string, unknown>;
}
