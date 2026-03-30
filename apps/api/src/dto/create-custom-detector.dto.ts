import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { CustomDetectorMethod } from '@prisma/client';

export class CreateCustomDetectorDto {
  @ApiProperty({
    description: 'Human-friendly detector name',
    example: 'DACH Contract Risk Terms',
  })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({
    description: 'Stable key override. If omitted, generated from name.',
    example: 'cust_dach_contract_risk',
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
    example: 'Detect legal/compliance risk language in contracts',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: CustomDetectorMethod,
    description: 'Execution method for this custom detector',
    example: CustomDetectorMethod.CLASSIFIER,
  })
  @IsEnum(CustomDetectorMethod)
  method: CustomDetectorMethod;

  @ApiPropertyOptional({
    description: 'Whether this detector can be selected in sources',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    description: 'Custom detector config payload',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  config: Record<string, unknown>;
}
