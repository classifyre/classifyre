import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
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

  @ApiProperty({
    description: 'Pipeline schema defining entities, classification, and validation (type: GLINER2 | REGEX | LLM)',
  })
  @IsObject()
  pipelineSchema: Record<string, unknown>;
}
