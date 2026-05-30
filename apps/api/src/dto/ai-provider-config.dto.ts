import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const AI_PROVIDER_TYPE_VALUES = [
  'OPENAI_COMPATIBLE',
  'CLAUDE',
  'GEMINI',
] as const;
export type AiProviderTypeValue = (typeof AI_PROVIDER_TYPE_VALUES)[number];

export class AiProviderConfigResponseDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({
    description: 'User-friendly label for this credential.',
    example: 'Production Claude',
  })
  name: string;

  @ApiProperty({ enum: AI_PROVIDER_TYPE_VALUES, example: 'CLAUDE' })
  provider: AiProviderTypeValue;

  @ApiProperty({
    description:
      'Model identifier (e.g. claude-sonnet-4-5, gpt-4o, gemini-2.0-flash).',
    example: 'claude-sonnet-4-5',
  })
  model: string;

  @ApiProperty({
    description: 'Whether an API key is currently stored.',
    example: false,
  })
  hasApiKey: boolean;

  @ApiProperty({
    description:
      'Masked preview of the stored API key (first 4 + last 4 chars). Null when no key is set.',
    example: 'sk-p...xyz4',
    nullable: true,
  })
  apiKeyPreview: string | null;

  @ApiProperty({
    description:
      'Base URL for OpenAI-compatible endpoints. Null for managed providers.',
    example: 'https://openrouter.ai/api/v1',
    nullable: true,
  })
  baseUrl: string | null;

  @ApiProperty({
    description: 'Context window size in tokens. Null when unspecified.',
    example: 200000,
    nullable: true,
  })
  contextSize: number | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CreateAiProviderConfigDto {
  @ApiProperty({
    description: 'User-friendly label for this credential.',
    example: 'Production Claude',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: AI_PROVIDER_TYPE_VALUES, example: 'CLAUDE' })
  @IsEnum(AI_PROVIDER_TYPE_VALUES)
  provider: AiProviderTypeValue;

  @ApiPropertyOptional({
    description: 'Model identifier.',
    example: 'claude-sonnet-4-5',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  @ApiPropertyOptional({
    description: 'Plaintext API key. Sent once, stored encrypted.',
    example: 'sk-proj-...',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional({
    description:
      'Base URL for OpenAI-compatible providers. Ignored for CLAUDE and GEMINI.',
    example: 'https://openrouter.ai/api/v1',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(500)
  baseUrl?: string;

  @ApiPropertyOptional({
    description: 'Context window size in tokens.',
    example: 200000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  contextSize?: number;
}

export class UpdateAiProviderConfigDto {
  @ApiPropertyOptional({
    description: 'User-friendly label for this credential.',
    example: 'Production Claude',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: AI_PROVIDER_TYPE_VALUES, example: 'CLAUDE' })
  @IsOptional()
  @IsEnum(AI_PROVIDER_TYPE_VALUES)
  provider?: AiProviderTypeValue;

  @ApiPropertyOptional({
    description: 'Model identifier.',
    example: 'claude-sonnet-4-5',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  @ApiPropertyOptional({
    description:
      'Plaintext API key. Sent once, stored encrypted. Pass an empty string to clear the key.',
    example: 'sk-proj-...',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional({
    description:
      'Base URL for OpenAI-compatible providers. Ignored for CLAUDE and GEMINI.',
    example: 'https://openrouter.ai/api/v1',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(500)
  baseUrl?: string;

  @ApiPropertyOptional({
    description: 'Context window size in tokens.',
    example: 200000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  contextSize?: number;
}

export class AiProviderConfigTestResultDto {
  @ApiProperty({ enum: AI_PROVIDER_TYPE_VALUES, example: 'CLAUDE' })
  provider: AiProviderTypeValue;

  @ApiProperty({ example: 'claude-sonnet-4-5' })
  model: string;
}
