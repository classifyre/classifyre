import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export const AI_PROVIDER_TYPE_VALUES = [
  'OPENAI_COMPATIBLE',
  'CLAUDE',
  'GEMINI',
] as const;
export type AiProviderTypeValue = (typeof AI_PROVIDER_TYPE_VALUES)[number];

export class AiProviderConfigResponseDto {
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

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class UpdateAiProviderConfigDto {
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
}
