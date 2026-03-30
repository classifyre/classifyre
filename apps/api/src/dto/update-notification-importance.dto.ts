import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateNotificationImportanceDto {
  @ApiProperty({ default: true })
  @IsBoolean()
  important: boolean;
}
