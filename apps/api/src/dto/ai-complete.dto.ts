import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsString, ValidateNested } from 'class-validator';

export class AiMessageDto {
  @ApiProperty({ enum: ['system', 'user', 'assistant'] })
  @IsIn(['system', 'user', 'assistant'])
  role!: 'system' | 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  content!: string;
}

export class AiCompleteRequestDto {
  @ApiProperty({ type: [AiMessageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiMessageDto)
  messages!: AiMessageDto[];
}

export class AiCompleteResponseDto {
  @ApiProperty()
  content!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  provider!: string;
}
